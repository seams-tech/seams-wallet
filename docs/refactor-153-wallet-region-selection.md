# Refactor 153: owner-controlled wallet region selection

Status: implementation and scoped hosted acceptance completed October 7, 2026.

## Why

Owners needed to select a wallet home for sustained use in another region.
A directory update alone could neither transfer custody nor prevent two active writers.

## What changed

- Added an owner-approved Wallet region setting and an exact persisted move request.
- Prepared the destination, paused wallet writes, and transferred immutable wallet state.
- Preserved exact retries, interruption recovery, and source fencing.
- Activated the destination before source cleanup and required fresh authentication afterward.
- Retired sessions and usable presignatures for relocation while keeping ordinary lock's retention behavior.
- Covered linked devices, offline devices, and fresh-browser recovery.

## Completion record

The APAC → US → APAC acceptance passed ECDSA, Ed25519, and cleanup in both regions.
Pause through fresh unlock and first signature measured 43.845 and 43.326 seconds.
Both observations met the scoped 60-second pause limit; they were not percentiles.

Public implementation included `b3db1161`; public completion evidence included `d8a6a630`.
Private acceptance included `654f65a` and `142e73b`.

## Deferred work and limits

Broader load/interference tests, complete custody-transfer byte accounting, package
publication, and production adoption were outside the closure.
[Region-change suggestions](refactor-154-region-change-notifications.md) remain separate work.

[R153B](refactor-153B.md) records the final transfer and execution design.
Current application behavior is documented in the [Wallet region reference](../apps/docs/src/reference/core.md#wallet-region).

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/refactor-153-wallet-region-selection.md).
