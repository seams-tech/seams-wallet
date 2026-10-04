---
title: Troubleshooting
description: Diagnose common Seams registration, iframe, session, signing, provisioning, broadcast, and theme failures by lifecycle boundary.
---

# Troubleshooting

Start with the visible symptom, identify the boundary, inspect stable state and
codes, then choose the supported recovery action. Avoid blind retries for
operations whose broadcast state is uncertain.

## Wallet surface does not load

**Boundary:** application-to-wallet iframe. Check the configured wallet origin,
service route, CSP `frame-src`, frame-ancestor policy, asset content types, and
browser console origin errors. Correct the deployment or origin allowlist, then
reload the wallet surface.

## An older client receives an upgrade-required response

**Boundary:** SDK, hosted wallet assets, and backend release identity. Version
0.8.0 rejects unsupported wallet-management protocols with HTTP 409 and an
upgrade message. Display it and reload the matching application and wallet
assets. Stop automatic retries of the same incompatible request. Follow the
[0.8.0 cutover instructions](/deploy-and-operate/hosted-integration#upgrading-to-0-8-0).

## A regional wallet cannot be routed

**Boundary:** wallet-home directory and regional bindings. Check the wallet's
recorded home and the serving Worker/D1 binding evidence. A directory outage
requires restoring directory access and retrying the same operation safely.
Wrong-home rejection requires correcting routing. Never write to a fallback
region or assign an existing wallet a new home to bypass the failure.

## Passkey prompt is unavailable

**Boundary:** browser capability, RP ID, and wallet origin. Inspect the public
capability-selection result, secure-context status, iframe permissions, and RP
scope. Offer a supported auth method or correct the origin configuration. Do
not loop the credential prompt.

## Registration succeeded but a signer is not ready

**Boundary:** provisioning lifecycle. Inspect the successful
`RegistrationResult` branch and current provisioning state. Wait for a pending
state, retry only a retryable failure, and continue after the exact capability
is ready.

## Signing reports a session or subject mismatch

**Boundary:** wallet-session identity. Confirm that the wallet-session reference,
account or chain target, wallet ID, network, and current SDK client all describe
the same wallet lifecycle. Re-authenticate and rebuild exact references from
validated state.

## Transaction status is uncertain

**Boundary:** broadcast and chain finality. Use the operation hash or request ID
to query the configured network and reconcile nonce-lane state. Retry only
after proving the previous transaction was not accepted.

## Appearance differs between app and wallet

**Boundary:** rendering origin. Confirm that app-owned components receive the
React `Theme` tokens and wallet-owned surfaces receive matching SDK appearance
tokens for the active mode. Verify contrast after correcting both channels.

## Tenant-root refresh is throttled or already running

**Boundary:** tenant-root operation admission. In releases containing R120's
hourly gate, HTTP 429 with `tenant_root_refresh_throttled` returns `retryAtMs`
and `Retry-After`. Wait until that server-computed time before starting a new
manual refresh. HTTP 409 with `tenant_root_refresh_in_progress` identifies a
different operation already in progress. Preserve the original `operationId`
when retrying an interrupted request; generating new IDs cannot resume it.

Verify the release and policy of the actual environment. The implemented
contract alone does not establish deployment configuration.

## Tenant-root backup cannot be opened

**Boundary:** role-local backup provider. Check the affected role's KMS key
reference, enabled key version, service-account access, and retained R2 object
against the authoritative activation evidence. Keep credentials and decrypted
material out of logs. Restore access to the recorded key version; creating a
replacement key cannot decrypt ciphertext written under the lost version.

A complete database-loss incident also requires authoritative identity and
activation records. Follow [tenant-root backup recovery requirements](/deploy-and-operate/tenant-root-backups#backup-refresh-and-restore).

## Refresh activated but retirement is incomplete

**Boundary:** tenant-root lifecycle cleanup. Inspect the authoritative revision
and role receipts. Resume the original operation's cleanup rather than
reactivating the retired epoch or starting repeated rotations. Working signing
does not prove retirement completed, and deleting active backup objects does
not prove all historical ciphertext is unrecoverable.

## What to collect for support

Collect release, environment, browser, operation ID, public error code, event
phase/status, and redacted console or network evidence. Exclude credentials,
tokens, assertions, OTPs, recovery data, and key material.
