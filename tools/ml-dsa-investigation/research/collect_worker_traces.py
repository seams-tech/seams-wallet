#!/usr/bin/env python3
"""Retain public timing and stage fields from private ML-DSA Worker traces."""

import argparse
import base64
import datetime
import json
import pathlib
import re
import urllib.parse


def exception_category(error):
    message = error.get("message", "")
    if isinstance(message, str) and message.startswith(
        "The Workers runtime canceled this request because it detected that your Worker's code had hung"
    ):
        return "runtime_hung_response"
    if message == "Durable Object reset because its code was updated.":
        return "runtime_code_update_reset"
    return "unclassified"


def refill_job(request, path):
    if path != "/router-ab/ml-dsa/prepare-connect":
        return None
    encoded = request.get("headers", {}).get("x-ml-dsa-input")
    if not isinstance(encoded, str) or len(encoded) > 16384:
        return None
    try:
        value = json.loads(base64.b64decode(encoded + "=" * (-len(encoded) % 4), altchars=b"-_", validate=True))
        key = value["key"]
        result = {}
        for name, data in [("batch", value["batch"]), ("key", key["public_key_digest"])]:
            if not isinstance(data, list) or len(data) != 32 or any(type(byte) is not int or not 0 <= byte < 256 for byte in data):
                return None
            result[name] = bytes(data).hex()
        for name, data in [("epoch", key["epoch"]), ("expires_at_ms", value["expires_at_ms"]), ("material_expires_at_ms", value["material_expires_at_ms"])]:
            if type(data) is not int or data < 0:
                return None
            result[name] = data
        return result
    except (ValueError, TypeError, KeyError):
        return None


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
        url = urllib.parse.urlsplit(request.get("url", ""))
        query = urllib.parse.parse_qs(url.query)
        run_id = query.get("run_id", [None])[0]
        run_id_available = run_id is not None and re.fullmatch("[0-9a-f]{32}", run_id) is not None
        if run_id is not None and re.fullmatch("[0-9a-f]{32}", run_id) is None:
            run_id = None
        operation = query.get("kernel", [None])[0]
        if operation not in ["prepared-keygen", "prepared-signing", "prepared-gmw-signing", "prepared-gmw-pool"]:
            operation = None
        progress = []
        transport = []
        registration = []
        registration_preparation = []
        signing = []
        socket_completion = []
        peer_close = []
        refill = []
        inventories = []
        for log in item.get("logs", []):
            for message in log.get("message", []):
                try:
                    value = json.loads(message)
                except (TypeError, ValueError):
                    continue
                if not isinstance(value, dict):
                    continue
                if value.get("event") == "ml_dsa_inventory_v1":
                    public_inventory = {key: value[key] for key in [
                        "key", "epoch", "ready_a", "ready_b", "reserved_a", "reserved_b",
                    ] if key in value}
                    public_inventory["log_timestamp_ms"] = log.get("timestamp")
                    inventories.append(public_inventory)
                if value.get("event") == "ml_dsa_refill_completed_v1":
                    batch = value.get("batch", "")
                    if isinstance(batch, str) and re.fullmatch("[0-9a-f]{64}", batch):
                        public_refill = {key: value[key] for key in [
                            "batch", "published", "elapsed_ms", "candidates",
                        ] if key in value}
                        public_refill["log_timestamp_ms"] = log.get("timestamp")
                        refill.append(public_refill)
                if value.get("event") == "ml_dsa_peer_close_v1":
                    peer_close.append({key: value[key] for key in [
                        "operation", "close_code", "was_clean",
                    ] if key in value})
                if value.get("event") == "ml_dsa_socket_completion_v1":
                    socket_completion.append({key: value[key] for key in [
                        "kind", "id", "protocol_completed", "close_code", "close_requested",
                    ] if key in value})
                if value.get("event") == "ml_dsa_signing_outcome_v1":
                    outcome = value.get("outcome", {})
                    operation_id = value.get("operation", "")
                    if isinstance(outcome, dict) and isinstance(operation_id, str) and re.fullmatch("[0-9a-f]{64}", operation_id):
                        public = {key: outcome[key] for key in [
                            "status", "consumed_batches", "evaluated_candidates",
                        ] if key in outcome}
                        failure = outcome.get("failure")
                        if isinstance(failure, dict):
                            public["failure"] = {key: failure[key] for key in ["reason", "status"] if key in failure}
                        signing.append({"operation": operation_id, "outcome": public, "log_timestamp_ms": log.get("timestamp")})
                if value.get("event") == "router_ab_yao_transport_v1":
                    transport.append({key: value[key] for key in [
                        "duration_ms", "request_bytes", "service", "stage", "status",
                    ] if key in value})
                if value.get("event") == "ml_dsa_registration_preparation_v1":
                    registration_preparation.append({key: value[key] for key in [
                        "role", "written_frames", "write_transactions", "peak_pending_frames",
                    ] if key in value})
                if value.get("event") == "ml_dsa_registration_execution_v1":
                    registration.append({key: value[key] for key in [
                        "role", "restore_wall_ms", "run_wall_ms", "table_load_wall_ms",
                        "loaded_frames", "loaded_bytes", "table_read_transactions", "peak_cached_frames",
                    ] if key in value})
                if value.get("event") not in ["ml-dsa-boolean-preparation-progress", "ml-dsa-signing-key-ready", "ml-dsa-generic-preparation-ready", "ml-dsa-keygen-preparation-ready"]:
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
            "path": url.path,
            "producer_alarm": "scheduledTime" in item.get("event", {}) and item.get("entrypoint") == "RouterAbMlDsaProducerDurableObject",
            "event_timestamp_ms": item.get("eventTimestamp"),
            "cpu_ms": item.get("cpuTime"),
            "wall_ms": item.get("wallTime"),
            "outcome": item.get("outcome"),
            "exception_names": [error.get("name") for error in item.get("exceptions", [])],
            "exception_categories": [exception_category(error) for error in item.get("exceptions", [])],
            "public_preparation_progress": progress,
            "transport": transport,
            "registration": registration,
            "registration_preparation": registration_preparation,
            "signing": signing,
            "socket_completion": socket_completion,
            "peer_close": peer_close,
            "refill": refill,
            "refill_job": refill_job(request, url.path),
            "inventories": inventories,
        })
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("role_a", type=pathlib.Path)
    parser.add_argument("role_b", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    parser.add_argument("--router", type=pathlib.Path)
    parser.add_argument("--preparer-a", type=pathlib.Path)
    parser.add_argument("--preparer-b", type=pathlib.Path)
    args = parser.parse_args()
    retained = records(args.role_a, "a") + records(args.role_b, "b")
    if args.router:
        retained += records(args.router, "router")
    for role, path in [("preparer-a", args.preparer_a), ("preparer-b", args.preparer_b)]:
        if path:
            retained += records(path, role)
    report = {
        "schema": "seams.ml-dsa-silent-worker-traces.v1",
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "scope": "Whole-invocation CPU and wall time include fixture key creation, preparation, online work, and cleanup. Request headers, complete URLs, credentials, exception messages, and unselected logs are excluded. Cloudflare can redact run_id query values; unavailable identifiers remain null. The original instances_started label counts binding-phase notifications, including chunk bindings. New traces label this binding_phases_started. Wasm linear memory is not total isolate memory. Signing outcomes describe role dispatch before Router verification and settlement.",
        "records": retained,
    }
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print("Retained", len(retained), "sanitized invocations")


if __name__ == "__main__":
    main()
