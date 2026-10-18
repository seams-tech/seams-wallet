#!/usr/bin/env python3
"""Recompute public preparation measurements from native and Worker E2E artifacts."""
import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path


def read(path):
    raw = path.read_bytes()
    if path.suffix == '.gz':
        raw = gzip.decompress(raw)
    return json.loads(raw)


def artifact_identity(path):
    return {'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def readiness(run, count):
    previous = 0
    for item in run['initialReserveMilestones']:
        if item['paired'] >= count:
            reads = [entry for entry in run.get('preparationReads', []) if entry['finishMs'] <= item['elapsedMs']]
            if len(reads) >= 2:
                lower = reads[-2]['startMs']
                source = 'Previous polling read start'
            else:
                lower = previous
                source = 'Previous count-change observation; individual reads were not retained'
            return {
                'lower_observation_bound_ms': lower,
                'lower_bound_source': source,
                'first_observed_ms': item['elapsedMs'],
                'note': 'Separate role reads are not an atomic snapshot. These are observation bounds during monotonic initial fill.',
            }
        previous = item['elapsedMs']
    return None


def worker_summary(run):
    return {
        'passed': run['passed'],
        'profiled': run['profilePreparation'],
        'passive_observer': run.get('passivePreparationObserver', False),
        'post_install_full_reserve_ms': run['initialReserveRefillMs'],
        'activation_to_full_reserve_ms': run.get('activationToFullReserveMs'),
        'first_admissible_reserve': readiness(run, run['policy']['minimum_ready_batches']),
        'full_reserve': readiness(run, run['policy']['refill_target_batches']),
        'signing_ms': [item['elapsedMs'] for item in run['signatures']],
        'failed_signing_operations': len(run['failedOperations']),
        'openssl_verified': run.get('standardSignaturesVerifiedByOpenSsl'),
        'error': run.get('error'),
    }


def classify(profile):
    nodes = {node['id']: node for node in profile['nodes']}
    parents = {child: node['id'] for node in profile['nodes'] for child in node.get('children', [])}
    categories = {
        'silent_generation_ancestry': '::silent::generate_chunk',
        'pprf_expansion_ancestry': '::silent::pprf::expand_level',
        'public_encoder_ancestry': 'cryprot_codes',
    }
    names = [*categories, 'aes_self']
    weights = dict.fromkeys(names, 0)
    counts = dict.fromkeys(names, 0)
    sensitivity = dict.fromkeys(names, 0)
    assert len(profile['samples']) == len(profile['timeDeltas'])
    for sample, delta in zip(profile['samples'], profile['timeDeltas']):
        ancestry = []
        current = sample
        while current is not None:
            ancestry.append(nodes[current]['callFrame']['functionName'])
            current = parents.get(current)
        matched = [name for name, text in categories.items() if any(text in frame for frame in ancestry)]
        if 'aes[' in ancestry[0]:
            matched.append('aes_self')
        for name in matched:
            weights[name] += delta
            counts[name] += 1
            if delta <= 10_000:
                sensitivity[name] += delta
    deltas = profile['timeDeltas']
    total = sum(deltas)
    short_total = sum(delta for delta in deltas if delta <= 10_000)
    return {
        'window_us': profile['endTime'] - profile['startTime'],
        'sample_weight_us': total,
        'sample_count': len(deltas),
        'maximum_delta_us': max(deltas),
        'weight_over_100ms_percent': 100 * sum(delta for delta in deltas if delta > 100_000) / total,
        'categories': {
            name: {
                'weighted_percent': 100 * weights[name] / total,
                'sample_count_percent': 100 * counts[name] / len(deltas),
                'sensitivity_weighted_percent_excluding_intervals_over_10ms': 100 * sensitivity[name] / short_total,
            } for name in names
        },
        'limits': 'Ancestry categories overlap. Do not add them. Sample weights are diagnostic wall intervals, not billed CPU or speedup bounds. Excluding long intervals is only a sensitivity check.',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('native', type=Path)
    parser.add_argument('recovery', type=Path)
    parser.add_argument('control', type=Path)
    parser.add_argument('passive', type=Path)
    parser.add_argument('profile', type=Path)
    parser.add_argument('repeat', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    paths = [args.native, args.recovery, args.control, args.passive, args.profile, args.repeat]
    native, recovery, control, passive, profiled, repeat = [read(path) for path in paths]
    assert passive['passed'] and profiled['passed'] and repeat['passed']
    assert all(run['workerWasmSha256'] == passive['workerWasmSha256'] for run in [control, profiled, repeat])
    assert recovery['same_wallet_seed_and_binding_reproduce_key']
    assert recovery['changed_seed_or_binding_changes_key']
    for case in native['cases']:
        assert case['canonical_key_verified']
    validation = native['cases'][1]['post_timer_key_validation']
    cases = validation['prepared_signing']['cases']
    case = next(item for item in cases if item['engine'] == 'gmw' and item['capacity'] == 4)
    result = case['b']['result']
    stages = dict(zip(
        ['nonce_conversion', 'commitment_decomposition', 'challenge_hash', 'private_bounds', 'decision'],
        [item['and_gates'] for item in result['preparation_batches'] + result['batches']],
        strict=True,
    ))
    assert len(stages) == 5
    total = sum(stages.values())
    chunk = 262_144
    separate = 4 * math.ceil(total / chunk)
    grouped = math.ceil(4 * total / chunk)
    output = {
        'scope': 'Current local Worker preparation baseline. No hosted or production-latency claim.',
        'inputs': [artifact_identity(path) for path in paths],
        'workers': {
            'historical_observer_control': worker_summary(control),
            'passive_observer': worker_summary(passive),
            'profiled_passive_observer': worker_summary(profiled),
            'repeated_passive_observer': worker_summary(repeat),
        },
        'profiles': [
            {'role': item['title'], **classify(item['profile'])}
            for item in profiled['preparationProfile']['profiles']
        ],
        'correlation_work': {
            'source': 'Native metrics for one four-candidate GMW reservation; same public circuit set as Worker preparation.',
            'and_gates_by_stage': stages,
            'total_and_gates': total,
            'triples_per_chunk': chunk,
            'chunks_per_batch': math.ceil(total / chunk),
            'chunks_for_four_separate_batches': separate,
            'chunks_for_one_sixteen_candidate_reservation': grouped,
            'chunk_reduction_percent': 100 * (separate - grouped) / separate,
            'claim': 'Arithmetic estimate of chunk padding only. Grouped durable preparation is not implemented or measured here.',
            'native_preparation_protocol_bytes_both_directions': sum(case[role]['preparation_traffic']['sent_bytes'] for role in ['a', 'b']),
        },
        'recovery': {
            'canonical_key_cases': len(native['cases']),
            'same_wallet_seed_and_binding_reproduce_key': recovery['same_wallet_seed_and_binding_reproduce_key'],
            'changed_seed_or_binding_changes_key': recovery['changed_seed_or_binding_changes_key'],
            'expanded_private_key_matches_openssl': validation['authorized_recovery']['reconstructed_k_s1_s2_t0_match_openssl_expanded_private_key'],
            'limit': 'Native recovery E2E. Worker harness installs disposable role material; full public Worker registration/recovery remains outside this test.',
        },
        'recommendation': 'Prioritize a protocol-preserving silent-OT/PPRF/AES optimization experiment. Keep Quantus conversion research gated on share privacy and canonical recovery.',
        'unmeasured': ['Hosted latency', 'Direct Worker CPU and billing', 'Worker peak memory', 'Worker protocol and storage byte totals', 'Sustained refill capacity', 'Production percentiles'],
    }
    args.output.write_text(json.dumps(output, indent=2) + '\n')


if __name__ == '__main__':
    main()
