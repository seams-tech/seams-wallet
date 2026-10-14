#!/usr/bin/env python3
"""Summarize hosted ML-DSA profiles without counting exhaustion as signing."""

import argparse
import hashlib
import json
import pathlib
import statistics


def load(path):
    return json.loads(path.read_text())


def distribution(values):
    if not values:
        return None
    return {"minimum": min(values), "median": statistics.median(values), "maximum": max(values)}


def payload(sample, phase):
    roles = sample["report"]["roles"]
    assert roles["a"][phase]["sent_bytes"] == roles["b"][phase]["received_bytes"]
    assert roles["b"][phase]["sent_bytes"] == roles["a"][phase]["received_bytes"]
    return sum(roles[role][phase]["sent_bytes"] for role in ["a", "b"])


def profile(data, traces, versions, capacity):
    assert data["environment"] == "hosted-cloudflare"
    samples = data["samples"]
    successful = [sample for sample in samples if sample["successful"]]
    measured = [sample for sample in successful if not sample["warmup"]]
    exhausted = [sample for sample in samples if sample["report"]["roles"]["a"]["status"] == "exhausted"]
    for sample in samples:
        assert sample["report"]["roles"]["a"]["pool_capacity"] == capacity
        assert sample["table_cleanup_acknowledged"]
        assert sample["websocket_close_code"] == 1000
    cpu_records = []
    counts = {}
    for role, version in zip(["a", "b"], versions):
        selected = [record for record in traces if record["role"] == role
                    and record["version"] == version
                    and record["operation"] == "prepared-gmw-signing"
                    and record["public_preparation_progress"]]
        counts[role] = len(selected)
        cpu_records.extend(selected)
    cpu = {"status": "incomplete", "observed_invocations_by_role": counts}
    if all(count == len(samples) for count in counts.values()) and not data["failures"]:
        assert all(record["cpu_ms"] is not None for record in cpu_records)
        total_cpu_ms = sum(record["cpu_ms"] for record in cpu_records)
        # Published Standard CPU overage: $0.02 per million CPU milliseconds.
        cost = total_cpu_ms / 1_000_000 * 0.02
        cpu = {
            "status": "complete",
            "observed_invocations_by_role": counts,
            "all_platform_outcomes_ok": all(record["outcome"] == "ok" for record in cpu_records),
            "whole_campaign_cpu_ms_both_roles": total_cpu_ms,
            "whole_invocation_cpu_ms_per_role": distribution([record["cpu_ms"] for record in cpu_records]),
            "whole_campaign_cpu_overage_usd": cost,
            "observed_cpu_overage_usd_per_verified_signature": cost / len(successful) if successful else None,
            "scope": "Includes warmup, exhausted reservations, repeated disposable fixture key creation, preparation, online work, and cleanup. Excludes account minimums, included allowances, storage, and other product services. Aggregate version-filtered counts avoid joining Cloudflare-redacted request IDs.",
        }
    campaign_payload = sum(payload(sample, "offline") + payload(sample, "online") for sample in samples)
    return {
        "campaign_protocol_bytes_including_exhaustion": campaign_payload,
        "observed_protocol_bytes_per_verified_signature": campaign_payload / len(successful) if successful else None,
        "candidates_per_reservation": capacity,
        "completed_requests_including_warmup": len(samples),
        "verified_signatures_including_warmup": len(successful),
        "exhausted_requests_including_warmup": len(exhausted),
        "infrastructure_failures": len(data["failures"]),
        "all_requested_completed": data.get("all_requested_completed", False),
        "successful_online_ms_including_warmup": distribution([sample["client_online_ms"] for sample in successful]),
        "successful_online_ms_excluding_warmup": distribution([sample["client_online_ms"] for sample in measured]),
        "readiness_ms_including_warmup": distribution([sample["client_ready_ms"] for sample in samples]),
        "all_verified_signatures_under_five_seconds": all(sample["client_online_ms"] < 5000 for sample in successful) if successful else False,
        "all_requests_returned_signature_under_five_seconds": bool(successful) and len(successful) == len(samples) and not data["failures"] and all(sample["client_online_ms"] < 5000 for sample in successful),
        "preparation_protocol_bytes": distribution([payload(sample, "offline") for sample in samples]),
        "successful_online_protocol_bytes": distribution([payload(sample, "online") for sample in successful]),
        "successful_total_protocol_bytes": distribution([payload(sample, "offline") + payload(sample, "online") for sample in successful]),
        "maximum_observed_wasm_bytes": max(sample["report"]["roles"][role]["wasm_linear_memory_highwater_bytes"] for sample in samples for role in ["a", "b"]),
        "cpu": cpu,
        "versions": dict(zip(["a", "b"], versions)),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["four", "eight", "keygen", "traces", "output"]:
        parser.add_argument("--" + name, required=True, type=pathlib.Path)
    parser.add_argument("--four-versions", required=True, nargs=2, metavar=("A", "B"))
    parser.add_argument("--eight-versions", required=True, nargs=2, metavar=("A", "B"))
    args = parser.parse_args()
    traces = load(args.traces)["records"]
    keygen = load(args.keygen)
    assert keygen["environment"] == "hosted-cloudflare"
    sources = []
    for path in [args.four, args.eight, args.keygen, args.traces]:
        sources.append({"file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    report = {
        "schema": "seams.ml-dsa-silent-product-screen.v1",
        "production_eligible": False,
        "sources": sources,
        "four": profile(load(args.four), traces, args.four_versions, 4),
        "eight": profile(load(args.eight), traces, args.eight_versions, 8),
        "keygen": {
            "completed_requests_including_warmup": len(keygen["samples"]),
            "infrastructure_failures": len(keygen["failures"]),
            "all_requested_completed": keygen.get("all_requested_completed", False),
            "online_ms_including_warmup": distribution([sample["client_online_ms"] for sample in keygen["samples"]]),
            "readiness_ms_including_warmup": distribution([sample["client_ready_ms"] for sample in keygen["samples"]]),
            "all_online_under_five_seconds": all(sample["client_online_ms"] < 5000 for sample in keygen["samples"]),
            "scope": "Prepared canonical key shares. The interval excludes precomputation and first-signature readiness.",
        },
        "billing_source": "https://developers.cloudflare.com/workers/platform/pricing/",
        "limits": [
            "Signing payload counters exclude initial fixture key creation and transport envelopes; raw transport counters retain those costs.",
            "Readiness includes repeated disposable fixture key creation and key-specific signing preparation.",
            "This small sequential campaign establishes no production percentile, throughput under load, or cross-account performance.",
            "No automatic rollover to another reservation or durable production pool is implemented.",
        ],
    }
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    for name in ["four", "eight", "keygen"]:
        print(name, json.dumps(report[name]))


if __name__ == "__main__":
    main()
