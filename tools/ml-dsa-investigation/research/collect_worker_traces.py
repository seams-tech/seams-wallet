#!/usr/bin/env python3
"""Retain public timing and stage fields from private ML-DSA Worker traces."""

import argparse
import base64
import datetime
import hashlib
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
    if message == "Durable Object storage operation exceeded timeout which caused object to be reset.":
        return "durable_storage_timeout_reset"
    if message == "InvalidGateDecision: Registration preprocessing is already running":
        return "registration_preprocessing_already_running"
    if message == "InvalidGateDecision: ML-DSA operation deadline expired":
        return "ml_dsa_operation_deadline_expired"
    if message == "InvalidGateDecision: ML-DSA registration execution failed":
        return "ml_dsa_registration_execution_failed"
    if isinstance(message, str) and re.fullmatch(
        r"Internal error in Durable Object storage caused object to be reset; reference = [a-z0-9]+", message
    ):
        return "durable_storage_internal_reset"
    if message == "Durable Object connection closed because the object was reset.":
        return "durable_object_reset_connection_closed"
    if message == "Connection closed: this Durable Object instance is no longer active. Reconnect or retry the request.":
        return "durable_object_inactive_connection_closed"
    if message == "InvalidGateDecision: ML-DSA storage operation failed":
        return "ml_dsa_storage_operation_failed"
    if message == "Durable Object reset because its code was updated.":
        return "runtime_code_update_reset"
    if isinstance(message, str) and re.fullmatch(r"internal error; reference = [a-z0-9]+", message):
        return "runtime_internal_error"
    return "unclassified"


def preparation_ids(batch, groups):
    if groups == "one":
        return [batch]
    if groups == "two":
        second = hashlib.sha256(b"seams/ml-dsa/preparation-second-pair/v1" + bytes.fromhex(batch)).hexdigest()
        return [batch, second]
    raise ValueError("Invalid preparation group count")


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
        result["batches"] = preparation_ids(result["batch"], value.get("groups", "one"))
        return result
    except (ValueError, TypeError, KeyError):
        return None


def public_counter(value):
    return type(value) is int and 0 <= value <= 2**64 - 1


def alarm_time(value):
    if not isinstance(value, str):
        return None
    try:
        instant = datetime.datetime.fromisoformat(value)
    except ValueError:
        return None
    if instant.tzinfo is None:
        return None
    elapsed = instant - datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)
    milliseconds = (elapsed.days * 86400 + elapsed.seconds) * 1000 + elapsed.microseconds // 1000
    return milliseconds if public_counter(milliseconds) else None


def public_time(value):
    return value is None or public_counter(value)


def public_object_list(value, maximum):
    return isinstance(value, list) and len(value) <= maximum and all(isinstance(item, dict) for item in value)


def public_id(value):
    return isinstance(value, str) and re.fullmatch("[0-9a-f]{64}", value) is not None


def public_stage(stage):
    if not isinstance(stage, dict):
        return None
    name = stage.get("stage")
    if name not in ("bound", "taking", "taken", "restored", "activated", "checked"):
        return None
    result = {"stage": name}
    keys = [] if name == "bound" else ["batch"]
    if name == "restored":
        keys += ["topology_builds", "topology_hits"]
    for key in keys:
        if not public_counter(stage.get(key)):
            return None
        result[key] = stage[key]
    if "material_id" in stage:
        identity = stage["material_id"]
        if not isinstance(identity, list) or len(identity) != 32 or any(type(byte) is not int or not 0 <= byte <= 255 for byte in identity):
            return None
        result["material_id"] = bytes(identity).hex()
    return result


def public_router_trace(value, timestamp):
    if value.get("event") != "ml_dsa_router_trace_v1" or not public_time(timestamp):
        return None
    request = value.get("http_request")
    if not isinstance(request, str) or re.fullmatch("[0-9a-f]{32}", request) is None:
        return None
    operation = value.get("operation")
    identity = value.get("module_instance")
    status = value.get("status")
    if operation is not None and not public_id(operation):
        return None
    if identity is not None and (not isinstance(identity, str) or re.fullmatch("[0-9a-f]{32}", identity) is None):
        return None
    if status is not None and (type(status) is not int or not 100 <= status <= 599):
        return None
    milestones = value.get("milestones")
    allowed = ["entered", "decoded", "admission_done", "execution_done", "completion_recorded", "roles_released", "settled", "activation_started", "installation_done", "activation_done", "response_ready"]
    if not public_object_list(milestones, len(allowed)):
        return None
    clean = []
    for item in milestones:
        if item.get("stage") not in allowed or not public_time(item.get("at_ms")):
            return None
        clean.append({"stage": item["stage"], "at_ms": item.get("at_ms")})
    return {"http_request": request, "operation": operation, "module_instance": identity,
            "status": status, "milestones": clean, "log_timestamp_ms": timestamp}


def public_stage_trace(value, timestamp):
    if value.get("event") != "ml_dsa_stage_trace_v1" or not public_time(timestamp):
        return None
    if not public_id(value.get("operation")) or value.get("role") not in ("a", "b"):
        return None
    identity = value.get("module_instance")
    if identity is not None and (not isinstance(identity, str) or re.fullmatch("[0-9a-f]{32}", identity) is None):
        return None
    context = value.get("context")
    if not isinstance(context, dict):
        return None
    kind = context.get("kind")
    if kind not in ("take_caller", "take_store", "registration_execute", "registration_install", "registration_stock"):
        return None
    key = "material" if kind in ("take_caller", "take_store") else "job"
    raw = context.get(key)
    if not isinstance(raw, list) or len(raw) != 32 or any(type(byte) is not int or not 0 <= byte <= 255 for byte in raw):
        return None
    clean_context = {"kind": kind, key: bytes(raw).hex()}
    if kind == "registration_stock":
        if not public_counter(context.get("ordinal")):
            return None
        clean_context["ordinal"] = context["ordinal"]
    marks = value.get("marks")
    if not public_object_list(marks, 32) or type(value.get("completed")) is not bool:
        return None
    allowed = {
        "started", "completed", "authorized", "transaction_committed", "response_headers",
        "schedules_loaded", "execution_reserved", "adapter_ready", "input_opened",
        "prepared_consumed", "prepared_opened", "prepared_restored", "keygen_completed",
        "material_sealed", "material_persisted", "result_exchanged", "installation_checked",
        "material_loaded", "material_installed", "stock_installed", "stock_loaded",
        "stock_resealed", "delivery_persisted", "delivery_acknowledged",
    }
    clean_marks = []
    for mark in marks:
        if mark.get("stage") not in allowed or not public_time(mark.get("at_ms")):
            return None
        clean_marks.append({"stage": mark["stage"], "at_ms": mark.get("at_ms")})
    reads = value.get("table_reads")
    keys = ("count", "measured", "elapsed_ms", "maximum_ms")
    if not isinstance(reads, dict) or not all(public_counter(reads.get(key)) for key in keys):
        return None
    return {
        "operation": value["operation"], "role": value["role"], "context": clean_context,
        "module_instance": identity, "completed": value["completed"], "marks": clean_marks,
        "table_reads": {key: reads[key] for key in keys}, "log_timestamp_ms": timestamp,
    }


def public_durable_boundary(value, timestamp):
    if value.get("event") != "ml_dsa_durable_boundary_v1":
        return None
    commands = {
        "prepare_registration", "retire_registration", "ready_registration",
        "check_registration_job", "claim_registration", "check_registration_claim",
        "finish_registration", "authorize_key", "commit_key", "key_state",
        "initialize_registration_storage", "install_registration_batch",
        "install_material", "install_pool", "check_material",
    }
    stages = {
        "authorized", "entered", "authorize", "transaction", "callback_started",
        "callback_finished", "get", "put", "delete", "schedule_alarm",
        "pool_dispatch", "admission_dispatch", "role_dispatch", "get_chunks",
        "put_chunk", "delete_many",
    }
    if value.get("command") not in commands or value.get("stage") not in stages:
        return None
    if value.get("state") not in {"mark", "begin", "end", "error"}:
        return None
    if value.get("call_id") is not None and not public_call_id(value["call_id"]):
        return None
    if any(value.get(key) is not None and not public_id(value[key]) for key in ("job", "operation")):
        return None
    if value["state"] == "mark":
        if value.get("observation") is not None:
            return None
    elif not public_counter(value.get("observation")):
        return None
    if not public_counter(value.get("sequence")) or not public_time(value.get("at_ms")):
        return None
    fields = (
        "call_id", "command", "job", "operation", "stage", "state",
        "sequence", "observation", "at_ms",
    )
    return {key: value.get(key) for key in fields} | {"log_timestamp_ms": timestamp}


def public_call_id(value):
    return isinstance(value, str) and re.fullmatch("[0-9a-f]{32}", value) is not None


def public_registration_context(headers):
    job = headers.get("x-ml-dsa-job-id")
    phase = headers.get("x-ml-dsa-command")
    operation = headers.get("x-ml-dsa-operation-id")
    if not public_id(job) or phase not in ("prepare", "prepare_peer", "execute", "execute_peer", "install", "result"):
        return None
    if phase in ("prepare", "prepare_peer"):
        if operation is not None:
            return None
    elif not public_id(operation):
        return None
    return {"job": job, "operation": operation, "phase": phase}


def public_registration_link(value):
    event = value.get("event")
    if event not in ("ml_dsa_registration_job_v1", "ml_dsa_registration_call_v1"):
        return None
    if not public_id(value.get("job")) or (value.get("operation") is not None and not public_id(value["operation"])):
        return None
    result = {key: value.get(key) for key in ("event", "job", "operation")}
    if event == "ml_dsa_registration_job_v1":
        if not public_call_id(value.get("http_request")):
            return None
        result["http_request"] = value["http_request"]
    else:
        if value.get("call_id") is not None and not public_call_id(value["call_id"]):
            return None
        if value.get("phase") not in ("prepare", "prepare_peer", "execute", "execute_peer", "install", "result"):
            return None
        result.update(call_id=value.get("call_id"), phase=value["phase"])
    return result


def public_wait_trace(value, timestamp):
    event = value.get("event")
    if event not in ("ml_dsa_wait_scope_v1", "ml_dsa_wait_boundary_v1", "ml_dsa_wait_summary_v1"):
        return None
    if not public_time(timestamp) or (value.get("call_id") is not None and not public_call_id(value["call_id"])):
        return None
    result = {"event": event, "call_id": value.get("call_id"), "log_timestamp_ms": timestamp}
    if event == "ml_dsa_wait_scope_v1":
        if not public_id(value.get("job")) or value.get("role") not in ("a", "b"):
            return None
        if value.get("operation") is not None and not public_id(value["operation"]):
            return None
        result.update(job=value["job"], operation=value.get("operation"), role=value["role"])
        return result
    for key in ("peer_ready", "peer_pending", "peer_boundary_ms"):
        if not public_counter(value.get(key)):
            return None
        result[key] = value[key]
    if event == "ml_dsa_wait_summary_v1":
        if not all(public_counter(value.get(key)) for key in ("observations", "emitted_events")) or type(value.get("event_limit_reached")) is not bool:
            return None
        result.update({key: value[key] for key in ("observations", "emitted_events", "event_limit_reached")})
    else:
        if value.get("kind") not in ("peer_connect", "peer_event", "peer_prepared", "publish_ready", "peer_ready", "peer_result", "store_tables", "load_tables", "publish_private", "consume_private", "store_signing_stock"):
            return None
        if value.get("state") not in ("begin", "end", "error") or type(value.get("pending")) is not bool:
            return None
        if not public_counter(value.get("sequence")) or not public_time(value.get("at_ms")):
            return None
        result.update({key: value[key] for key in ("kind", "state", "pending", "sequence", "at_ms")})
    return result


def public_retirement(value, timestamp):
    if value.get("event") != "ml_dsa_registration_retirement_v1" or not public_time(timestamp):
        return None
    if not public_id(value.get("job")) or value.get("preparation_failed") is not True:
        return None
    outcome = value.get("retirement")
    failed = value.get("retirement_failed")
    if type(failed) is not bool or outcome not in (None, "retired", "already_retired", "claimed"):
        return None
    if failed != (outcome is None):
        return None
    return {"job": value["job"], "retirement": outcome, "retirement_failed": failed,
            "preparation_failed": True, "log_timestamp_ms": timestamp}


def public_commit_probe(value, timestamp):
    if value.get("event") != "ml_dsa_commit_probe_v1" or not public_time(timestamp):
        return None
    if value.get("role") not in ("a", "b") or not public_id(value.get("object")):
        return None
    if not public_call_id(value.get("instance")) or not public_counter(value.get("sequence")):
        return None
    if value.get("state") not in ("complete", "transaction_error", "sync_error"):
        return None
    times = ("transaction_started_ms", "transaction_returned_ms", "sync_finished_ms")
    if any(key not in value for key in times) or not public_counter(value["transaction_started_ms"]):
        return None
    if not all(public_time(value[key]) for key in times):
        return None
    if value["state"] == "complete" and not all(public_counter(value[key]) for key in times):
        return None
    if value["state"] == "sync_error" and not public_counter(value["transaction_returned_ms"]):
        return None
    if value["state"] != "complete" and value["sync_finished_ms"] is not None:
        return None
    calibration = value.get("calibration")
    if calibration is not None:
        if not isinstance(calibration, dict) or calibration.get("requested_ms") != 400:
            return None
        if not all(public_counter(calibration.get(key)) for key in ("started_ms", "finished_ms")):
            return None
        calibration = {key: calibration[key] for key in ("requested_ms", "started_ms", "finished_ms")}
    fields = ("role", "object", "instance", "sequence", "state", *times)
    return {**{key: value[key] for key in fields}, "calibration": calibration, "log_timestamp_ms": timestamp}


def public_producer_entry(value, timestamp):
    if value.get("event") != "ml_dsa_producer_entry_v1" or not public_time(timestamp):
        return None
    identity = value.get("module_instance")
    if identity is not None and (not isinstance(identity, str) or re.fullmatch("[0-9a-f]{32}", identity) is None):
        return None
    if (not public_id(value.get("producer"))
            or not all(public_counter(value.get(key)) for key in ["construction", "invocation"])
            or not all(public_time(value.get(key)) for key in ["created_at_ms", "at_ms"])
            or type(value.get("schedule_cache_hit")) is not bool
            or value.get("stage") not in ["fetch_entered", "authenticated", "alarm_entered"]):
        return None
    fields = ["producer", "module_instance", "construction", "invocation", "created_at_ms", "at_ms", "schedule_cache_hit", "stage"]
    return {**{key: value.get(key) for key in fields}, "log_timestamp_ms": timestamp}


def public_signing_trace(value, timestamp=None):
    if not isinstance(value, dict) or not public_time(timestamp):
        return None
    required = ["operation", "role", "module_instance", "signing_call", "schedule_cache_hit", "completed", "transport"]
    if any(key not in value for key in required):
        return None
    operation = value.get("operation")
    if "module_instance" not in value or not public_time(timestamp):
        return None
    identity = value["module_instance"]
    if not isinstance(operation, str) or not re.fullmatch("[0-9a-f]{64}", operation):
        return None
    if identity is not None and (not isinstance(identity, str) or not re.fullmatch("[0-9a-f]{32}", identity)):
        return None
    if value.get("role") not in ("a", "b") or not public_counter(value.get("signing_call")):
        return None
    if type(value.get("schedule_cache_hit")) is not bool or type(value.get("completed")) is not bool:
        return None
    trace = {key: value[key] for key in ["operation", "role", "module_instance", "signing_call", "schedule_cache_hit", "completed"]}
    trace["log_timestamp_ms"] = timestamp
    milestones = value.get("milestones")
    if not public_object_list(milestones, 256):
        return None
    trace["milestones"] = []
    for item in milestones:
        if item.get("name") not in ("started", "permit_checked", "material_loaded", "material_opened", "schedules_loaded", "protocol_completed", "completed") or not public_time(item.get("at_ms")):
            return None
        trace["milestones"].append({key: item.get(key) for key in ["name", "at_ms"]})
    batches = value.get("batches")
    if not public_object_list(batches, 256):
        return None
    trace["batches"] = []
    for item in batches:
        stage = item.get("value")
        if not isinstance(stage, dict) or not public_time(item.get("at_ms")):
            return None
        public = public_stage(stage)
        if public is None:
            return None
        trace["batches"].append({"at_ms": item.get("at_ms"), "value": public})
    transport = value.get("transport")
    if transport is None:
        trace["transport"] = None
        return trace
    if not isinstance(transport, dict):
        return None
    public = {}
    for key in ["sent_bytes", "received_bytes", "acknowledgments_sent", "acknowledgments_received", "ready_events", "pending_events", "pending_event_boundary_ms", "maximum_event_boundary_ms"]:
        if not public_counter(transport.get(key)):
            return None
        public[key] = transport[key]
    phases = transport.get("phases")
    if not public_object_list(phases, 2048):
        return None
    public["phases"] = []
    for item in phases:
        if not public_time(item.get("at_ms")):
            return None
        phase = {"at_ms": item.get("at_ms")}
        for key in ["phase", "sent_frames", "received_frames"]:
            if not public_counter(item.get(key)):
                return None
            phase[key] = item[key]
        public["phases"].append(phase)
    trace["transport"] = public
    return trace


def public_refill_recovery(value, timestamp):
    batch = value.get("batch")
    if not isinstance(batch, str) or not re.fullmatch("[0-9a-f]{64}", batch):
        return None
    stage = value.get("stage")
    if stage not in ("waiting_for_publication", "paired_publication_confirmed", "deadline_reached"):
        return None
    if not public_counter(value.get("expires_at_ms")) or not public_time(timestamp):
        return None
    return {"batch": batch, "stage": stage, "expires_at_ms": value["expires_at_ms"], "log_timestamp_ms": timestamp}


def public_refill_claim(value, timestamp):
    key = value.get("key")
    epoch = value.get("epoch")
    claim = value.get("claim")
    if not isinstance(key, str) or not re.fullmatch("[0-9a-f]{64}", key):
        return None
    if not public_counter(epoch) or not public_time(timestamp) or not isinstance(claim, dict):
        return None
    result = {"key": key, "epoch": epoch, "log_timestamp_ms": timestamp}
    if claim.get("status") == "busy" and public_counter(claim.get("retry_at_ms")):
        return {**result, "status": "busy", "retry_at_ms": claim["retry_at_ms"]}
    job = claim.get("job")
    if claim.get("status") != "acquired" or not isinstance(job, dict):
        return None
    batch = job.get("batch")
    scope = job.get("key")
    if not isinstance(batch, list) or len(batch) != 32 or any(type(byte) is not int or not 0 <= byte <= 255 for byte in batch):
        return None
    if not isinstance(scope, dict) or not public_counter(scope.get("epoch")) or scope["epoch"] != epoch:
        return None
    digest = scope.get("public_key_digest")
    if not isinstance(digest, list) or any(type(byte) is not int for byte in digest) or digest != list(bytes.fromhex(key)):
        return None
    if not public_counter(job.get("expires_at_ms")):
        return None
    groups = job.get("groups", "one")
    if groups not in ("one", "two"):
        return None
    batch = bytes(batch).hex()
    return {**result, "status": "acquired", "batch": batch,
            "batches": preparation_ids(batch, groups), "expires_at_ms": job["expires_at_ms"]}


def public_refill_wake(value, timestamp):
    fields = {
        "ml_dsa_refill_controller_v1": ["key", "epoch", "at_ms"],
        "ml_dsa_refill_settled_v1": ["batch", "wake_count", "at_ms"],
        "ml_dsa_refill_woken_v1": ["batch", "key", "epoch", "at_ms"],
    }.get(value.get("event"))
    if fields is None or not public_time(timestamp):
        return None
    for field in fields:
        if field in ("batch", "key"):
            check = public_id
        elif field == "at_ms":
            check = public_time
        else:
            check = public_counter
        if not check(value.get(field)):
            return None
    return {"event": value["event"], **{field: value[field] for field in fields}, "log_timestamp_ms": timestamp}


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
        request_id = request.get("headers", {}).get("x-ml-dsa-request-id")
        if not isinstance(request_id, str) or re.fullmatch("[0-9a-f]{32}", request_id) is None:
            request_id = None
        headers = request.get("headers", {})
        service_call_id = headers.get("x-seams-trace-id")
        if not public_call_id(service_call_id):
            service_call_id = None
        registration_context = public_registration_context(headers)
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
        signing_traces = []
        router_traces = []
        registration_links = []
        wait_traces = []
        durable_boundaries = []
        retirements = []
        commit_probes = []
        stage_traces = []
        socket_completion = []
        peer_close = []
        refill = []
        refill_recovery = []
        refill_claims = []
        refill_wakes = []
        inventories = []
        producer_jobs = []
        producer_entries = []
        producer_startup = []
        material_stages = []
        preparation_stages = []
        preparation_transport = []
        for log in item.get("logs", []):
            for message in log.get("message", []):
                try:
                    value = json.loads(message)
                except (TypeError, ValueError):
                    continue
                if not isinstance(value, dict):
                    continue
                boundary = public_durable_boundary(value, log.get("timestamp"))
                if boundary is not None:
                    durable_boundaries.append(boundary)
                retirement = public_retirement(value, log.get("timestamp"))
                if retirement is not None:
                    retirements.append(retirement)
                commit_probe = public_commit_probe(value, log.get("timestamp"))
                if commit_probe is not None:
                    commit_probes.append(commit_probe)
                link = public_registration_link(value)
                if link is not None:
                    registration_links.append(link)
                wait_trace = public_wait_trace(value, log.get("timestamp"))
                if wait_trace is not None:
                    wait_traces.append(wait_trace)
                stage_trace = public_stage_trace(value, log.get("timestamp"))
                if stage_trace is not None:
                    stage_traces.append(stage_trace)
                router_trace = public_router_trace(value, log.get("timestamp"))
                if router_trace is not None:
                    router_traces.append(router_trace)
                entry = public_producer_entry(value, log.get("timestamp"))
                if entry is not None:
                    producer_startup.append(entry)
                if value.get("event") == "ml_dsa_signing_trace_v1":
                    public_trace = public_signing_trace(value, log.get("timestamp"))
                    if public_trace is not None:
                        signing_traces.append(public_trace)
                wake = public_refill_wake(value, log.get("timestamp"))
                if wake is not None:
                    refill_wakes.append(wake)
                if value.get("event") == "ml_dsa_refill_recovery_v1":
                    recovery = public_refill_recovery(value, log.get("timestamp"))
                    if recovery is not None:
                        refill_recovery.append(recovery)
                if value.get("event") == "ml_dsa_refill_claim_v1":
                    claim = public_refill_claim(value, log.get("timestamp"))
                    if claim is not None:
                        refill_claims.append(claim)
                if value.get("event") == "ml_dsa_inventory_v1":
                    public_inventory = {key: value[key] for key in [
                        "key", "epoch", "ready_a", "ready_b", "reserved_a", "reserved_b",
                    ] if key in value}
                    public_inventory["log_timestamp_ms"] = log.get("timestamp")
                    inventories.append(public_inventory)
                if value.get("event") == "ml_dsa_producer_entered_v1" and public_id(value.get("producer")):
                    producer_entries.append({"producer": value["producer"], "log_timestamp_ms": log.get("timestamp")})
                if value.get("event") == "ml_dsa_producer_job_v1":
                    ids = value.get("batches")
                    if (all(public_id(value.get(key)) for key in ["producer", "batch", "key"])
                            and isinstance(ids, list) and 1 <= len(ids) <= 2 and all(public_id(batch) for batch in ids)
                            and ids[0] == value["batch"] and len(set(ids)) == len(ids)
                            and public_counter(value.get("epoch")) and value.get("stage") in ("queued", "running", "recovering", "settling")):
                        producer_jobs.append({**{key: value[key] for key in ["producer", "batch", "batches", "key", "epoch", "stage"]}, "log_timestamp_ms": log.get("timestamp")})
                if value.get("event") == "ml_dsa_material_stage_v1":
                    stage = public_stage(value.get("value"))
                    if (public_id(value.get("operation")) and value.get("role") in ("a", "b")
                            and stage is not None and "material_id" in stage and stage["stage"] in ("taken", "checked")):
                        material_stages.append({"operation": value["operation"], "role": value["role"], "value": stage, "log_timestamp_ms": log.get("timestamp")})
                if value.get("event") == "ml_dsa_preparation_stage_v1":
                    if (public_id(value.get("job")) and public_id(value.get("batch")) and value.get("role") in ("a", "b")
                            and value.get("stage") in ("controller_selected", "activation_checked", "local_inventory_checked", "peer_inventory_checked",
                                                     "claim_acquired", "dispatch_started", "dispatch_acknowledged", "producer_received",
                                                     "producer_authorized", "queue_checked", "receipt_ready", "producer_running",
                                                     "recovery_armed", "role_claimed", "peer_received", "peer_connected",
                                                     "load_started", "crypto_started", "correlations_completed",
                                                     "commitment_started", "commitment_completed", "crypto_completed",
                                                     "serialized", "sealed", "published") and public_time(value.get("at_ms"))):
                        stage = {key: value[key] for key in ["job", "batch", "role", "stage", "at_ms"]}
                        identity = value.get("module_instance")
                        memory = value.get("wasm_linear_memory_bytes")
                        observed_at = value.get("resource_observed_at_ms")
                        if (isinstance(identity, str) and re.fullmatch("[0-9a-f]{32}", identity)
                                and public_counter(memory) and memory > 0 and memory % 65536 == 0
                                and public_counter(observed_at)):
                            stage.update(module_instance=identity, wasm_linear_memory_bytes=memory,
                                         resource_observed_at_ms=observed_at)
                        stage["log_timestamp_ms"] = log.get("timestamp")
                        preparation_stages.append(stage)
                if value.get("event") == "ml_dsa_preparation_transport_v1":
                    if (public_id(value.get("job")) and value.get("role") in ("a", "b")
                            and all(public_counter(value.get(key)) for key in ["sent_bytes", "received_bytes", "pending_events"])):
                        preparation_transport.append({key: value[key] for key in ["job", "role", "sent_bytes", "received_bytes", "pending_events"]})
                if value.get("event") == "ml_dsa_refill_completed_v1":
                    batch = value.get("batch", "")
                    if isinstance(batch, str) and re.fullmatch("[0-9a-f]{64}", batch):
                        public_refill = {key: value[key] for key in [
                            "batch", "published", "elapsed_ms", "candidates",
                        ] if key in value}
                        if "batches" in value:
                            batches = value["batches"]
                            if not (isinstance(batches, list) and 1 <= len(batches) <= 2
                                    and all(isinstance(item, str) and re.fullmatch("[0-9a-f]{64}", item) for item in batches)
                                    and len(set(batches)) == len(batches) and batches[0] == batch):
                                raise ValueError("Invalid preparation publication identities")
                            public_refill["batches"] = batches
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
                        "operation", "wasm_linear_memory_bytes",
                    ] if key in value})
                if value.get("event") not in ["ml-dsa-boolean-preparation-progress", "ml-dsa-signing-key-ready", "ml-dsa-generic-preparation-ready", "ml-dsa-keygen-preparation-ready"]:
                    continue
                progress.append({key: value[key] for key in [
                    "event", "role", "instances_started", "binding_phases_started", "wasm_linear_memory_bytes", "sent_bytes", "received_bytes",
                ] if key in value})
        result.append({
            "role": role,
            "http_request": request_id,
            "service_call_id": service_call_id,
            "registration_context": registration_context,
            "registration_links": registration_links,
            "wait_traces": wait_traces,
            "durable_boundaries": durable_boundaries,
            "retirements": retirements,
            "commit_probes": commit_probes,
            "worker": item.get("scriptName"),
            "entrypoint": item.get("entrypoint") if item.get("entrypoint") in (
                "default", "RouterAbMlDsaRegistrationDurableObject", "RouterAbMlDsaPoolDurableObject",
                "RouterAbMlDsaProducerDurableObject", "RouterAbMlDsaAdmissionDurableObject",
            ) else None,
            "version": item.get("scriptVersion", {}).get("id"),
            "run_id": run_id,
            "run_id_available": run_id_available,
            "operation": operation,
            "path": url.path,
            "producer_alarm": "scheduledTime" in item.get("event", {}) and item.get("entrypoint") == "RouterAbMlDsaProducerDurableObject",
            "alarm_scheduled_ms": alarm_time(item.get("event", {}).get("scheduledTime")),
            "event_timestamp_ms": item.get("eventTimestamp"),
            "cpu_ms": item.get("cpuTime"),
            "wall_ms": item.get("wallTime"),
            "outcome": item.get("outcome"),
            "logs_truncated": item.get("truncated") if type(item.get("truncated")) is bool else None,
            "exception_names": [error.get("name") for error in item.get("exceptions", [])],
            "exception_categories": [exception_category(error) for error in item.get("exceptions", [])],
            "public_preparation_progress": progress,
            "transport": transport,
            "registration": registration,
            "registration_preparation": registration_preparation,
            "signing": signing,
            "signing_traces": signing_traces,
            "router_traces": router_traces,
            "stage_traces": stage_traces,
            "socket_completion": socket_completion,
            "peer_close": peer_close,
            "refill": refill,
            "refill_recovery": refill_recovery,
            "refill_claims": refill_claims,
            "refill_wakes": refill_wakes,
            "refill_job": refill_job(request, url.path),
            "inventories": inventories,
            "producer_jobs": producer_jobs,
            "producer_entries": producer_entries,
            "producer_startup": producer_startup,
            "material_stages": material_stages,
            "preparation_stages": preparation_stages,
            "preparation_transport": preparation_transport,
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
    parser.add_argument("--front", type=pathlib.Path)
    args = parser.parse_args()
    retained = records(args.role_a, "a") + records(args.role_b, "b")
    if args.router:
        retained += records(args.router, "router")
    for role, path in [("preparer-a", args.preparer_a), ("preparer-b", args.preparer_b), ("front", args.front)]:
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
