#!/usr/bin/env python3
"""Compare independently consumed groups with equal prepared-candidate capacity."""
import argparse
import collections
import datetime
import hashlib
import json
from pathlib import Path

from summarize_refill import distribution, timestamp
from summarize_preparation_coverage import summarize as summarize_coverage


def read(path):
    return json.loads(path.read_text())


def operation_id(request):
    return bytes(request["operation"]).hex()


def summarize_profile(folder):
    client = read(folder / "client.json")
    summary = read(folder / "summary.json")
    versions = read(folder / "hosted/versions.json")
    records = [row for row in read(folder / "traces.json")["records"]
               if row["version"] == versions.get(row["role"])]
    policy = client["policy"]
    width = policy["candidate_group_size"]
    assert width in (2, 4, 8)
    assert width * policy["refill_target_batches"] == 32
    assert width * policy["minimum_ready_batches"] == 16
    start = datetime.datetime.fromisoformat(client["observedAt"].replace("Z", "+00:00")).timestamp() * 1000
    end = start + client["elapsedMs"]
    final_observation = read(folder / "final-stock.json")
    scopes = {(hashlib.sha256(bytes.fromhex(wallet["publicKeyHex"])).hexdigest(), wallet["key"]["epoch"])
              for wallet in client["wallets"]}
    assert {(row["key"], row["epoch"]) for row in final_observation} == scopes
    restored = len(final_observation) == len(scopes) and all(
        len(set(row["ready_a"])) == policy["refill_target_batches"]
        and set(row["ready_a"]) == set(row["ready_b"])
        and not row["reserved_a"] and not row["reserved_b"]
        and row["log_timestamp_ms"] >= end for row in final_observation)
    horizon = max(row["log_timestamp_ms"] for row in final_observation) if restored else end
    final_by_scope = {(row["key"], row["epoch"]): row for row in final_observation}
    for record in records:
        for inventory in record["inventories"]:
            final = final_by_scope.get((inventory["key"], inventory["epoch"]))
            if final is not None and final["log_timestamp_ms"] < timestamp(record, inventory) <= horizon:
                restored = restored and all(set(inventory[field]) == set(final[field])
                                             for field in ["ready_a", "ready_b", "reserved_a", "reserved_b"])
    successes = [row for row in client["requests"] if row.get("verified")]
    success_by_operation = {operation_id(row): row for row in successes}
    demand_by_operation = {operation_id(row): (row["wallet"], row["demand"]) for row in client["requests"]}
    consumption = [outcome for wallet in summary["wallets"] for outcome in wallet["consumption"]]
    recorded_operations = {row["operation"] for row in consumption}
    admitted_terminal_operations = {operation_id(row) for row in client["requests"]
                                    if row.get("state") in ("failed", "succeeded")}
    for operation in sorted(admitted_terminal_operations - recorded_operations):
        consumption.append({"operation": operation, "count_unknown": True,
                            "outcome": {"status": "admitted_terminal_operation_missing_router_outcome"}})
    peer_bindings = {row["operation"]: row for row in
                     summarize_coverage(client, records, versions)["matched_operation_material_bindings"]}
    recovered_consumption = []
    for index, row in enumerate(consumption):
        peer = peer_bindings.get(row["operation"])
        if row.get("count_unknown") and peer is not None:
            # Matching completed role traces prove consumption. The client
            # result separately determines whether the signature was verified.
            recovered_consumption.append(row["operation"])
            outcome = dict(row["outcome"])
            outcome["evaluated_candidates"] = peer["evaluated_candidates"]
            if peer["signature_verified"]:
                outcome["status"] = "signed"
            consumption[index] = {
                "operation": row["operation"], "batches": peer["batches"],
                "outcome": outcome,
            }
    initial = {batch for wallet in summary["wallets"] for batch in wallet["initial_ids_including_prestarted_producers"]}
    initial_observation = read(folder / "initial-stock.json")
    assert {(row["key"], row["epoch"]) for row in initial_observation} == scopes
    observed_initial = {batch for row in initial_observation for batch in row["ready_a"]}
    initial_capacity_matches = len(initial_observation) == len(scopes) and all(
        len(set(row["ready_a"])) == policy["refill_target_batches"]
        and set(row["ready_a"]) == set(row["ready_b"])
        and not row["reserved_a"] and not row["reserved_b"]
        and row["log_timestamp_ms"] <= start for row in initial_observation)
    initial_capacity_matches = (initial_capacity_matches and initial == observed_initial
                                and len(initial) == len(scopes) * policy["refill_target_batches"])
    fresh = set()
    peak_observed_groups = 0
    for record in records:
        for inventory in record["inventories"]:
            if (inventory["key"], inventory["epoch"]) in scopes and start <= timestamp(record, inventory) <= horizon:
                peak_observed_groups = max(peak_observed_groups,
                                           len(inventory["ready_a"]) + len(inventory["reserved_a"]),
                                           len(inventory["ready_b"]) + len(inventory["reserved_b"]))
                for state in ["ready", "reserved"]:
                    fresh.update(set(inventory[state + "_a"]) & set(inventory[state + "_b"]))
    assert peak_observed_groups <= policy["refill_target_batches"]
    fresh.difference_update(initial)
    completed = {}
    failures = {}
    interrupted = set()
    completed_invocations = {}
    completed_jobs = {}
    completed_job_widths = {}
    producer_invocations = []
    for record in records:
        producer = (record["role"] == "preparer-a" and record["producer_alarm"]
                    and start <= record["event_timestamp_ms"] <= horizon)
        if producer:
            producer_invocations.append(record)
        for event in record["refill"]:
            ids = event.get("batches", [event["batch"]])
            assert event["candidates"] == width * len(ids)
            # A completion can arrive after the inventory proves publication.
            # Charge its invocation once, even when it delivered two pairs.
            if producer and event["published"] is True and set(ids).intersection(fresh):
                assert event["batch"] not in completed_jobs
                completed_jobs[event["batch"]] = record
                completed_job_widths[event["batch"]] = event["candidates"]
                for batch in ids:
                    assert batch not in completed_invocations
                    completed_invocations[batch] = {**record, "prepared_groups": len(ids)}
                    completed[batch] = event
            if start <= timestamp(record, event) <= horizon:
                if event["published"] is False:
                    failures[event["batch"]] = event
                elif event["published"] is None and event["batch"] not in initial:
                    interrupted.update(ids)
    missing_completions = sorted(batch for batch in fresh
                                 if batch not in completed_invocations or completed_invocations[batch]["wall_ms"] is None)
    unknown_consumption = [row["operation"] for row in consumption if row.get("count_unknown")]
    missing_costs = sorted(set(missing_completions) | interrupted)
    known_production_ms = sum(row["wall_ms"] for row in producer_invocations if row["wall_ms"] is not None)
    # Unmapped producer work can have no completion event. Preserve this limit
    # even when all successfully published groups have measured durations.
    unknown_producers = [row for row in producer_invocations
                         if row["wall_ms"] is None or (not row["refill"] and not row["refill_recovery"])]
    groups_by_success = collections.defaultdict(list)
    consumed_groups = []
    for row in consumption:
        if "batches" not in row:
            continue
        groups = len(row["batches"])
        assert row["outcome"]["evaluated_candidates"] == groups * width
        consumed_groups.extend(row["batches"])
        if row["operation"] in success_by_operation:
            groups_by_success[groups].append(success_by_operation[row["operation"]]["elapsedMs"])
    assert len(consumed_groups) == len(set(consumed_groups))
    final_ids = {batch for row in final_observation for batch in row["ready_a"]}
    material_balanced = (restored and initial_capacity_matches and not unknown_consumption
                         and not set(consumed_groups).intersection(final_ids)
                         and (initial | fresh) == (set(consumed_groups) | final_ids))
    complete_accounting = material_balanced and not missing_costs and not unknown_producers

    # A logical demand can contain exhausted admitted operations before success.
    demand_groups = collections.defaultdict(list)
    incomplete_demands = set()
    for row in consumption:
        demand = demand_by_operation[row["operation"]]
        if row.get("count_unknown"):
            incomplete_demands.add(demand)
        else:
            demand_groups[demand].extend(row["batches"])
    allocation = []
    for success in successes:
        demand = (success["wallet"], success["demand"])
        batches = demand_groups[demand]
        if demand in incomplete_demands or not batches or any(batch in initial or batch in missing_costs
                                                             or batch not in completed_invocations for batch in batches):
            continue
        allocation.append({"wallet": demand[0], "demand": demand[1], "groups": len(batches),
                           "candidates": len(batches) * width,
                           "producer_invocation_wall_ms": sum(completed_invocations[batch]["wall_ms"] / completed_invocations[batch]["prepared_groups"] for batch in batches)})

    captured_cpu = {}
    for role in ["preparer-a", "preparer-b"]:
        values = [row["cpu_ms"] for row in records if row["role"] == role
                  and row["cpu_ms"] is not None and start <= row["event_timestamp_ms"] <= horizon
                  and (row["producer_alarm"] or row["path"] in ["/router-ab/ml-dsa/prepare", "/router-ab/ml-dsa/prepare-connect"])]
        captured_cpu[role] = distribution(values)
    pending_responses = sum(row.get("state") in ("preparing", "running") for row in client["requests"])
    failed_operations = {operation_id(row) for row in client["requests"] if row.get("state") == "failed"}
    mean_preparation = known_production_ms / len(successes) if successes else None
    return {
        "group_size": width,
        "preparation_group_size": policy.get("preparation_group_size", width),
        "policy": policy,
        "wallets": len(client["wallets"]),
        "client_sha256": hashlib.sha256((folder / "client.json").read_bytes()).hexdigest(),
        "traces_sha256": hashlib.sha256((folder / "traces.json").read_bytes()).hexdigest(),
        "versions": versions,
        "successful_signatures": len(successes),
        "online_http_ms": summary["successful_http_ms"],
        "online_http_by_consumed_groups": {str(count): distribution(values) for count, values in sorted(groups_by_success.items())},
        "online_under_five_seconds": summary["successful_under_five_seconds"],
        "pending_operation_responses": pending_responses,
        "complete_demand_ms": summary["successful_demand_ms"],
        "failed_operations": len(failed_operations),
        "duplicate_requests": client["duplicateRequests"],
        "censored_demands": summary["censored_demands"],
        "initial_excluded_groups": len(initial),
        "initial_excluded_candidates": len(initial) * width,
        "initial_stock_matches_controller": initial_capacity_matches,
        "identified_consumed_groups": len(consumed_groups),
        "identified_consumed_candidates": len(consumed_groups) * width,
        "unknown_consumption_operations": unknown_consumption,
        "consumption_recovered_from_complete_peer_traces": recovered_consumption,
        "peak_observed_candidates_per_role_wallet": peak_observed_groups * width,
        "common_post_initial_stock": summary["common_post_initial_stock"],
        "material_identity_balance_complete": material_balanced,
        "full_reserve_restoration_ms": horizon - end if restored else None,
        "balanced_cycle_ms_per_verified_signature": (horizon - start) / len(successes) if material_balanced and successes else None,
        "preparation_cost": {
            "scope": "Captured preparer-A producer-alarm invocation wall time during load and full reserve restoration, including failed and recovery invocations. One producer invocation can deliver two independent groups. Invocation time is charged once; peer time is not added. Per-group allocation divides job time equally and is an accounting model. Starting material cancels only when the same candidate reserve is restored and the identity ledger is complete. Missing publication, invocation, and canceled-producer costs remain unknown. These invocation durations include setup and settlement. Queue waits are in the cycle and demand metrics. Worker elapsed_ms is only clock advancement and cannot qualify elapsed preparation time.",
            "fresh_paired_groups": len(fresh),
            "fresh_paired_candidates": len(fresh) * width,
            "completed_job_invocation_wall_ms": distribution([row["wall_ms"] for row in completed_jobs.values() if row["wall_ms"] is not None]),
            "allocated_group_invocation_wall_ms": distribution([completed_invocations[batch]["wall_ms"] / completed_invocations[batch]["prepared_groups"] for batch in fresh
                                                                 if batch in completed_invocations and completed_invocations[batch]["wall_ms"] is not None]),
            "completed_job_count": len(completed_jobs),
            "completed_job_invocation_wall_ms_by_candidates": {
                str(count): distribution([row["wall_ms"] for job, row in completed_jobs.items()
                                          if completed_job_widths[job] == count and row["wall_ms"] is not None])
                for count in sorted(set(completed_job_widths.values()))
            },
            "failed_producer_completions": len(failures),
            "missing_group_costs": missing_costs,
            "unknown_producer_invocations": len(unknown_producers),
            "captured_producer_invocation_wall_ms": known_production_ms,
            "captured_invocation_ms_per_verified_signature": mean_preparation,
            "accounting_complete": complete_accounting,
            "observed_mean_under_ten_seconds": mean_preparation <= 10000 if complete_accounting and mean_preparation is not None else None,
            "captured_invocation_cpu_ms": captured_cpu,
        },
        "fully_measured_fresh_demands": {
            "scope": "Only successful logical demands whose consumed groups all have matched producer-invocation wall measurements and none came from starting stock. Includes earlier exhausted operations within each demand. This subset excludes unassigned preparation failures and is not the total service cost.",
            "producer_invocation_wall_ms": distribution([row["producer_invocation_wall_ms"] for row in allocation]),
            "demands": allocation,
        },
        "online_target_met_in_screen": bool(successes) and not client["errors"] and not failed_operations and pending_responses == 0
                                       and all(row["elapsedMs"] < 5000 for row in successes),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    profiles = [summarize_profile(args.directory / f"group-{size}") for size in [8, 4, 2]]
    report = {"schema": "seams.ml-dsa-candidate-group-comparison.v1",
              "scope": "Equal 32-candidate reserve and 16-candidate admission minimum per wallet. Exact-version hosted screens. Prepared HTTP latency, complete demand, production work and stock-balanced cycle time have different boundaries. No production percentile or billing claim.",
              "profiles": profiles}
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps([{"group_size": row["group_size"], "successful": row["successful_signatures"],
                       "online_under_five_seconds": row["online_under_five_seconds"],
                       "captured_preparation_invocation_ms_per_signature": row["preparation_cost"]["captured_invocation_ms_per_verified_signature"],
                       "preparation_accounting_complete": row["preparation_cost"]["accounting_complete"]} for row in profiles]))


if __name__ == "__main__":
    main()
