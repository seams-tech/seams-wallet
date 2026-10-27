#!/usr/bin/env python3
"""Compare paired producer CPU and public stages from normalized hosted traces."""
import argparse
import hashlib
import json
import statistics
from collections import Counter
from pathlib import Path


def summary(values):
    if not values:
        return None
    return {"count": len(values), "min": min(values), "median": statistics.median(values), "max": max(values)}


def stages(record, job):
    return {item["stage"]: item for item in record["preparation_stages"] if item["job"] == job}


def span(events, first, last):
    if first not in events or last not in events:
        return None
    return events[last]["at_ms"] - events[first]["at_ms"]


def peer_for(records, job):
    matches = [row for row in records if row["role"].startswith("preparer-b")
               and any(item["job"] == job and item["stage"] == "correlations_completed"
                       for item in row["preparation_stages"])]
    if len(matches) != 1:
        raise ValueError(f"Expected one complete B invocation for {job}, found {len(matches)}")
    return matches[0]


def window_outcomes(records, window):
    selected = [record for record in records if record["event_timestamp_ms"] is not None
                and window["startAtMs"] <= record["event_timestamp_ms"] <= window["endAtMs"]]
    return {
        "invocations": len(selected),
        "by_role": {role: dict(Counter(record["outcome"] for record in selected if record["role"] == role))
                    for role in sorted({record["role"] for record in selected})},
        "exceptions": sum(len(record["exception_names"]) for record in selected),
        "truncated_records": sum(record["logs_truncated"] for record in selected),
        "unsuccessful_crypto": [
            {"role": record["role"], "outcome": record["outcome"], "cpu_ms": record["cpu_ms"],
             "version": record["version"]}
            for record in selected if record["outcome"] != "ok"
            and any(stage["stage"] == "crypto_started" for stage in record["preparation_stages"])
        ],
    }


def material_accounting(records, rows, window):
    if "finalReady" not in window:
        return None
    retired = [bytes(batch).hex() for entry in window["retired"] for batch in entry["batches"]]
    ready = [bytes(batch).hex() for batches in window["finalReady"] for batch in batches]
    published = []
    publication_times = []
    for row in rows:
        own = [record for record in records if record["role"] == row["slot"]
               and any(receipt["batch"] == row["job"] and receipt["published"] is True
                       for receipt in record["refill"])]
        if len(own) != 1:
            raise ValueError("Ambiguous publication invocation")
        receipt = next(receipt for receipt in own[0]["refill"] if receipt["batch"] == row["job"])
        batches = receipt["batches"]
        published.extend(batches)
        for record in [own[0], peer_for(records, row["job"])]:
            stages = [stage for stage in record["preparation_stages"]
                      if stage["job"] == row["job"] and stage["stage"] == "published"]
            publication_times.extend(stage["at_ms"] for stage in stages)
            if sorted(stage["batch"] for stage in stages) != sorted(batches):
                raise ValueError("Participant publication IDs differ")
            if any(stage["at_ms"] > window["endAtMs"] for stage in stages):
                raise ValueError("Publication completed outside restoration window")
    if len(set(published)) != len(published) or sorted(published) != sorted(ready):
        raise ValueError("Fresh publications do not exactly match the final reserve")
    if set(published) & set(retired):
        raise ValueError("A retired pair reappeared")
    if len(set(retired)) != len(retired) or len(set(ready)) != len(ready):
        raise ValueError("Retired or final reserve IDs are duplicated")
    latest_publication = max(publication_times)
    return {"retired_pairs": len(retired), "fresh_published_pairs": len(published),
            "final_ready_pairs": len(ready), "both_participants_match": True,
            "all_publications_inside_window": True, "retired_reuse": False,
            "latest_publication_checkpoint_ms": latest_publication,
            "last_publication_since_start_ms": latest_publication - window["startAtMs"],
            "client_detection_lag_ms": window["endAtMs"] - latest_publication}


def summarize_window(records, window):
    rows = []
    for record in records:
        if not record["role"].startswith("preparer-a") or record["outcome"] != "ok":
            continue
        if record["event_timestamp_ms"] is None or not window["startAtMs"] <= record["event_timestamp_ms"] <= window["endAtMs"]:
            continue
        receipts = [item for item in record["refill"] if item["published"] is True and item["candidates"] == 4]
        if not receipts:
            continue
        if len(receipts) != 1:
            raise ValueError("Ambiguous producer completion")
        receipt = receipts[0]
        job = receipt["batch"]
        peer = peer_for(records, job)
        own_stages = stages(record, job)
        peer_stages = stages(peer, job)
        for required in ["crypto_started", "correlations_completed", "crypto_completed"]:
            if required not in own_stages or required not in peer_stages:
                raise ValueError(f"Incomplete public preparation stages for {job}")
        caches = [item for item in record["preparation_cache"] if item["job"] == job and item["stage"] == "prepared"]
        if len(caches) != 1:
            raise ValueError("Missing cache observation")
        cache = caches[0]
        peer_caches = [item for item in peer["preparation_cache"] if item["job"] == job and item["stage"] == "prepared"]
        if len(peer_caches) != 1:
            raise ValueError("Missing B cache observation")
        rows.append({
            "job": job, "slot": record["role"], "version_a": record["version"], "version_b": peer["version"],
            "module_a": own_stages["crypto_started"]["module_instance"],
            "module_b": peer_stages["crypto_started"]["module_instance"],
            "cpu_a_ms": record["cpu_ms"], "cpu_b_ms": peer["cpu_ms"],
            "wall_a_ms": record["wall_ms"], "wall_b_ms": peer["wall_ms"],
            "correlation_span_ms": span(own_stages, "crypto_started", "correlations_completed"),
            "commitment_span_ms": span(own_stages, "correlations_completed", "crypto_completed"),
            "publication_span_ms": span(own_stages, "serialized", "published"),
            "wasm_a_bytes": own_stages["correlations_completed"]["wasm_linear_memory_bytes"],
            "wasm_b_bytes": peer_stages["correlations_completed"]["wasm_linear_memory_bytes"],
            "topology_builds": cache["topology_builds"], "topology_hits": cache["topology_hits"],
            "topology_builds_b": peer_caches[0]["topology_builds"],
            "active_crypto": cache["active_crypto"],
        })
    if len({row["job"] for row in rows}) != len(rows):
        raise ValueError("Duplicate producer completion")
    groups = {}
    for slot in sorted({row["slot"] for row in rows}):
        members = [row for row in rows if row["slot"] == slot]
        warm = [row for row in members if row["topology_builds"] == 0]
        groups[slot] = {
            "jobs": len(members), "warm_jobs": len(warm),
            "all": {field: summary([row[field] for row in members if row[field] is not None]) for field in
                    ["cpu_a_ms", "cpu_b_ms", "wall_a_ms", "correlation_span_ms", "commitment_span_ms", "publication_span_ms"]},
            "a_warm": {field: summary([row[field] for row in warm]) for field in ["cpu_a_ms", "correlation_span_ms"]},
            "b_warm_cpu_ms": summary([row["cpu_b_ms"] for row in members if row["topology_builds_b"] == 0]),
            "wasm_a_sizes": sorted({row["wasm_a_bytes"] for row in members}),
            "wasm_b_sizes": sorted({row["wasm_b_bytes"] for row in members}),
            "active_crypto": dict(Counter(row["active_crypto"] for row in members)),
            "versions_a": sorted({row["version_a"] for row in members}),
            "versions_b": sorted({row["version_b"] for row in members}),
        }
    return {"window": window, "all_outcomes": window_outcomes(records, window),
            "material_accounting": material_accounting(records, rows, window), "slots": groups, "jobs": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("traces", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("windows", nargs="+", type=Path)
    args = parser.parse_args()
    records = json.loads(args.traces.read_text())["records"]
    result = {
        "schema": "seams.ml-dsa-producer-variation.v1",
        "trace_sha256": hashlib.sha256(args.traces.read_bytes()).hexdigest(),
        "limits": ["Successful four-candidate invocations whose start timestamps fall in the supplied windows; completion may occur afterward. This cohort is not throughput within the window.",
                   "CPU covers an entire role invocation; stage spans are wall time, not stage CPU.",
                   "Wasm stage memory excludes transient peaks, native allocations, and JS memory.",
                   "active_crypto is module-local and cannot measure host-wide contention.",
                   "Routing and deployment identity require separate configuration and version checks; this summary alone cannot establish a controlled crossover."],
        "phases": {path.parent.name: summarize_window(records, json.loads(path.read_text())) for path in args.windows},
    }
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({phase: {slot: {"jobs": value["jobs"], "a_cpu_ms": value["all"]["cpu_a_ms"]["median"],
                                   "b_cpu_ms": value["all"]["cpu_b_ms"]["median"],
                                   "correlation_ms": value["all"]["correlation_span_ms"]["median"]}
                             for slot, value in data["slots"].items()} for phase, data in result["phases"].items()}))


if __name__ == "__main__":
    main()
