#!/usr/bin/env python3
"""Summarize public signing and registration boundaries without imputing missing calls."""
import argparse
import collections
import hashlib
import json
from pathlib import Path

from summarize_refill import distribution


def spans(marks):
    result = {}
    for previous, current in zip(marks, marks[1:]):
        start, end = previous['at_ms'], current['at_ms']
        name = previous['stage'] + '_to_' + current['stage']
        if name in result:
            result[name] = None
        else:
            result[name] = end - start if start is not None and end is not None and end >= start else None
    return result


def call_lists():
    return collections.defaultdict(list)


def summarize(records, versions, registrations):
    stages = []
    router = collections.defaultdict(list)
    totals = collections.defaultdict(list)
    for index, record in enumerate(records):
        if record['version'] != versions.get(record['role']):
            continue
        for trace in record.get('stage_traces', []):
            row = {'record_index': index, 'worker_role': record['role'],
                   'invocation_wall_ms': record['wall_ms'], 'invocation_cpu_ms': record['cpu_ms'],
                   **trace, 'service_clock_spans_ms': spans(trace['marks'])}
            row['clock_spans_exceeding_invocation_wall'] = [
                name for name, elapsed in row['service_clock_spans_ms'].items()
                if elapsed is not None and record['wall_ms'] is not None and elapsed > record['wall_ms']
            ]
            stages.append(row)
            kind = trace['context']['kind']
            for name, elapsed in row['service_clock_spans_ms'].items():
                if elapsed is not None:
                    totals[(kind, trace['role'], trace['completed'], name)].append(elapsed)
        if record['role'] == 'router' and record['path'] == '/router-ab/ml-dsa/register':
            for trace in record.get('router_traces', []):
                router[trace['http_request']].append({
                    'record_index': index, 'invocation_wall_ms': record['wall_ms'],
                    'invocation_cpu_ms': record['cpu_ms'], **trace,
                    'service_clock_spans_ms': spans(trace['milestones']),
                })
    material = collections.defaultdict(call_lists)
    for row in stages:
        if row['context']['kind'] in ('take_caller', 'take_store'):
            key = (row['operation'], row['role'], row['context']['material'])
            material[key][row['context']['kind']].append(row)
    takes = []
    for (operation, role, batch), calls in sorted(material.items()):
        caller = calls.get('take_caller', [])
        store = calls.get('take_store', [])
        unique = len(caller) == 1 and len(store) == 1
        takes.append({'operation': operation, 'role': role, 'material': batch,
                      'unique_pair': unique, 'callers': caller, 'stores': store})
    client_ids = collections.Counter(
        attempt['httpRequest'] for registration in registrations
        for attempt in registration.get('httpAttempts', [])
        if attempt['path'] == '/router-ab/ml-dsa/register'
    )
    attempts = []
    for wallet, registration in enumerate(registrations, 1):
        for attempt in registration.get('httpAttempts', []):
            if attempt['path'] != '/router-ab/ml-dsa/register':
                continue
            candidates = router.get(attempt['httpRequest'], [])
            match = None
            if client_ids[attempt['httpRequest']] == 1 and len(candidates) == 1:
                candidate = candidates[0]
                if (candidate['operation'] == attempt['operation']
                        and attempt['status'] is not None and candidate['status'] == attempt['status']
                        and attempt['echoedRequestId'] == attempt['httpRequest']):
                    match = candidate
            attempts.append({'wallet': wallet, **attempt,
                             'client_id_count': client_ids[attempt['httpRequest']],
                             'router_join': 'unique' if match else ('missing' if not candidates else 'ambiguous_or_mismatched'),
                             'router': match})
    return {
        'scope': 'Exact-version public diagnostics. Service clocks can omit CPU and I/O. Adjacent spans include all work between their named boundaries, not isolated storage, CPU, or network time. Invocation wall/CPU values belong to the entire enclosing record and must not be summed across its multiple stage traces. Material caller/store joins require one retained call on each side. Missing traces can conceal retries. Registration Router joins require unique client and Router HTTP IDs, operation, status, and echoed ID; role contexts remain separate from HTTP attempts and preserve every call, including replays and incomplete calls. Distributions separate completed/incomplete records; completed replay prefixes remain included. Client HTTP records cover post() calls; direct raw() fault and refusal probes are outside this recorder.',
        'counts': dict(collections.Counter(row['context']['kind'] for row in stages)),
        'calls_with_clock_spans_exceeding_invocation_wall': sum(bool(row['clock_spans_exceeding_invocation_wall']) for row in stages),
        'unique_material_pairs': sum(row['unique_pair'] for row in takes),
        'unpaired_material_contexts': sum(not row['unique_pair'] for row in takes),
        'distributions': [
            {'kind': kind, 'role': role, 'completed': completed, 'span': name, 'service_clock_ms': distribution(values)}
            for (kind, role, completed, name), values in sorted(totals.items())
        ],
        'registration_attempts': attempts,
        'material_calls': takes,
        'stage_calls': stages,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('profile', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    records = json.loads((args.profile / 'traces.json').read_text())['records']
    versions = json.loads((args.profile / 'hosted/versions.json').read_text())
    registrations = [json.loads((args.profile / f'registration-{wallet}.json').read_text()) for wallet in [1, 2]]
    result = summarize(records, versions, registrations)
    result['script_sha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: result[key] for key in ['counts', 'unique_material_pairs', 'unpaired_material_contexts']}))


if __name__ == '__main__':
    main()
