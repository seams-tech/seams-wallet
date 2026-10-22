#!/usr/bin/env python3
"""Retain exact-version preparation memory samples, including interrupted jobs."""
import argparse
import collections
import hashlib
import json
from pathlib import Path


def summarize(records, versions):
    invocations = []
    modules = {}
    outcomes = collections.defaultdict(collections.Counter)
    for index, record in enumerate(records):
        role = record["role"]
        if record["version"] != versions.get(role):
            continue
        outcomes[role][record["outcome"]] += 1
        samples = []
        for stage in record["preparation_stages"]:
            if "wasm_linear_memory_bytes" not in stage:
                continue
            identity = (role, stage["module_instance"])
            module = modules.setdefault(identity, {
                "role": role, "module_instance": identity[1], "samples": 0,
                "minimum_bytes": stage["wasm_linear_memory_bytes"],
                "maximum_bytes": stage["wasm_linear_memory_bytes"],
                "jobs": set(), "outcomes": set(),
            })
            module["samples"] += 1
            module["minimum_bytes"] = min(module["minimum_bytes"], stage["wasm_linear_memory_bytes"])
            module["maximum_bytes"] = max(module["maximum_bytes"], stage["wasm_linear_memory_bytes"])
            module["jobs"].add(stage["job"])
            module["outcomes"].add(record["outcome"])
            samples.append(stage)
        if role not in ("preparer-a", "preparer-b"):
            continue
        jobs = {stage["job"] for stage in record["preparation_stages"]}
        if record["refill_job"] is not None:
            jobs.add(record["refill_job"]["batch"])
        jobs.update(job["batch"] for job in record["producer_jobs"])
        invocations.append({
            "record_index": index, "role": role, "outcome": record["outcome"],
            "cpu_ms": record["cpu_ms"], "wall_ms": record["wall_ms"],
            "jobs": sorted(jobs), "exception_categories": record["exception_categories"],
            "samples": samples,
            "last_observed_stage": samples[-1]["stage"] if samples else None,
            "maximum_observed_bytes": max((stage["wasm_linear_memory_bytes"] for stage in samples), default=None),
        })
    for module in modules.values():
        module["jobs"] = sorted(module["jobs"])
        module["outcomes"] = sorted(module["outcomes"])
    role_memory = {}
    for role in versions:
        measured = [module for module in modules.values() if module["role"] == role]
        role_memory[role] = {
            "modules": len(measured), "samples": sum(module["samples"] for module in measured),
            "minimum_observed_bytes": min((module["minimum_bytes"] for module in measured), default=None),
            "maximum_observed_bytes": max((module["maximum_bytes"] for module in measured), default=None),
        }
    return {
        "scope": (
            "Allocated Wasm linear memory at explicit logging boundaries, matched to deployed versions. "
            "Resource timestamps describe the logging boundary; earlier stage timestamps can differ. "
            "This excludes JS heap, live-allocation counts, physical resident memory, and unsampled peaks. "
            "A provider outcome is retained without assigning its cause. Missing observations remain unknown."
        ),
        "versions": versions,
        "outcomes": {role: dict(counts) for role, counts in outcomes.items()},
        "role_memory": role_memory,
        "modules": list(modules.values()),
        "preparer_invocations": invocations,
        "load_shed_invocations": [row["record_index"] for row in invocations if row["outcome"] == "loadShed"],
        "preparer_invocations_without_memory_samples": [row["record_index"] for row in invocations if not row["samples"]],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("traces", type=Path)
    parser.add_argument("versions", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = summarize(json.loads(args.traces.read_text())["records"], json.loads(args.versions.read_text()))
    result["script_sha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"role_memory": result["role_memory"], "load_shed_invocations": len(result["load_shed_invocations"])}))


if __name__ == "__main__":
    main()
