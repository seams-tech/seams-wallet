#!/usr/bin/env python3
"""Summarize complete pool requests, including exhaustion and replenishment."""

import argparse
import datetime
import hashlib
import json
import pathlib

from summarize_silent_prototype import distribution, load, payload


def total_payload(roles):
    sample = {"report": {"roles": roles}}
    return payload(sample, "offline") + payload(sample, "online")


def campaign(path):
    data = load(path)
    rows = []
    signatures = []
    registrations = []
    first_signatures = []
    refills = []
    failed_signs = 0
    rollovers = 0
    maximum_memory = 0
    for sample in data["samples"]:
        row = {"fixture_index": sample["fixture_index"], "status": sample["status"], "operations": []}
        if "registration_ms" not in sample:
            rows.append(row)
            continue
        registrations.append(sample["registration_ms"])
        if sample["first_success_from_registration_start_ms"] is not None:
            first_signatures.append(sample["first_success_from_registration_start_ms"])
        previous = total_payload(sample["registration"]["roles"])
        row["registration_ms"] = sample["registration_ms"]
        row["first_signature_from_registration_start_ms"] = sample["first_success_from_registration_start_ms"]
        row["initial_preparation_ms"] = sample["preparation_ms"]
        row["initial_preparation_payload_bytes"] = total_payload(sample["ready"]["roles"])
        row["registration_payload_bytes"] = previous - row["initial_preparation_payload_bytes"]
        for report in [sample["ready"], sample["registration"]]:
            for role in ["a", "b"]:
                maximum_memory = max(maximum_memory, report["roles"][role]["wasm_linear_memory_highwater_bytes"])
        for operation in sample["operations"]:
            roles = operation["report"]["roles"]
            current = total_payload(roles)
            assert current >= previous
            own = roles["a"]
            result = {"kind": operation["kind"], "status": own["status"], "client_ms": operation["client_ms"],
                      "protocol_payload_bytes": current - previous, "remaining_batches": own["inventory"]["batches"]}
            previous = current
            if operation["kind"] == "sign":
                result["exhausted_batches"] = len(own["exhausted"])
                if own["status"] == "signed":
                    signatures.append(operation["client_ms"])
                    rollovers += int(bool(own["exhausted"]))
                else:
                    assert own["status"] == "empty"
                    failed_signs += 1
            if operation["kind"] == "refill":
                assert own["status"] == "refilled"
                batches = operation["command"]["batches"]
                result["batches"] = batches
                result["average_ms_per_batch"] = operation["client_ms"] / batches
                refills.append(result)
            for role in ["a", "b"]:
                maximum_memory = max(maximum_memory, roles[role]["wasm_linear_memory_highwater_bytes"])
            row["operations"].append(result)
        rows.append(row)
    completed = sum(sample["status"] == "complete" for sample in data["samples"])
    return {
        "source": path.name, "environment": data["environment"],
        "initial_batches": data["initial_batches"], "refill_batches": data["refill_batches"],
        "completed_sessions": completed, "failed_sessions": len(data["samples"]) - completed,
        "registration_ms": distribution(registrations),
        "successful_signing_ms": distribution(signatures), "verified_signatures": len(signatures),
        "signing_requests_exhausting_all_available_batches": failed_signs,
        "successful_automatic_rollovers": rollovers,
        "first_signature_from_registration_start_ms": distribution(first_signatures),
        "all_observed_registrations_under_five_seconds": bool(registrations) and all(ms < 5000 for ms in registrations),
        "all_successful_signatures_under_five_seconds": bool(signatures) and all(ms < 5000 for ms in signatures),
        "all_admitted_signing_requests_succeeded_under_five_seconds": completed == len(data["samples"]) and bool(signatures) and failed_signs == 0 and all(ms < 5000 for ms in signatures),
        "all_complete_sessions_first_signature_under_five_seconds": completed == len(data["samples"]) == len(first_signatures) and bool(first_signatures) and all(ms < 5000 for ms in first_signatures),
        "maximum_observed_wasm_bytes": maximum_memory,
        "refills": refills, "samples": rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--campaigns", required=True, nargs="+", type=pathlib.Path)
    parser.add_argument("--traces", required=True, type=pathlib.Path)
    parser.add_argument("--native", required=True, type=pathlib.Path)
    parser.add_argument("--versions", required=True, nargs=2, metavar=("A", "B"))
    parser.add_argument("--output", required=True, type=pathlib.Path)
    args = parser.parse_args()
    profiles = [campaign(path) for path in args.campaigns]
    expected = sum(len(load(path)["samples"]) for path in args.campaigns if load(path)["environment"] == "hosted-cloudflare")
    selected = []
    counts = {}
    for role, version in zip(["a", "b"], args.versions):
        records = [record for record in load(args.traces)["records"]
                   if record["role"] == role and record["version"] == version
                   and record["operation"] == "prepared-gmw-pool" and record["public_preparation_progress"]]
        counts[role] = len(records)
        selected.extend(records)
    cpu = {"status": "incomplete", "observed_invocations_by_role": counts, "expected_per_role": expected}
    if all(count == expected for count in counts.values()) and all(record["cpu_ms"] is not None for record in selected):
        cpu = {"status": "complete", "observed_invocations_by_role": counts,
               "whole_campaign_cpu_ms_both_roles": sum(record["cpu_ms"] for record in selected),
               "all_platform_outcomes_ok": all(record["outcome"] == "ok" for record in selected)}
    native = load(args.native)
    assert all(case["canonical_key_verified"] for case in native["cases"])
    validations = [case["post_timer_key_validation"] for case in native["cases"] if case["post_timer_key_validation"]]
    assert len(validations) == 1
    pools = [case for case in validations[0]["prepared_signing"]["cases"] if case["engine"] == "pool"]
    assert len(pools) == 1
    for role in ["a", "b"]:
        for field in ["empty_pool_checked", "operation_replay_rejected", "refill_replay_rejected", "cancellation_poisoned_pool"]:
            assert pools[0][role]["result"][field]
    sources = args.campaigns + [args.traces, args.native]
    report = {
        "schema": "seams.ml-dsa-ready-pool-screen.v1", "production_eligible": False,
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "sources": [{"file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in sources],
        "versions": dict(zip(["a", "b"], args.versions)), "campaigns": profiles, "cpu": cpu,
        "native": {"all_canonical_keys_verified": True, "pool": pools[0]["verification"],
                   "empty_replay_and_cancellation_checks_passed": True},
        "limits": [
            "All timing intervals use external client clocks. Registration starts only after keygen tables and generic signing reservations are prepared.",
            "Successful signing includes lazy commitment activation, every exhausted batch, and both Worker verifiers. Explicit empty/replay probes are separated from admitted nonempty-pool requests.",
            "A group refill divided by its batch count is an average. It does not prove each batch completes within ten seconds.",
            "Payload uses differences of cumulative role counters. It excludes transport envelopes, command frames, and R2 network traffic. Initial keygen preparation is reported separately.",
            "CPU includes whole sessions: preparation, registration, all signs, exhaustion, refills, replay probes, and cleanup. Redacted request IDs are not used for joins.",
            "The pool is in memory and serializes operations. Concurrent signing during refill, durable state, production admission, and sustained throughput remain unqualified.",
            "Wasm high-water marks exclude JavaScript and other isolate allocations. Ten ready batches were tested; larger capacities are unqualified.",
            "These finite samples establish observed latency, not a production percentile or universal five-second guarantee.",
        ],
    }
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    for profile in profiles:
        print(profile["source"], json.dumps({key: profile[key] for key in ["completed_sessions", "failed_sessions", "verified_signatures", "successful_automatic_rollovers", "registration_ms", "successful_signing_ms", "refills"]}))


if __name__ == "__main__":
    main()
