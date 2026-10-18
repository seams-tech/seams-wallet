#!/usr/bin/env python3
"""Join explicit producer jobs and consumed material IDs without inferring identities."""
import argparse
import collections
import json
from pathlib import Path

from summarize_refill import distribution


def checked_material(trace):
    checked = [row["value"] for row in trace["batches"] if row["value"]["stage"] == "checked"]
    taken = [row["value"] for row in trace["batches"] if row["value"]["stage"] == "taken"]
    if not trace["completed"] or not checked or any("material_id" not in row for row in checked + taken):
        return None
    assert [row["batch"] for row in checked] == list(range(len(checked)))
    assert [row["material_id"] for row in taken] == [row["material_id"] for row in checked]
    ids = [row["material_id"] for row in checked]
    assert len(ids) == len(set(ids))
    return ids


def summarize(client, records, versions):
    selected = [(index, row) for index, row in enumerate(records) if row["version"] == versions.get(row["role"])]
    actors = {}
    for _, record in selected:
        for job in record.get("producer_jobs", []):
            identity = (job["batch"], tuple(job["batches"]), job["key"], job["epoch"])
            assert job["producer"] not in actors or actors[job["producer"]] == identity
            actors[job["producer"]] = identity
    attributed = []
    canceled = []
    unknown = []
    for index, record in selected:
        if record["role"] != "preparer-a" or not record["producer_alarm"]:
            continue
        names = {row["producer"] for row in record.get("producer_entries", [])}
        names.update(row["producer"] for row in record.get("producer_jobs", []))
        if len(names) == 1 and next(iter(names)) in actors:
            identity = actors[next(iter(names))]
            attributed.append({"record_index": index, "job": identity[0], "batches": list(identity[1]),
                               "wall_ms": record["wall_ms"], "cpu_ms": record["cpu_ms"], "outcome": record["outcome"]})
        elif record["outcome"] == "canceled" and record["cpu_ms"] == 0:
            canceled.append(index)
        else:
            unknown.append(index)
    successes = {bytes(row["operation"]).hex() for row in client["requests"] if row.get("verified")}
    traces = collections.defaultdict(dict)
    for _, record in selected:
        for trace in record["signing_traces"]:
            operation = trace["operation"]
            if operation not in successes:
                continue
            ids = checked_material(trace)
            if ids is not None:
                assert trace["role"] not in traces[operation]
                traces[operation][trace["role"]] = ids
    workload_operations = {bytes(row["operation"]).hex() for row in client["requests"]}
    retained_events = []
    taken_by_id = {}
    for index, record in selected:
        for event in record.get("material_stages", []):
            if event["operation"] not in workload_operations:
                continue
            retained_events.append({"record_index": index, **event})
            if event["value"]["stage"] == "taken":
                identity = event["value"]["material_id"]
                owner = event["operation"]
                assert identity not in taken_by_id or taken_by_id[identity] == owner
                taken_by_id[identity] = owner
    consumption = []
    missing = []
    consumed = set()
    for operation in sorted(successes):
        roles = traces[operation]
        if set(roles) != {"a", "b"}:
            missing.append(operation)
            continue
        assert roles["a"] == roles["b"]
        assert not consumed.intersection(roles["a"])
        consumed.update(roles["a"])
        consumption.append({"operation": operation, "batches": roles["a"],
                            "evaluated_candidates": len(roles["a"]) * client["policy"]["candidate_group_size"]})
    stages = collections.defaultdict(list)
    traffic = []
    for index, record in selected:
        for event in record.get("preparation_stages", []):
            stages[(event["job"], event["role"])].append(event)
        for event in record.get("preparation_transport", []):
            traffic.append({"record_index": index, **event})
    boundaries = []
    for (job, role), events in stages.items():
        by_name = {event["stage"]: event["at_ms"] for event in events}
        spans = {}
        for name, start, end in [("crypto", "crypto_started", "crypto_completed"),
                                 ("post_crypto_through_sealing", "crypto_completed", "sealed"),
                                 ("post_seal_to_publication", "sealed", "published")]:
            if by_name.get(start) is not None and by_name.get(end) is not None:
                spans[name] = by_name[end] - by_name[start]
        boundaries.append({"job": job, "role": role, "service_clock_deltas_ms": spans})
    return {
        "schema": "seams.ml-dsa-preparation-coverage.v1",
        "scope": "Whole captured campaign. Public identity joins, not secret material. Service-clock deltas can omit CPU and are not stage elapsed times. Unidentified canceled alarms remain separate.",
        "retained_consumption_events": retained_events,
        "unique_taken_ids_across_all_client_operations": len(taken_by_id),
        "taken_ids_for_unverified_operations": [identity for identity, operation in taken_by_id.items() if operation not in successes],
        "consumption_limit": "Taken follows receipt of the durable reply. Missing events cannot prove that a burn did not commit. Immediate events do not prove complete evaluation when final traces are missing.",
        "verified_operations": len(successes), "matched_operation_material_bindings": consumption,
        "missing_complete_peer_traces": missing, "unique_consumed_material_ids": len(consumed),
        "attributed_producer_alarms": attributed, "unknown_work_invocations": unknown,
        "unattributed_canceled_zero_cpu_alarms": canceled,
        "unattributed_canceled_wall_ms": distribution([records[index]["wall_ms"] for index in canceled if records[index]["wall_ms"] is not None]),
        "preparation_boundaries": boundaries, "preparation_transport": traffic,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("client", type=Path)
    parser.add_argument("traces", type=Path)
    parser.add_argument("versions", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = summarize(json.loads(args.client.read_text()), json.loads(args.traces.read_text())["records"], json.loads(args.versions.read_text()))
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"matched_signatures": len(result["matched_operation_material_bindings"]),
                      "missing_peer_traces": len(result["missing_complete_peer_traces"]),
                      "attributed_producer_alarms": len(result["attributed_producer_alarms"]),
                      "unknown_work": len(result["unknown_work_invocations"])}))


if __name__ == "__main__":
    main()
