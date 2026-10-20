# R153: backend relocation validation

Status: initial investigation completed October 2, 2026; the subsequent implementation
and scoped hosted acceptance closed October 7.

## Why

Changing a wallet's region label could not move its authoritative state safely.
The investigation identified every owner and binding that a real transfer had to preserve.

## What it established

- Gateway, runtime, role-private, and wallet-object state required exact scoped selectors.
- A copied database could replay admission logic or duplicate usable signing material.
- Destination activation needed source fencing and owner approval across all devices.
- Imports needed immutable manifests, exact replay, and durable progress.
- Shared tenant authority required separate handling from wallet-local ownership.

These findings informed [R153's move contract](refactor-153-wallet-region-selection.md)
and [R153B's transfer implementation](refactor-153B.md).

## Completion record

The recorded APAC → US → APAC acceptance preserved both signing curves and cleanup.
Pause through fresh unlock and first signature was 43.845 seconds outbound and
43.326 seconds on return. These were single observations.

## Deferred work and limits

Broader load, interference, complete transfer-byte accounting, and production adoption
were separate gates. Investigation probes alone did not prove a complete regional move.

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/refactor-153-backend-relocation-validation.md).
