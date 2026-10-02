# Cross-tab lock and session restoration

Checked on 2026-10-02. This small companion to the
[signing pilot](../tla-signing/README.md) checks one tab locking while another
awaits session status. It exposed a production race: a delayed reconciliation
upsert recreated the exact session credential that lock had deleted.

Reconciliation now refreshes only the unchanged original row and credential.
The comparison and write share one IndexedDB transaction. A missing or changed
row supersedes the response. Fresh session issuance keeps its existing write
path. This adds a local conditional read to reconciliation writes and requires
no additional network request.

## Bounds and assumptions

- One wallet, one fixed authority and auth method, two tabs, one lock, one
  restoration, and one held status response. An optional fresh verified unlock
  installs a different session after lock completes.
- The response either preserves or updates a capability projection. It carries
  the original identity or substitutes exactly one of wallet, authority,
  method, authorization, session, or quota identity. Cryptographic verification,
  token contents, expiry, digest, and revocation epoch are trusted fixed inputs.
- Lock generation changes from 0 to 1. Generation publication, credential
  deletion, and runtime cleanup are separate actions, matching separate awaited
  production boundaries. Refresh and deletion of the credential row serialize
  through IndexedDB read/write transactions on the same store.
- Credential revision summarizes the capability projection. Equality in
  `CanRefresh` represents comparison of the original record and operation token.
  Production also checks immutable record fields before accepting a refresh.
- Budgets 1 and 2 are symbolic already-assigned allowances for the old and
  optional fresh session. Restoration has no budget effect. Fresh issuance,
  quota admission, and server-side revocation are outside this model.

`ObservePrivilegedGate` assumes an atomic observation of current shared lock
state and the current credential. It records which session each tab observed;
it does **not** establish that every production privileged operation performs
that observation atomically. The reviewed readers have asynchronous boundaries.
The production finding and correction concern durable credential publication.

The model checks finite safety properties. It establishes no eventual delivery,
real-time deadline, instantaneous UI synchronization, retroactive cancellation
of already-started signing, or complete fresh-unlock-versus-unfinished-lock
policy. Multiple locks, wallets, methods, authorities, concurrent issuance, and
other delayed response handlers require separate checks. The
[TLA+ applicability notes](../tla-signing/README.md#where-tla-applies) apply here.

## Properties and correspondence

| Invariant | Required guarantee within these bounds |
| --- | --- |
| `TypeOK` | Records, phases, counters, and history stay in their finite domains. |
| `LockGenerationPreserved` | Restoration cannot reset the shared lock generation. |
| `RestorationCannotUnlock` | Only the optional fresh unlock can unlock after lock publication. |
| `RetiredSessionStaysAbsent` | Once deleted, the old session cannot return. |
| `CompletedLockKeepsCredentialsAbsent` | Completed lock leaves no credential until a fresh unlock. |
| `FreshSessionSurvivesLateRestore` | A fresh session keeps its identity through the delayed response. |
| `ExactRestoreIdentity` | A projection update requires all modeled identity fields to match. |
| `RestorePreservesBudget` | Restoration neither spends nor replenishes allowance. |
| `PrivilegedGateRequiresCurrentSession` | The abstract gate admits only while unlocked, using the current session. |

| Boundary | Production owner |
| --- | --- |
| Shared lock generation | [`advanceWalletLockGeneration`](../../../../packages/wallet/src/core/indexedDB/seamsWalletDB/repositories.ts), a transaction over wallet selections. |
| Lock ordering and final restoration lock check | [`lock` and `setRestoredWalletAuthenticationIfUnlocked`](../../../../packages/wallet/src/SeamsWeb/operations/auth/login.ts). Lock publishes the generation, retires local sessions, then clears runtime state. |
| Exact credential retirement and conditional refresh | [`WalletSessionAuthorizationRepository`](../../../../packages/wallet/src/core/indexedDB/seamsWalletDB/walletSessionAuthorizationStore.ts). `retireExactActiveForWallet` deletes active rows; `refreshExactWithOperationCredential` compares and updates one existing row in a read/write transaction. |
| Original snapshot, awaited status, identity checks, conditional write | [`exactSessionReconciliation.ts`](../../../../packages/wallet/src/SeamsWeb/walletIframe/shared/exactSessionReconciliation.ts). An unchanged status skips writing; superseded refresh skips publication. |
| Reconciliation followed by current exact-state read | [`auth.ts`](../../../../packages/wallet/src/SeamsWeb/walletIframe/host/handlers/auth.ts) and [`exactSessionState.ts`](../../../../packages/wallet/src/SeamsWeb/walletIframe/shared/exactSessionState.ts). |

The model does not execute TypeScript. Source review, the transaction assumption,
and controlled browser schedules provide the correspondence evidence. The
normative contract is
[Page Refresh After Unlock](../../../../docs/intended-behaviours.md#page-refresh-after-unlock).

## Results

The baseline unconditional write produced a seven-state counterexample:
read the original credential, hold and deliver status, publish lock, delete the
credential, then apply status and recreate it. The controlled browser scenario
confirmed the same production defect: lock completed at generation 1 with zero
session rows; the delayed response restored the old session and quota identity.
The UI remained logged out. This evidence establishes credential resurrection,
without claiming a demonstrated unauthorized signature.

The corrected model passed all nine invariants: **3,158 generated states,
1,767 distinct states, depth 11, zero states left on the queue**. All 19
reachability witnesses and eight deliberate faults qualified with exit 12
naming the expected invariant. Faults are artificial assertion checks.

Four browser contracts passed on the VM host with fresh state per case and a
rebuilt SDK: delayed restoration after cross-tab lock, delayed restoration after
fresh unlock, the existing Passkey refresh/signing/step-up/export contract, and
the existing Email OTP registration/unlock/refresh contract. Both race cases
also perform NEAR and Tempo signing with the fresh session. The fresh-unlock
test needed a refreshed frame reference because unlock remounts the iframe;
that test setup failure preceded its passing rerun.

The race helper uses real registered session rows, retains a valid earlier
capability projection to force reconciliation, and delays the actual status
response in the restoring tab. Its repeatable `cross-tab-restoration.json`
artifact records lock generation, session/quota identifiers, and capability
counts before lock, after lock, and after the late response. Credentials are
excluded. Sanitized results are retained under
`.artifacts/tla-session-restore/browser-fixed/`; the fresh-unlock result is in
`fresh_unlock-rerun/`. Baseline evidence is in `browser-baseline-race/`.

SDK build, Wallet and intended-contract type checks, whitespace checks, and
`pnpm report:bloat --check` passed. Retain this model for changes to these
boundaries; further expansion should begin with a concrete coverage question.

## Reproduce

Use the Java and official TLC setup from the
[signing pilot](../tla-signing/README.md#reproduce). Checked tools: Temurin
17.0.20.1 and TLC 2.19 revision `5a47802`, distributed in the v1.7.4 jar.
Jar SHA-256:
`936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`.
Keep tools and output ignored and give each process its own temporary directory.

From the repository root:

```sh
TLA_JAVA="$PWD/.tooling/tla/runtime/jdk-17.0.20.1+1-jre/Contents/Home/bin/java"
TLA_MODEL=crates/router-ab-core/formal-verification/tla-session-restore/CrossTabSessionRestore.tla
TLA_OUTPUT=.artifacts/tla-session-restore/fixed
mkdir -p "$TLA_OUTPUT/tmp"
"$TLA_JAVA" -Djava.io.tmpdir="$PWD/$TLA_OUTPUT/tmp" -XX:+UseParallelGC -Xmx1g \
  -cp .tooling/tla/tla2tools-1.7.4.jar tlc2.TLC \
  -workers 1 -fp 0 -seed 1 -difftrace -metadir "$TLA_OUTPUT/states" \
  "$TLA_MODEL" > "$TLA_OUTPUT/tlc.log" 2>&1
```

Expect exit 0 and `Model checking completed. No error has been found.`
No new runner, CI job, production flag, or verification dependency is added.

Use the existing isolated browser runner on available service ports:

```sh
pnpm -C packages/wallet build:sdk
SEAMS_INTENDED_WALLET_HOST=vm SEAMS_INTENDED_SKIP_BUILD=1 \
  node tests/scripts/run-wallet-intended-isolated.mjs --require-google-token -- \
  e2e/intended-behaviours/passkey.unlock.contract.test.ts \
  --grep 'cross-tab lock prevents|fresh unlock survives|page refresh hydrates'
SEAMS_INTENDED_WALLET_HOST=vm SEAMS_INTENDED_SKIP_BUILD=1 \
  node tests/scripts/run-wallet-intended-isolated.mjs --require-google-token -- \
  e2e/intended-behaviours/email-otp.unlock.contract.test.ts
```

Recorded runs used the CI Playwright configuration directly with isolated
ports: service offset 300, Gateway 4400, app 4501, Wallet origin 4502, and one
fresh temporary state/cache root per case. Baseline production review used HEAD
`a319155647cfd72e5d6cc8b6b7cc2e0d3dd43f9d` before applying the correction.

For qualification, copy the model and config to ignored artifact directories.
Add `NoWitness == ~(predicate)` before the final delimiter, retaining only
`TypeOK` and `NoWitness` as invariants. Each target below must produce exit 12
with `NoWitness`. This supplies a reachable trace without a liveness claim.

| Witness | Predicate |
| --- | --- |
| Ordinary update | `/\ history.writes = 1 /\ ~history.oldRetired` |
| Unchanged status | `/\ restore.phase = "finished" /\ responseField = "exact" /\ responseRevision = 0 /\ history.writes = 0 /\ ~history.rejected` |
| Waiting after lock | `/\ restore.phase = "waiting" /\ lockPhase = "completed"` |
| Held response after lock | `/\ restore.phase = "held" /\ lockPhase = "completed"` |
| Late update rejected | `/\ restore.phase = "finished" /\ history.rejected /\ responseField = "exact" /\ history.oldRetired /\ history.freshUnlocks = 0` |
| Fresh unlock before response | `/\ restore.phase = "held" /\ history.freshUnlocks = 1` |
| Fresh session survives | `/\ restore.phase = "finished" /\ history.rejected /\ responseField = "exact" /\ history.freshUnlocks = 1` |
| Update during lock cleanup | `/\ lockPhase = "retiring" /\ history.writes = 1` |
| Refresh then lock deletes | `/\ lockPhase = "completed" /\ history.writes = 1 /\ history.freshUnlocks = 0 /\ credential = NoSession` |
| Unchanged late response | `/\ restore.phase = "finished" /\ responseRevision = 0 /\ responseField = "exact" /\ history.oldRetired /\ history.freshUnlocks = 0 /\ history.writes = 0` |
| Fresh session gate | `history.admittedSession["restoring_tab"] = Identity("new")` |
| Old session gate | `history.admittedSession["restoring_tab"] = Identity("old")` |
| Both tabs gate | `history.admitted = Tabs` |
| Six altered identity fields | `/\ responseField = "wallet" /\ history.rejected`, then separately `"authority"`, `"method"`, `"authorization"`, `"session"`, and `"quota"`. |

Mutate only copies for faults, retaining `TypeOK` and the target invariant.
Require exit 12 naming that invariant; parsing or evaluation errors do not
qualify. Qualification traces/results are in
`.artifacts/tla-session-restore/qualification/`.

| Fault in copied model | Expected invariant |
| --- | --- |
| Remove `CanRefresh` from `ApplyStatus`; check each target separately. | `RetiredSessionStaysAbsent`; `CompletedLockKeepsCredentialsAbsent` |
| Replace `CanRefresh` with `credential # NoSession`, accepting any current session. | `FreshSessionSurvivesLateRestore` |
| Replace `ValidStatus` with `TRUE`. | `ExactRestoreIdentity` |
| In `ApplyStatus`, decrement `serverBudgets.old` and remove `serverBudgets` from `UNCHANGED`. | `RestorePreservesBudget` |
| In `ApplyStatus`, set selection state to unlocked and remove `selection` from `UNCHANGED`. | `RestorationCannotUnlock` |
| In `ApplyStatus`, set selection generation to 0 and remove `selection` from `UNCHANGED`. | `LockGenerationPreserved` |
| Remove the selection-state guard from `ObservePrivilegedGate`. | `PrivilegedGateRequiresCurrentSession` |

## Checked files

These hashes identify the checked model and corrected production boundaries
independently of concurrent commits.

| File | SHA-256 |
| --- | --- |
| `CrossTabSessionRestore.tla` | `d5a1831ce939121dd4855573912fbb032829e3eae460346210e087f67c623c80` |
| `CrossTabSessionRestore.cfg` | `dc610f1feee7ce17300fb1d78a1eacb0932134c4b2d118b3d75be7270ccb57b4` |
| `walletSessionAuthorizationStore.ts` | `911dd405a09ebe1c743472ec17cab221617c5817e8e4f2e43f5d3e55aaa9ed87` |
| `exactSessionReconciliation.ts` | `ecc5f2de9556b93ec488b1cf123e7110a87859aa65a0a6e975f3dc301846e234` |
| `auth.ts` | `0a07f8822b7c312c685ddcfad7c0a57a455694e3866026790f9cb7af9436d56f` |
| `login.ts` | `ac39afe87f4036a08a05455f40dcfaf4c76988f7ff554a883c68bf25fd06ebed` |
| `repositories.ts` | `27b6d401b95870939d1d48655068673bccd3d78cb75e526150de51c73e3f0315` |
| `exactSessionState.ts` | `d9d8909afd58c7ae9861360be317eaba863de54d7fcc78658059ffba4396c98f` |
