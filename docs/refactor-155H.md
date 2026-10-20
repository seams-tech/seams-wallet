# R155H: registration preparation and finalization

Status: closed October 14, 2026. Each scoped item had evidence or a recorded disposition.

## Why

Registration exposed preparation, claim, finalization, and storage waits after user
interaction. The refactor measured those waits and moved safe independent work earlier.

## What changed

- Added bounded setup-time admission and connection preparation, expiry, cancellation, and replay behavior.
- Moved the passkey claim ahead of finalization and addressed the Yao execution gap.
- Reduced shared-record and admission overhead while preserving durable custody boundaries.
- Added founding-read overlap, seal warm-up, and transient response-storage retry handling.
- Verified the Singapore staging placement and measured the accumulated candidate.

Wallet 0.10.2 carried the final recorded response and finalization changes.
The median target was met in named runs; that did not close tail acceptance.

## Deferred work and limits

At closure, production rollout, Console completion after the response, and remaining
finalization CPU profiling were outside this refactor. Further garbling before verified
execution and broader bind/load consolidation were deferred.

[R155J](refactor-R155J-p99.md) owns unresolved slow-attempt causes and final tail acceptance.
Later 0.13 moved directory completion after the response; see [release history](../apps/docs/src/releases.md#_0-13-0).
The dated staging results do not establish a production latency guarantee.

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/refactor-155H.md).
