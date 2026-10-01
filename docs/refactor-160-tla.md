# Router A/B signing concurrency verification plan

Status: planned.

Implement one small TLA+ model of reusable-session ECDSA signing. Check the
highest-impact guarantees across quota admission, presignature ownership,
finalization replay, and material invalidation. Keep the model close to the
existing Gateway D1 and SigningWorker transaction boundaries.

The deliverable is a repeatable check of these guarantees within explicit model
bounds, backed by focused E2E evidence. It does not establish that every wallet
concurrency bug has been eliminated.

## Scope

Model one wallet, one owner authority, one reusable Wallet Session, one ECDSA
signer, and the SigningWorker half of its presignature pool. Begin with available
material and an issued session. Model the Client only through submitted requests,
cancellation, response loss, and exact retries.

Cover all four areas in the same model. Initial bounds:

- Two competing operation identities and an initial quota of one or two uses.
- One presignature identity with its actual revision and request binding.
- Two material generations, representing one retirement or replacement.
- Live or invalidated session authorization, including revocation and expiry.
- Matching and altered request digests, and two symbolic terminal results.
- One Gateway restart and one SigningWorker restart, independently scheduled.
- Finite pending messages with delayed, duplicate, and lost delivery.

Use logical deadline states for session, request, and reservation expiry. Keep
message storage and observation counters finite; avoid an unbounded history.
One use exposes the last-use admission race. Two uses allow both operations to
be admitted and independently challenge single-material ownership.
Record them with every run; they do not justify claims about arbitrary sizes.

Exclude Ed25519/Yao execution, Client pool persistence, pool generation/refill,
derivation, registration, recovery ceremonies, tenant-root rotation, linked-device
provisioning, step-up authentication, chain submission/nonces, rate limiting,
performance, cryptographic arithmetic, and secrecy proofs. Retirement and
revocation enter as external state changes; their originating flows stay outside
the model. Keep existing Lean/Verus verification separate.

## Required properties

| Area | Required check |
| --- | --- |
| Quota and operation admission | New claims never exceed the starting quota; at most one distinct operation spends the last use. A successful new claim consumes exactly one use; an exact retry consumes zero additional uses. Pre-admission rejection changes no claim or quota. |
| Presignature lifecycle | Reservation ownership and request binding remain fixed. Material is released only after durable consumption, at most once, for an exactly admitted operation. Consumed records and tombstones remain terminal through failure, cancellation, expiry, stale writes, and restart. |
| Finalization and replay | Each store retains its first committed terminal result. An authorized exact retry recovers that result after response loss or restart without another signing effect. Changed input cannot reuse the prior claim, material, or result. Gateway completion agrees with the durable worker result. |
| Material replacement and revocation | A decision uses the live authorization and material required at that decision boundary. A stale authorization/material snapshot cannot create a new claim or pass the required finalize/replay check. A late response cannot reactivate retired material or restore authorization. |

Pin invalidation semantics to the current contract: reusable-session prepare,
finalize, and replay require their live checks. Material replacement before the
required decision rejects the request. A signature that has already started
retains its actual outcome through cancellation or expiry; invalidation does not
refund quota or restore material. Durable result retention and permission to
return that result are separate facts.

Add one limited progress property: a durable terminal result eventually becomes
observable through an exact retry while its authorization and material remain
eligible, services recover, and retry/delivery actions are fairly scheduled.
Safety checks permit permanent failure and arbitrary message loss. Do not require
every consumed attempt to eventually produce a signature: a crash can destroy
volatile signing work before a terminal result is durable.

## Production boundaries to model

Use the existing domain states and canonical identities. Represent verified
credentials and request digests symbolically; assume boundary validation and
collision-resistant binding. Do not model raw tokens, secret material, or SQL
syntax. Preserve independent stores and actual transaction boundaries.

| Model boundary | Production owner |
| --- | --- |
| Resolve authorization and capture current material | `packages/wallet-server/src/router/domains/signingOperations/routerAbEcdsaDerivationNormalSigningRoute.ts` and `packages/wallet-server/src/core/ecdsaMaterialReadSnapshot.ts` |
| Atomically claim an operation, validate its material snapshot, and debit quota | `packages/wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore.ts`, `authorizedOperationStatements.ts`, and the effective `authorized_operation_owner_grant_claim_atomic` D1 trigger |
| Reserve, consume, burn, or reject a stale pool revision | `crates/router-ab-ecdsa-pool/src/lib.rs`, `crates/router-ab-cloudflare/src/ecdsa_pool_lifecycle.rs`, and `signing_worker/wallet_ecdsa_store.rs` |
| Atomically claim a signing effect and consume its material | `claim_and_consume_effect` in `signing_worker/wallet_ecdsa_store.rs`, hosted by the transaction in `durable_object/signing_worker_wallet.rs` |
| Perform signing and record the first worker terminal result | `crates/router-ab-cloudflare/src/ecdsa_normal_signing_transport.rs` and `commit_terminal` in `signing_worker/wallet_ecdsa_store.rs` |
| Reconcile and record the Gateway response | `routerAbEcdsaDerivationNormalSigningRoute.ts` and `completeAuthorizedOperation` in `d1AuthorizationStore.ts` |

All abbreviated Rust paths in the table are beneath
`crates/router-ab-cloudflare/src/`.

Keep authorization/material reads separate from their later decisions so a
replacement can interleave. Keep Gateway admission, request forwarding, worker
reservation, worker claim/consumption, signing, worker terminal persistence, and
Gateway completion as separate actions wherever production separates them.
Only existing atomic transactions become one model action.

Include both outcomes of an uncertain write: rollback, and commit followed by a
lost response. Restart clears volatile work while retaining committed records.
An interrupted reservation follows the existing destructive recovery/expiry
policy. A retry observes an existing effect as in progress or completed; it
cannot take fresh material for that effect.

## Implementation steps

1. **Confirm the boundary map.** Follow one owner reusable-session ECDSA
   prepare/finalize/replay through the files above. Identify the effective D1
   triggers after all migrations and the precise live checks for each decision.
   Record the transaction, rollback, and restart behavior in the model README.
   Use the current contract as the required behavior; expose differences between
   the implementation and that contract instead of assuming the guarantees hold.
2. **Write the model and check safety.** Add one handwritten module,
   `RouterAbSigning.tla`, and one checked configuration under
   `crates/router-ab-core/formal-verification/tla-signing/`. Express the four rows
   above as named invariants/action properties, including basic state validity.
   Model the implementation's guards and writes; formulate the properties
   independently from the contract. Run exhaustive TLC checking to completion.
3. **Check meaningful failure schedules.** Explore competing prepares, duplicate
   finalizes, rollback, committed-write response loss, signing before a crash,
   expired reservation cleanup, stale revision writes, and invalidation between
   a read and its decision. Validate that each important boundary is reachable.
   Then check the limited replay progress property with its stated assumptions.
4. **Connect the model to E2E evidence.** Reuse the existing presign-pool browser
   contract and harness. Add only the two scenarios below where existing behavior
   coverage has a genuine gap. Use real Gateway storage and the actual
   SigningWorker adapter with separate consumption and terminal writes. Retain
   repeatable artifacts using the existing evidence conventions.
5. **Make the check repeatable.** Add one small runner, one
   `just router-ab-signing-tla` recipe, and a job in the existing Router A/B
   validation workflow. Pin the released `tla2tools.jar` version and checksum in
   the runner; use a compatible Java runtime. Reuse this command locally and in
   CI. Fail on violations, tool errors, or incomplete exploration. Upload the TLC
   log, model/config hashes, tool version, exact command, property names, and
   state counts. Keep generated output and the downloaded jar out of Git.

Use a handwritten TLA+ module and the official CLI tools. The expected new model
files are one `.tla`, one `.cfg`, one runner, and one README. Add no model generator,
verification framework, production flags, or duplicate protocol implementation.
Extend the existing workflow filters to include the model, pool crate, Gateway
admission/material files, relevant migrations, and runner/recipe changes. Add
the new job to the workflow's existing aggregate validation gate.

## Focused E2E evidence

1. **Last use with lost completion.** Two distinct requests compete for the last
   session use and the same available material. Let the winner commit its worker
   result, lose the response, then restart the worker and retry exactly. Submit
   an altered finalize against the original claim. Verify one quota debit, one
   material consumption, no second signing effect, an identical replayed result,
   and rejection of changed input. Separately interrupt after consumption before
   terminal persistence and verify that retry cannot consume or sign again.
   Include a two-use variant where both operations have valid admission and
   compete for one presignature, so quota exhaustion cannot hide double-use.
2. **Invalidation during an in-flight decision.** Hold a request after its
   authorization/material read. Retire or replace that material, or revoke the
   session, then release it. Exercise the same boundary at new admission and at
   finalize/replay. Verify the required rejection, unchanged quota for rejected
   new admission, no new worker effect, and no revival from a late response.
   Preserve any already-spent use and already-consumed material.

Keep the variants within these two contract scenarios. Add no unit
tests or source-text guards. Start with
`tests/e2e/intended-behaviours/passkey.presign-pool.contract.test.ts` and its
existing harness; read any applicable test instructions before editing them.
If the harness cannot interrupt the actual worker boundary, extend its existing
test transport/process controls only as needed. A client-side dropped response
alone cannot demonstrate recovery from a worker crash before terminal commit.

Artifacts must include the replay command and sanitized evidence of quota,
operation identity, material identity/revision, terminal-result equality, and
signature verification where a result exists. Exclude credentials and secrets.
Use a public chain/RPC stub only outside signing; keep signing and persistence
real. Classify failures against the behavioral contract before repairing code
or fixtures.

## Completion criteria

- The one bounded model completes exhaustive safety checking for all four areas.
- The conditional replay progress check completes with documented assumptions.
- Temporary deliberate faults in quota debit, material consumption, terminal
  persistence, and stale-snapshot acceptance each produce a corresponding
  counterexample. Restore the model before committing; retain the mutation
  description and counterexample as qualification evidence.
- Every atomic model action has a reviewed production mapping. A passing model
  is reported as bounded design evidence, with E2E evidence for its selected
  implementation schedules.
- The two focused E2E scenarios pass, or existing equivalent coverage is cited,
  and each produces a repeatable verification artifact.
- Local and CI runs use the same command and retain useful failure artifacts.
- Any discovered production regression within these boundaries is fixed and
  rechecked. Broader findings are recorded with concrete evidence for separate
  work; they do not silently expand this implementation.

Stop at this scope. Additional curves, authorities, pool refill, ceremonies,
larger bounds, trace-conformance infrastructure, and unbounded proofs require a
separate demonstrated need.

## References

- [Router A/B signing and response uncertainty](./spec-5-router-ab-threshold-protocol.md)
- [Wallet intended behavior](./intended-behaviours.md), especially durable ECDSA preprocessing and cancellation after signing starts
- [Persistent pool lifecycle](../crates/router-ab-ecdsa-pool/specs/persistent-pool-lifecycle-v1.md)
- [Official TLA+ CLI tools](https://github.com/tlaplus/tlaplus#use)
- [What TLA+ can and cannot check](https://buttondown.com/hillelwayne/archive/what-tla-can-and-cant-check/)
