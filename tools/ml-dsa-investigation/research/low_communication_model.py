#!/usr/bin/env python3
"""Model GMW payloads from recorded circuit counts and measured silent triples."""

import argparse
import hashlib
import json
import math
import pathlib
import statistics


def load(path):
    return json.loads(path.read_text())


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def openings(gates, lanes):
    # Two masked bits per role and AND, with byte padding across bit lanes.
    return 4 * gates * math.ceil(lanes / 8)


def batch_payload(size, schedules, chunk_size, chunk_bytes, chunk_ms):
    nonce_shapes = [("fresh-mask", 5), ("prepared-commitment", 6)]
    online_shapes = [
        ("commitment-hash", 1),
        ("response-check", 5),
        ("low-response-check", 6),
        ("bounds-decision", 1),
    ]
    nonce_gates = sum(schedules[name]["and_gates"] * count * size for name, count in nonce_shapes)
    online_gates = sum(schedules[name]["and_gates"] * count * size for name, count in online_shapes)
    nonce_openings = sum(openings(schedules[name]["and_gates"], count * size) for name, count in nonce_shapes)
    online_openings = sum(openings(schedules[name]["and_gates"], count * size) for name, count in online_shapes)
    chunks = math.ceil((nonce_gates + online_gates) / chunk_size)
    # Current schedules output 736/864 private bytes per nonce polynomial.
    # Online output: 48 public bytes twice, 11 private bits padded separately,
    # and one aggregate decision byte twice. Request binding is excluded.
    nonce_outputs = size * (5 * 736 + 6 * 864)
    online_outputs = size * (2 * 48 + 11 + 2)
    offline_bytes = chunks * chunk_bytes + nonce_openings + nonce_outputs
    online_bytes = online_openings + online_outputs
    return {
        "candidates": size,
        "nonce_and_gates": nonce_gates,
        "online_and_gates": online_gates,
        "fresh_correlation_chunks": chunks,
        "discarded_padding_triples": chunks * chunk_size - nonce_gates - online_gates,
        "correlation_bytes": chunks * chunk_bytes,
        "nonce_opening_bytes": nonce_openings,
        "nonce_output_bytes": nonce_outputs,
        "online_opening_bytes": online_openings,
        "online_output_bytes": online_outputs,
        "offline_counted_payload_bytes": offline_bytes,
        "online_counted_payload_bytes": online_bytes,
        "total_counted_payload_bytes": offline_bytes + online_bytes,
        "native_correlation_time_projection_ms": chunks * chunk_ms,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    args = parser.parse_args()
    native_path = args.evidence / "ml-dsa-65-fixed-base-complete-native-20261014.json"
    silent_path = args.evidence / "ml-dsa-65-silent-triples-native-screen-20261014.json"
    native = load(native_path)
    silent = load(silent_path)
    assert silent["production_eligible"] is False
    measured = []
    for case in silent["cases"]:
        if case["requested_triples"] == 262144 and not case["warmup"] and not case["padding_case"]:
            assert case["profile_selected_before_base_ot"]
            assert case["triple_invariant_verified"] and case["shared_and_verified"]
            measured.append(case)
    assert len(measured) >= 3
    chunk_bytes = sum(measured[0]["total_sent_bytes"])
    assert all(sum(case["total_sent_bytes"]) == chunk_bytes for case in measured)
    chunk_ms = statistics.median(case["total_ms"] for case in measured)
    schedules = {schedule["name"]: schedule for schedule in native["prepared_signing_schedules"]}
    signing_cases = native["cases"][1]["post_timer_key_validation"]["prepared_signing"]["cases"]
    baseline = None
    for case in signing_cases:
        if case["engine"] != "gmw":
            continue
        modeled = batch_payload(case["capacity"], schedules, 262144, chunk_bytes, chunk_ms)
        measured_openings = 0
        for role in ["a", "b"]:
            measured_openings += sum(batch["phases"][4]["sent_bytes"] for batch in case[role]["result"]["batches"])
        assert measured_openings == modeled["online_opening_bytes"]
        if case["capacity"] == 32:
            baseline = case
    assert baseline is not None
    prep = sum(baseline[role]["offline"]["sent_bytes"] for role in ["a", "b"])
    boolean = sum(batch["phases"][1]["sent_bytes"] for role in ["a", "b"] for batch in baseline[role]["result"]["batches"])
    base_ot = 1280 * 2 * 2 * 4144
    extension = 1280 * 2 * (48 + 16 * 16384)
    messages = 1280 * 2 * (48 + 2 * 16384)
    assert base_ot + extension + messages == boolean
    failure_probability = 1 - 1 / 5.14
    models = []
    for size in [1, 2, 4, 8, 16, 32]:
        model = batch_payload(size, schedules, 262144, chunk_bytes, chunk_ms)
        exhausted = failure_probability ** size
        batches = 1 / (1 - exhausted)
        model.update({
            "modeled_batch_exhaustion_probability": exhausted,
            "expected_consumed_batches": batches,
            "expected_evaluated_candidates": size * batches,
            "expected_counted_payload_bytes_per_success": model["total_counted_payload_bytes"] * batches,
            "expected_online_and_exchanges": 227 * batches,
            "modeled_p99_consumed_batches": math.ceil(math.log(0.01) / math.log(exhausted)),
        })
        models.append(model)
    report = {
        "schema": "seams.ml-dsa-low-communication-model.v1",
        "production_eligible": False,
        "kind": "projection_from_native_primitives_and_existing_gmw_wire_format",
        "sources": [
            {"file": native_path.name, "sha256": sha256(native_path)},
            {"file": silent_path.name, "sha256": sha256(silent_path)},
        ],
        "baseline_32_candidate_preparation": {
            "measured_total_bytes": prep,
            "measured_boolean_ot_bytes": boolean,
            "nonce_yao_and_other_setup_bytes": prep - boolean,
            "base_ot_bytes": base_ot,
            "extension_matrix_bytes": extension,
            "masked_message_bytes": messages,
            "base_ot_amortization_to_three_stages_saving_bytes": base_ot - 3 * 2 * 2 * 4144,
        },
        "primitive": {
            "triples_per_chunk": 262144,
            "measured_chunk_bytes_both_directions": chunk_bytes,
            "measured_native_chunk_median_ms": chunk_ms,
            "maximum_measured_two_role_rss_bytes": max(case["two_role_process_peak_rss_bytes"] for case in measured),
        },
        "models": models,
        "conditions": [
            "Every chunk runs genuine fresh base OT with explicit ExConv7x24 and regular noise.",
            "Each reservation flattens all five stages into independently consumed triples; chunk padding is discarded.",
            "Nonce conversion and private commitment decomposition must migrate from Yao to GMW.",
            "Only untouched independent reservations survive for future messages. Every evaluated candidate burns.",
            "Expected costs assume independent fully valid signature candidates with mean 5.14 attempts, including hint checks, and unlimited ready reservations.",
            "Batch exhaustion and p99 counts are mathematical models, not measured service rates.",
            "Repeated native chunk times project correlation work only. They predict no hosted latency.",
        ],
        "excluded_bytes": [
            "Initial canonical key generation and recovery.",
            "Session, epoch, request, schedule, and correlation bindings.",
            "Accepted response openings, signature delivery, extra messages for public hint rejections, and verifier messages.",
            "Additional Worker/WebSocket framing, authentication, storage writes and reads, and abandoned reservations. Measured coproto headers remain included.",
        ],
        "unmeasured": [
            "Complete silent-OT-backed ML-DSA signing, nonce conversion, and all request bytes.",
            "Wasm constant-time behavior, memory, online latency, and sustained throughput.",
            "Empty-pool behavior, first-signature activation, concurrency, and hosted failure rates.",
        ],
    }
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    for model in models:
        print(model["candidates"], round(model["total_counted_payload_bytes"] / 1e6, 3),
              round(model["expected_counted_payload_bytes_per_success"] / 1e6, 3),
              model["modeled_p99_consumed_batches"])


if __name__ == "__main__":
    main()
