# Narrow wallet revocation race

Checked on 2026-10-02. This companion to the
[signing pilot](../tla-signing/README.md) models one wallet, one full-owner
authority, two active methods, two opposing revocation requests, and one delayed
response. `revoke_passkey` uses Email OTP to remove the Passkey;
`revoke_email_otp` uses the Passkey to remove Email OTP.

Both requests may verify and pass preflight before either commits. The intended
outcome permits at most one committed revocation. Its target's sessions, quota,
hosted children, and custody envelope retire together; the surviving method
and its state remain usable. A failed batch spends no Email OTP proof. An exact
retry recovers the immutable committed answer without another effect.

The server decision occurs in the database batch. A delayed response cannot
undo it. The SDK may retain an active cache entry until it receives the
revocation; after observing that revocation, these response handlers must
preserve it. Successful revocation replies contain the revoked target, and
refusals publish no active-method snapshot.

## Bounds and interpretation

- Exactly two methods, one Passkey and one Email OTP, on the same authority.
  Their authority identity, digest, permissions, and epoch stay fixed.
- One already-issued session, quota, hosted-child bundle, and method-bound
  active custody envelope per method. Initial remaining uses are 1 and 2,
  which makes accidental changes to the survivor visible.
- Two logical revocations; at most one retry and one batch rollback per request.
  One selected response waits for the other's delivery or loss. That selected
  response may be lost once, including after commit.
- One altered replay probe per execution, choosing wallet, target, operation
  fingerprint, proof digest, or answer kind. Digests and successful factor
  verification are symbolic trusted inputs.

`VerifySource` and `Prepare` summarize read-only preflight work. A prepared
request can become stale while the other request commits. `Commit` models the
existing atomic batch, including its live guards; `Rollback` publishes a
refusal with durable state unchanged. `Deliver` updates only the revoked
target's local projection. History variables retain evidence for assertions;
they confer no authority on a request.

The two-method bound makes the live method-count check, source-method check,
and remaining-envelope check overlap. The controls below demonstrate that
masking. Independent source authorization with three methods, multiple
authorities, envelope replacement, new session issuance, signing admission,
and delayed add/unlock/restore publication require separate coverage.

This model checks safety under finite ordering choices. Eventual delivery,
fairness, recovery from every state, cryptographic verification, privacy,
latency, and real-time deadlines are separate obligations. Already-admitted
signing work has no transition in this model, so this result establishes no
retroactive cancellation policy. The
[TLA+ applicability notes](../tla-signing/README.md#where-tla-applies) apply here.

## Checks and production correspondence

| Invariant | Required guarantee |
| --- | --- |
| `TypeOK` | All modeled records, request phases, response states, and counters stay within their finite domains. |
| `LastMethodSurvives` | At least one method remains active, including when both requests passed preflight. |
| `LiveSourceAtCommit` | Each committed request used a source still active at commit, while more than one method remained active. |
| `AtomicRetirement` | The revoked target's session, quota, hosted children, and envelope retire together; the active sibling keeps its initial state and budget. |
| `ProofSpendMatchesCommit` | Email OTP proof spending occurs exactly with its revocation commit. |
| `ReplayMatchesCommit` | A replay exists exactly for a committed request, retains its first answer and identity, and supplies that answer to exact retries. |
| `AlteredInputsCannotReplay` | Changing any of the five replay identity fields cannot recover the committed answer. |
| `TerminalRevocation` | Server retirement stays terminal; SDK-observed revocations stay terminal through the modeled replies. |

The model does not execute TypeScript or SQL. Its correspondence is the source
review below plus the behavioral evidence recorded separately. Atomic batch
execution and rollback are assumptions of `Commit` and `Rollback`.

| Boundary | Current implementation |
| --- | --- |
| Live target, wallet-wide final-method check, target authority CAS | [`D1WalletAuthorityStore.revokeWalletAuthMethod`](../../../../packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletAuthorityStore.ts), including the count subquery in the conditional `UPDATE` and its batch CAS guard. The authority remains active while its sibling remains active. |
| Source method, authority digest, and epoch recheck | [`prepareActiveV2SourceGuardStatements`](../../../../packages/wallet-server/src/core/d1WalletAuthMethodStore.ts), executed inside the same revocation batch. |
| Composition of proof spending, retirement, and replay | [`revokeWalletAuthMethodWithFreshProof` / `revokeWithVerifiedProof`](../../../../packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletAuthMethodService.ts). Email OTP verification prepares consumption; the batch spends it. |
| Exact session, quota, and hosted-child retirement | [`prepareRetireWalletSessionAuthorizationsForAuthMethod`](../../../../packages/wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore.ts), wired by `d1RouterApiAuthService.ts`. Active target quotas become exhausted with zero uses. |
| Exact envelope retirement and surviving-envelope guard | [`prepareMethodEnvelopeRevocationStatements`](../../../../packages/wallet-server/src/router/cloudflare/d1/passkeyCustody/d1PasskeyCustodyEnvelopeStore.ts), including versioned writes and the final live remaining-envelope guard. |
| Immutable exact replay | [`D1WalletAuthMethodRevocationReplayStoreV1`](../../../../packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletAuthMethodRevocationReplayStore.ts), plus migrations `0037` and `0039`. The model's request-indexed replay map is equivalent to target indexing because each request has a different target. |
| Local revocation response | [`revokeAuthMethod.ts`](../../../../packages/wallet/src/SeamsWeb/operations/authMethods/revokeAuthMethod.ts): successful replies mark only the target revoked; refused replies throw before projection writes. |

The behavioral contract is
[Adding an Authentication Method](../../../../docs/intended-behaviours.md#adding-an-authentication-method).
Full-owner proof checks and exact wallet/authority binding precede the batch;
the single fixed authority abstracts their unchanged identity checks. Multiple
rows belonging to a method are summarized by one representative child bundle.

## Results

TLC exhaustively checked all eight invariants: **10,470 generated states,
4,360 distinct states, depth 18, zero states left on the queue**. The run
completed in under one second. No counterexample was found in the unchanged
model; no production fix resulted from this pilot.

Qualification reached all 19 target states and detected all eight deliberate
faults, each with exit 12 naming the expected invariant. Three masking controls
completed without error. Qualification copies and traces are retained locally
under `.artifacts/tla-revocation/qualification/`; the unchanged run is
`.artifacts/tla-revocation/base/tlc.log`.

The existing browser contracts exercise revocation in both directions, survivor
signing, refusal to remove the final method, and revoked Email OTP unlock.
The Email OTP-to-Passkey contract additionally exercises a refused batch,
response loss, exact retry, committed replay, and changed operation/proof
rejection. Both contracts passed again on the VM host with fresh state per case: Passkey
to Email OTP in 38.5 seconds, and Email OTP to Passkey in 48.5 seconds. The
Gateway ran from current source; unchanged prebuilt SDK/Rust artifacts were
reused. Sanitized command/result records are retained under
`.artifacts/tla-revocation/browser/`.

These contracts do not force both opposing requests to reach the pre-commit
boundary together. That particular production schedule has model and static guard
evidence; a controlled concurrent production E2E remains a coverage gap.

Retain this small model for changes to these boundaries. Its green result
supports the scoped revocation design and adds no runtime code or latency.
Further expansion should start from a concrete behavior or coverage question.

## Reproduce

Use the same official TLC jar and Java setup as the
[signing pilot](../tla-signing/README.md#reproduce). TLC identifies itself as
2.19, revision `5a47802`; the v1.7.4 jar's SHA-256 is
`936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`.
The checked runtime is Temurin 17.0.20.1. Give each process its own temporary
directory, so concurrent runs cannot race standard-module extraction.

From the repository root:

```sh
TLA_JAVA="$PWD/.tooling/tla/runtime/jdk-17.0.20.1+1-jre/Contents/Home/bin/java"
TLA_MODEL=crates/router-ab-core/formal-verification/tla-revocation/WalletRevocationRace.tla
TLA_OUTPUT=.artifacts/tla-revocation/base
mkdir -p "$TLA_OUTPUT/tmp"
"$TLA_JAVA" -Djava.io.tmpdir="$PWD/$TLA_OUTPUT/tmp" -XX:+UseParallelGC -Xmx1g \
  -cp .tooling/tla/tla2tools-1.7.4.jar tlc2.TLC \
  -workers 1 -fp 0 -seed 1 -difftrace -metadir "$TLA_OUTPUT/states" \
  "$TLA_MODEL" > "$TLA_OUTPUT/tlc.log" 2>&1
```

Expect exit 0 and `Model checking completed. No error has been found.`
No new runner, CI job, production flag, or verification dependency is added.

To rerun the two existing browser contracts with fresh state per case, use the
existing isolated runner on available local service ports:

```sh
SEAMS_INTENDED_WALLET_HOST=vm SEAMS_INTENDED_SKIP_BUILD=1 \
  node tests/scripts/run-wallet-intended-isolated.mjs --require-google-token -- \
  e2e/intended-behaviours/passkey.add-email-otp.contract.test.ts \
  e2e/intended-behaviours/email-otp.add-passkey.contract.test.ts
```

The recorded reruns used the CI Playwright configuration directly, one fresh
temporary state/cache root per case, and isolated ports: offset 300 for Wallet
services, Gateway 4400, app 4501, and Wallet origin 4502.
`pnpm report:bloat --check` and whitespace checks passed.

For a witness, copy the model and config into a fresh ignored artifact directory.
Add `NoWitness == ~(predicate)` before the final module delimiter. In that
config, retain `TypeOK` and `NoWitness` as the only invariants. Run the copied
module with the same CLI and isolated output directories. Exit 12 naming
`NoWitness` supplies one reachable trace. It establishes reachability of the
target, without a liveness or all-states recovery claim.

| Witness | Predicate |
| --- | --- |
| Both verified | `phases = [req \in Requests |-> "verified"]` |
| Both prepared | `phases = [req \in Requests |-> "prepared"]` |
| Passkey wins | `history.commits["revoke_email_otp"] = 1` |
| Email OTP wins | `history.commits["revoke_passkey"] = 1` |
| Stale prepared request denied | `\E req \in Requests : /\ history.prepared = Requests /\ req \in history.denied /\ history.commits[Other(req)] = 1` |
| Winner's reply delayed | `/\ history.commits[delayedRequest] = 1 /\ replies[delayedRequest].state = "pending" /\ replies[Other(delayedRequest)].state = "delivered"` |
| Loser's reply delayed | `/\ replies[delayedRequest].answer = DeniedAnswer /\ replies[delayedRequest].state = "pending" /\ replies[Other(delayedRequest)].state = "delivered" /\ history.commits[Other(delayedRequest)] = 1` |
| Committed reply lost | `/\ history.commits[delayedRequest] = 1 /\ delayedRequest \in history.lost` |
| Exact retry after loss | `/\ history.retryAnswer[delayedRequest] # NoAnswer /\ delayedRequest \in history.lost` |
| Lost reply's retry delivered | `/\ history.retryAnswer[delayedRequest] # NoAnswer /\ delayedRequest \in history.lost /\ replies[delayedRequest].state = "delivered"` |
| Email OTP rollback, then retry commits | `/\ "revoke_passkey" \in history.rolledBack /\ "revoke_passkey" \in history.retried /\ history.commits["revoke_passkey"] = 1` |
| Denied Email OTP proof stays unspent | `/\ "revoke_passkey" \in history.denied /\ history.commits["revoke_email_otp"] = 1 /\ ~server.emailProofSpent` |
| Server revocation precedes SDK observation | `\E method \in Methods : server.methods[method] = "revoked" /\ client[method] = "active"` |
| Both replies delivered, one method retired | `/\ \A req \in Requests : replies[req].state = "delivered" /\ Cardinality(history.retired) = 1` |
| Altered replay, five separate witnesses | `history.alteredField = "wallet"`, then separately `"target"`, `"operation"`, `"proof"`, and `"answer_kind"`. |

For a deliberate fault, mutate only an ignored copy. Retain `TypeOK` and the
target invariant below. Require exit 12 naming that invariant; a parser or
evaluation error does not qualify the check.

| Fault in copied model | Expected invariant |
| --- | --- |
| In `CanCommit`, remove the live `ActiveMethods` count, source-method status, and `ActiveEnvelopes` count checks, trusting the old `Prepare` result. Check each property separately. | `LastMethodSurvives`; `LiveSourceAtCommit` |
| In `Commit`, remove `!.quotaUses[Target(req)] = 0`. | `AtomicRetirement` |
| In `Commit`, also retire `server.sessions[Source(req)]`. | `AtomicRetirement` |
| In `VerifySource`, set `server.emailProofSpent` when the source is Email OTP, before a commit; remove `server` from its `UNCHANGED` tuple. | `ProofSpendMatchesCommit` |
| In `ReplayMatches`, remove the identity equality check. | `AlteredInputsCannotReplay` |
| In `ExactRetry`, overwrite `server.replays[req]` with `Answer(Other(req))`; remove `server` from its `UNCHANGED` tuple. | `ReplayMatchesCommit` |
| In `Deliver`'s denial branch, write `client[Source(req)] = "active"`. The late losing reply then restores an already-observed revoked source. | `TerminalRevocation` |

Three controls run all eight invariants after removing only the method-count
guard, only the source guard, or both while retaining the envelope-count guard.
All remain green within these bounds. The stale-preflight fault removes all
three overlapping checks to expose the harmful interleaving. These artificial
faults qualify the assertions; they are not findings in production.

## Checked revisions

Model and config SHA-256 hashes, and the reviewed source snapshot, are saved
below. Source review used repository HEAD
`de40f7b3d52f8a0c13fa7012cca0a8a8c88fbd04`; source hashes identify the exact files
independently of other concurrent commits.

| File | SHA-256 |
| --- | --- |
| `WalletRevocationRace.tla` | `a4e5b5418c0ae1747a563f06b13556cca0d9b1e5df459f1231cb3cd10d91d013` |
| `WalletRevocationRace.cfg` | `d078eb3172b0572051ac5e2c28bfa11b52204567b85d57f7b48d9c573abaca0f` |
| `d1WalletAuthorityStore.ts` | `ac7a3d8774a254a36b10e7819a2094f108c0eaab0305672526bc7bf30be37233` |
| `d1WalletAuthMethodStore.ts` | `b1f6bcfcc99eedac1e34505d5e0e83bc31fe2f9b1a8fc954bcb3b8dd90ce96af` |
| `d1WalletAuthMethodService.ts` | `f338091184d2045fc452552fb1769b3491e74267d4a47b24a711d7c168f36209` |
| `d1WalletAuthMethodRevocationReplayStore.ts` | `c81209938d81f33af24d62386982915596ef34ff5730f5f7df11e435a0445351` |
| `d1AuthorizationStore.ts` | `2d6cb6c6025443be59ba7c2be956cfedb8eed89e1f3037866cbb204619cdae60` |
| `d1PasskeyCustodyEnvelopeStore.ts` | `eb6fe2c1976f0ab6f0f7f82620b39df4ea669f8deed71d74ed8cf1e8098b15fe` |
| `revokeAuthMethod.ts` | `00281d67abf61533b66f5389ebd8c9bafa88c5e8e4281d62e5d4d6c702969688` |
