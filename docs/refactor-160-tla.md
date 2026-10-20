# Refactor 160: Router A/B verification strategy and TLA+ pilot

Status: the bounded pilot and focused admission-expiry fix were implemented October 2, 2026.

## Why

Quota contention, step-up admission, one-use preprocessing material, retries, and crashes
needed evidence beyond sequential happy-path tests.

## What changed

- Modeled one wallet, one reusable session, an ECDSA signer, competing operations, and one presignature.
- Kept quota-consuming reusable admission separate from exact-operation step-up authority.
- Explored duplicate/lost responses, rollback, bounded restarts, and expiry ordering.
- Reproduced a stale-time step-up defect through the production route and authorization store.
- Fixed atomic admission to check the database clock; all 13 recorded invariants passed.

## Scope limits and follow-ups

Finite-model results do not prove all SDK executions, constant-time behavior, or
cryptographic privacy. Worker build selection, timestamp freshness, and automatic startup
recovery remained model-to-production correspondence questions.

Lean mathematical/privacy reasoning, Verus implementation checks, and TLA+ lifecycle
models have distinct evidence boundaries. The pilot authorized no broader verification infrastructure.

Results and reproduction live in the [signing pilot](../crates/router-ab-core/formal-verification/tla-signing/README.md).
Current model scope is documented beside each formal-verification artifact.

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/refactor-160-tla.md).
