#!/usr/bin/env python3
"""Match client operations to exact-version, public-only Worker diagnostics."""
import argparse
import json

from summarize_refill import distribution


def role_measurement(record, trace):
    restored = [item["value"] for item in trace["batches"]
                if item["value"]["stage"] == "restored"]
    return {
        "version": record["version"],
        "cpu_ms": record["cpu_ms"],
        "wall_ms": record["wall_ms"],
        "invocation_outcome": record["outcome"],
        **trace,
        "restored_batches": len(restored),
        "topology_builds": restored[-1]["topology_builds"] if restored else None,
        "topology_hits": restored[-1]["topology_hits"] if restored else None,
    }


def operation_id(request):
    return bytes(request["operation"]).hex()


def cache_group_key(row):
    first = row["signing_call"] == 0
    return (row["role"], row["restored_batches"], first, row["schedule_cache_hit"])


def summarize(client, records, versions):
    records = [record for record in records
               if record["version"] == versions.get(record["role"])]
    clients = {}
    for request in client["requests"]:
        clients.setdefault(operation_id(request), []).append(request)
    operations = []
    groups = {}
    for identity, requests in clients.items():
        matching = []
        routers = []
        for record in records:
            traces = [trace for trace in record.get("signing_traces", [])
                      if trace["operation"] == identity]
            matching.extend(role_measurement(record, trace) for trace in traces)
            if any(item["operation"] == identity for item in record.get("signing", [])):
                routers.append({
                    "version": record["version"],
                    "cpu_ms": record["cpu_ms"],
                    "wall_ms": record["wall_ms"],
                    "outcome": record["outcome"],
                    "transport": record["transport"],
                    "signing": record["signing"],
                })
        # Keep duplicate traces and missing roles visible. Never choose one silently.
        terminal = [request for request in requests if request.get("state")]
        if not terminal:
            continue
        final = terminal[-1]
        operations.append({
            "operation": identity,
            "client_http_ms": final["elapsedMs"],
            "client_demand_ms": final["demandElapsedMs"],
            "verified": final.get("verified", False),
            "state": final["state"],
            "role_counts": {role: sum(row["role"] == role for row in matching)
                            for role in ["a", "b"]},
            "participants": matching,
            "routers": routers,
        })
        for row in matching:
            if row["completed"] and row["invocation_outcome"] == "ok":
                groups.setdefault(cache_group_key(row), []).append(row)
    cache_groups = []
    for (role, batches, first, schedule_hit), rows in sorted(groups.items()):
        cpu = [row["cpu_ms"] for row in rows if row["cpu_ms"] is not None]
        events = [row["transport"]["pending_events"] for row in rows if row["transport"]]
        cache_groups.append({
            "role": role,
            "restored_batches": batches,
            "first_observed_signing_call_in_module": first,
            "schedule_cache_hit": schedule_hit,
            "count": len(rows),
            "cpu_ms": distribution(cpu),
            "pending_socket_events": distribution(events),
            "module_instances": sorted({row["module_instance"] for row in rows
                                        if row["module_instance"] is not None}),
        })
    succeeded = [row for row in operations if row["verified"]]
    return {
        "schema": "seams.ml-dsa-online-diagnosis.v1",
        "limits": [
            "Milestone and event deltas measure observed clock advancement. Hosted clocks can freeze during CPU and I/O. These deltas do not partition elapsed time.",
            "A module identity begins at its first signing attempt. A first observed call does not prove a cold isolate or measure startup.",
            "Invocation CPU is role-specific. Parallel elapsed readings must not be added or subtracted to infer pure waits or billing.",
            "Transport bytes exclude framing. Acknowledgment counters count standalone acknowledgment frames only.",
            "Short sequential deployment screens do not isolate platform variation or establish production percentiles.",
        ],
        "deployment_versions": versions,
        "successful_http_ms": distribution([row["client_http_ms"] for row in succeeded]),
        "successful_under_five_seconds": sum(row["client_http_ms"] < 5000 for row in succeeded),
        "missing_or_duplicate_role_traces": [row["operation"] for row in operations
                                             if row["routers"] and row["role_counts"] != {"a": 1, "b": 1}],
        "cache_groups": cache_groups,
        "operations": operations,
        "non_ok_invocations": [record for record in records
                               if record["outcome"] != "ok" or record["exception_names"]],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("client")
    parser.add_argument("traces")
    parser.add_argument("output")
    parser.add_argument("--versions", required=True)
    args = parser.parse_args()
    with open(args.client) as source:
        client = json.load(source)
    with open(args.traces) as source:
        records = json.load(source)["records"]
    with open(args.versions) as source:
        versions = json.load(source)
    report = summarize(client, records, versions)
    with open(args.output, "w") as output:
        json.dump(report, output, indent=2)
        output.write("\n")
    print(json.dumps({"successful_http_ms": report["successful_http_ms"],
                      "successful_under_five_seconds": report["successful_under_five_seconds"],
                      "missing_role_traces": len(report["missing_or_duplicate_role_traces"])}))


if __name__ == "__main__":
    main()
