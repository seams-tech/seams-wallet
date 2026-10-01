# Router A/B formal verification strategy and signing pilot

Status: TLA+ pilot planned. Time box: one working day, including setup and reporting.

Run a small TLA+ pilot to check whether modeling adds useful evidence about our
signing budgets, one-use presignatures, and step-up authorization. Focus on
concurrent admission, exact owner-approved operation binding, duplicate requests,
and failures between Gateway authorization and SigningWorker material consumption.
Finish with a concrete continue-or-stop recommendation before investing in
verification infrastructure.

## Verification strategy

Use Lean, Verus, and TLA+ as complementary tools. Choose the tool by the property
being checked and its connection to production.

| Tool | Intended responsibility | Evidence boundary |
| --- | --- | --- |
| Lean | Mathematical correctness and explicit protocol/security theorems for the Router A/B Yao design. | State the theorem, adversary model, and cryptographic assumptions. A model theorem needs a justified connection to the implementation. |
| Verus | Functional correctness of selected Rust paths: arithmetic, encoding, bindings, and permitted state transitions. | Identify whether verification covers production code or a separate executable mirror. A proved mirror alone does not verify production. |
| TLA+ / TLC | Quota budgets, presignature lifecycle, step-up authorization, and their behavior under concurrency, retries, response loss, crashes, and modeled expiry. | Check the distributed SDK, Gateway, and SigningWorker model within explicit finite bounds. Production correspondence requires separate evidence. |

Cryptographic functional correctness and privacy are separate obligations.
Correct derivation and output sharing do not establish server blindness. A privacy
claim needs explicit party views, adversary and collusion assumptions, and
assumptions or proofs for garbling, OT, randomness, and protocol composition.

The [current Yao proof inventory](../crates/ed25519-yao/formal-verification/README.md)
records structural/model proofs, a Rust-shaped Verus mirror, a narrow Aeneas
Rust-to-Lean extraction boundary, and conformance checks. It explicitly makes no
protocol-security claim. Preserve those limits when describing combined coverage.

TLA+ models logical ordering and deadline/expiry decisions. Constant-time
execution, timing side channels, and wall-clock performance require separate
analysis. They are outside this pilot.

For each checked property, record the behavioral contract, production enforcement
point, and trusted inputs or atomicity assumptions in the existing pilot README.
Relate model traces to actual guards and writes, and identify existing E2E
evidence or a concrete coverage gap. A green finite model and passing E2E
scenarios provide evidence for their stated scopes; they do not constitute a
proof of all SDK executions or the cryptographic protocol.

This strategy adds no Lean/Verus work, cryptographic privacy proof, extraction
pipeline, or implementation refinement proof to the one-day TLA+ pilot. Scope any
such follow-up independently after reviewing the pilot's findings.

## Pilot scope

Budget means the server-authoritative signing-use balance of one exact
`walletSessionId` and `quotaId`. Keep that balance separate from presignature
inventory: prepared material creates no signing allowance, and preprocessing
consumes no signing quota.

Model one wallet, one owner reusable Wallet Session, one ECDSA signer, two
competing operations, one SigningWorker presignature, and one operation-scoped
owner proof. Start with an issued quota and available material. Explore starting
balances of zero, one, and two: zero tests denial without step-up and permission
for its exact approved operation with valid step-up; one tests competition for
the last use; two lets independently admitted operations compete for the same
material.

Represent authorization with two distinct branches: reusable-session admission
requires its quota debit; verified step-up requires its exact evidence and is
quota-neutral. Treat successful factor verification as a boundary input. Model
missing, valid, and expired proof/evidence eligibility, durable proof consumption,
and operation admission; preserve any separate writes in production. Represent
Passkey and Email OTP as distinct selected-method bindings without simulating
WebAuthn or OTP verification.

Include exact retries, altered request bindings, duplicate or lost responses,
transaction rollback, one restart per service, and reservation expiry or
cancellation. Restart preserves durable records and clears volatile work.
Represent signing and results symbolically. Keep messages, counters, and
deadline states finite.

Use safety checks only. Defer Client pool persistence, pool generation/refill,
quota issuance/renewal, other quota scopes, material replacement, revocation,
Ed25519, ceremonies, factor-verifier correctness, full prompt lifecycle,
cryptographic proofs, chain submission, and liveness. Review preprocessing's
quota-neutral boundary without modeling its protocol. This pilot makes no claim
about those deferred areas.

## Checks that matter

| Check | Required guarantee |
| --- | --- |
| Budget conservation | For the issued quota, `remainingUses = startingUses - distinctDebitedOperations`, with the balance always between zero and its starting value. No modeled action replenishes it. |
| Atomic admission | A successful new reusable-session operation claim and its one-use debit commit together. Rejection or rollback leaves both unchanged. Two requests cannot spend the last use. |
| Retry accounting | Exact prepare/finalize retries and result replay create no additional debit. A timeout, cancellation, failed signing attempt, or restart does not refund an admitted use. |
| One-use material | Reservation fixes the exact operation/request binding. Only one attempt can take material, after consumed state is durable. Stale revisions and changed bindings cannot take it. |
| Terminal material | Consumed material and tombstones never become available again. An interrupted reservation follows the existing destructive recovery/expiry policy. |
| Budget and material coupling | A worker signing effect requires the matching Gateway-admitted operation. At zero budget a new operation requires its own valid step-up. Available material supplies no authorization. Each admitted operation starts at most one signing effect, including after retries. |
| Exact step-up binding | The claimed operation matches the verified owner proof and evidence: wallet/authority, selected auth method, signer/material, curve, chain target, purpose, and lane/intent/display digests. A signing approval cannot become export, unlock, or another signing approval. |
| One-operation step-up | Concurrent requests cannot consume one proof for different scopes or authorize different operations with the same evidence. Exact retries reconcile the original scope and claim; they cannot issue another authorization or start another signing effect. |
| Step-up eligibility | New step-up authority requires verified, unexpired proof/evidence at the actual decision boundary. Failed or cancelled verification yields no authority. Restart cannot turn an incomplete approval into a verified proof. |
| Step-up budget neutrality | Step-up changes neither the existing Wallet Session/quota identity, remaining uses, nor expiry, and creates no replacement Wallet Session or quota. An exact approved operation may sign at zero session budget without spending or replenishing it. |

Retain only enough finalization/replay state to check those guarantees: a
committed worker result answers an eligible exact retry without another effect;
a claim without a durable result can remain in progress after a crash. Do not
assume every admitted operation eventually returns a signature.

Finalization and replay of an already-admitted operation may proceed after its
debit exhausts the quota; they must resolve the existing claim rather than demand
or create another signing use.

For step-up, trace the SDK's prepared operation and confirmation result through
server proof consumption, evidence recording, operation claim, and worker effect.
Check that the confirmed operation binding reaches admission unchanged. Use the
actual expiry rules for existing claims and replay; an already-started signing
effect retains its actual outcome. Modeling a verified proof does not establish
that the browser prompt, factor verifier, or displayed transaction is correct.

## Map the real boundaries

Read the current implementations and effective D1 triggers before writing the
model. Copy their actual guard and write ordering; derive the assertions
independently from the behavioral contract. An assertion must be able to expose
a missing guard or partial commit.

| Boundary | Production owner |
| --- | --- |
| Gateway claim and quota debit | `packages/wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore.ts`, `authorizedOperationStatements.ts`, and the effective `authorized_operation_owner_grant_claim_atomic` trigger |
| SDK prepared operation and selected-method confirmation | `packages/wallet/src/core/signingEngine/flows/signEvmFamily/requireEvmFamilyStepUpAuth.ts`, `stepUpAuthorization.ts`, and `stepUpConfirmation/confirmOperation.ts` |
| Verified owner proof and step-up claim | `packages/wallet-server/src/authorization/factorEvidence.ts`, `authorization/service.ts`, `router/domains/signingOperations/routerAbOperationStepUp.ts`, and D1 `consumeVerifiedOwnerProof`, `putVerifiedEvidenceSet`, and the effective `authorized_operation_step_up_claim_atomic` trigger |
| Prepare, finalize, and retry routing | `packages/wallet-server/src/router/domains/signingOperations/routerAbEcdsaDerivationNormalSigningRoute.ts` |
| Pool states and revision checks | `crates/router-ab-ecdsa-pool/src/lib.rs` and `crates/router-ab-cloudflare/src/ecdsa_pool_lifecycle.rs` |
| Worker claim and material consumption | `claim_and_consume_effect` in `crates/router-ab-cloudflare/src/signing_worker/wallet_ecdsa_store.rs`, inside the transaction in `durable_object/signing_worker_wallet.rs` |
| Signing and result persistence | `crates/router-ab-cloudflare/src/ecdsa_normal_signing_transport.rs`, worker `commit_terminal`, and Gateway `completeAuthorizedOperation` |

Keep Gateway admission, forwarding, reservation, worker claim/consumption,
signing, and result persistence separate wherever production separates them.
Only an existing atomic transaction becomes one model action. A write may roll
back or commit before its response is lost; model both outcomes. Document any
atomicity assumption that remains unverified.

## One day of work

1. **Boundary review, up to one hour.** Map the quota debit, material take, and
   step-up operation binding from SDK approval to server claim. Include proof
   consumption, purpose/expiry checks, rollback, and exact retry semantics.
   Confirm which existing E2E scenarios exercise these boundaries. Record concrete
   questions the model should answer.
2. **Model and check, up to four hours.** Add one handwritten `RouterAbSigning.tla`
   and one configuration under
   `crates/router-ab-core/formal-verification/tla-signing/`. Run exhaustive TLC
   safety checking for the small starting states above. Use the official CLI
   directly and record its release/checksum and exact invocation in a short
   README. Keep the downloaded jar and generated output out of Git.
3. **Qualify the checks, up to two hours.** Confirm competing admission, two
   admitted operations sharing one material identity, duplicate finalization,
   response loss, and crashes before/after consumption are reachable. Also check
   two requests competing for one step-up, altered operation/purpose/method
   binding, expired evidence, and exact retry after proof consumption or claim.
   Temporarily introduce double-debit, double-take, and step-up substitution/reuse
   faults; each must produce the intended counterexample. Restore the model
   afterward. Relate any finding to production before calling it a bug.
4. **Report, up to one hour.** Save the TLC log, model/config hashes, tool version,
   exact command, bounds, checked properties, state counts, and qualification
   traces. Report findings, unresolved assumptions, existing behavior coverage,
   and a continue-or-stop recommendation. Distinguish model results, production
   correspondence evidence, and trusted cryptographic/factor-verification inputs.
   An incomplete run is an incomplete pilot result; do not extend the time box
   silently.

Expected committed files: one model, one configuration, and one short README
with findings and reproduction instructions. Add no runner, CI job, generator,
production flags, unit tests, source guards, or new E2E harness in this pilot.
Use existing artifact conventions and retain only sanitized public metadata.

Keep the one-day limit. If all checks cannot finish, prioritize step-up binding,
one-operation use, budget neutrality, and atomic quota admission. Report remaining
presignature/recovery checks as incomplete rather than widening the pilot.

## Decision after the pilot

Continue only if the model identifies a plausible production defect, exposes
an unresolved authorization/accounting/recovery rule, or answers a concrete
concurrency question beyond the existing evidence. Scope the next change to that
finding; use the existing E2E harness for production verification if a genuine
behavior coverage gap exists.

Stop if the model mainly restates guarantees already enforced and exercised,
or trustworthy correspondence with production needs substantial new tooling.
A green bounded model alone does not establish implementation correctness.
Keep useful findings and reproduction instructions without adding ongoing CI
or maintenance obligations. Any larger follow-up gets its own scope.

## References

- [Signing admission and response uncertainty](./spec-5-router-ab-threshold-protocol.md)
- [Wallet Session allowance](./spec-3-wallet-sessions-and-execution-lanes.md)
- [Intended behavior](./intended-behaviours.md), especially step-up auth, durable ECDSA preprocessing, and signing quota accounting
- [Persistent pool lifecycle](../crates/router-ab-ecdsa-pool/specs/persistent-pool-lifecycle-v1.md)
- [Current Yao proof scope](../crates/ed25519-yao/formal-verification/README.md)
- [Verus Rust verification](https://verus-lang.github.io/verus/guide/)
- [Aeneas Rust-to-Lean translation](https://github.com/AeneasVerif/aeneas)
- [Official TLA+ CLI tools](https://github.com/tlaplus/tlaplus#use)
