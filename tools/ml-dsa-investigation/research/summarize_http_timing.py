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
        assert timing['echo'] in (None, identity)
        operation = bytes(request['operation']).hex()
        events = timing.get('events')
        counts = None if events is None else dict(collections.Counter(event['stage'] for event in events))
        ambiguous = events is not None and (timing['eventsTruncated'] or any(counts.get(stage) != 1 for stage in ['created', 'sent', 'headers', 'complete']))
        start = request['startMs']
        end = start + request.get('elapsedMs', timing['totalMs'])
        loop_gaps = [gap for gap in client.get('eventLoopGaps', []) if gap['previousMs'] < end and gap['observedMs'] > start]
        row = {
            'http_request': identity, 'operation': operation, 'verified': request.get('verified', False),
            'client_total_ms': request.get('elapsedMs'), 'observer_total_ms': timing['totalMs'], 'cf_ray': timing['cfRay'], 'socket': timing['socket'],
            'pre_send_ms': timing['sentMs'],
            'response_header_wait_ms': delta(timing, 'responseHeadersMs', 'sentMs'),
            'response_wire_body_ms': delta(timing, 'responseCompleteMs', 'responseHeadersMs'),
            'body_read_ms': delta(timing, 'bodyReadMs', 'fetchHeadersMs'),
            'json_parse_ms': delta(timing, 'parsedMs', 'bodyReadMs'),
            'echo_matched': timing['echo'] == identity,
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
            if trace['status'] is not None and timing['status'] is not None:
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
        'scope': 'Exact HTTP-attempt IDs, with separate operation IDs for retries. Client timers are monotonic. Socket DNS/TCP/TLS fields are cumulative from socket creation and belong to that connection, including its later reuse; do not add them to each request. Router stage clocks can omit CPU. Client minus Router invocation wall time remains a signed, unassigned difference, not a network measurement. Missing or repeated Router IDs remain unjoined. Earlier clients lack repeated-event counters and event-loop observations. Their phase fields are last retained diagnostic events; multiplicity is unobserved.',
        'coverage': dict(coverage), 'event_loop_gaps': client.get('eventLoopGaps'), 'attempts': len(rows), 'successful_attempts': len(success),
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
