# Refactor 170: separate the application client from wallet execution

Status: approved essential scope completed October 5, 2026, together with R171.

## Why

Application bundles imported wallet execution, stores, worker managers, and shared crypto.
This increased downloads and obscured which origin owned signing authority and secrets.

## What changed

- Kept `SeamsWeb` focused on public configuration/state, transport, and iframe coordination.
- Moved host execution, wallet stores, and worker orchestration into the wallet origin.
- Made worker and runtime loading follow selected operations and persisted work.
- Added precise connection/session observations and lifecycle reconciliation boundaries.
- Preserved ordinary lock's durable presignature retention and existing wallet behavior.

## Completion record

The root and React application graphs excluded host execution and worker managers.
Cold signed-out loading started no crypto workers and downloaded no WASM in the recorded run.
Types, package declarations, browser flows, build boundaries, and source accounting passed.
See the [completion receipt](refactor-170-completion.md) for measured sizes and limits.

## Deferred work

The extra month-later clock simulation was deferred. Publication, matched client/host
deployment, and exact private adoption were separate release tasks at closure.
Historical inventory checklists did not add requirements to the approved closure.

[R171](refactor-171.md) records the public API changes. Current integration guidance
lives in the [browser reference](../apps/docs/src/reference/core.md).

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/refactor-170.md).
