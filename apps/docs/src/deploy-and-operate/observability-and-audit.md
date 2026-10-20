---
title: Observability and audit
description: Correlate Seams wallet flows across browser and service boundaries while excluding credentials, secrets, and sensitive proof material.
---

# Observability and audit

Track wallet operations with stable identifiers, flow phases, result codes, and service
receipts. Use these values to connect events across services. Exclude sensitive
authentication data from telemetry.

## Record

- release, environment, network, and component identity.
- a generated operation or intent ID.
- wallet ID or another approved pseudonymous subject identifier.
- event version, phase, status, duration, and stable error code.
- policy decision, signing lane, broadcast acceptance, and finalization state.
- administrative change, actor, target, and reviewed reason.

For tenant-root operations, correlate the operation ID with approved public
tenant/lineage identifiers, share epoch, lifecycle revision, affected role, and receipt
digest. Distinguish activation success from retirement cleanup failure. Record cooldown
rejection as an admission outcome. It does not mean a refresh or provider call occurred.

## Registration measurements

Record setup, response, finalization, passkey interaction, and the first verified
signature separately. Define whether the reported total includes setup or the
passkey interval. Preserve warm-up samples and report them separately.

Admission diagnostics include `yao_admission_state_read`,
`yao_admission_authorization`, `yao_admission_root_wait`,
`yao_admission_backend`, and `yao_admission_commit`. These can nest inside
`yao_admission_bind`. Parent and child durations are not additive. A failed
attempt can lack a parent span, and a retry can repeat a span name.

Elapsed protocol time includes waits. It does not measure cryptographic CPU
alone. Record ingress location, serving component revisions, object hosts,
database primaries, sample count, and the test environment with latency results.
Small sequential cohorts do not establish a release effect or a tail guarantee.

## Exclude

Never log passwords, OTP codes, passkey assertions, challenge responses, private
keys, threshold shares, recovery codes, session or ID tokens, authorization
headers, or complete export payloads. Redact URLs and request bodies that can
carry these values.

Exclude Google service-account credentials, bootstrap tokens, recovery private
keys, and complete backup/import bodies. Use object or receipt digests when
diagnosing backup failures instead of capturing request and response payloads.

## Alert

Alert on these conditions:

- Changes in registration and unlock failures.
- Challenge abuse or rejected origin and authentication checks.
- Signing lanes that are no longer ready.
- Repeated policy denials.
- Disagreement between broadcast and finalization state.
- Custody-role health problems.
- Failures to write audit records.
 Route every alert to the team that owns the failing boundary.

Tenant-root alerts should identify failed backup verification, loss of access
to a recorded KMS version, and stalled refresh or retirement checkpoints.
Expected hourly cooldown responses alone are not custody-health failures.

Progress events support UI and telemetry. The operation result remains the
authoritative lifecycle outcome.
