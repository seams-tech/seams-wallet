#!/usr/bin/env python3
"""Retain public timing and stage fields from private ML-DSA Worker traces."""

import argparse
import datetime
import json
import pathlib
import re
import urllib.parse


def records(path, role):
    source = path.read_text()
    decoder = json.JSONDecoder()
    position = 0
    result = []
    while position < len(source):
        while position < len(source) and source[position].isspace():
            position += 1
        if position == len(source):
            break
        item, position = decoder.raw_decode(source, position)
        request = item.get("event", {}).get("request", {})
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(request.get("url", "")).query)
        run_id = query.get("run_id", [None])[0]
        run_id_available = run_id is not None and re.fullmatch("[0-9a-f]{32}", run_id) is not None
        if run_id is not None and re.fullmatch("[0-9a-f]{32}", run_id) is None:
            run_id = None
        operation = query.get("kernel", [None])[0]
        if operation not in ["prepared-keygen", "prepared-signing", "prepared-gmw-signing"]:
            operation = None
        progress = []
        for log in item.get("logs", []):
            for message in log.get("message", []):
                try:
                    value = json.loads(message)
                except (TypeError, ValueError):
                    continue
                if not isinstance(value, dict):
                    continue
                if value.get("event") not in ["ml-dsa-boolean-preparation-progress", "ml-dsa-signing-key-ready", "ml-dsa-generic-preparation-ready"]:
                    continue
                progress.append({key: value[key] for key in [
                    "event", "role", "instances_started", "binding_phases_started", "wasm_linear_memory_bytes", "sent_bytes", "received_bytes",
                ] if key in value})
        result.append({
            "role": role,
            "worker": item.get("scriptName"),
            "version": item.get("scriptVersion", {}).get("id"),
            "run_id": run_id,
            "run_id_available": run_id_available,
            "operation": operation,
            "event_timestamp_ms": item.get("eventTimestamp"),
            "cpu_ms": item.get("cpuTime"),
            "wall_ms": item.get("wallTime"),
            "outcome": item.get("outcome"),
            "exception_names": [error.get("name") for error in item.get("exceptions", [])],
            "public_preparation_progress": progress,
        })
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("role_a", type=pathlib.Path)
    parser.add_argument("role_b", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    args = parser.parse_args()
    retained = records(args.role_a, "a") + records(args.role_b, "b")
    report = {
        "schema": "seams.ml-dsa-silent-worker-traces.v1",
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "scope": "Whole-invocation CPU and wall time include fixture key creation, preparation, online work, and cleanup. Request headers, complete URLs, credentials, exception messages, and unselected logs are excluded. Cloudflare can redact run_id query values; unavailable identifiers remain null. The original instances_started label counts binding-phase notifications, including chunk bindings. New traces label this binding_phases_started. Wasm linear memory is not total isolate memory.",
        "records": retained,
    }
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print("Retained", len(retained), "sanitized invocations")


if __name__ == "__main__":
    main()
