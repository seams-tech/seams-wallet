#!/usr/bin/env python3
"""Account for concurrent wallets without counting their starting stock as refill."""
import argparse
import datetime
import hashlib
import json

from summarize_refill import distribution, paired, summarize, timestamp


def operation_id(request):
    return bytes(request["operation"]).hex()


def batch_scopes(records):
    scopes = {}
    for record in records:
        for inventory in record["inventories"]:
            scope = (inventory["key"], inventory["epoch"])
            for field in ["ready_a", "ready_b", "reserved_a", "reserved_b"]:
                for batch in inventory[field]:
                    add_scope(scopes, batch, scope)
        job = record["refill_job"]
        if job:
            for batch in job.get("batches", [job["batch"]]):
                add_scope(scopes, batch, (job["key"], job["epoch"]))
        for claim in record.get("refill_claims", []):
            if claim["status"] == "acquired":
                for batch in claim.get("batches", [claim["batch"]]):
                    add_scope(scopes, batch, (claim["key"], claim["epoch"]))
    return scopes


def add_scope(scopes, batch, scope):
    assert batch not in scopes or scopes[batch] == scope, "A batch crossed key or epoch boundaries"
    scopes[batch] = scope


def scoped_records(records, scope, operations, scopes):
    result = []
    for record in records:
        row = dict(record)
        row["inventories"] = [item for item in record["inventories"]
                              if (item["key"], item["epoch"]) == scope]
        row["signing"] = [item for item in record["signing"] if item["operation"] in operations]
        row["signing_traces"] = [item for item in record["signing_traces"] if item["operation"] in operations]
        row["refill"] = [item for item in record["refill"] if scopes.get(item["batch"]) == scope]
        row["refill_claims"] = [item for item in record.get("refill_claims", [])
                                if (item["key"], item["epoch"]) == scope]
        row["refill_recovery"] = [item for item in record.get("refill_recovery", [])
                                  if scopes.get(item["batch"]) == scope]
        job = record["refill_job"]
        row["refill_job"] = job if job and (job["key"], job["epoch"]) == scope else None
        if any(row[field] for field in ["inventories", "signing", "signing_traces", "refill", "refill_job", "refill_claims", "refill_recovery"]):
            result.append(row)
    return result


def wallet_client(client, wallet):
    requests = [item for item in client["requests"] if item["wallet"] == wallet["index"]]
    successful = [item for item in requests if item.get("verified")]
    return {
        "observedAt": client["observedAt"],
        "elapsedMs": client["elapsedMs"],
        "key": wallet["key"],
        "publicKeyHex": wallet["publicKeyHex"],
        "requests": requests,
        "successfulSignatureLatenciesMs": [item["elapsedMs"] for item in successful],
        "successfulDemandLatenciesMsIncludingEmptyPool": [item["demandElapsedMs"] for item in successful],
        "functionalPassed": not client["errors"] and len(successful) >= 4,
        "latencyTargetMet": bool(successful) and all(item.get("verified") and item["elapsedMs"] < 5000 for item in requests),
    }


def summarize_all(client, records, versions):
    assert client.get("timingQualified", True), "Client clock continuity failed; timing and throughput are unqualified"
    records = [row for row in records if row["version"] == versions.get(row["role"])]
    scopes = batch_scopes(records)
    summaries = []
    consumed = set()
    for wallet in client["wallets"]:
        own = wallet_client(client, wallet)
        key = hashlib.sha256(bytes.fromhex(wallet["publicKeyHex"])).hexdigest()
        scope = (key, wallet["key"]["epoch"])
        operations = {operation_id(request) for request in own["requests"]}
        rows = scoped_records(records, scope, operations, scopes)
        summary = summarize(own, rows, versions, client["policy"]["refill_target_batches"])
        summary["wallet_index"] = wallet["index"]
        summaries.append(summary)
        for outcome in summary["consumption"]:
            for batch in outcome.get("batches", []):
                assert batch not in consumed, "A batch was consumed by multiple operations or wallets"
                consumed.add(batch)
    start = datetime.datetime.fromisoformat(client["observedAt"].replace("Z", "+00:00")).timestamp() * 1000
    end = start + client["elapsedMs"]
    depletion = [item["post_initial_stock"]["start_ms"] for item in summaries]
    common_start = max(depletion) if all(value is not None for value in depletion) else None
    initial = set()
    allowed_scopes = set()
    for item in summaries:
        initial.update(item["initial_ids_including_prestarted_producers"])
        snapshot = item["initial_observed_stock"]
        allowed_scopes.add((snapshot["key"], snapshot["epoch"]))
    new_arrivals = set()
    if common_start is not None:
        for row in records:
            for inventory in row["inventories"]:
                if (inventory["key"], inventory["epoch"]) not in allowed_scopes:
                    continue
                at = timestamp(row, inventory)
                if common_start < at <= end:
                    new_arrivals.update(batch for batch in paired(inventory) if batch not in initial)
    # Count each arrival once, from its FIRST observation. Stock already present
    # at common depletion is not new throughput in the subsequent interval.
    first_observed = {}
    for row in records:
        for inventory in row["inventories"]:
            if (inventory["key"], inventory["epoch"]) not in allowed_scopes:
                continue
            at = timestamp(row, inventory)
            for batch in paired(inventory) + paired(inventory, "reserved"):
                first_observed[batch] = min(at, first_observed.get(batch, at))
    if common_start is not None:
        new_arrivals = {batch for batch in new_arrivals if common_start < first_observed[batch] <= end}
    duration = end - common_start if common_start is not None else None
    successful = [item for item in client["requests"] if item.get("verified")]
    successes_after = sum(start + item["startMs"] + item["elapsedMs"] > common_start
                          for item in successful) if common_start is not None else 0
    whole_window_arrivals = {batch for batch, at in first_observed.items()
                             if batch not in initial and start < at <= end}
    minimum_new_signatures = max(0, len(successful) - len(initial))
    for item in summaries:
        item["missing_consumption_outcomes"] = [entry["operation"] for entry in item["consumption"] if entry.get("count_unknown")]
    peak_stock = 0
    for row in records:
        for inventory in row["inventories"]:
            if (inventory["key"], inventory["epoch"]) in allowed_scopes and start <= timestamp(row, inventory) <= end:
                peak_stock = max(peak_stock, len(inventory["ready_a"]) + len(inventory["reserved_a"]),
                                 len(inventory["ready_b"]) + len(inventory["reserved_b"]))
    claims = []
    recoveries = []
    for row in records:
        for claim in row.get("refill_claims", []):
            if start <= timestamp(row, claim) <= end:
                claims.append(claim)
        for recovery in row.get("refill_recovery", []):
            if start <= timestamp(row, recovery) <= end:
                recoveries.append(recovery)
    return {
        "scope": "Exact-version concurrent-wallet screen. Common throughput starts only after every wallet consumes its excluded starting stock. Pending demands at the cutoff remain censored. Clock deltas do not partition CPU and waits.",
        "deployment_versions": versions,
        "wallets": summaries,
        "initial_excluded_batches": len(initial),
        "distinct_consumed_batches": len(consumed),
        "stock_ledger_complete": all(item["complete_publication_accounting"] for item in summaries),
        "peak_observed_batches_per_role_and_wallet": peak_stock,
        "configured_pool_target_respected": peak_stock <= client["policy"]["refill_target_batches"],
        "whole_window_excluding_starting_stock": {
            "elapsed_ms": client["elapsedMs"],
            "observed_new_paired_batches": len(whole_window_arrivals),
            "paired_batches_per_minute": len(whole_window_arrivals) * 60000 / client["elapsedMs"],
            "minimum_new_material_signatures": minimum_new_signatures,
            "minimum_new_material_signatures_per_minute": minimum_new_signatures * 60000 / client["elapsedMs"],
            "limit": "Subtract every excluded starting batch from verified signatures. Each batch is single-use and can produce at most one signature. This gives a conservative bound even when consumption traces are missing. It is not a production percentile or an exact steady-state signing rate.",
        },
        "common_post_initial_stock": {
            "start_ms": common_start,
            "elapsed_ms": duration,
            "observed_new_paired_batches": len(new_arrivals),
            "successful_signatures": successes_after,
            "paired_batches_per_minute": len(new_arrivals) * 60000 / duration if duration and duration > 0 else None,
            "successful_signatures_per_minute": successes_after * 60000 / duration if duration and duration > 0 else None,
        },
        "admission_waits": admission_waits(client),
        "reserve_restoration_cycle": reserve_restoration_cycle(client, summaries, start, end),
        "successful_http_ms": distribution([item["elapsedMs"] for item in successful]),
        "successful_demand_ms": distribution([item["demandElapsedMs"] for item in successful]),
        "successful_under_five_seconds": sum(item["elapsedMs"] < 5000 for item in successful),
        "censored_demands": [item for item in client["demands"] if item["state"] != "succeeded"],
        "refill_claims": sorted(claims, key=log_time),
        "refill_recoveries": sorted(recoveries, key=log_time),
        "service_non_ok_invocations": [row for row in records if row["outcome"] != "ok" or row["exception_names"]],
        "unmapped_producer_records": [row for row in records if row["producer_alarm"]
                                      and not any(item["batch"] in scopes for item in row["refill"])],
    }


def admission_waits(client):
    reasons = ("empty_pool", "service_capacity", "wallet_cooldown", "operation_running", "protocol_retry")
    totals = {reason: {"responses": 0, "http_ms": 0, "sleep_ms": 0} for reason in reasons}
    grouped = {}
    for request in client["requests"]:
        if request.get("status") == "unavailable":
            reason = request["reason"]
            assert reason in reasons[:3], "Unknown admission reason"
        elif request.get("state") == "awaiting_stock":
            reason = "empty_pool"
        elif request.get("state") in ("preparing", "running"):
            reason = "operation_running"
        elif request.get("state") in ("failed", "declined"):
            reason = "protocol_retry"
        else:
            continue
        delay = request["retryDelayMs"]
        assert isinstance(delay, (int, float)) and delay >= 0
        remaining = max(0, client["elapsedMs"] - request["startMs"])
        elapsed = min(request["elapsedMs"], remaining)
        delay = min(delay, max(0, remaining - request["elapsedMs"]))
        totals[reason]["responses"] += 1
        totals[reason]["http_ms"] += elapsed
        totals[reason]["sleep_ms"] += delay
        identity = (request["wallet"], request["demand"])
        entry = grouped.setdefault(identity, {"wallet": identity[0], "demand": identity[1],
                                              "empty_pool_http_and_sleep_ms": 0,
                                              "reasons": {reason: 0 for reason in reasons}})
        entry["reasons"][reason] += elapsed + delay
        if reason == "empty_pool":
            entry["empty_pool_http_and_sleep_ms"] += elapsed + delay
    demands = {(item["wallet"], item["number"]): item for item in client["demands"]}
    for identity, entry in grouped.items():
        demand = demands[identity]
        entry["state"] = demand["state"]
        entry["total_demand_ms"] = demand.get("elapsedMs")
    empty = [entry for entry in grouped.values() if entry["empty_pool_http_and_sleep_ms"] > 0]
    return {
        "scope": "Observed HTTP response time plus measured client retry sleeps, clipped at the load cutoff. Response counts cover attempts initiated within the window. Empty-pool waits include polling granularity; they are not an exact server stock-unavailable interval.",
        "client_errors": client["errors"],
        "retry_polling": client["retryPolling"],
        "by_reason": totals,
        "demands_with_empty_pool": len(empty),
        "empty_pool_http_and_sleep_ms": distribution([item["empty_pool_http_and_sleep_ms"] for item in empty]),
        "completed_demand_ms_when_pool_was_empty": distribution([item["total_demand_ms"] for item in empty if item["state"] == "succeeded"]),
        "per_demand": list(grouped.values()),
    }


def reserve_restoration_cycle(client, summaries, start, end):
    final = [item["final_observed_stock"] for item in summaries]
    target = client["policy"]["refill_target_batches"]
    complete = all(item is not None and len(paired(item)) == target
                   and not item["reserved_a"] and not item["reserved_b"] for item in final)
    initial_full = all(len(paired(item["initial_observed_stock"])) == target for item in summaries)
    observed_end = max(item["at_ms"] for item in final) if complete else None
    elapsed = observed_end - start if complete and initial_full else None
    successes = sum(item.get("verified") is True for item in client["requests"])
    return {
        "scope": "Full starting and ending reserves at unchanged capacity. Includes the observed wait for final refill and idle inventory alarms. This is a finite load-and-restoration cycle, not a production capacity guarantee.",
        "full_reserve_restored": complete,
        "initial_full_reserve_observed": initial_full,
        "observed_end_ms": observed_end,
        "cycle_elapsed_ms": elapsed,
        "after_load_observation_wait_ms": observed_end - end if complete else None,
        "verified_signatures": successes,
        "signatures_per_cycle_minute": successes * 60000 / elapsed if elapsed and elapsed > 0 else None,
    }


def log_time(item):
    return item["log_timestamp_ms"] or 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("client")
    parser.add_argument("traces")
    parser.add_argument("versions")
    parser.add_argument("output")
    args = parser.parse_args()
    with open(args.client) as source:
        client = json.load(source)
    with open(args.traces) as source:
        records = json.load(source)["records"]
    with open(args.versions) as source:
        versions = json.load(source)
    report = summarize_all(client, records, versions)
    with open(args.output, "w") as output:
        json.dump(report, output, indent=2)
        output.write("\n")
    print(json.dumps({"successful_http_ms": report["successful_http_ms"],
                      "post_initial_stock": report["common_post_initial_stock"]}))


if __name__ == "__main__":
    main()
