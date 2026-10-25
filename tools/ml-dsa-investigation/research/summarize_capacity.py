#!/usr/bin/env python3
"""Measure refill capacity, trace coverage, and waits in a fixed-policy campaign."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
from operator import itemgetter

from summarize_multi_wallet import summarize_all
from summarize_refill import distribution, timestamp


def operation_id(value):
    return bytes(value).hex()


def trace_coverage(client, records):
    attempts = []
    operations = {}
    by_request = {}
    by_operation = {'a': {}, 'b': {}}
    outcomes = {}
    for row in records:
        role = row['role']
        if role == 'router':
            if row['http_request'] is not None:
                by_request.setdefault(row['http_request'], []).append(row)
            for outcome in row['signing']:
                outcomes[outcome['operation']] = outcomes.get(outcome['operation'], 0) + 1
        elif role in by_operation:
            for trace in row['signing_traces']:
                by_operation[role].setdefault(trace['operation'], []).append(trace)
    for request in client['requests']:
        identity = request.get('requestId')
        matching = by_request.get(identity, [])
        attempts.append({'request_id': identity, 'router_invocations': len(matching)})
        if request.get('verified'):
            operation = operation_id(request['operation'])
            own = {}
            for role in ['a', 'b']:
                traces = by_operation[role].get(operation, [])
                own[role] = {'traces': len(traces), 'completed': any(trace['completed'] for trace in traces)}
            operations[operation] = {'roles': own, 'router_outcomes': outcomes.get(operation, 0)}
    return {
        'scope': 'Every client HTTP attempt must match exactly one Router invocation. Every verified operation needs a Router outcome and completed traces from both participants.',
        'attempts': attempts,
        'verified_operations': operations,
        'complete': all(item['request_id'] is not None and item['router_invocations'] == 1 for item in attempts)
                    and all(item['router_outcomes'] >= 1 and all(role['completed'] for role in item['roles'].values()) for item in operations.values()),
        'truncated_invocations': sum(row['logs_truncated'] is True for row in records),
    }


def authority_version_coverage(client, records, start, end):
    expected = client['deploymentVersions']['router']
    versions = {}
    undated = 0
    for row in records:
        if row['role'] != 'router' or row['path'] not in ('/control', '/check'):
            continue
        at = row['event_timestamp_ms']
        if at is None:
            undated += 1
            continue
        if not start <= at <= end:
            continue
        version = row['version']
        entry = versions.setdefault(version, {'invocations': 0, 'first_at_ms': at, 'last_at_ms': at})
        entry['invocations'] += 1
        entry['first_at_ms'] = min(entry['first_at_ms'], at)
        entry['last_at_ms'] = max(entry['last_at_ms'], at)
    return {
        'scope': 'Unfiltered admission actor invocation versions during the load window. The public Router version alone does not establish the effective policy.',
        'expected_version': expected,
        'versions': versions,
        'undated_invocations': undated,
        'complete': bool(versions) and set(versions) == {expected} and undated == 0,
    }


def admission_stock_counts(records, start, end):
    checks = []
    for row in records:
        at = row['event_timestamp_ms']
        if row['role'] != 'router' or at is None or not start <= at <= end:
            continue
        stock = row.get('admission_stock', [])
        for item in stock:
            if item['stage'] != 'preflight':
                continue
            claimed = any(event['stage'] == 'claimed' and event['operation'] == item['operation']
                          for event in stock)
            checks.append({'request_id': row['http_request'], 'operation': item['operation'],
                           'paired': item['paired'], 'minimum': item['minimum'], 'claimed': claimed})
    empty = [item for item in checks if item['paired'] < item['minimum']]
    return {'scope': 'Router invocation logs distinguish empty inventory hints from subsequent exclusive claims. These counts do not measure slot occupancy time.',
            'checks': checks, 'empty_checks': len(empty),
            'ready_checks': len(checks) - len(empty),
            'empty_checks_that_claimed': sum(item['claimed'] for item in empty),
            'claimed': sum(item['claimed'] for item in checks)}


def producer_profiles(client, records, start, end):
    active = {(bytes(wallet['key']['public_key_digest']).hex(), wallet['key']['epoch']) for wallet in client['wallets']}
    jobs = []
    unmatched = []
    lifecycle = []
    for row in records:
        at = row['event_timestamp_ms']
        if row['role'] not in ('preparer-a', 'preparer-a-secondary') or not row['producer_alarm'] or at is None or not start <= at <= end:
            continue
        identities = {(item['batch'], tuple(item['batches']), item['key'], item['epoch']) for item in row['producer_jobs']}
        if len(identities) != 1:
            unmatched.append({'at_ms': at, 'cpu_ms': row['cpu_ms'], 'wall_ms': row['wall_ms'], 'outcome': row['outcome']})
            continue
        batch, batches, key, epoch = next(iter(identities))
        entered = bool(row['producer_entries'])
        running = any(item['stage'] == 'running' for item in row['producer_jobs'])
        if not entered or not running:
            lifecycle.append({'batch': batch, 'at_ms': at, 'cpu_ms': row['cpu_ms'],
                              'wall_ms': row['wall_ms'], 'outcome': row['outcome'],
                              'stages': sorted({item['stage'] for item in row['producer_jobs']})})
            continue
        peers = [peer for peer in records if peer['role'] == row['role'].replace('preparer-a', 'preparer-b')
                 and peer['refill_job'] is not None and peer['refill_job']['batch'] == batch]
        peer = peers[0] if len(peers) == 1 else None
        completed = [item for item in row['refill'] if item['batch'] == batch and item['published'] is True]
        jobs.append({'worker_role': row['role'], 'batch': batch, 'batches': list(batches), 'key': key, 'epoch': epoch,
                     'active_wallet': (key, epoch) in active, 'candidates': 2 * len(batches),
                     'started_at_ms': at, 'published_at_ms': min(timestamp(row, item) for item in completed) if completed else None,
                     'a_cpu_ms': row['cpu_ms'], 'a_wall_ms': row['wall_ms'],
                     'b_matches': len(peers), 'b_cpu_ms': peer['cpu_ms'] if peer else None,
                     'b_wall_ms': peer['wall_ms'] if peer else None, 'outcome': row['outcome']})
    execution_counts = {}
    for job in jobs:
        execution_counts[job['batch']] = execution_counts.get(job['batch'], 0) + 1
    for job in jobs:
        if execution_counts[job['batch']] != 1:
            job['b_cpu_ms'] = None
            job['b_wall_ms'] = None
    profiles = []
    for active_wallet in [True, False]:
        for candidates in [2, 4]:
            selected = [job for job in jobs if job['active_wallet'] == active_wallet and job['candidates'] == candidates]
            if not selected:
                continue
            metrics = {}
            for field in ['a_cpu_ms', 'a_wall_ms', 'b_cpu_ms', 'b_wall_ms']:
                metrics[field] = distribution([item[field] for item in selected if item[field] is not None])
            profiles.append({'active_wallet': active_wallet, 'candidates': candidates, 'executing_invocations': len(selected),
                             'unique_jobs': len({item['batch'] for item in selected}),
                             'published_jobs': len({item['batch'] for item in selected if item['published_at_ms'] is not None}),
                             'exact_b_matches': sum(item['b_matches'] == 1 and execution_counts[item['batch']] == 1 for item in selected), **metrics})
    return {'scope': 'Whole producer invocations beginning in the measured window. Their CPU and wall time can include completion after the cutoff. Unattributed alarms remain separate. This is not complete billing.',
            'profiles': profiles, 'jobs': jobs, 'nonexecuting_lifecycle_alarms': lifecycle, 'unattributed_alarms': unmatched}


def expiry_guard(client, campaign, directory, records):
    start = datetime.datetime.fromisoformat(client['observedAt'].replace('Z', '+00:00')).timestamp() * 1000
    end = start + client['elapsedMs']
    expiry = campaign['preparation_expiry_policy_ms']
    registration_expiry = []
    for wallet in client['wallets']:
        source = directory / ('registration-' + str(wallet['index'] + 1) + '.json')
        registration = json.loads(source.read_text())
        latest = registration['cases'][-1]
        assert latest['key'] == wallet['key'], 'Recovery epoch changed during the load test'
        registration_expiry.append(latest['initialSigningStockExpiresAtMs'])
    guard = max(start + expiry['refill_stock'], *registration_expiry)
    assert max(registration_expiry) <= start + expiry['initial_registration_stock'], 'Initial registration stock exceeds its declared lifetime'
    first_attempts = {}
    for request in client['requests']:
        operation = operation_id(request['operation'])
        first_attempts[operation] = min(first_attempts.get(operation, request['startMs']), request['startMs'])
    requests = [request for request in client['requests'] if request.get('verified')
                and start + first_attempts[operation_id(request['operation'])] >= guard]
    producer = producer_profiles(client, records, start, end)
    published = [job for job in producer['jobs'] if job['active_wallet'] and job['published_at_ms'] is not None
                 and guard <= job['published_at_ms'] <= end]
    elapsed = max(0, end - guard)
    return {'scope': 'Conservative interval after all material present or in flight before load must be expired or consumed. Uses recorded initial-registration expiry and the campaign refill lifetime. Only operations whose first HTTP attempt starts after that bound count. Earlier operations stay excluded.',
            'start_ms': guard, 'elapsed_ms': elapsed,
            'verified_signatures': len(requests),
            'successful_signatures_per_minute': len(requests) * 60000 / elapsed if elapsed else None,
            'published_candidate_groups': len(published),
            'published_candidates': sum(job['candidates'] for job in published),
            'published_candidates_per_minute': sum(job['candidates'] for job in published) * 60000 / elapsed if elapsed else None,
            'registration_expiry_ms': registration_expiry,
            'refill_lifetime_ms': expiry['refill_stock']}


def starting_stock_bound(client, records, summary, start, end):
    terminal = {}
    for request in client['requests']:
        if request.get('state') in ('succeeded', 'failed', 'declined') and 'completedAtMs' in request:
            if request['state'] != 'succeeded' or request.get('verified'):
                identity = operation_id(request['operation'])
                terminal[identity] = min(terminal.get(identity, request['completedAtMs']), request['completedAtMs'])
    taken = {'a': {}, 'b': {}}
    for row in records:
        if row['role'] not in taken:
            continue
        for stage in row['material_stages']:
            value = stage['value']
            if value['stage'] == 'taken':
                taken[row['role']].setdefault(value['material_id'], set()).add(stage['operation'])
    bounds = []
    unresolved = []
    excluded = set()
    additional = set()
    for wallet in summary['wallets']:
        snapshot = wallet['initial_observed_stock']
        scope = (snapshot['key'], snapshot['epoch'])
        initial = set(wallet['initial_ids_including_prestarted_producers'])
        observed = set()
        lifetimes = {}
        prestarted = set()
        for row in records:
            for inventory in row['inventories']:
                if (inventory['key'], inventory['epoch']) == scope and start <= timestamp(row, inventory) <= end:
                    for field in ('ready_a', 'ready_b', 'reserved_a', 'reserved_b'):
                        observed.update(inventory[field])
            for claim in row['refill_claims']:
                if claim['status'] != 'acquired' or (claim['key'], claim['epoch']) != scope:
                    continue
                for batch in claim['batches']:
                    lifetimes.setdefault(batch, set()).add(claim['material_expires_at_ms'])
                    if timestamp(row, claim) < start:
                        prestarted.add(batch)
            job = row['refill_job']
            if job and (job['key'], job['epoch']) == scope:
                for batch in job['batches']:
                    lifetimes.setdefault(batch, set()).add(job['material_expires_at_ms'])
                    if row['event_timestamp_ms'] < start:
                        prestarted.add(batch)
        additional.update((prestarted & observed) - initial)
        initial.update(prestarted & observed)
        owners = {}
        for operation in wallet['consumption']:
            for batch in operation.get('batches', []):
                owners.setdefault(batch, set()).add(operation['operation'])
        for batch in sorted(initial):
            excluded.add(batch)
            operations = owners.get(batch, set())
            a = taken['a'].get(batch, set())
            b = taken['b'].get(batch, set())
            if len(operations) == 1 and a == operations and b == operations:
                operation = next(iter(operations))
                if operation in terminal:
                    bounds.append({'batch': batch, 'kind': 'terminal_consumption', 'operation': operation,
                                   'cannot_contribute_after_ms': terminal[operation]})
                    continue
            deadlines = lifetimes.get(batch, set())
            if not operations and not a and not b and len(deadlines) == 1:
                bounds.append({'batch': batch, 'kind': 'material_deadline', 'retirement_cause': 'unobserved',
                               'cannot_contribute_after_ms': next(iter(deadlines))})
            else:
                unresolved.append({'batch': batch, 'reason': 'Missing or conflicting consumption, terminal response, or deadline evidence'})
    bound = max([start, *(item['cannot_contribute_after_ms'] for item in bounds)]) if not unresolved else None
    elapsed = end - bound if bound is not None and bound < end else 0
    successes = [request for request in client['requests'] if request.get('verified')
                 and bound is not None and request['startAtMs'] > bound]
    return {'scope': 'Each excluded pair has either a terminal client response backed by identical A/B taken events, or one recorded deadline with no taken event. The interval starts after the latest bound. A material deadline proves no later contribution; its retirement cause stays unobserved. This finite interval does not prove full reserve restoration or maximum sustainable capacity.',
            'excluded_pairs': len(excluded), 'additional_prestarted_pairs': sorted(additional),
            'pair_bounds': bounds, 'unresolved': unresolved,
            'start_ms': bound, 'elapsed_ms': elapsed, 'verified_signatures': len(successes),
            'successful_signatures_per_minute': len(successes) * 60000 / elapsed if elapsed else None}


def bounded_records(records, horizon):
    bounded = []
    for record in records:
        event_at = record['event_timestamp_ms']
        if event_at is not None and event_at > horizon:
            continue
        row = dict(record)
        for field in ('inventories', 'refill', 'refill_claims', 'refill_recovery',
                      'refill_wakes', 'producer_jobs', 'producer_entries', 'producer_startup',
                      'signing', 'signing_traces', 'material_stages', 'preparation_stages'):
            row[field] = [item for item in record[field]
                          if timestamp(record, item) is None or timestamp(record, item) <= horizon]
        bounded.append(row)
    return bounded


def unused_material_audit(records, summary, start, horizon):
    lifetimes = {}
    taken = set()
    snapshots = {}
    for row in records:
        for claim in row['refill_claims']:
            if claim['status'] == 'acquired':
                for batch in claim['batches']:
                    lifetimes.setdefault(batch, set()).add(claim['material_expires_at_ms'])
        job = row['refill_job']
        if job:
            for batch in job['batches']:
                lifetimes.setdefault(batch, set()).add(job['material_expires_at_ms'])
        for item in row['material_stages']:
            if item['value']['stage'] == 'taken':
                taken.add(item['value']['material_id'])
        for inventory in row['inventories']:
            at = timestamp(row, inventory)
            if at is not None and start <= at <= horizon:
                scope = (inventory['key'], inventory['epoch'])
                ready = set(inventory['ready_a']) | set(inventory['ready_b'])
                reserved = set(inventory['reserved_a']) | set(inventory['reserved_b'])
                snapshots.setdefault(scope, []).append((at, ready, reserved))
    for values in snapshots.values():
        values.sort(key=itemgetter(0))
    initial = {batch for wallet in summary['wallets']
               for batch in wallet['initial_ids_including_prestarted_producers']}
    initial.update(summary['after_starting_stock_disposal_bound']['additional_prestarted_pairs'])
    result = []
    for wallet in summary['wallets']:
        snapshot = wallet['initial_observed_stock']
        scope = (snapshot['key'], snapshot['epoch'])
        for batch in wallet['unaccounted_batch_ids'] or []:
            deadlines = lifetimes.get(batch, set())
            deadline = next(iter(deadlines)) if len(deadlines) == 1 else None
            seen = False
            absent = []
            reappeared = False
            for at, ready, reserved in snapshots.get(scope, []):
                if batch in ready:
                    if seen is False or absent:
                        reappeared = reappeared or bool(absent)
                    seen = True
                elif seen and batch not in reserved:
                    absent.append(at)
                    seen = False
            first_absent = min(absent) if absent else None
            result.append({'wallet': wallet['wallet_index'], 'batch': batch,
                           'starting_pair': batch in initial, 'has_taken_event': batch in taken,
                           'material_deadline_ms': deadline, 'deadline_at_or_before_horizon': deadline is not None and deadline <= horizon,
                           'first_absent_ms': first_absent,
                           'lifetime_at_first_absence_ms': deadline - first_absent if deadline is not None and first_absent is not None else None,
                           'reappeared': reappeared, 'retirement_cause': 'unobserved'})
    return {'scope': 'Unaccounted pairs are audited against recorded deadlines and actual taken events. Readiness disappearance is an observation, not proof of a retirement event.',
            'pairs': result, 'count': len(result),
            'newly_prepared_pairs': sum(not item['starting_pair'] for item in result),
            'deadlines_passed': sum(item['deadline_at_or_before_horizon'] for item in result),
            'conflicting_taken_events': sum(item['has_taken_event'] for item in result),
            'missing_or_conflicting_deadlines': sum(item['material_deadline_ms'] is None for item in result),
            'early_disappearances': sum(item['lifetime_at_first_absence_ms'] is not None and item['lifetime_at_first_absence_ms'] > 30000 for item in result)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('client', type=Path)
    parser.add_argument('traces', type=Path)
    parser.add_argument('campaign', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    client = json.loads(args.client.read_text())
    campaign = json.loads(args.campaign.read_text())
    versions = client['deploymentVersions']
    rows = json.loads(args.traces.read_text())['records']
    records = [row for row in rows if row['version'] == versions.get(row['role'])]
    start = datetime.datetime.fromisoformat(client['observedAt'].replace('Z', '+00:00')).timestamp() * 1000
    end = start + client['elapsedMs']
    horizon = end + 120000
    records = bounded_records(records, horizon)
    report = summarize_all(client, records, versions)
    report['analysis_horizon_ms'] = horizon
    report['service_non_ok_invocations'] = [row for row in records
        if row['event_timestamp_ms'] is not None and start <= row['event_timestamp_ms'] <= end
        and (row['outcome'] != 'ok' or row['exception_names'])]
    report['trace_coverage'] = trace_coverage(client, records)
    report['authority_version_coverage'] = authority_version_coverage(client, rows, start, end)
    report['admission_stock'] = admission_stock_counts(records, start, end)
    report['producer_profiles'] = producer_profiles(client, records, start, end)
    report['after_starting_stock_expiry'] = expiry_guard(client, campaign, args.campaign.parent, records)
    report['after_starting_stock_disposal_bound'] = starting_stock_bound(client, records, report, start, end)
    report['unused_material_audit'] = unused_material_audit(records, report, start, horizon)
    report['input_sha256'] = {name: hashlib.sha256(path.read_bytes()).hexdigest()
                              for name, path in [('client', args.client), ('traces', args.traces), ('campaign', args.campaign)]}
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'wallets': len(client['wallets']), 'signatures': client['successfulSignatures'],
                      'trace_coverage': report['trace_coverage']['complete'],
                      'authority_version_coverage': report['authority_version_coverage']['complete'],
                      'ledger_complete': report['stock_ledger_complete'],
                      'post_expiry': report['after_starting_stock_expiry']}))
    if not report['authority_version_coverage']['complete']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
