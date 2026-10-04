---
title: Production checklist
description: Verify Seams release identity, origins, policy, lifecycle recovery, accessibility, observability, and rollback before launch.
---

# Production checklist

Complete this list against the exact artifacts and environment that will serve
users.

## Build and identity

- [ ] SDK, Wallet Server, and hosted wallet assets use the matching 0.8.0 release.
- [ ] An already-open older client shows an upgrade message; reload completes
      registration and signing with the current release.
- [ ] The docs, application, wallet runtime, workers, and WASM build without
      uncommitted generated output.
- [ ] Network, project environment, wallet origin, and RP ID match the target
      lane.

## Security boundaries

- [ ] Exact origin allowlists, CSP, iframe message validation, and request
      authentication are enabled.
- [ ] Browser configuration contains no secrets.
- [ ] Router A/B custody roles have independent credentials and operational
      authority where strict isolation is claimed.
- [ ] Challenge, registration, recovery, export, and signing endpoints have
      appropriate rate and replay controls.

## Product flows

- [ ] Registration, unlock, first signing, cancellation, recovery, linked
      device approval, export, and revocation complete on supported browsers.
- [ ] Expired sessions, retryable provisioning, transport failure, policy
      denial, and uncertain broadcast state have clear recovery actions.
- [ ] Mobile, keyboard, screen-reader, reduced-motion, and 200% zoom checks
      pass for the wallet surfaces.

## Operations

- [ ] Audit events exclude credentials, key material, OTP codes, and tokens.
- [ ] Alerts identify the affected lane and boundary without exposing secrets.
- [ ] Backup, restore, rollback, and secret-rotation procedures have been
      rehearsed.
- [ ] Support can map public error codes to the current troubleshooting runbook.
- [ ] Each enabled regional home has verified Worker/D1 bindings and DO/Container
      placement; routing and directory outages fail safely.
- [ ] One wallet retains the same home across devices and travel; concurrent
      wallets can operate in different homes.

## Tenant-root release

- [ ] The deployed release includes the intended refresh admission policy;
      same-operation retries replay, and a distinct manual refresh during the
      hourly cooldown is rejected before provider work.
- [ ] Fresh ECDSA and Ed25519 registration and signing pass on the deployed
      lane, with stable wallet identity across tenant-root refresh.
- [ ] A/B backup objects and the authoritative identity/activation metadata
      needed for managed restore are recoverable. Each role can access only
      its configured backup key through its runtime credential.
- [ ] Managed restore completes its mandatory forward refresh, and interrupted
      activation/retirement can resume from recorded checkpoints.
- [ ] Published security claims match actual administration and key-retention
      boundaries. Shared KMS versions do not establish per-tenant erasure.

SDK publication does not establish that administrative recovery or portability
is enabled in a particular environment. Verify the actual dashboard, signed CLI
binary, recovery custody, and destination restore path before offering them.
See [recovery availability](/deploy-and-operate/recovery-and-portability#availability).
