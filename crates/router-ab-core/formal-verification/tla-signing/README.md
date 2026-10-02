# Router A/B bounded signing model

Pilot run: 2026-10-02. Scope follows [the signing pilot plan](../../../../docs/refactor-160-tla.md).
This is a handwritten distributed lifecycle model. It establishes no
cryptographic privacy theorem or implementation refinement proof.

## Scope and assumptions

The model has two competing operations, one wallet/authority/signer/material
scope, one reusable session/quota, one worker presignature, and one exact owner
approval. Initial quota balances are 0, 1, and 2. Both selected methods, Passkey
and Email OTP, are explored with verified, missing, failed, and cancelled factor
inputs: 24 initial states. The clock has two classes: before and at/after the
shared request, evidence, session, and reservation deadline. Each service may
restart once. There are no state-space constraints, symmetry reductions,
fairness assumptions, or liveness checks.

Bindings represent operation identity, wallet, authority, method, signer,
material, curve, chain, purpose, lane/intent/display digests, origin, and audience.
Each field can be substituted independently. Hashes are ideal exact bindings;
hash collision resistance, challenge correctness, factor verification, and the
SDK's displayed confirmation are trusted boundary inputs. Tenant, current
material, and live authority remain fixed; their replacement/revocation is outside
scope. One shared deadline does not check races between independently expiring
credentials or clock skew.

`gateway` and `worker` are durable state; `volatile` is lost on service restart.
`audit` contains observation/history variables for independent safety assertions,
including debit/take/sign counts and the first committed outcomes. Rollback leaves
durable state unchanged. Response loss leaves commits intact. Consumption loses
material permanently, including when delivery or subsequent signing fails.
Cryptographic work may finish after expiry once material has been taken; the
original completion can persist, while a new expired retry remains ineligible.

## Production correspondence

Reviewed source revision: `117756407f4ab0652bbda594701a4646178ddb5a`.
Exact source-file hashes are retained with the local run artifacts.

| Model actions | Implementation and trusted boundary |
| --- | --- |
| `AdmitWarm`, `ExactRetry`, `CompleteGateway` | [D1 authorization store](../../../../packages/wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore.ts): admission insert/readback batch, existing-claim resolution, and conditional first completion. Debit/claim atomicity follows the effective owner-grant trigger in [migration 0034](../../../../packages/wallet-server/migrations/d1-signer/0034_r103f_exact_wallet_session_cutover.sql). Database transaction guarantees are assumed. |
| `BeginApproval`, `VerifyFactor`, `ConsumeEmailGrant`, `RecordEvidence`, `AdmitStepUp` | [ECDSA step-up route](../../../../packages/wallet-server/src/router/transport/fetch/routes/thresholdEcdsa.ts), [factor evidence builder](../../../../packages/wallet-server/src/authorization/factorEvidence.ts), and evidence/claim writes in D1. Passkey is bound by its operation challenge; Email OTP consumes its factor-specific grant. The generic `consumeVerifiedOwnerProof` helper is not called by this route and is not modeled as an extra replay barrier. |
| Exact step-up admission and replay | The effective step-up trigger in [migration 0003](../../../../packages/wallet-server/migrations/d1-signer/0003_r107_wallet_authorization.sql) compares evidence scope/digests and expiry against `claimed_at_ms`. [Admission reads](../../../../packages/wallet-server/src/router/cloudflare/d1/authorization/authorizedOperationStatements.ts) recheck eligibility. The model assumes the SDK preparation, challenge, evidence builder, and request parsers preserve the complete binding. |
| `Reserve`, `ClaimWorker`, `CommitWorkerResult` | [Worker pool reducer](../../../router-ab-cloudflare/src/ecdsa_pool_lifecycle.rs), [ECDSA store](../../../router-ab-cloudflare/src/signing_worker/wallet_ecdsa_store.rs), and the claim/consume transaction in the [wallet Durable Object](../../../router-ab-cloudflare/src/durable_object/signing_worker_wallet.rs). The model selects the wallet-DO path compiled with `wallet-do-signing-worker-harness`; the separate claim/consume non-DO branch is outside scope. Deployment/build selection remains to be confirmed. |
| `BurnMaterial`, `RecoverReservation`, `RestartWorker` | [Persistent pool lifecycle contract](../../../router-ab-ecdsa-pool/specs/persistent-pool-lifecycle-v1.md). Restart preserves durable reservations; recovery is a separate destructive command. Automatic startup invocation and a barrier preventing consumption before recovery are not established by this pilot. |
| Worker expiry | `ClaimWorker` assumes the worker's supplied timestamp is current at consumption. Production carries `now_unix_ms` across asynchronous work; freshness is an unresolved correspondence assumption. This pilot does not establish wall-clock signing eligibility. |

## Result and concrete finding

The committed configuration intentionally retains the failing
`LiveStepUpEligibility` invariant. The default run reports a counterexample,
not a green verification result:

1. Begin the approval with `sampledAt = 0`.
2. Verify the Passkey factor and record exact evidence.
3. Advance to expiry (`clock = 1`).
4. Admit the step-up with `checkedAt = 0`, `admittedAt = 1`.

The route samples `nowMs` before asynchronous material resolution and factor
verification, then uses that same value for `verifiedAtMs` and `claimedAtMs`.
The D1 evidence trigger checks expiry against that supplied claim timestamp.
This violates the plan's requirement that new authority be unexpired at the
actual admission boundary. Classification: a production-mapped correctness
candidate requiring a controlled production E2E reproduction; no production
behavior has been changed. The trace establishes neither unauthorized key use
nor a late signature. Worker timestamp freshness is separately unresolved.

| Run | Result |
| --- | --- |
| Committed configuration, all 13 invariants | `LiveStepUpEligibility` counterexample; exit 12. 86,645 generated states, 13,755 distinct states, depth 6; exploration stops at the finding. |
| Same model, only the known failing invariant excluded | All other 12 invariants pass; exit 0. 40,527,474 generated states, 1,550,866 distinct states, no queued states, depth 22; 4 min 41 s. TLC's calculated fingerprint-collision estimate is `3.3E-6`; this is bounded model-checking evidence. |
| Reachability qualification | 30 witness traces: last-use retry; two warm admissions competing for one material; zero-budget step-up; proof/evidence interruption; crashes before/after take; lost response and exact replay; rollback; expiry/cancellation; stale revision; late completion; failed factor after restart; and all 14 substituted binding fields. |
| Fault qualification | Double debit violates `BudgetConservation`; double take violates `OneUseMaterial`; step-up substitution violates `ExactStepUpBinding`; step-up reuse violates `OneOperationStepUp`. All four faults were introduced only in ignored model copies. |

The remaining checks cover budget conservation, atomic debit/claim and retry
accounting, session identity and step-up neutrality, one-use/terminal material,
reservation binding/revision, admission before signing, exact one-operation
step-up, verified factor eligibility at the supplied timestamp, and immutable
results/exact replay. A passing supplied-timestamp check does not satisfy the
separately failing live-time check.

Checked model SHA-256: `bb6e8503b263b2b6d83c062db4a787ffdbbcfd8c38eef3cde99231319a3b59aa`.
Committed configuration SHA-256: `b1ce357e305d4cb0974f1208f691db25ade668d1b4f9348ef582cb81b4b779f0`.

Existing E2E coverage was reviewed, not executed: `passkey.presign-pool.contract.test.ts`
covers distinct concurrent prepares at the last use and admitted finalize with
lost-response retry; `passkey.unlock.contract.test.ts` covers shared budgets and
step-up after exhaustion; `passkey.registration.contract.test.ts` covers step-up
with a delayed session-status response. Controlled expiry during verification
and a startup recovery barrier remain concrete coverage questions.

Continue only with a focused follow-up on the admission timestamp, using the
existing E2E harness to delay verification across expiry and inspect the durable
claim. Confirm the deployed worker path and its clock/recovery boundaries before
extending worker conclusions. Add no CI, runner, or broader model in this pilot.

## Reproduce

Run from the `seams-wallet` repository root with Java 17. The pilot used Temurin
17.0.20.1+1 on macOS ARM64, stored locally in `.tooling/tla/runtime/`. Its archive
SHA-256 is `190480874ccceb358cbc840393207f77ac3e63a4c5f8129d0e23e9518b96ad05`.
Use another installed Java 17 runtime by setting `TLA_JAVA` to its executable.

Download the official [TLA+ v1.7.4 release](https://github.com/tlaplus/tlaplus/releases/tag/v1.7.4):

```sh
mkdir -p .tooling/tla
curl -fL https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar \
  -o .tooling/tla/tla2tools-1.7.4.jar
printf '%s  %s\n' \
  '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88' \
  '.tooling/tla/tla2tools-1.7.4.jar' | shasum -a 256 -c -
```

The jar also matches the release's published SHA-1
`bee4a54f3ee3d4afc347c3240ec2d9e93b075104`. TLC identifies itself as version 2.19,
revision `5a47802`. Use a separate temporary directory per process; simultaneous
TLC starts sharing extracted standard modules caused a parser error in the pilot.

```sh
TLA_JAVA="$PWD/.tooling/tla/runtime/jdk-17.0.20.1+1-jre/Contents/Home/bin/java"
TLA_MODEL=crates/router-ab-core/formal-verification/tla-signing/RouterAbSigning.tla
TLA_OUTPUT=.artifacts/tla-signing/expiry
mkdir -p "$TLA_OUTPUT/tmp"
"$TLA_JAVA" -Djava.io.tmpdir="$PWD/$TLA_OUTPUT/tmp" -XX:+UseParallelGC -Xmx2g \
  -cp .tooling/tla/tla2tools-1.7.4.jar tlc2.TLC \
  -workers 1 -fp 0 -seed 1 -difftrace -metadir "$TLA_OUTPUT/states" \
  "$TLA_MODEL" > "$TLA_OUTPUT/tlc.log" 2>&1
```

Expect exit 12 and `Invariant LiveStepUpEligibility is violated.` in the log.
To check the other 12 invariants without hiding the known finding in the committed
configuration, derive a local configuration and run the same unchanged model:

```sh
TLA_OUTPUT=.artifacts/tla-signing/accounting
mkdir -p "$TLA_OUTPUT/tmp"
sed '/^    LiveStepUpEligibility$/d' "${TLA_MODEL%.tla}.cfg" \
  > "$TLA_OUTPUT/RouterAbSigning.cfg"
"$TLA_JAVA" -Djava.io.tmpdir="$PWD/$TLA_OUTPUT/tmp" -XX:+UseParallelGC -Xmx2g \
  -cp .tooling/tla/tla2tools-1.7.4.jar tlc2.TLC \
  -workers 1 -fp 0 -seed 1 -metadir "$TLA_OUTPUT/states" \
  -config "$TLA_OUTPUT/RouterAbSigning.cfg" "$TLA_MODEL" \
  > "$TLA_OUTPUT/tlc.log" 2>&1
```

For qualification, copy the model/config into a fresh ignored artifact directory,
retain `TypeOK` plus the target invariant, and use the same CLI with the copied
model and an isolated temporary/state directory. Expect exit 12 naming the
intended invariant. Never edit the committed model to make these runs pass.

| Fault | Exact change to the ignored copy | Target invariant |
| --- | --- | --- |
| Double debit | In `ExactRetry`, require a warm claim with positive remaining uses; decrement remaining uses and increment that operation's debit counter again. Remove `gateway` from that action's `UNCHANGED` tuple. | `BudgetConservation` |
| Double take | In `ClaimWorker`, remove the existing-effect absence guard and allow material kinds `{reserved, consumed}` with revisions `{1, 2}`. | `OneUseMaterial` |
| Substitution | In `AdmitStepUp`, replace `Request(op, field) = gateway.evidence` with `gateway.evidence # NoBinding`. | `ExactStepUpBinding` |
| Reuse | Apply the same binding fault and check the one-operation property independently. | `OneOperationStepUp` |

For a reachability witness, insert `NoWitness == ~(predicate)` before the module's
final delimiter and check `TypeOK` plus `NoWitness`. A counterexample demonstrates
that the predicate is reachable. Examples: `startingUses = 0 /\ Cardinality(StepUpOperations) = 1 /\ audit.takes = 1`;
`Cardinality(WarmOperations) = 2 /\ worker.material.kind = "reserved"`;
`audit.takes = 1 /\ "worker" \in restarts`;
and `lastEvent = "method"` (repeat for each member of `BindingFields`).

Logs, full witness predicates, exact fault edits, commands, traces, source/tool
hashes, and state counts are retained in `.artifacts/tla-signing/`, including
`qualification.json` and `run-summary.json`. These public symbolic artifacts and
the tool/runtime stay outside Git. Only this README, model, and configuration
belong to the pilot's committed implementation.
