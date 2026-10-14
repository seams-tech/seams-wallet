#!/usr/bin/env python3
"""Derive a five-second resource screen from retained experiment evidence.

No latency forecast in this file is a benchmark. Round budgets exclude compute,
input conversion, output handling, storage, queueing, and admission.
"""
import hashlib
import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/evidence"
OUTPUT = EVIDENCE / "ml-dsa-65-five-second-resource-screen-20261014.json"


def read_evidence(name, sources):
    path = EVIDENCE / name
    data = path.read_bytes()
    sources.append({"path": str(path.relative_to(ROOT)), "sha256": hashlib.sha256(data).hexdigest()})
    return json.loads(data)


def seconds_summary(values):
    return {"samples": len(values), "median_seconds": statistics.median(values),
            "minimum_seconds": min(values), "maximum_seconds": max(values)}


def kernel_wire(kernel):
    return kernel["a_to_b_wire_bytes"] + kernel["b_to_a_wire_bytes"]


def main():
    sources = []
    keygen = read_evidence("ml-dsa-65-selected-halfgates-keygen-joint-hosted-20261014.json", sources)
    signing = read_evidence("ml-dsa-65-selected-halfgates-threshold-joint-hosted-20261014.json", sources)
    fixed = read_evidence("ml-dsa-65-selected-halfgates-threshold-fixture-hosted-20261014.json", sources)
    topology = read_evidence("ml-dsa-65-engine-structural-screen-20261013.json", sources)
    conversion = read_evidence("ml-dsa-65-fresh-mask-conversion-20261014.json", sources)
    key_samples = keygen["cases"][0]["samples"]
    sign_samples = signing["cases"][0]["samples"]
    fixed_samples = fixed["cases"][0]["samples"]
    observed = {
        "keygen_client": seconds_summary([s["client_complete_ms"] / 1000 for s in key_samples]),
        "signing_phase_role_a": seconds_summary([s["report"]["roles"]["a"]["signing_observed_ms"] / 1000 for s in sign_samples]),
        "fixed_five_candidate_signing_phase_role_a": seconds_summary([s["report"]["roles"]["a"]["signing_observed_ms"] / 1000 for s in fixed_samples]),
        "signing_candidates": [s["report"]["roles"]["a"]["attempts"] for s in sign_samples],
    }
    for value in observed.values():
        if isinstance(value, dict):
            value["median_speedup_needed_for_five_seconds"] = value["median_seconds"] / 5
    first = sign_samples[0]["report"]["roles"]["a"]
    assert first["attempts"] == 1
    kernels = {k["kernel"]: k for k in first["runtime"]["per_kernel"]}
    candidate = topology["operation_forecasts"]["signing_candidate"]
    key = topology["operation_forecasts"]["key_generation"]
    new_mask_ands = conversion["conversion_and_gates"]
    old_mask_ands = conversion["baseline_mask_and_gates"]
    assert new_mask_ands < old_mask_ands
    assert all(c["mapping_verified"] for c in conversion["cases"])
    new_mask_wire = conversion["cases"][0]["role_a"]["garbler_to_evaluator_wire_bytes"] + conversion["cases"][0]["role_a"]["evaluator_to_garbler_wire_bytes"]
    candidate_wire = sum(kernel_wire(kernels[k]) for k in candidate["calls"])
    fresh_ands = candidate["and_gates"] - 5 * (old_mask_ands - new_mask_ands)
    fresh_wire = candidate_wire - kernel_wire(kernels["signing-mask"]) + 5 * new_mask_wire
    prepared_kernels = ["commitment-hash", "response-check", "row-check", "aggregate-check"]
    prepared_ands = sum(kernels[k]["table_bytes"] // 32 for k in prepared_kernels)
    prepared_wire = sum(kernel_wire(kernels[k]) for k in prepared_kernels)
    measurements = topology["schedule_measurements"]
    depth = {k: v["maximum_and_depth"] for k, v in measurements.items()}
    # Independent polynomial calls share each interaction layer. The response
    # and row checks can also share layers after the public challenge is known.
    key_layers = depth["seed"] + depth["sampling"] + depth["rounding"]
    exact_layers = depth["signing-mask"] + depth["commitment-high"] + depth["commitment-hash"] + max(depth["response-check"], depth["row-check"]) + depth["aggregate-check"]
    prepared_layers = depth["commitment-hash"] + max(depth["response-check"], depth["row-check"]) + depth["aggregate-check"]
    round_models = []
    for candidates in [1, 3, 5, 16]:
        exact = depth["signing-seed"] + candidates * exact_layers
        prepared = candidates * prepared_layers
        round_models.append({
            "candidates": candidates, "exact_algorithm_batched_layers": exact,
            "prepared_fresh_mask_batched_layers": prepared,
            "exact_zero_compute_rtt_budget_ms": 5000 / exact,
            "prepared_zero_compute_rtt_budget_ms": 5000 / prepared,
            "prepared_network_only_seconds_at_rtt_ms": {str(rtt): prepared * rtt / 1000 for rtt in [0.25, 0.5, 1, 2, 5, 10]},
        })
    baseline_sources = keygen["provenance"]["sources"]
    unchanged = []
    for src in baseline_sources:
        path = Path(src["path"])
        if path.name in ["passive.rs", "gate_aes.rs"]:
            unchanged.append({"path": str(path.relative_to(ROOT)), "same_as_hosted_baseline": hashlib.sha256(path.read_bytes()).hexdigest() == src["sha256"]})
    report = {
        "schema": "seams.ml-dsa-five-second-resource-screen.v1",
        "production_integration": "paused-by-user",
        "latency_target_seconds": 5,
        "source_evidence": sources,
        "analysis_script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "observed_hosted_baseline": observed,
        "already_in_hosted_runtime": unchanged,
        "keygen": {"and_gates_without_wallet_prelude": key["and_gates"], "half_gate_table_bytes": key["current_half_gate_table_bytes"],
                   "sampling_fraction_of_table_bytes": kernels["sampling"]["table_bytes"] / key["current_half_gate_table_bytes"],
                   "wallet_prelude_additional_and_gates": 37056,
                   "batched_layers_without_wallet_prelude": key_layers,
                   "zero_compute_rtt_budget_ms_without_wallet_prelude": 5000 / key_layers},
        "fresh_mask_conversion": {"baseline_ands_per_polynomial": old_mask_ands, "conversion_ands_per_polynomial": new_mask_ands,
                                  "and_reduction_fraction": 1 - new_mask_ands / old_mask_ands,
                                  "baseline_wire_bytes_per_polynomial": kernel_wire(kernels["signing-mask"]) // 5,
                                  "conversion_wire_bytes_per_polynomial": new_mask_wire},
        "candidate_resource_models": {
            "baseline": {"and_gates": candidate["and_gates"], "wire_bytes": candidate_wire},
            "fresh_mask_online": {"and_gates": fresh_ands, "wire_bytes": fresh_wire, "and_reduction_fraction": 1 - fresh_ands / candidate["and_gates"]},
            "fresh_mask_and_commitment_prepared": {"online_and_gates": prepared_ands, "online_wire_bytes": prepared_wire,
                "and_reduction_fraction": 1 - prepared_ands / candidate["and_gates"]},
            "three_halves_table_only": {"table_fraction_of_halfgates": 197 / 256, "ideal_bandwidth_only_speedup": 256 / 197},
        },
        "boolean_round_models": round_models,
        "limits": [
            "No five-second implementation is demonstrated. Fresh-mask conversion is the only newly executed private primitive in this screen.",
            "Candidate models retain current checks and disclosures. They exclude request binding and final return bytes, one-time signing setup, and all preparation costs.",
            "Prepared fresh masks and commitments would change the exact message-bound nonce derivation. They require a new composition review and durable one-use state.",
            "Layer batching and prepared pools are models, not implemented Worker paths. Round budgets assume one RTT per AND layer and zero other cost.",
            "Key-generation layers exclude the wallet-seed prelude, input setup, conversions between circuit invocations, output delivery, and all preprocessing.",
            "Worker phase clocks advance with I/O. They are elapsed observations, not isolated CPU timings. Client key-generation timings exclude wallet custody and durable activation.",
            "Five fresh-key samples do not establish percentiles, a retry distribution, or a successful-signature deadline guarantee.",
            "Disabling export alone removes no work from canonical key generation or ordinary signing.",
        ],
    }
    OUTPUT.write_text(json.dumps(report, indent=2) + "\n")
    print(OUTPUT)


if __name__ == "__main__":
    main()
