# R155C — concurrent Deriver A/B preparation under one trusted operator

Status: implemented, verified locally, and measured on staging. The change is
kept. Router Yao execution fell from 3.199 seconds on the restored control to
2.009 seconds, and every hosted sample dispatched A together with B. The 3–4
second registration-to-signature target remains unmet at 10.599 seconds.
Staging serves its original versions again.
Date: October 9, 2026. Supersedes the earlier R155C draft of the same date.
Revised the same day after review: role-local digest checks, outcome-based
failure resolution, a budget-derived wait, and recoverable pre-claim refusal.
The [implementation record](#implementation-record) lists what was built, what
the baseline turned out to do, and the evidence, including the
[hosted measurement](#hosted-measurement).

## Objective and relationship to R155B

Remove the Router's wait for Deriver B before it dispatches Deriver A. Dispatch
B preparation and A execution at the same time. Let B's wallet object admit the
peer connection as soon as its own preparation lands. Remove the A/B mutual
attestation that the current flow carries: readiness receipts, start acceptance,
their signatures, and their verification at Router, A, and B.

[R155B](refactor-155B.md) records the registration optimizations through Phase
6AO and the measured history. Keep that history there. Record this refactor's
implementation and results here.

The earlier R155C draft moved B preparation onto the A-to-B connection. That
design put B's first object touch, root admission, and claim behind A's own
preparation and connect, and it made A relay the Router's authority to B. It is
withdrawn. Phase 6AG's notes already identified that ordering as serializing
work. This plan removes the dependency instead of moving it.

The main performance objective remains NEAR-only registration followed by the
first independently verified signature. The user requires less than 3–4 seconds,
with 1–2 seconds preferred. This change removes a measured serial stage from the
Yao execute request. It does not promise the full-flow target by itself. Yao
execute is 3.5 seconds of a 10.65-second flow.

## Trust model

One trusted organisation operates Deriver A and Deriver B. Separate Cloudflare
Workers keep each role's plaintext inputs, private keys, and tenant-root share
separate. Independent organisations or mutually distrusting operators are not
required.

The organisation may use separate Cloudflare accounts for additional
administrative isolation. Both arrangements require authenticated communication
and the same local execution guarantees. Current hosted evidence covers
same-account service bindings. A separate-account deployment must validate its
authenticated transport before activation.

[Deployment](router-ab/deployment.md), [the protocol reference](router-ab/protocol.md),
and [spec-5](spec-5-router-ab-threshold-protocol.md) state this model. The separation
guarantee excludes an operator or deployment authority that can control both
roles and combine their secrets.

Consequences for this refactor:

- Peer signatures are redundant under this trust model. Authenticated service
  calls carry the execution handshake. Remove the role readiness receipt, the
  start acceptance, and every verification of them. The peer-message signing
  and verifying keys stay configured: Worker startup validates them and the
  ECDSA signer host loads them. Removing them is a separate change.
- Authorization, identity binding, and one-use execution remain necessary.
  Inter-Worker authentication is required in both account arrangements. Keep the
  existing internal service authentication on every request, including the upgrade. The
  exact wallet home, ownership generation, tenant-root identity, session, pair
  digest, circuit, and execution id select one object and one pair. Each role
  records its execution claim before it sends protocol material, and one
  execution per pair is enforced after lost replies and retries.
- Secret separation remains a required invariant. Keep per-role HPKE envelope
  keys, per-role D1 KEKs and databases, and B's sealed completion opaque to A.
  A never receives B's encrypted input or share. B never receives A's.
- Ownership fences, relocation checks, cancellation reads, expiry, and bounded
  timeouts stay unchanged.

The normative documents state the trusted-organisation model, optional account
separation, and the handshake without signed statements. Their key tables keep
the peer-signing keys, which the runtime still requires at startup. Keep
tenant-root lifecycle signatures, role encryption, and protocol proofs.

## Frozen starting evidence

Start from public `dev` implementation `155b36ea7123d15e0396b7ada15cebb981d7c500`,
documented by `f7a6c9f5b915d3c7c772bdf07ec0ebdb4276b4be`. Phase 6AN sends B
preparation first, then one combined A preparation/execution request that
carries B's receipt. Phase 6AO reuses A's freshly admitted root result within
that request. Preserve both.

The working checkout at the time of this plan is on `ml-dsa` and does not
contain 6AN or 6AO. `router_coordinator/ceremony_execution.rs` exists only on
`dev`. Implement from `dev`.

The accepted Phase 6AO candidate measured three fresh, implicit, unfunded wallets:

| Metric | Median | Observed range |
| --- | --- | --- |
| SDK registration | 8.137s | 7.023–9.225s |
| Registration → independently verified signature | 10.650s | 10.597–12.411s |
| Yao execute HTTP | 3.478s | 3.472–4.109s |

The restored control's full-flow median was 10.720 seconds.

Stage medians inside the candidate's Yao execute request, from
[the sanitized evidence](evidence/near-registration-reused-admitted-target-20261009.json):

| Span | Median | Range |
| --- | ---: | ---: |
| `router.yao_execute` (server) | 2,871 ms | 2,848–3,354 ms |
| `router.parse_and_authorize`, including the wallet claim | 449 ms | 426–537 ms |
| `router.prepare_pair.deriver_b` | 885 ms | 814–1,051 ms |
| `router.deriver_a_execute.http` | 1,938 ms | 1,895–2,196 ms |
| `deriver_a.prepare_in_execute` | 151 ms | 144–163 ms |
| `deriver_a.websocket_connect` | 392 ms | 314–563 ms |
| `deriver_a.yao_protocol` / `deriver_b.yao_protocol` | 489 / 267 ms | 304–547 / 236–450 ms |

The Router's registration claim waits 435 ms for response headers with a 0 ms
handler. B's preparation and A's execution are strictly serial today. These
spans overlap and include transport. Do not add them.

Current measured counts per wallet: eight Gateway HTTP requests including two
session-status requests, nine Console HTTP requests, five bound-root D1 round
trips and thirteen SQL statements. A admission uses 2/5, B admission 2/5, and
B's repeated admitted-root read 1/3 of those.

Earlier connection experiments and why this plan differs:

| Phase | Shape | Result | Dependency it kept |
| --- | --- | --- | --- |
| 6K | A dispatched B preparation, then executed | 3.379 s vs 3.548 / 3.354 s controls | A waited for B's receipt before connecting |
| 6N | One A connection for preparation and execution | 3.932 s vs 4.136 / 3.589 s | Router waited for both receipts before start |
| 6AD | A opened B during preparation | 4.791 s vs 4.167 / 4.008 s | Both receipts still exchanged and verified |
| 6AN | B preparation, then combined A request | full flow 11.486 s vs 10.561 / 10.664 s | A dispatch waited for B's receipt |
| Earlier R155C draft | B preparation inside A's connection | not measured | B's work queued behind A's |

Every arm kept a wait for a signed readiness exchange somewhere before the
protocol started. This plan deletes that exchange.

## Failure semantics today, and what must not regress

The Router's result model has three failure classes. `RecoverableFailure`
leaves the registration claim to lapse; the Gateway treats
`router_execution_retryable` as retryable and an exact retry re-runs the
ceremony. `Rejected` and `Burned` record a terminal `Failed` answer on the
claim. The claim is keyed by the lifecycle id and the exact request digest, so
a fresh session for the same registration is refused as `execution_mismatch`.
A terminal answer therefore ends that registration lifecycle; the SDK records
`near_failed_retryable` and a new registration is required.

Today a B-preparation failure happens before A is dispatched. Nothing burns.
This plan dispatches A concurrently, so a failed or late B preparation now
surfaces at A's connect. A burn is reserved for failures after B has claimed,
when the execution id may have been consumed.

Implementation found that the baseline differed from this description: most
B-preparation failures were terminal, and an exact retry did not re-run the
ceremony. [What the baseline did](#what-the-baseline-did) records both, with
the behaviour this change gives each.

## Current and proposed flow

Current:

1. Router claims the registration in its wallet object.
2. Router sends B its encrypted input. B admits its root, stores `Prepared`,
   and returns a signed readiness receipt.
3. Router verifies that receipt, then sends A one request with A's input and
   B's receipt.
4. A verifies B's receipt, admits its root, signs its own receipt, reserves
   execution, and opens the connection to B with its receipt, execution id,
   and wallet-pair scope.
5. B's object loads `Prepared`, verifies A's receipt and its own stored
   receipt, claims `Running`, re-reads its admitted root, signs a start
   acceptance, and upgrades.
6. A verifies the acceptance, claims locally, exchanges target proofs, and
   runs the protocol. B delivers its sealed completion over the socket.
7. Router validates both role results, delivers to the Signing Worker, and
   finishes the claim.

Proposed:

1. Router claims the registration in its wallet object. Unchanged.
2. Router dispatches B preparation and A execution concurrently and awaits
   both. B's request is unchanged. A's request carries A's input, the run's
   deadline, and no peer receipt.
3. B admits its root and stores `Prepared`. No readiness signature.
4. A admits its root, reserves execution, and opens the connection to B's exact
   wallet object. The upgrade carries the subprotocol binding, execution id,
   wallet-pair scope, the run's deadline, and the internal service
   authentication. No receipt header and no digest header.
5. B's object admits the upgrade. If `Prepared` is absent, it waits until the
   run's deadline for its own preparation to land in the same object. It then
   checks scope, expiry, and fences, validates its own prepared root-metadata
   digest against its freshly read admitted root, claims `Running` durably, and
   upgrades. The 101 response is B's claim. No acceptance signature.
6. A treats the 101 as B's claim, claims locally, exchanges target proofs, and
   runs the protocol. B delivers its sealed completion over the socket.
7. Router resolves the outcome from A's execution result. It validates A's
   execution and B's sealed execution as today and finishes.

Root-metadata digests are role-local. A's and B's digests cover their own share
metadata and differ by design. Never compare them across roles. Each role
validates its own prepared digest against its own fresh root at claim time, as
the baseline does. Cross-role root consistency is enforced where it already is:
the target-proof preface verifies each peer's share against the commitment in
the Router-supplied activation receipt.

The critical path becomes the longer of B preparation and A dispatch plus A
preparation, then the connect, then the protocol. Today it is their sum. The
hypothesis from the stage medians is a server span near 2.0–2.2 seconds instead
of 2.87 seconds. The expected benefit is the overlap. The cost of the removed
signature work has not been measured separately. Neither figure is a saving
until Phase 4 measures it. Phase 4 measured a 2.009 second median.

Keep the existing B preparation endpoint and the existing Worker entry points.
B still receives its input from the Router over the authenticated binding. Add
no transport mode, configuration family, environment variable, or signing secret.

## Required code inventory

Paths are relative to the public `seams-wallet` repository at the frozen commit
unless stated otherwise.

| Area | Files | Required change |
| --- | --- | --- |
| Router ceremony dispatch | `crates/router-ab-cloudflare/src/router_coordinator/ceremony_execution.rs`, `router_coordinator.rs` | Dispatch B preparation and A execution with one join and await both. Resolve the outcome from A's execution result. Remove readiness verification, the `router.verify_readiness_receipts` span, `verify_readiness_ms`, and the `yao_router_verify_readiness` timing label. Keep `router.prepare_pair` and `router.deriver_a_execute` as overlapping spans. Carry the run's deadline into A's request. |
| Router checks | `crates/router-ab-cloudflare/src/ed25519_yao_router_checks.rs` | Remove `validate_router_ed25519_yao_readiness_v1`. Keep role execution validation unchanged. |
| Request shapes | `crates/router-ab-cloudflare/src/ed25519_yao_pair_protocol.rs` | `CloudflareDeriverAWalletPairExecuteRequestV1` drops `peer_receipt` and gains the run deadline. `CloudflareEd25519YaoPairPrepareRequestV1` is unchanged. |
| Core wire types | `crates/router-ab-core/src/protocol/ed25519_yao_router.rs`, `protocol/mod.rs` | Delete `Ed25519YaoRoleReadinessReceiptV1`, `Ed25519YaoRoleStartAcceptanceV1`, and the role signature types if no other consumer remains. |
| Pair lifecycle | `crates/router-ab-core/src/protocol/ed25519_yao_pair_lifecycle.rs` | Replace receipts in `Ed25519YaoPairClaimIdentityV1`, `Prepared`, `Starting`, and `Running` with the role-local root-metadata digest and execution id. Add a release transition from `Starting` back to `Prepared` for a refusal before the peer claims. Keep exact replay and the other transitions. |
| A wallet execution | `crates/router-ab-cloudflare/src/durable_object/deriver_a_pair.rs` | Stop validating a peer receipt. Replay identity is tenant root, work, input, and pair binding; the pair binding already commits to both input digests. Reserve before connect. Release only after an authenticated, exact-execution pre-claim refusal. Claim on 101. Preserve terminal or uncertain execution handling when the upgrade reply is lost. |
| Shared lifecycle and root use | `crates/router-ab-cloudflare/src/ed25519_yao_lifecycle.rs`, `ed25519_yao_lifecycle/bound_root.rs` | Admission returns the role-local root-metadata digest without signing a receipt. Remove `VerifiedDeriverAReadinessV1`. Keep fresh A target reuse and resumed root checks. |
| Peer connection | `crates/router-ab-cloudflare/src/ed25519_yao_websocket.rs` | Remove the readiness receipt and start acceptance headers and their parsing. Carry the run's deadline in the existing wallet-pair scope header. Distinguish a pre-claim refusal from a post-claim failure in the error type. Keep subprotocol, execution id, service auth, timeout, and socket cleanup. |
| B admission on the socket | `crates/router-ab-cloudflare/src/ed25519_yao_lifecycle/deriver_b_start.rs`, `durable_object/deriver_b_pair.rs` | Bounded in-object wait for `Prepared` until the run's deadline, yielding so the concurrent `PreparePair` request runs. Remove peer receipt and stored receipt verification and acceptance signing. Validate the role-local digest, claim `Running`, then upgrade. Refuse a second socket for a running or terminal pair. Leave a tombstone when a burn arrives for a missing record. |
| Environment | `crates/router-ab-cloudflare/src/env.rs`, `lib.rs`, `strict_worker/mod.rs` | Remove the runtime accessors that served the receipts. Keep the reads of `DERIVER_*_PEER_SIGNING_KEY_BINDING`, `*_PEER_SIGNING_KEY_EPOCH`, and `*_PEER_VERIFYING_KEY_HEX`: startup validation and the ECDSA signer host still read them. Tenant-root role signing keys are separate and stay. |
| Native HTTP consumers | `crates/router-ab-dev/src/local_router_coordinator.rs`, `local_ed25519_yao_pair.rs`, `local_ed25519_yao_pair_sqlite.rs`, `local_ed25519_yao_stream.rs`, `local_ed25519_yao_worker.rs` | Same shapes, ordering, wait, and failure classes. The local coordinator dispatches A execution with B preparation. |
| Timing consumers | `packages/wallet/src/SeamsWeb/operations/registration/registrationTiming.ts`, `packages/wallet-server/src/router/domains/ed25519Yao/registration/routerAbEd25519YaoHttpRegistrationBackend.ts` | Drop `yao_router_verify_readiness`. Keep the other labels. The Gateway's retryable set and its burned mapping are unchanged. |
| Behavioral evidence | `crates/router-ab-cloudflare/scripts/test-private-d1.mjs`, `yao-peer-disconnect-evidence.mjs`, `wallet-home-placement-evidence.mjs` | Retire `forged-peer-readiness`, `invalid-acceptance`, `forged-acceptance`, and `delayed-forged-acceptance`. Add the scenarios in Phase 3. |
| Hosted acceptance | Private `seams-monorepo/tests/e2e/hosted-product/near-signing-latency.test.ts` | Repeat the same NEAR-only comparison with independent signature proofs. |
| Contracts and documentation | `docs/spec-5-router-ab-threshold-protocol.md`, `docs/router-ab/protocol.md`, `docs/router-ab/ed25519-yao.md`, `docs/router-ab/deployment.md`, the R155B follow-up paragraph, the private diagnosis pointer, and this plan | Preserve the clarified trust model. Remove peer-signing key requirements with their code consumers. Record structural and timing results separately. |

Inventory every consumer of the removed types before changing them. Classify
active registration, recovery, export, and lane paths explicitly. Update live
consumers and delete retired ones. Do not leave a compatibility path that
accepts or emits a receipt.

## Phase 1 — fix the contract

- [x] Record the current call path, type consumers, measured starting point,
  and today's failure classes.
- [x] State the trusted-organisation model in the protocol, deployment, Yao, and
  spec-5 documents. Include optional account separation and retained guarantees.
- [x] Define the claim identity without receipts: tenant root, work, input
  digest pair, execution id, and the role-local root-metadata digest. Exact
  completed replay must survive root retirement and object restart. Changed
  input, scope, or execution identity must fail.
- [x] Define the run deadline. The Router derives it from its registration
  claim lease, ten seconds by default, and `YAO_CEREMONY_TIMEOUT` (15 s),
  whichever ends first, and carries it to A and then to B. B waits for its
  preparation until that deadline. No new constant and no new environment
  variable. A slower valid preparation must not fail the ceremony.
- [x] Define B's wait mechanically. It runs inside the exact wallet object,
  re-reads that object's own storage or an in-instance notifier, yields between
  reads so the concurrent `PreparePair` request executes on the same object,
  and uses no alarm and no cross-instance state. A timeout refuses the upgrade
  before any claim. Nothing burns on B.
- [x] Define pre-claim refusal as recoverable. When B refuses before claiming
  (not prepared by the deadline, preparation failed, scope or fence mismatch),
  A releases its reservation to `Prepared` in the same request and returns
  `RecoverableFailure`. The Router leaves the claim to lapse. An exact Gateway
  retry re-runs: B's `PreparePair` replays or completes, A reserves again, and
  the ceremony succeeds. No protocol material was sent, so no execution id was
  consumed and nothing burns.
- [x] Define post-claim failure as terminal. After B claims, a disconnect,
  invalid preface, or local claim failure burns as today. A may lose the 101
  reply after B has claimed. Timeout or transport failure without that reply
  is uncertain execution and cannot release A's reservation. Use existing
  reconciliation or terminal handling. Only an authenticated refusal for the
  exact execution that establishes no B claim can permit release.
- [x] Define outcome resolution at the Router. Await both requests. A's
  execution result decides. A completed execution with a lost or failed B
  preparation reply is a success; B's sealed completion over the socket is the
  evidence. Report B's preparation error only when A also failed, and prefer
  the more specific failure.
- [x] Define late-preparation cleanup. After a terminal outcome, the Router's
  existing peer burn must leave a tombstone at B when no record exists, so a
  late `PreparePair` is refused and no root-use admission is retained. After a
  recoverable outcome, a late preparation stays for the retry and expires
  normally otherwise.
- [x] Make only the caller that wins A's durable reservation open the connection.
  A duplicate or competing A request must not start a second execution. A second
  socket for a running or terminal pair at B must be refused.
- [x] Keep role-local root-metadata validation, expiry, ownership generation,
  relocation fences, and cancellation reads at both roles. Do not compare
  digests across roles.
- [x] Account for the join explicitly: B preparation, A dispatch, A preparation,
  connect, wait, protocol, and completion. Record which side arrives first at B:
  `deriver_b.await_preparation` is emitted only when A's connection arrived
  first.

## Phase 2 — implement the concurrent dispatch

- [x] Join B preparation and A execution in the Router and await both. Resolve
  the outcome from A's result. Do not cancel either request.
- [x] Remove the peer receipt from A's request and from A's replay identity.
  Carry the run deadline. Keep A's reservation before connect and its claim on
  the 101.
- [x] Implement the release transition and the recoverable pre-claim refusal
  at A. Keep burn-on-failure for every failure after the 101.
- [x] Implement B's deadline-bounded wait and claim-then-upgrade in the wallet
  object. Recheck ownership and cancellation after each awaited operation that
  can race a fence. Preserve `PairPrepared` idempotent replay of an exact
  repeated preparation. Add the burn tombstone for a missing record.
- [x] Remove readiness signing at admission and acceptance signing at upgrade.
  Remove every verification of them at Router, A, and B.
- [x] Add a `deriver_b.await_preparation` span. Keep `deriver_a.websocket_connect`.
- [x] Retain bounded setup and protocol timeouts and socket closure for
  refusal, disconnect, and local claim failure.
- [x] Keep deferred completion and admission settlement bound to the exact
  wallet home, ownership generation, session, and physical object.

Bound-root D1 work stays at five round trips and thirteen statements. Reusing
B's freshly admitted target across its preparation and socket requests is a
separate, later, measured change. First establish the benefit of concurrent
dispatch and the simpler handshake.

A must never decrypt B's input or receive B's share. The cryptographic protocol,
the target-proof preface, and the existing encryption are unchanged.

## Phase 3 — remove obsolete paths and verify behavior

- [x] Delete the receipt and acceptance types, signers, verifiers, header
  constants, and timing labels in the same change. Update every caller, fixture
  factory, export, and native consumer. The peer-message key reads stay:
  startup validation and the ECDSA signer host use them.
- [x] Remove the retired fault scenarios. Add real Worker/DO scenarios for:
  socket before preparation, preparation before socket, preparation never
  arrives, preparation fails with a D1 error, B preparation reply lost while
  execution completes, pre-claim refusal followed by an exact retry that
  succeeds, late preparation after a terminal outcome refused and settled, late
  preparation after a recoverable refusal used by the retry, duplicate A
  request, duplicate socket, wrong scope, changed generation, disconnect before
  claim, after B claims, before A claims, during the protocol, and after B
  completes.
- [ ] Add a scenario for a mismatched role-local digest. It needs B's root to
  change between its preparation and its claim, which the harness cannot stage
  from outside the wallet object. The check itself is unchanged code.
- [x] Run existing scenarios for all four wallet homes, concurrent calls, lost
  replies, object restart, root retirement, admission settlement, cancellation,
  and exact replay after root erasure.
- [x] Verify one durable execution outcome, no reopened terminal pair, no leaked
  socket, and no retained unaccounted admission after each failure settles.
- [x] Verify affected recovery and export paths end to end. The
  intended-behaviour contracts for Yao and recovery ran against this change on
  offset local ports: 19 of 22 cases pass. They cover registration replay, a
  burned execution, recovery of Passkey-founded and Email-only wallets,
  interrupted and superseded recoveries, and the interrupted export retry.
  Three Email OTP recovery cases fail at a later Tempo signature with
  `Exact Wallet Session authorization does not bind the ECDSA signing capability`.
  They fail the same way on Worker builds of the parent commit, so this change
  does not cause them. Lane work is refused at A's wallet object as before.
  Protocol vectors and encoding contracts are unchanged.
- [x] Build the affected release Workers and run the exact-tree bloat check.
- [x] Follow-up: remove the peer-signing keys, their configuration, and the
  unused ECDSA peer-message plumbing that read them, in one change. No Worker
  or native role parses a peer-signing Secret, epoch, or verifying key. The
  direct Deriver-to-Deriver ECDSA message, its signature, both of its wire
  kinds, and its route are gone from the protocol crate, the Workers, and the
  native roles. The Router keyset no longer carries
  `signer_peer_verifying_keys`.
- [ ] Deployment follow-up in the private deployment repository, in this order:
  1. With the release that consumes this version, stop generating, requiring,
     and writing the peer-signing Secrets and verifying-key vars. In the same
     activation, drop `signer_peer_verifying_keys` from the Gateway's
     `ROUTER_AB_PUBLIC_KEYSET_JSON`: the Gateway rejects a keyset that still
     names it. Local tooling stops importing `localPeerVerifyingKeyHex`, which
     `@seams/wallet-server/local-runtime` no longer exports.
  2. Activate that release on Router, Deriver A, Deriver B, the Tenant Root
     Control Plane, and the Gateway. The new Workers ignore leftover Secrets
     and vars.
  3. Delete the `DERIVER_*_PEER_SIGNING_KEY` Secrets and the
     `DERIVER_*_PEER_SIGNING_KEY_BINDING`, `DERIVER_*_PEER_SIGNING_KEY_EPOCH`,
     and `DERIVER_*_PEER_VERIFYING_KEY_HEX` vars once no older version can be
     restored. An older version fails startup without them.

Use behavioral evidence with repeatable commands, source and build hashes, final
pair states, and independently verified signatures. Do not add tests that assert
the implementation's shape. Classify an existing test failure before changing a
fixture or production behavior.

## Phase 4 — measure on existing staging and record the decision

- [x] Freeze matching SDK, Router, A, B, Signing Worker, Gateway, Runtime, and
  Console versions. Preserve concurrent work and the Phase 6AO baseline. The
  comparison waited for Phase 6AR's hosted run to restore staging, then used the
  same baseline versions.
- [x] Settle existing ceremonies before activation. Router, A, and B change
  together: a new Router sends no receipt, a new A accepts none, and a new B
  expects no receipt header. Reject mixed versions explicitly. Add no fallback.
  No ceremony ran while the three versions were mixed.
- [x] Reuse existing staging resources within the user's $25 Cloudflare budget.
  No new Worker, object namespace, database, Container, or paid plan.
- [x] Run sequential baseline, candidate, and restored-control arms on the same
  client with three fresh implicit, unfunded NEAR wallets per arm and identical
  SDK assets.
- [x] Measure SDK registration, registration → first verified signature, Yao
  execute, B preparation, A execution, connect, `deriver_b.await_preparation`,
  protocol, finalization, and the overlap between B preparation and A execution.
  No hosted socket had to wait for B's preparation.
- [x] Record median, maximum, range, HTTP counts, and D1 round trips and
  statements. Keep subsystem D1 counts separate from totals.
- [ ] Record peer frame counts. Hosted traces do not count frames. The protocol
  code is unchanged.
- [x] Audit actual serving versions. Do not infer colocation from placement
  hints.
- [ ] Separate controlled cold runs from warm runs. No controlled cold run was
  made. Each wallet used new wallet objects on prewarmed Workers.
- [x] Verify each signature independently. Preserve sample artifacts and hashes.
- [x] Restore original assignments and placement, verify activation, and stop
  observation processes.
- [x] Record the acceptance decision and commit completed work on `dev`.

Structural acceptance targets:

| Work | Starting point | Target |
| --- | --- | --- |
| Router wait for B readiness before dispatching A | One per ceremony | Zero |
| Serial role stages before the protocol starts | Three: B preparation, A preparation, connect | Two: the longer preparation, then connect |
| Signed readiness receipts produced and verified | Two produced, verified at Router, A, and B | Zero |
| Signed start acceptances produced and verified | One | Zero |
| Router-to-role HTTP requests | Two, serial | Two, concurrent |
| Bound-root D1 work for a fresh ceremony | 5 round trips / 13 statements | Unchanged |
| B-preparation failure before protocol material | Recoverable | Recoverable |
| Secret separation between A and B | Preserved | Preserved |
| Duplicate execution after retry | Forbidden | Forbidden |

Gateway and Console call counts are comparison controls. This refactor does not
claim to remove them.

Keep a correct, simple change that demonstrably removes a serial stage even if a
small sample does not isolate a latency gain. Report slower results explicitly
and do not attribute them to the provider without evidence.

## Completion criteria

Router dispatches A and B concurrently, awaits both, and holds no readiness
exchange. Neither role signs or verifies a peer attestation. Both roles enforce
their own claims, fences, role-local root checks, and identity binding. Secret
separation is unchanged. A failed or late B preparation remains recoverable by
an exact retry. Real failure scenarios prove one durable execution outcome in
every ordering of preparation and socket arrival. Hosted traces show the removed
serial stage. The plan records measured latency, uncertainty, cleanup, and any
unmet full-flow target. No receipt, acceptance, compatibility flag, or new
infrastructure dependency remains.

## Implementation record

Phases 1–3 are implemented on public `dev` at
`580cb508017f21fafbc69ab28aebf48bffda0dbf`, on top of
`9faf702cfbc75141f49092c3dbdbb04148a2e0a6`. Phase 4 measured release builds of
that commit on staging with temporary Router, Deriver A, and Deriver B versions.
Staging serves its original versions again. Releasing the change is a separate
activation of the three roles together.

### What was built

- **Router.** One join of B's preparation and A's execution. A's answer decides
  the run. B's typed failure is reported only when A failed without a specific
  answer of its own. The run deadline is the registration claim's lease end or
  `YAO_CEREMONY_TIMEOUT` from now, whichever is first, and travels in A's
  request and then in A's connection to B.
- **Execution request.** `CloudflareEd25519YaoPairExecuteRequestV1` carries the
  pair binding, tenant root, work, A's input, and the deadline. Workers and the
  native reference use the one type. It replaces the two earlier request types.
- **Pair lifecycle.** Records carry the role-local root-metadata digest and the
  execution id, and no receipt. `release` returns a reservation to `Prepared`.
  A later preparation replaces a `Prepared` record that nothing reserved.
- **Deriver A.** It prepares inside the execution request, reserves, and
  connects. B's 101 is B's claim, and A claims after it. A typed refusal that
  names the exact execution releases the reservation. Any other failure burns
  it and tells B.
- **Deriver B.** Its wallet object claims the pair on A's connection. Without a
  preparation of the same Router run it waits, re-reading its record's revision
  every five milliseconds. It refuses with `not_prepared` at the deadline, or
  as soon as that run's preparation failed in the same object instance, and
  with `expired` when its preparation outlived its lifetime. A burn for a
  session it holds no record for leaves a burned record.
- **Run identity.** Each Router run stamps a new window into the tenant-root
  context it sends both roles. That context's outer binding names the run. B
  matches A's connection to its own preparation by it, so an earlier run's
  preparation is never claimed for a later run's connection.
- **Removed.** The readiness receipt, start acceptance, and role signature
  types, their headers, signing, and verification at Router, A, and B. The
  `router.verify_readiness_receipts` span and `yao_router_verify_readiness`
  label. The unrouted Deriver A session path that predated the wallet object,
  about 1,600 lines. The `local-intended-yao-clock-skew` build feature. The
  native receipt lifecycle module and the native Deriver A preparation route.

Mixed versions fail explicitly. An older Deriver A rejects the new request, an
older Deriver B rejects a connection without a receipt header, and a newer
Deriver B rejects a connection without the run in its scope header.

### What the baseline did

Implementation found four differences from this plan's description of the
baseline. Each changed the design.

1. **Most B-preparation failures were terminal.** The role failure mapping
   answers `Rejected` for every error it does not name, and only expiry and
   service configuration errors were recoverable. B's typed answer keeps its
   class here: a preparation B rejects ends the run as before. A failure of B's
   wallet-object command, such as a D1 error, is now recoverable, as the same
   failure at A already was.
2. **The Router never re-ran a registration.** A retry after the claim's lease
   took the claim over and answered from A's record. `Missing`, `Prepared`, and
   `Running` all answered recoverable again, so a registration that failed
   before completing could not finish. A takeover that finds `Prepared` at A
   now executes the registration: A holds a preparation nothing reserved, so no
   execution started. `Missing` and `Running` answer as before.
3. **A pair could not run twice.** A second run's tenant-root context differs
   from the first's, so a stored preparation never matched it. A later run's
   preparation now replaces an unreserved one at both roles.
4. **The peer-signing keys are not Yao-only.** Worker startup validates them
   and the ECDSA signer host loads the verifying keys. Production ECDSA
   derivation supplies no peer responses, and the peer-message signing helper
   has no caller, so nothing verifies a peer signature today. The keys and that
   plumbing are removed together in the follow-up.

A burned pair is still first reported as a recoverable service failure, as in
the baseline. The retry reads A's burned record and ends the registration.

### Native reference implementation

`router-ab-dev` follows the same shapes. Its Deriver worker serves one
connection at a time, so Deriver B sets an early connection aside and takes it
up again after each later connection, polling its listener while one waits.

Deriver A now admits its root and executes in one request there too, as on
Workers. Nothing can reach that worker between A's admission and the end of its
execution. Three native tests staged that window through the old separate
preparation request:

- The claimed-execution recovery test now fails the execution first and
  refreshes after, as the Worker scenario does.
- The paused-execution test cancels both admissions in the role stores while
  the execution is paused, in place of a refresh and retirement.
- The test that finished admitted work on its retired epoch is removed. Its
  state needs a refresh between A's admission and A's claim. Worker scenarios
  cover refresh against admitted and held work.

A repeated native B preparation is admitted again before it is answered, so
one whose admission was cancelled is still refused.

### Local evidence

| Check | Result |
| --- | --- |
| `router-ab-core` tests | All pass |
| `router-ab-cloudflare` native tests | Four test binaries fail, as on the base: ECDSA and normal-signing fixtures and source guards over files this change does not touch |
| `router-ab-dev` tests | Pass, apart from four failures present on the base. The native HTTP suite passes 34 with the same two failures as the base |
| Wasm type-check, five Worker builds | Pass |
| Release Worker builds | Five built |
| Worker and wallet-object scenarios, release builds | 24 pass |
| Fault-injection scenarios, dev builds | 3 pass: historical replay, claimed recovery, B burn before completion |
| `wallet` and `wallet-server` type-check | Pass |
| Intended-behaviour contracts, Yao and recovery files | 19 of 22 pass. Three Email OTP recovery cases fail at an ECDSA session check, as they do on the parent commit |
| Exact-tree bloat check | Pass |

The sixteen pair-connection scenarios run through
`crates/router-ab-cloudflare/scripts/yao-peer-disconnect-evidence.mjs`:

| Scenario | First run | A / B after | Exact retry |
| --- | --- | --- | --- |
| `socket-before-preparation` | succeeded; B waited 322 ms | completed / completed | — |
| `preparation-before-socket` | succeeded; B did not wait | completed / completed | — |
| `preparation-reply-lost` | succeeded | completed / completed | — |
| `duplicate-socket` | succeeded; second socket refused, untyped | completed / completed | — |
| `duplicate-execution` | succeeded; one of two requests won | completed / completed | — |
| `preparation-never-arrives` | recoverable at the deadline, `not_prepared` | prepared / missing | succeeded |
| `preparation-fails` | recoverable in 150 ms, `not_prepared` | prepared / missing | succeeded |
| `late-preparation-after-refusal` | recoverable at the deadline, `not_prepared` | prepared / prepared | succeeded |
| `changed-generation` | recoverable at the deadline, `not_prepared` | prepared / prepared | succeeded |
| `wrong-scope` | recoverable; B answered untyped | burned / prepared | refused |
| `connection-refused` | recoverable; no answer from B | burned / prepared | refused |
| `lost-upgrade-reply` | recoverable; B had claimed | burned / burned | refused |
| `protocol-disconnect` | recoverable; cut after B's second frame | burned / burned | refused |
| `cancelled-root` | recoverable; A's claim refused | burned / burned | refused |
| `missing-admission` | recoverable; A's claim refused | burned / burned | refused |
| `late-preparation-after-burn` | rejected; B refused its late preparation | burned / burned | refused |

Each released pair exchanged no protocol frame, and its retry settled both
admissions. Each burned pair opened no second connection on retry. A
preparation that failed or arrived after a burn admitted nothing at B. Another
wallet's registration completed after every scenario.

### Hosted measurement

The comparison ran on existing staging on October 9, 2026. Three fresh implicit,
unfunded NEAR wallets ran in each sequential baseline, candidate, and restored
control arm, on one client with the same SDK assets. Baseline and control are
the Phase 6AO backend that Phase 6AR also measured against. The candidate arm
replaced Router, Deriver A, and Deriver B together with release builds of
`580cb508`. Signing Worker, Gateway, Runtime, Console, and placement
settings stayed fixed. Existing ceremonies were settled before each change of
versions. Cells show the median and the observed range. Funding, broadcast, and
chain confirmation are excluded. Worker cold state was not controlled.

| Metric | Baseline | Concurrent dispatch | Restored control |
| --- | --- | --- | --- |
| SDK registration | 10.303s (8.404–11.546s) | 7.119s (6.949–9.674s) | 8.604s (8.274–8.648s) |
| Registration → independently verified signature | 13.639s (11.295–14.453s) | 10.599s (9.795–12.150s) | 11.482s (11.303–12.050s) |
| Setup HTTP | 1.182s (0.665–1.218s) | 0.843s (0.593–1.595s) | 0.650s (0.645–0.651s) |
| Respond HTTP | 0.972s (0.824–1.687s) | 0.791s (0.679–0.853s) | 0.726s (0.707–0.789s) |
| Yao execute HTTP | 4.794s (3.761–5.075s) | 2.739s (2.460–3.247s) | 3.903s (3.840–4.160s) |
| Finalize HTTP | 2.434s (2.366–2.520s) | 2.462s (2.177–3.103s) | 2.510s (2.059–2.601s) |

Router and role spans from the same wallets:

| Span | Baseline | Concurrent dispatch | Restored control |
| --- | --- | --- | --- |
| Router Yao execution | 3758 ms (2961–4260) | 2009 ms (1766–2505) | 3199 ms (3187–3396) |
| A dispatched after the execution starts | 1395 ms (739–1429) | 20 ms (16–21) | 1018 ms (728–1113) |
| B preparation, at the Router | 1207 ms (725–1283) | 770 ms (411–1189) | 1003 ms (710–1098) |
| A execution, at the Router | 2228 ms (2118–2787) | 1900 ms (1662–2352) | 2200 ms (2065–2392) |
| B preparation overlapping A execution | 0 ms (0–0) | 770 ms (411–1189) | 0 ms (0–0) |
| A preparation | 172 ms (163–179) | 154 ms (153–171) | 165 ms (159–174) |
| A connect to B | 544 ms (309–692) | 622 ms (279–726) | 388 ms (316–824) |
| Protocol, at A | 434 ms (398–461) | 404 ms (358–439) | 359 ms (336–376) |
| Protocol, at B | 325 ms (258–492) | 356 ms (253–398) | 360 ms (258–378) |
| Signing Worker delivery after the roles | 101 ms (78–104) | 89 ms (83–137) | 83 ms (79–104) |

`deriver_b.await_preparation` did not occur. B logs it only when a socket finds
its pair unprepared. In all three candidate wallets B had recorded its
preparation before A's socket arrived, so no socket waited. The local
`socket-before-preparation` scenario covers the other ordering.

| Count per wallet | Baseline | Concurrent dispatch | Restored control |
| --- | --- | --- | --- |
| Router readiness verifications | 1 | 0 | 1 |
| Router-to-B preparation requests | 1 | 1 | 1 |
| Router-to-A execution requests | 1 | 1 | 1 |
| Browser-to-Gateway requests | 8 | 8 | 8 |
| Bound-root D1 round trips | 5 | 5 | 5 |
| Bound-root SQL statements | 13 | 13 | 13 |

Bound-root counters cover the Derivers' root admission only. Total registration
D1 work is not instrumented. Peer frame counts are not recorded: hosted traces
do not count frames, and the protocol code is unchanged.

Results against the structural targets:

| Work | Target | Hosted result |
| --- | --- | --- |
| Router wait for B readiness before dispatching A | Zero | Zero. A is dispatched 16–21 ms after the execution starts, in the same instant as B |
| Serial role stages before the protocol starts | Two | Two. B preparation overlaps A's preparation and connect for 0.411–1.189s |
| Signed readiness receipts and start acceptances | Zero | Zero. The Router's verification span no longer exists |
| Router-to-role HTTP requests | Two, concurrent | Two, concurrent |
| Bound-root D1 work for a fresh ceremony | Unchanged | 5 round trips / 13 statements in every arm |

Router Yao execution measures **3.758s → 2.009s → 3.199s**. Every
candidate sample is faster than every baseline and control sample, for this span
and for the browser's Yao execute request. The candidate median is
**1.190s** below the restored control. The saving is the B
preparation that no longer precedes A. The planning hypothesis of 2.0–2.2
seconds holds for the median; the slowest candidate sample took
2.505s.

Registration to verified signature measures **13.639s → 10.599s → 11.482s**.
The control also improves on the baseline, so the baseline difference includes
run order. Against the control the candidate median is
**0.883s** lower. Three sequential samples per arm do not
establish tail percentiles or a latency guarantee. The 3–4 second
registration-to-signature target remains unmet.

Decision: keep the change. It removes the serial stage in every sample, with no
added request, D1 work, or infrastructure. Yao execution is now bounded by A's
own path. A's connect to B is the largest remaining A/B stage at
0.622s median. Finalization, setup, and respond are outside this refactor.

All six observed role streams ran only the expected versions in every arm. All
nine NEP-413 signatures pass an independent Node.js Ed25519 verifier with a
separate Borsh encoder. Altered message, recipient, nonce, and callback URL
fail. Each wallet used new wallet objects, and each Worker received prewarm
requests. No controlled cold run was made. Span start times derive from log time
minus duration, and a Worker clock advances only at I/O. Requested APAC
placement does not prove physical colocation.

All 13 original Worker assignments and placement settings were restored.
Restoration activation [37916869561](https://github.com/seams-tech/seams-monorepo/actions/runs/37916869561) passed.
All six observation processes stopped. The experiment reused existing staging
resources and created no Worker, object namespace, database, or paid plan. It
uploaded three Worker versions, which staging no longer serves: Router
`7da081d5`, Deriver A `69ba207a`, and Deriver B `398dc7d5`. The three
candidate-arm wallets hold completed pair records without receipts. The
restored code's record type requires them, so it cannot replay those three
registrations. The wallets are disposable.

[Sanitized evidence](evidence/near-registration-concurrent-pair-dispatch-20261009.json) contains all
samples, signature proofs, Router and role spans, request counts, partial D1
counts, version audits, structural checks, and source and build hashes.
Repeatable raw artifacts remain in public `.artifacts/r155c` and private
`.artifacts/r155c-hosted`.

### Not done

- **Full-flow target.** Registration to verified signature is 10.599 seconds at
  the candidate median. The 3–4 second target is unmet.
- **Release.** The measured versions are not served. Activating this change
  means Router, Deriver A, and Deriver B together, after ceremonies settle.
- **Peer frame counts and controlled cold runs.** Not recorded on staging.
- **Three Email OTP recovery contracts.** They fail at an ECDSA session check
  with and without this change. Their cause is not identified here.
- **Mismatched role-local digest.** No scenario stages it.
- **Peer-signing keys.** Removed from the code and its configuration after this
  refactor. The private deployment keeps the Secrets and vars until the
  deployment follow-up in Phase 3 completes.
