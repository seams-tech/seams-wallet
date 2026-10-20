# R170: client and worker ownership inventory

Status: historical audit supporting the approved R170/R171 completion, October 5, 2026.

## Why

The refactor needed an ownership and dependency inventory before moving execution.
Application bundle size alone could hide downloads and work transferred to the wallet origin.

## What the audit established

- Classified application facade, iframe transport, host execution, stores, workers, and WASM dependencies.
- Traced connection generations, session observation, command ownership, and startup triggers.
- Audited public imports, declarations, custom email challenges, and removed API aliases.
- Measured application and wallet-origin response bodies separately.
- Checked package boundaries without relying on repository path aliases.

The root and React provider graphs excluded host execution and worker managers.
Signed-out startup created no crypto workers and downloaded no WASM in the recorded scenario.

## Evidence limits

Cold, warm, authenticated, and signed-out cohorts have different cache policies.
Test-app totals do not predict every consumer's payload. Byte reductions do not
establish a paired latency improvement. Deferred matrices in the full audit did
not override the approved essential-scope closure.

See the [completion receipt](refactor-170-completion.md) and its machine-readable evidence.

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/refactor-170-inventory.md).
