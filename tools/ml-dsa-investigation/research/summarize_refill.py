#!/usr/bin/env python3
"""Join public stock identities with hosted signing and refill measurements."""
import argparse
import datetime
import hashlib
import json
import statistics


def timestamp(record, event):
    return event.get("log_timestamp_ms") or record["event_timestamp_ms"]


def paired(inventory, state="ready"):
    return [batch for batch in inventory[state + "_a"] if batch in inventory[state + "_b"]]


def distribution(values):
    if not values:
        return None
    return {"count": len(values), "minimum": min(values), "median": statistics.median(values),
            "maximum": max(values), "sum": sum(values)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("client")
    parser.add_argument("traces")
    parser.add_argument("output")
    parser.add_argument("--versions", required=True, help="Exact role-to-deployment-version map for this control")
    args = parser.parse_args()
    with open(args.client) as source:
        client = json.load(source)
    with open(args.traces) as source:
        traces = json.load(source)["records"]
    with open(args.versions) as source:
        versions = json.load(source)
    report = summarize(client, traces, versions, client["policy"]["refill_target_batches"])
    with open(args.output, "w") as output:
        json.dump(report, output, indent=2)
        output.write("\n")
    print(json.dumps({"batches": len(report["paired_publications"]),
                      "consumed": report["unique_consumed_batches"],
                      "post_initial_stock": report["post_initial_stock"]}))


def summarize(client, traces, versions, target_groups):
    traces = [record for record in traces if record["version"] == versions.get(record["role"])]
    start = datetime.datetime.fromisoformat(client["observedAt"].replace("Z", "+00:00")).timestamp() * 1000
    end = start + client["elapsedMs"]
    key_digest = hashlib.sha256(bytes.fromhex(client["publicKeyHex"])).hexdigest()
    operations = {bytes(request["operation"]).hex() for request in client["requests"]}
    verified_operations = {bytes(request["operation"]).hex() for request in client["requests"] if request.get("verified")}
    completions = {bytes(request["operation"]).hex(): start + request["startMs"] + request["elapsedMs"] for request in client["requests"] if "elapsedMs" in request}
    inventories = []
    publications = []
    for record in traces:
        for inventory in record.get("inventories", []):
            observed = timestamp(record, inventory)
            if inventory["key"] == key_digest and inventory["epoch"] == client["key"]["epoch"] and observed >= start:
                inventories.append({"at_ms": observed, "role": record["role"], **inventory})
        for refill in record.get("refill", []):
            completed = timestamp(record, refill)
            if completed >= start:
                publications.append({"at_ms": completed, **refill})
    inventories.sort(key=lambda item: item["at_ms"])
    assert inventories, "No stock observations captured"
    initial = inventories[0]
    final_candidates = [item for item in inventories if item["at_ms"] >= end]
    full = [item for item in final_candidates if len(paired(item)) == target_groups and not paired(item, "reserved")]
    if full:
        final = full[0]
    elif final_candidates:
        final = final_candidates[-1]
    else:
        final = None
    horizon = final["at_ms"] if final else end
    inventories = [item for item in inventories if item["at_ms"] <= horizon]
    publications = [item for item in publications if item["at_ms"] <= horizon + 90000]
    observed_batch_ids = set()
    for snapshot in inventories:
        for state in ["ready", "reserved"]:
            observed_batch_ids.update(snapshot[state + "_a"])
            observed_batch_ids.update(snapshot[state + "_b"])
    unmatched_publications = []
    matched_publications = []
    for item in publications:
        ids = item.get("batches", [item["batch"]])
        if any(batch in observed_batch_ids for batch in ids):
            matched_publications.append(item)
        else:
            unmatched_publications.append(item)
    publications = matched_publications
    by_batch = {batch: item for item in publications if item["published"]
                for batch in item.get("batches", [item["batch"]]) if batch in observed_batch_ids}
    consumed = []
    seen_operations = set()
    for record in traces:
        for outcome in record.get("signing", []):
            operation = outcome["operation"]
            if operation not in operations or operation in seen_operations:
                continue
            seen_operations.add(operation)
            result = outcome["outcome"]
            if "consumed_batches" not in result:
                consumed.append({"operation": operation, "count_unknown": True, "outcome": result})
                continue
            snapshots = record.get("inventories", [])
            assert len(snapshots) == 1, "Cannot identify this operation's reserved order"
            available = paired(snapshots[0])
            count = result["consumed_batches"]
            assert count <= len(available)
            consumed.append({"operation": operation, "at_ms": completions[operation], "dispatch_at_ms": timestamp(record, outcome),
                             "batches": available[:count], "outcome": result})
    for operation in sorted(verified_operations - seen_operations):
        consumed.append({"operation": operation, "count_unknown": True,
                         "outcome": {"status": "verified_signature_missing_router_outcome"}})
    known = sorted([item for item in consumed if "batches" in item], key=lambda item: item["at_ms"])
    if known:
        assert initial["at_ms"] <= min(item["dispatch_at_ms"] for item in known), "Initial stock was observed after consumption"
    paired_observed = set()
    for snapshot in inventories:
        paired_observed.update(paired(snapshot))
        paired_observed.update(paired(snapshot, "reserved"))
    initial_ids = set(paired(initial) + paired(initial, "reserved"))
    initially_in_flight = []
    for record in traces:
        job = record.get("refill_job")
        if job and job["key"] == key_digest and job["epoch"] == client["key"]["epoch"]:
            if record["event_timestamp_ms"] < start:
                for batch in job.get("batches", [job["batch"]]):
                    if batch in paired_observed:
                        initial_ids.add(batch)
                        initially_in_flight.append(batch)
    remaining = initial_ids.copy()
    depleted_at = start if not remaining else None
    all_consumed = set()
    for operation in known:
        batches = set(operation["batches"])
        assert not all_consumed.intersection(batches), "A batch was consumed twice"
        all_consumed.update(batches)
        remaining.difference_update(batches)
        if not remaining and depleted_at is None:
            depleted_at = operation["at_ms"]
    successes_after = sum(completions[operation] > depleted_at for operation in verified_operations) if depleted_at is not None else 0
    duration_after = end - depleted_at if depleted_at is not None else 0
    first_pair_observation = {}
    for snapshot in inventories:
        for batch in paired(snapshot) + paired(snapshot, "reserved"):
            first_pair_observation.setdefault(batch, snapshot["at_ms"])
    arrivals_after_depletion = [batch for batch, observed in first_pair_observation.items()
                               if batch not in initial_ids and depleted_at is not None
                               and depleted_at < observed <= end]
    final_ids = set(paired(final) + paired(final, "reserved")) if final else set()
    unaccounted = (initial_ids | paired_observed | set(by_batch)) - all_consumed - final_ids if final else None
    unexplained_arrivals = (all_consumed | final_ids) - initial_ids - set(by_batch) if final else None
    inferred_publications = paired_observed - initial_ids
    role_cpu = {}
    queued_dispatch = any(record.get("producer_alarm") for record in traces)
    for role in ["a", "b", "preparer-a", "preparer-b"]:
        invocations = [record for record in traces if record["role"] == role
                       and record["event_timestamp_ms"] is not None
                       and start <= record["event_timestamp_ms"] <= horizon
                       and record["cpu_ms"] is not None]
        if role == "preparer-a" and queued_dispatch:
            values = [record["cpu_ms"] for record in invocations if record.get("producer_alarm")
                      and any(item["batch"] in observed_batch_ids for item in record.get("refill", []))]
        else:
            values = [record["cpu_ms"] for record in invocations
                      if record["path"] in ["/router-ab/ml-dsa/prepare", "/router-ab/ml-dsa/prepare-connect"]]
        role_cpu[role] = distribution(values)
    report = {
        "schema": "seams.ml-dsa-refill-summary.v1",
        "scope": "Short one-wallet saturation screen. Initial stock is excluded from the post-depletion rate. Final HTTP latency and demand latency are separate. Whole-invocation CPU is reported per role without a billing claim.",
        "deployment_versions": versions,
        "unmatched_publications": unmatched_publications,
        "initial_observed_stock": initial,
        "final_observed_stock": final,
        "initial_ids_including_prestarted_producers": sorted(initial_ids),
        "prestarted_producer_batch_ids": sorted(set(initially_in_flight)),
        "paired_publications": [{"batch": batch, "producer_job": item["batch"], "at_ms": item["at_ms"]}
                                for batch, item in by_batch.items()],
        "new_paired_batch_ids_observed": sorted(inferred_publications),
        "missing_publication_completion_records": sorted(inferred_publications - set(by_batch)),
        "unexplained_arrival_ids": sorted(unexplained_arrivals) if unexplained_arrivals is not None else None,
        "failed_producer_completions": [item for item in publications if item["published"] is False],
        "publication_limit": "A failed producer completion can follow durable publication. Inventories determine observed paired stock. Missing completion records remain explicit.",
        "unknown_publications": [item for item in publications if item["published"] is None],
        "consumption": consumed,
        "unique_consumed_batches": len(all_consumed),
        "unaccounted_batch_ids": sorted(unaccounted) if unaccounted is not None else None,
        "complete_publication_accounting": final is not None and not unaccounted and not unexplained_arrivals and not (inferred_publications - set(by_batch)) and not any(item.get("count_unknown") for item in consumed),
        "expiry_limit": "Unaccounted stock may include expiry or retirement. No independent expiry event counter is available.",
        "post_initial_stock": {"start_ms": depleted_at, "elapsed_ms": duration_after,
                               "successful_signatures": successes_after,
                               "observed_new_paired_batches": len(arrivals_after_depletion),
                               "observed_paired_batches_per_minute": len(arrivals_after_depletion) * 60000 / duration_after if duration_after > 0 else None,
                               "end_ms": end,
                               "includes_trailing_failed_or_unknown_requests": True,
                               "signatures_per_minute": successes_after * 60000 / duration_after if duration_after > 0 else None},
        "preparation_job_clock_delta_ms": distribution([item["elapsed_ms"] for item in publications if item["published"]]),
        "matched_producer_invocation_cpu_ms": role_cpu,
        "producer_queue_invocation_cpu_ms": distribution([record["cpu_ms"] for record in traces
            if queued_dispatch and record["role"] == "preparer-a" and record["path"] == "/router-ab/ml-dsa/prepare"
            and record["event_timestamp_ms"] is not None and start <= record["event_timestamp_ms"] <= horizon
            and record["cpu_ms"] is not None]),
        "unmatched_producer_alarm_cpu_ms": distribution([record["cpu_ms"] for record in traces
            if record.get("producer_alarm") and record["cpu_ms"] is not None
            and record["event_timestamp_ms"] is not None and start <= record["event_timestamp_ms"] <= horizon
            and not any(item["batch"] in observed_batch_ids for item in record.get("refill", []))]),
        "successful_final_http_ms": distribution(client["successfulSignatureLatenciesMs"]),
        "successful_demand_ms_including_waits": distribution(client["successfulDemandLatenciesMsIncludingEmptyPool"]),
        "client_requests": len(client["requests"]),
        "unavailable_requests": sum(item["status"] == "unavailable" for item in client["requests"]),
        "client_functional_passed": client["functionalPassed"],
        "client_latency_target_met": client["latencyTargetMet"],
    }
    return report


if __name__ == "__main__":
    main()
