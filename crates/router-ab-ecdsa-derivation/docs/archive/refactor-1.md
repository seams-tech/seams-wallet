# Refactor 1: boundary-first ECDSA derivation crate

Status: completed crate-layout cleanup, April 2026.

## Why

The mixed module layout obscured client/server ownership and made security review harder.

## What changed

- Moved client-visible logic into `src/client` and server-owned staged logic into `src/server`.
- Put wire formats in `src/wire` and boundary-neutral helpers in `src/shared`.
- Removed the transitional layout that mixed those boundaries.

The resulting ownership boundaries supported later server-blindness, retained-state,
export-policy, and proof-scope reviews. This cleanup alone did not establish those security properties.

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/crates/router-ab-ecdsa-derivation/docs/archive/refactor-1.md).
