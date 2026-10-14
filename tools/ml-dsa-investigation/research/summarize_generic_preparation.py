#!/usr/bin/env python3
"""Separate generic preparation, activation, and successful signing measurements."""

import argparse
import hashlib
import json
import pathlib

from summarize_silent_prototype import distribution, load, profile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["hosted", "native", "traces", "control", "output"]:
        parser.add_argument("--" + name, required=True, type=pathlib.Path)
    parser.add_argument("--versions", required=True, nargs=2, metavar=("A", "B"))
    args = parser.parse_args()
    hosted = load(args.hosted)
    native = load(args.native)
    traces = load(args.traces)["records"]
    versions = args.versions
    observed = []
    for sample in hosted["samples"]:
        ready = [event for event in sample["preparation_progress"]
                 if event["event"] == "ml-dsa-generic-preparation-ready"]
        assert len(ready) == 1
        interval = sample["client_ready_ms"] - ready[0]["client_elapsed_ms"]
        assert interval >= 0
        roles = sample["report"]["roles"]
        assert all(roles[role]["preparation"]["activation_in_client_online"] for role in ["a", "b"])
        observed.append({
            "fixture_index": sample["fixture_index"],
            "status": roles["a"]["status"],
            "client_request_to_generic_ready_ms": ready[0]["client_elapsed_ms"],
            "client_post_generic_to_ready_ms": interval,
            "client_post_generic_to_signature_ms": interval + sample["client_online_ms"] if sample["successful"] else None,
        })
    validation = [case["post_timer_key_validation"] for case in native["cases"]
                  if case["post_timer_key_validation"] is not None]
    assert len(validation) == 1
    native_cases = validation[0]["prepared_signing"]["cases"]
    report = {
        "schema": "seams.ml-dsa-generic-preparation-screen.v1",
        "production_eligible": False,
        "sources": [{"file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                    for path in [args.hosted, args.native, args.traces, args.control]],
        "hosted": profile(hosted, traces, versions, 4),
        "worker_clock_control": {
            "source": args.control.name,
            "status": "invalid-for-preparation-and-activation-timing",
            "reported_generic_preparation_ms": [sample["report"]["roles"][role]["preparation"]["generic_preparation_ms"]
                                                for sample in load(args.control)["samples"] for role in ["a", "b"]],
            "reported_activation_ms": [sample["report"]["roles"][role]["preparation"]["activation_ms"]
                                      for sample in load(args.control)["samples"] for role in ["a", "b"]],
            "reason": "Worker timers can remain fixed while code executes. These zero readings do not measure preparation or activation latency.",
        },
        "client_post_generic_to_ready_ms": distribution([case["client_post_generic_to_ready_ms"] for case in observed]),
        "observations": observed,
        "native_activation": [{"scenario": case["scenario"], "capacity": case["capacity"],
                               "status": case["a"]["result"]["status"],
                               "maximum_role_activation_ms": max(case[role]["activation_ns"] for role in ["a", "b"]) / 1_000_000}
                              for case in native_cases if case["engine"] == "gmw"],
        "limits": [
            "Generic preparation elapsed observations use client request-start to progress receipt. Worker-clock fields remain unusable raw diagnostics.",
            "The corrected client online interval includes activation and signing. Standalone hosted activation time remains unknown.",
            "The client post-generic gap starts at receipt of a progress event. It includes unprepared fixture key creation; it is not a production registration boundary.",
            "Generic preparation is still performed for every benchmark request. No persistent ready pool or rollover exists.",
            "All successful, exhausted, warmup, and failed requests remain in the input artifact. These samples establish no percentile or concurrency capacity.",
            "Signing payload excludes fixture key creation and transport envelopes. CPU includes whole invocations. Wasm memory excludes JavaScript allocations.",
        ],
    }
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"activation_plus_signing_ms": report["hosted"]["successful_online_ms_including_warmup"],
                      "post_generic_to_ready_ms": report["client_post_generic_to_ready_ms"],
                      "signatures": report["hosted"]["verified_signatures_including_warmup"],
                      "exhaustions": report["hosted"]["exhausted_requests_including_warmup"]}))


if __name__ == "__main__":
    main()
