# Refactor 171: simplify the public Wallet SDK API

Status: approved essential scope completed October 5, 2026, with R170.

## Why

Overlapping methods and public preparation helpers exposed execution details and made
ordinary wallet tasks difficult to discover and handle correctly.

## What changed

- Grouped operations under connection, configuration, events, authentication, registration, and chain capabilities.
- Standardized registration, signer/auth-method management, signing, and NEAR readiness names.
- Replaced overlapping custom email entry points with host-owned request/submit challenge handling.
- Kept Google hosted authentication behind its existing public flow.
- Unified lock behavior while retaining valid durable presignatures.
- Removed replaced aliases, specialized routes, bootstrap helpers, and duplicate adapters.

Exact identity, authority checks, typed failures, and worker ownership remained with
their existing domains. API simplification did not combine distinct authentication proofs or signing protocols.

## Closure and follow-ups

The final caller audit and accepted lifecycle checks passed for the recorded build.
Publication and private exact-release adoption remained separate tasks at closure.
See [R170's receipt](refactor-170-completion.md) for evidence and deferred verification.

The [current API reference](../apps/docs/src/reference/core.md) supersedes historical
migration maps for integration work.

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/refactor-171.md).
