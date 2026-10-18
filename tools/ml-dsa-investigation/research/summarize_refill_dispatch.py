#!/usr/bin/env python3
"""Join public refill dispatch events by exact job ID; keep missing and repeated stages visible."""
import argparse
import collections
import json
from pathlib import Path

from summarize_refill import distribution

STAGES = (
    "controller_selected", "activation_checked", "local_inventory_checked", "peer_inventory_checked",
    "claim_acquired", "dispatch_started", "producer_received", "producer_authorized", "queue_checked",
    "receipt_ready", "dispatch_acknowledged", "producer_running", "recovery_armed", "role_claimed",
    "peer_received", "peer_connected", "load_started",
)
SPANS = (
    ("a", "controller_selected", "a", "claim_acquired"),
    ("a", "claim_acquired", "a", "queued"),
    ("a", "claim_acquired", "a", "dispatch_started"),
    ("a", "dispatch_started", "a", "producer_received"),
    ("a", "dispatch_started", "a", "producer_fetch_entered"),
    ("a", "producer_fetch_entered", "a", "producer_authenticated"),
    ("a", "producer_authenticated", "a", "producer_received"),
    ("a", "producer_received", "a", "producer_authorized"),
    ("a", "producer_authorized", "a", "queue_checked"),
    ("a", "queue_checked", "a", "receipt_ready"),
    ("a", "dispatch_started", "a", "dispatch_acknowledged"),
    ("a", "queued", "a", "running"),
    ("a", "running", "a", "load_started"),
    ("a", "producer_running", "a", "recovery_armed"),
    ("a", "recovery_armed", "a", "role_claimed"),
    ("a", "role_claimed", "b", "peer_received"),
    ("b", "peer_received", "b", "role_claimed"),
    ("a", "role_claimed", "a", "peer_connected"),
    ("a", "peer_connected", "a", "load_started"),
    ("a", "claim_acquired", "a", "load_started"),
)


def retain_stage(events, job, role, stage, at, record_index, clock_source):
    events[job][(role, stage)].append({"at_ms": at, "record_index": record_index, "clock_source": clock_source})


def stage_observations():
    return collections.defaultdict(list)


def summarize(records, versions):
    events = collections.defaultdict(stage_observations)
    claims = {}
    invocations = collections.defaultdict(list)
    for index, record in enumerate(records):
        if record["version"] != versions.get(record["role"]):
            continue
        if record["role"] == "a":
            for claim in record["refill_claims"]:
                if claim["status"] == "acquired":
                    claims[claim["batch"]] = {"key": claim["key"], "epoch": claim["epoch"]}
                    retain_stage(events, claim["batch"], "a", "claim_observed", claim["log_timestamp_ms"], index, "log_timestamp_ms")
                    for entry in record.get("refill_wakes", []):
                        if (entry["event"] == "ml_dsa_refill_controller_v1"
                                and entry["key"] == claim["key"] and entry["epoch"] == claim["epoch"]):
                            retain_stage(events, claim["batch"], "a", "controller_observed", entry["at_ms"], index, "at_ms")
        for event in record["producer_jobs"]:
            invocations[event["batch"]].append({
                "record_index": index, "worker_role": record["role"], "stage": event["stage"],
                "alarm": record["producer_alarm"], "scheduled_ms": record.get("alarm_scheduled_ms"),
                "event_timestamp_ms": record["event_timestamp_ms"], "log_timestamp_ms": event["log_timestamp_ms"],
                "wall_ms": record["wall_ms"], "cpu_ms": record["cpu_ms"], "outcome": record["outcome"],
                "startup": record.get("producer_startup", []),
            })
            if event["stage"] == "queued":
                for entry in record.get("producer_startup", []):
                    if entry["producer"] == event["producer"] and entry["stage"] in ("fetch_entered", "authenticated"):
                        retain_stage(events, event["batch"], "a", "producer_" + entry["stage"], entry["at_ms"], index, "at_ms")
            retain_stage(events, event["batch"], "a", event["stage"], event["log_timestamp_ms"], index, "log_timestamp_ms")
        for event in record["preparation_stages"]:
            if event["stage"] in STAGES:
                retain_stage(events, event["job"], event["role"], event["stage"], event["at_ms"], index, "at_ms")
    # Older traces have a claim log, but no additional timestamp at its caller.
    for stages in events.values():
        if ("a", "controller_selected") not in stages:
            stages[("a", "controller_selected")] = stages.get(("a", "controller_observed"), [])
        if ("a", "claim_acquired") not in stages:
            stages[("a", "claim_acquired")] = stages.get(("a", "claim_observed"), [])
    rows = []
    spans = collections.defaultdict(list)
    excluded = collections.defaultdict(collections.Counter)
    for job, stages in sorted(events.items()):
        row = {"job": job, "claim": claims.get(job), "producer_invocations": invocations.get(job, []), "stages": [], "service_clock_spans_ms": {}}
        for (role, stage), values in sorted(stages.items()):
            row["stages"].append({"role": role, "stage": stage, "observations": values})
        for role_a, start, role_b, end in SPANS:
            name = f"{role_a}.{start}_to_{role_b}.{end}"
            first = stages.get((role_a, start), [])
            last = stages.get((role_b, end), [])
            if not first or not last:
                excluded[name]["missing_stage"] += 1
                continue
            if len(first) != 1 or len(last) != 1:
                excluded[name]["repeated_stage"] += 1
                continue
            a, b = first[0]["at_ms"], last[0]["at_ms"]
            if a is None or b is None:
                excluded[name]["missing_clock"] += 1
                continue
            if b < a:
                excluded[name]["negative_delta"] += 1
                continue
            elapsed = b - a
            spans[name].append(elapsed)
            row["service_clock_spans_ms"][name] = elapsed
        rows.append(row)
    event_offsets = []
    log_offsets = []
    for observations in invocations.values():
        for observation in observations:
            if not observation["alarm"] or observation["stage"] != "running":
                continue
            scheduled = observation["scheduled_ms"]
            if scheduled is None:
                continue
            if observation["event_timestamp_ms"] is not None:
                event_offsets.append(observation["event_timestamp_ms"] - scheduled)
            if observation["log_timestamp_ms"] is not None:
                log_offsets.append(observation["log_timestamp_ms"] - scheduled)
    return {
        "alarm_clock_observations": {
            "scope": "Signed differences between retained platform/log timestamps and scheduled alarm time. These clocks do not establish actual delivery delay.",
            "platform_event_minus_schedule_ms": distribution(event_offsets),
            "running_log_minus_schedule_ms": distribution(log_offsets),
        },
        "scope": "Exact per-job joins from retained version-matched traces. A stage must occur exactly once per job/role to form a span; Observed repeated endpoints are excluded; missing records can conceal retries and their boundaries. Older claim timestamps come from claim logs; new claims use explicit stage timestamps. Service clocks can omit CPU and cross actors. These are not CPU, pure idle-time, or alarm-delivery guarantees. Missing spans stay missing; adjacent global jobs are never substituted.",
        "jobs": rows,
        "job_count": len(rows),
        "spans_ms": {name: distribution(values) for name, values in sorted(spans.items())},
        "excluded": {name: dict(values) for name, values in sorted(excluded.items())},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("traces", type=Path)
    parser.add_argument("versions", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    records = json.loads(args.traces.read_text())["records"]
    versions = json.loads(args.versions.read_text())
    result = summarize(records, versions)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"job_count": result["job_count"], "spans_ms": result["spans_ms"]}))


if __name__ == "__main__":
    main()
