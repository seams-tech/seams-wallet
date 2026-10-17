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
            add_scope(scopes, job["batch"], (job["key"], job["epoch"]))
        for claim in record.get("refill_claims", []):
            if claim["status"] == "acquired":
                add_scope(scopes, claim["batch"], (claim["key"], claim["epoch"]))
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
        summary = summarize(own, rows, versions)
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
