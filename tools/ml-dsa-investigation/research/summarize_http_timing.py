#!/usr/bin/env python3
"""Join each client HTTP attempt to exactly one version-matched Router invocation."""
import argparse
import collections
import hashlib
import json
import math
from pathlib import Path

from summarize_refill import distribution


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def delta(timing, end, start):
    a, b = timing.get(start), timing.get(end)
    return b - a if finite(a) and finite(b) and b >= a else None


def socket_queue_observations(requests):
    intervals = []
    for request in requests:
        timing = request['http']
        if timing.get('socket') is None or not all(finite(timing.get(field)) for field in ['sentMs', 'responseCompleteMs']):
            continue
        events = timing.get('events', [])
        counts = collections.Counter(event['stage'] for event in events)
        if timing.get('eventsTruncated') or any(counts[stage] != 1 for stage in ['created', 'sent', 'headers', 'complete']):
            continue
        start = timing.get('clientStartedMs', request['startMs'])
        intervals.append({
            'request': timing['requestId'], 'client': timing.get('clientId'), 'socket': timing['socket']['id'],
            'start_ms': start, 'send_ms': start + timing['sentMs'],
            'complete_ms': start + timing['responseCompleteMs'],
            'pre_send_ms': timing['sentMs'], 'protocol': timing['socket'].get('protocol'),
            'http2': timing.get('http2'),
        })
    intervals.sort(key=lambda row: row['send_ms'])
    previous = {}
    observations = []
    for interval in intervals:
        connection = (interval['client'], interval['socket'])
        earlier = previous.get(connection)
        if earlier is not None and interval['pre_send_ms'] >= 100 and earlier['complete_ms'] > interval['start_ms']:
            observations.append({
                'http_request': interval['request'], 'previous_http_request': earlier['request'],
                'client': interval['client'], 'socket': interval['socket'], 'protocol': interval['protocol'], 'http2': interval['http2'],
                'pre_send_ms': interval['pre_send_ms'],
                'previous_remaining_at_start_ms': earlier['complete_ms'] - interval['start_ms'],
                'previous_complete_to_send_ms': interval['send_ms'] - earlier['complete_ms'],
            })
        previous[connection] = interval
    return observations


def summarize(client, records, versions):
    routers = collections.defaultdict(list)
    for index, record in enumerate(records):
        if record['role'] != 'router' or record['version'] != versions.get('router'):
            continue
        for trace in record.get('router_traces', []):
            routers[trace['http_request']].append((index, record, trace))
    rows = []
    seen = set()
    coverage = collections.Counter()
    for request in client['requests'] + client['duplicateRequests']:
        timing = request['http']
        identity = timing['requestId']
        assert identity not in seen, 'HTTP request identity was reused'
        seen.add(identity)
        assert timing.get('echo') in (None, identity)
        operation = bytes(request['operation']).hex()
        events = timing.get('events')
        counts = None if events is None else dict(collections.Counter(event['stage'] for event in events))
        ambiguous = events is not None and (timing['eventsTruncated'] or any(counts.get(stage) != 1 for stage in ['created', 'sent', 'headers', 'complete']))
        start = request['startMs']
        elapsed = request.get('elapsedMs', timing.get('parentElapsedMs'))
        end = start + elapsed if finite(elapsed) else None
        loop_gaps = None if end is None else [gap for gap in client.get('eventLoopGaps', []) if gap['previousMs'] < end and gap['observedMs'] > start]
        row = {
            'http_request': identity, 'operation': operation, 'verified': request.get('verified', False),
            'client_total_ms': elapsed, 'observer_total_ms': timing.get('totalMs'), 'cf_ray': timing.get('cfRay'), 'socket': timing.get('socket'),
            'http2': timing.get('http2'),
            'client': timing.get('clientId'), 'fetch_event_loop_gaps': timing.get('fetchEventLoopGaps'),
            'worker_timing_received': timing.get('workerTimingReceived'),
            'pre_send_ms': timing.get('sentMs'),
            'response_header_wait_ms': delta(timing, 'responseHeadersMs', 'sentMs'),
            'response_wire_body_ms': delta(timing, 'responseCompleteMs', 'responseHeadersMs'),
            'body_read_ms': delta(timing, 'bodyReadMs', 'fetchHeadersMs'),
            'json_parse_ms': delta(timing, 'parsedMs', 'bodyReadMs'),
            'echo_matched': timing.get('echo') == identity,
            'router': None, 'transport_event_counts': counts, 'ambiguous_transport_events': ambiguous,
            'event_loop_observed': 'eventLoopGaps' in client, 'overlapping_event_loop_gaps': loop_gaps,
        }
        if ambiguous:
            coverage['ambiguous_transport_events'] += 1
            for field in ['pre_send_ms', 'response_header_wait_ms', 'response_wire_body_ms']:
                row[field] = None
        matches = routers[identity]
        if len(matches) != 1:
            coverage['missing_router_trace' if not matches else 'multiple_router_traces'] += 1
        else:
            index, record, trace = matches[0]
            assert trace['operation'] == operation
            if trace['status'] is not None and timing.get('status') is not None:
                assert trace['status'] == timing['status']
            stages = trace['milestones']
            assert len({s['stage'] for s in stages}) == len(stages)
            spans = {}
            for a, b in zip(stages, stages[1:]):
                spans[a['stage'] + '_to_' + b['stage']] = delta({'a': a['at_ms'], 'b': b['at_ms']}, 'b', 'a')
            row['router'] = {
                'record_index': index, 'module_instance': trace['module_instance'],
                'cpu_ms': record['cpu_ms'], 'wall_ms': record['wall_ms'],
                'milestones': stages, 'service_clock_spans_ms': spans,
                'client_minus_router_wall_ms': request['elapsedMs'] - record['wall_ms'] if finite(request.get('elapsedMs')) and finite(record['wall_ms']) else None,
            }
            coverage['matched_router_trace'] += 1
        rows.append(row)
    success = [r for r in rows if r['verified']]
    metrics = {}
    for name in ['client_total_ms', 'pre_send_ms', 'response_header_wait_ms', 'response_wire_body_ms', 'body_read_ms', 'json_parse_ms']:
        metrics[name] = distribution([r[name] for r in success if finite(r[name])])
    return {
        'scope': 'Exact HTTP-attempt IDs, with separate operation IDs for retries. Socket and session identities are local to each recorded client. Queue joins use that client and its monotonic fetch clock. Driver durations include client dispatch and result delivery. Socket DNS/TCP/TLS fields belong to connection creation and must not be added to later requests. Fetch-loop gaps are separate from driver-loop gaps. Router clocks can omit CPU; client minus Router wall time is an unassigned difference. Missing or repeated Router IDs remain unjoined. Earlier records can lack client identity, repeated-event counters, and loop observations.',
        'coverage': dict(coverage), 'event_loop_gaps': client.get('eventLoopGaps'), 'attempts': len(rows), 'successful_attempts': len(success),
        'socket_queue_observations': socket_queue_observations(client['requests'] + client['duplicateRequests']),
        'successful_client_metrics': metrics,
        'successful_router_wall_ms': distribution([r['router']['wall_ms'] for r in success if r['router'] and finite(r['router']['wall_ms'])]),
        'successful_unassigned_difference_ms': distribution([r['router']['client_minus_router_wall_ms'] for r in success if r['router'] and finite(r['router']['client_minus_router_wall_ms'])]),
        'slow_successes': [r for r in success if r['client_total_ms'] >= 5000],
        'rows': rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('client', type=Path)
    parser.add_argument('traces', type=Path)
    parser.add_argument('versions', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    result = summarize(json.loads(args.client.read_text()), json.loads(args.traces.read_text())['records'], json.loads(args.versions.read_text()))
    result['script_sha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: result[key] for key in ['coverage', 'attempts', 'successful_client_metrics']}))


if __name__ == '__main__':
    main()
