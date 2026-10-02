# Router A/B bounded signing model

Pilot run: 2026-10-02. Scope follows [the signing pilot plan](../../../../docs/refactor-160-tla.md).
This is a handwritten distributed lifecycle model. It establishes no
cryptographic privacy theorem or implementation refinement proof.

## Where TLA+ applies

Use TLA+ for explicit safety properties of the concurrent authorization and
resource state machine. This follows the invariant/action-property scope in
[What TLA+ can and can't check](https://buttondown.com/hillelwayne/archive/what-tla-can-and-cant-check/).

| Applicable property | Required rule |
| --- | --- |
| Quota accounting | The balance equals the issued allowance minus distinct debited operations; exact retries add no debit. |
| Presignature lifecycle | Material is taken at most once; consumed material and tombstones remain terminal. |
| Step-up authorization | Every signing effect has the matching approved operation, and step-up preserves session quota. |
| Finalization and replay | The first committed outcome remains immutable and eligible exact retries recover it. |

An authorization property can be an ordinary safety invariant even when its
consequences are security-sensitive. Cryptographic confidentiality,
indistinguishability, and server blindness require separate protocol arguments;
this lifecycle model establishes none of them.

The clock represents logical expiry ordering, including approval followed by
expiry followed by admission. It supplies no wall-clock latency, percentile,
clock-synchronization, or constant-time execution guarantee.

`audit` counters and first-result fields are auxiliary history variables. They
support assertions without controlling admission or signing. Keep them separate
from machine state and keep behavioral guards independent of them, as described
in [Auxiliary Variables](https://learntla.com/topics/aux-vars.html).

The negated-target qualification checks produce individual reachability
witnesses. They show that a scenario occurs in the bounded model; they establish
no recovery guarantee from every initial state or eventual completion of every
claim. Liveness remains outside this pilot.

Describe a passing run as bounded model-checking evidence under stated
assumptions. For every check, identify its logical formula, production owner,
transaction boundaries, and trusted inputs. Relate counterexamples to source and
confirm production candidates with focused E2E scenarios. Model/code
correspondence remains a separate obligation, as explained in
[What if the spec doesn't match the code?](https://buttondown.com/hillelwayne/archive/what-if-the-spec-doesnt-match-the-code/).

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

Initial source review: `117756407f4ab0652bbda594701a4646178ddb5a`.
Follow-up source-file hashes are retained with the local run artifacts.

| Model actions | Implementation and trusted boundary |
| --- | --- |
| `AdmitWarm`, `ExactRetry`, `CompleteGateway` | [D1 authorization store](../../../../packages/wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore.ts): admission insert/readback batch, existing-claim resolution, and conditional first completion. Debit/claim atomicity follows the effective owner-grant trigger in [migration 0034](../../../../packages/wallet-server/migrations/d1-signer/0034_r103f_exact_wallet_session_cutover.sql). Database transaction guarantees are assumed. |
| `BeginApproval`, `VerifyFactor`, `ConsumeEmailGrant`, `RecordEvidence`, `AdmitStepUp` | [ECDSA step-up route](../../../../packages/wallet-server/src/router/transport/fetch/routes/thresholdEcdsa.ts), [factor verification](../../../../packages/wallet-server/src/router/transport/fetch/routes/ecdsaOperationStepUpFactor.ts), [factor evidence builder](../../../../packages/wallet-server/src/authorization/factorEvidence.ts), and evidence/claim writes in D1. Verification time is sampled after awaited factor work. Passkey is bound by its operation challenge; Email OTP consumes its factor-specific signing grant. The generic `consumeVerifiedOwnerProof` helper is not called by this route and is not modeled as an extra replay barrier. |
| Exact step-up admission and replay | The effective step-up trigger in [migration 0041](../../../../packages/wallet-server/migrations/d1-signer/0041_step_up_admission_expiry.sql) compares evidence scope/digests and expiry against both `claimed_at_ms` and the database clock inside the atomic write. [Admission reads](../../../../packages/wallet-server/src/router/cloudflare/d1/authorization/authorizedOperationStatements.ts) use current database time for pending eligibility. The model assumes the SDK preparation, challenge, evidence builder, and request parsers preserve the complete binding. |
| `Reserve`, `ClaimWorker`, `CommitWorkerResult` | [Worker pool reducer](../../../router-ab-cloudflare/src/ecdsa_pool_lifecycle.rs), [ECDSA store](../../../router-ab-cloudflare/src/signing_worker/wallet_ecdsa_store.rs), and the claim/consume transaction in the [wallet Durable Object](../../../router-ab-cloudflare/src/durable_object/signing_worker_wallet.rs). The model selects the wallet-DO path compiled with `wallet-do-signing-worker-harness`; the separate claim/consume non-DO branch is outside scope. Deployment/build selection remains to be confirmed. |
| `BurnMaterial`, `RecoverReservation`, `RestartWorker` | [Persistent pool lifecycle contract](../../../router-ab-ecdsa-pool/specs/persistent-pool-lifecycle-v1.md). Restart preserves durable reservations; recovery is a separate destructive command. Automatic startup invocation and a barrier preventing consumption before recovery are not established by this pilot. |
| Worker expiry | `ClaimWorker` assumes the worker's supplied timestamp is current at consumption. Production carries `now_unix_ms` across asynchronous work; freshness is an unresolved correspondence assumption. This pilot does not establish wall-clock signing eligibility. |

## Result and concrete finding

The initial model exposed this `LiveStepUpEligibility` counterexample:

1. Begin the approval with `sampledAt = 0`.
2. Verify the Passkey factor and record exact evidence.
3. Advance to expiry (`clock = 1`).
4. Admit the step-up with `checkedAt = 0`, `admittedAt = 1`.

The original route sampled `nowMs` before asynchronous material resolution and
factor verification, then reused it for `verifiedAtMs` and `claimedAtMs`. The
original trigger checked only that supplied timestamp. Controlled HTTP E2E
reproduction confirmed both Passkey and Email OTP could create durable claims
after expiry during verification, evidence recording, or admission.
Classification: `production_regression` against the live-admission expiry rule.
The reproduction established a late authorization claim; it made no signing
worker request and establishes no unauthorized signature or key use.

The fix samples verification time after awaited factor work and rejects expired
operations or OTP grants with HTTP 403. It samples a fresh claim time after the
evidence write and checks the database clock in the atomic claim trigger.
Pending retry eligibility also checks that clock. Completed-result replay keeps
its existing behavior. Signing OTP grants consumed before rejection stay spent;
step-up never changes the reusable session quota.

The database expression uses SQLite's millisecond `subsec` clock, rounded to an
integer. SQLite obtains `now` from its VFS clock; the local D1 and Node SQLite
checks exercised the exact expression. See [SQLite date/time functions](https://www.sqlite.org/lang_datefunc.html).
Apply signer migration `0041_step_up_admission_expiry.sql` to each deployment;
this follow-up performs no deployment.

| Run | Result |
| --- | --- |
| Initial model, all 13 invariants | `LiveStepUpEligibility` counterexample; exit 12. 86,645 generated states, 13,755 distinct states, depth 6; exploration stops at the finding. |
| Current committed configuration, all 13 invariants | Pass; exit 0. 40,107,376 generated states, 1,536,642 distinct states, no queued states, depth 22; 4 min 46 s. TLC's calculated fingerprint-collision estimate is `3.2E-6`. |
| Reachability qualification | 30 witness traces: last-use retry; two warm admissions competing for one material; zero-budget step-up; proof/evidence interruption; crashes before/after take; lost response and exact replay; rollback; expiry/cancellation; stale revision; late completion; failed factor after restart; and all 14 substituted binding fields. |
| Fault qualification | Double debit violates `BudgetConservation`; double take violates `OneUseMaterial`; step-up substitution violates `ExactStepUpBinding`; step-up reuse violates `OneOperationStepUp`; stale-time admission violates `LiveStepUpEligibility`. All five faults were introduced only in ignored model copies. |
| Controlled HTTP expiry E2E | 22 cases pass across VM SQLite and local Cloudflare D1, applying the full signer migration chain. Valid and failed factors; expiry during verification, after evidence, and before admission; independent OTP-grant expiry; pending exact retries; completed replay; result immutability; unchanged zero-use quota. |
| Browser lifecycle contracts | Passkey unlock/signing/export/shared-budget step-up and Email OTP registration/unlock/signing/export/step-up both pass on the VM host. The initial Email OTP attempt was environment-blocked by a missing Google ID token; the existing refresh command repaired the environment before the passing rerun. |
| Static checks and patch review | Wallet Server typecheck and intended-contract typecheck pass. Independent prepatch boundary review and postpatch bypass review found no remaining bypass in the changed paths. |

The remaining checks cover budget conservation, atomic debit/claim and retry
accounting, session identity and step-up neutrality, one-use/terminal material,
reservation binding/revision, admission before signing, exact one-operation
step-up, verified factor eligibility at the supplied timestamp, and immutable
results/exact replay, including live-time admission eligibility. All invariants
remain enabled in the committed configuration.

Checked model SHA-256: `3db56ea9994bec95c2d0e8177478f63fd836c7e8cb2f5cad39012e65e615686d`.
Committed configuration SHA-256: `b1ce357e305d4cb0974f1208f691db25ade668d1b4f9348ef582cb81b4b779f0`.

The controlled E2E uses the actual HTTP route, authorization service/store, and
SQL migrations with trusted factor-verification and material-discovery ports.
It does not verify WebAuthn/OTP cryptography, browser confirmation correctness,
export-specific delayed expiry, or worker effects. The Passkey browser contract
exercises real verification plus immediate export and shared-budget signing;
the Email OTP browser contract exercises its real factor and export grant flow.

Factor verification remains a trusted input in the model. Its verification and
evidence actions permit completion after logical expiry; the atomic admission
guard must reject every such new claim. Production also rejects expired factor
completion earlier. The E2E checks that earlier rejection and independently
expiring OTP grants, which the model's shared deadline does not represent.

The model requires unexpired credentials even for result replay. Production's
store can replay a completed step-up result after evidence expiry while outer
request gates and current material checks still apply. The E2E explicitly covers
that store behavior; the model's eligible-replay guarantee is narrower.

Recommendation: retain the small model and stop expanding this pilot. The
admission fix is implemented and verified within the scopes above.
Confirm the deployed worker path and its clock/recovery boundaries in separately
scoped work before extending worker conclusions. Add no CI or broader model.

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
TLA_OUTPUT=.artifacts/tla-signing/fixed
mkdir -p "$TLA_OUTPUT/tmp"
"$TLA_JAVA" -Djava.io.tmpdir="$PWD/$TLA_OUTPUT/tmp" -XX:+UseParallelGC -Xmx2g \
  -cp .tooling/tla/tla2tools-1.7.4.jar tlc2.TLC \
  -workers 1 -fp 0 -seed 1 -difftrace -metadir "$TLA_OUTPUT/states" \
  "$TLA_MODEL" > "$TLA_OUTPUT/tlc.log" 2>&1
```

Expect exit 0 and `Model checking completed. No error has been found.` in the log.

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
| Stale-time admission | In `AdmitStepUp`, replace its `clock < Deadline` guard with `volatile.sampledAt < Deadline`, and record `checkedAt` as `volatile.sampledAt`. | `LiveStepUpEligibility` |

For a reachability witness, insert `NoWitness == ~(predicate)` before the module's
final delimiter and check `TypeOK` plus `NoWitness`. A counterexample demonstrates
that the predicate is reachable. Examples: `startingUses = 0 /\ Cardinality(StepUpOperations) = 1 /\ audit.takes = 1`;
`Cardinality(WarmOperations) = 2 /\ worker.material.kind = "reserved"`;
`audit.takes = 1 /\ "worker" \in restarts`;
and `lastEvent = "method"` (repeat for each member of `BindingFields`).

Run the controlled E2E and existing browser contracts from the repository root:

```sh
node tests/e2e/step-up-expiry.e2e.mjs
SEAMS_INTENDED_WALLET_HOST=vm SEAMS_INTENDED_SKIP_BUILD=1 \
  node tests/scripts/run-wallet-intended-isolated.mjs -- \
  e2e/intended-behaviours/passkey.unlock.contract.test.ts \
  --grep 'passkey unlock restores immediate export and shared-budget signing'
pnpm -C tests ensure:intended-google-token
SEAMS_INTENDED_WALLET_HOST=vm SEAMS_INTENDED_SKIP_BUILD=1 \
  node tests/scripts/run-wallet-intended-isolated.mjs -- \
  e2e/intended-behaviours/email-otp.unlock.contract.test.ts \
  --grep 'Email OTP registration and unlock lifecycle'
```

The browser commands reuse already-built Rust/SDK artifacts. Omit
`SEAMS_INTENDED_SKIP_BUILD=1` on a fresh checkout. Run them sequentially because
the existing local service ports are shared.

Logs, full witness predicates, exact fault edits, commands, traces, source/tool
hashes, and state counts remain in `.artifacts/tla-signing/`. The initial
`run-summary.json` and `admission-e2e/before.json` preserve baseline evidence;
`fixed/summary.json`, `fixed/qualification/qualification.json`, and
`admission-e2e/after.json` record the follow-up. These sanitized local artifacts
and the tool/runtime stay outside Git.
