# Router A/B quota and presignature verification pilot

Status: planned. Time box: one working day, including setup and reporting.

Run a small TLA+ pilot to check whether modeling adds useful evidence about our
signing budgets and one-use presignatures. Focus on concurrent admission,
duplicate requests, and failures between Gateway quota consumption and
SigningWorker material consumption. Finish with a concrete continue-or-stop
recommendation before investing in verification infrastructure.

## Pilot scope

Budget means the server-authoritative signing-use balance of one exact
`walletSessionId` and `quotaId`. Keep that balance separate from presignature
inventory: prepared material creates no signing allowance, and preprocessing
consumes no signing quota.

Model one wallet, one owner reusable Wallet Session, one ECDSA signer, two
competing operations, and one SigningWorker presignature. Start with an issued
quota and available material. Explore starting balances of zero, one, and two:
zero tests denial despite available material; one tests competition for the last
use; two lets independently admitted operations compete for the same material.

Include exact retries, altered request bindings, duplicate or lost responses,
transaction rollback, one restart per service, and reservation expiry or
cancellation. Restart preserves durable records and clears volatile work.
Represent signing and results symbolically. Keep messages, counters, and
deadline states finite.

Use safety checks only. Defer Client pool persistence, pool generation/refill,
quota issuance/renewal, other quota scopes, step-up, material replacement,
revocation, Ed25519, ceremonies, cryptographic proofs, chain submission, and
liveness. Review preprocessing's quota-neutral boundary without modeling its
protocol. This pilot makes no claim about those deferred areas.

## Checks that matter

| Check | Required guarantee |
| --- | --- |
| Budget conservation | For the issued quota, `remainingUses = startingUses - distinctDebitedOperations`, with the balance always between zero and its starting value. No modeled action replenishes it. |
| Atomic admission | A successful new operation claim and its one-use debit commit together. Rejection or rollback leaves both unchanged. Two requests cannot spend the last use. |
| Retry accounting | Exact prepare/finalize retries and result replay create no additional debit. A timeout, cancellation, failed signing attempt, or restart does not refund an admitted use. |
| One-use material | Reservation fixes the exact operation/request binding. Only one attempt can take material, after consumed state is durable. Stale revisions and changed bindings cannot take it. |
| Terminal material | Consumed material and tombstones never become available again. An interrupted reservation follows the existing destructive recovery/expiry policy. |
| Budget and material coupling | A worker signing effect requires the matching Gateway-admitted operation. Available presignatures cannot admit a new operation at zero budget. Each admitted operation starts at most one signing effect, including after retries. |

Retain only enough finalization/replay state to check those guarantees: a
committed worker result answers an eligible exact retry without another effect;
a claim without a durable result can remain in progress after a crash. Do not
assume every admitted operation eventually returns a signature.

Finalization and replay of an already-admitted operation may proceed after its
debit exhausts the quota; they must resolve the existing claim rather than demand
or create another signing use.

## Map the real boundaries

Read the current implementations and effective D1 triggers before writing the
model. Copy their actual guard and write ordering; derive the assertions
independently from the behavioral contract. An assertion must be able to expose
a missing guard or partial commit.

| Boundary | Production owner |
| --- | --- |
| Gateway claim and quota debit | `packages/wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore.ts`, `authorizedOperationStatements.ts`, and the effective `authorized_operation_owner_grant_claim_atomic` trigger |
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

1. **Boundary review, up to one hour.** Map the quota debit and material take,
   including rollback, retry identity, and restart semantics. Confirm which
   existing E2E scenarios exercise these boundaries. Record concrete questions
   the model should answer.
2. **Model and check, up to four hours.** Add one handwritten `RouterAbSigning.tla`
   and one configuration under
   `crates/router-ab-core/formal-verification/tla-signing/`. Run exhaustive TLC
   safety checking for the small starting states above. Use the official CLI
   directly and record its release/checksum and exact invocation in a short
   README. Keep the downloaded jar and generated output out of Git.
3. **Qualify the checks, up to two hours.** Confirm competing admission, two
   admitted operations sharing one material identity, duplicate finalization,
   response loss, and crashes before/after consumption are reachable. Temporarily
   introduce a double-debit fault and a double-take fault; each must produce the
   intended counterexample. Restore the model afterward. Relate any finding to
   the actual production boundary before calling it a bug.
4. **Report, up to one hour.** Save the TLC log, model/config hashes, tool version,
   exact command, bounds, checked properties, state counts, and qualification
   traces. Report findings, unresolved assumptions, existing behavior coverage,
   and a continue-or-stop recommendation. An incomplete run is an incomplete
   pilot result; do not extend the time box silently.

Expected committed files: one model, one configuration, and one short README
with findings and reproduction instructions. Add no runner, CI job, generator,
production flags, unit tests, source guards, or new E2E harness in this pilot.
Use existing artifact conventions and retain only sanitized public metadata.

## Decision after the pilot

Continue only if the model identifies a plausible production defect, exposes
an unresolved accounting/recovery rule, or answers a concrete concurrency
question beyond the existing evidence. Scope the next change to that finding;
use the existing E2E harness for production verification if a genuine behavior
coverage gap exists.

Stop if the model mainly restates guarantees already enforced and exercised,
or trustworthy correspondence with production needs substantial new tooling.
A green bounded model alone does not establish implementation correctness.
Keep useful findings and reproduction instructions without adding ongoing CI
or maintenance obligations. Any larger follow-up gets its own scope.

## References

- [Signing admission and response uncertainty](./spec-5-router-ab-threshold-protocol.md)
- [Wallet Session allowance](./spec-3-wallet-sessions-and-execution-lanes.md)
- [Intended behavior](./intended-behaviours.md), especially durable ECDSA preprocessing and signing quota accounting
- [Persistent pool lifecycle](../crates/router-ab-ecdsa-pool/specs/persistent-pool-lifecycle-v1.md)
- [Official TLA+ CLI tools](https://github.com/tlaplus/tlaplus#use)
