# R155C — concurrent Deriver A/B preparation under one trusted operator

Status: planned. The code inventory and the frozen baseline are recorded. No
transport implementation or live deployment is part of this planning change.
Date: October 9, 2026. Supersedes the earlier R155C draft of the same date.
Revised the same day after review: role-local digest checks, outcome-based
failure resolution, a budget-derived wait, and recoverable pre-claim refusal.

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
  start acceptance, the peer-message signing and verifying keys that exist only
  for them, and every verification of them.
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

The normative documents now state the trusted-organisation model and optional
account separation. Their key tables still describe the current runtime.
Remove peer-signing key requirements with their consumers during implementation.
Keep tenant-root lifecycle signatures, role encryption, and protocol proofs.

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

Today a B-preparation failure happens before A is dispatched and is reported as
`RecoverableFailure`. Nothing burns. This plan dispatches A concurrently, so a
failed or late B preparation now surfaces at A's connect. That failure must stay
recoverable. A burn is reserved for failures after B has claimed, when the
execution id may have been consumed.

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
until Phase 4 measures it.

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
| Environment | `crates/router-ab-cloudflare/src/env.rs`, `lib.rs`, `strict_worker/mod.rs` | Retire reads of `DERIVER_*_PEER_SIGNING_KEY_BINDING`, `*_PEER_SIGNING_KEY_EPOCH`, and `*_PEER_VERIFYING_KEY_HEX` and the validations that reference them, once no reader remains. Tenant-root role signing keys are separate and stay. |
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
- [ ] Define the claim identity without receipts: tenant root, work, input
  digest pair, execution id, and the role-local root-metadata digest. Exact
  completed replay must survive root retirement and object restart. Changed
  input, scope, or execution identity must fail.
- [ ] Define the run deadline. The Router derives it from its registration
  claim lease, ten seconds by default, and `YAO_CEREMONY_TIMEOUT` (15 s),
  whichever ends first, and carries it to A and then to B. B waits for its
  preparation until that deadline. No new constant and no new environment
  variable. A slower valid preparation must not fail the ceremony.
- [ ] Define B's wait mechanically. It runs inside the exact wallet object,
  re-reads that object's own storage or an in-instance notifier, yields between
  reads so the concurrent `PreparePair` request executes on the same object,
  and uses no alarm and no cross-instance state. A timeout refuses the upgrade
  before any claim. Nothing burns on B.
- [ ] Define pre-claim refusal as recoverable. When B refuses before claiming
  (not prepared by the deadline, preparation failed, scope or fence mismatch),
  A releases its reservation to `Prepared` in the same request and returns
  `RecoverableFailure`. The Router leaves the claim to lapse. An exact Gateway
  retry re-runs: B's `PreparePair` replays or completes, A reserves again, and
  the ceremony succeeds. No protocol material was sent, so no execution id was
  consumed and nothing burns.
- [ ] Define post-claim failure as terminal. After B claims, a disconnect,
  invalid preface, or local claim failure burns as today. A may lose the 101
  reply after B has claimed. Timeout or transport failure without that reply
  is uncertain execution and cannot release A's reservation. Use existing
  reconciliation or terminal handling. Only an authenticated refusal for the
  exact execution that establishes no B claim can permit release.
- [ ] Define outcome resolution at the Router. Await both requests. A's
  execution result decides. A completed execution with a lost or failed B
  preparation reply is a success; B's sealed completion over the socket is the
  evidence. Report B's preparation error only when A also failed, and prefer
  the more specific failure.
- [ ] Define late-preparation cleanup. After a terminal outcome, the Router's
  existing peer burn must leave a tombstone at B when no record exists, so a
  late `PreparePair` is refused and no root-use admission is retained. After a
  recoverable outcome, a late preparation stays for the retry and expires
  normally otherwise.
- [ ] Make only the caller that wins A's durable reservation open the connection.
  A duplicate or competing A request must not start a second execution. A second
  socket for a running or terminal pair at B must be refused.
- [ ] Keep role-local root-metadata validation, expiry, ownership generation,
  relocation fences, and cancellation reads at both roles. Do not compare
  digests across roles.
- [ ] Account for the join explicitly: B preparation, A dispatch, A preparation,
  connect, wait, protocol, and completion. Record which side arrives first at B.

## Phase 2 — implement the concurrent dispatch

- [ ] Join B preparation and A execution in the Router and await both. Resolve
  the outcome from A's result. Do not cancel either request.
- [ ] Remove the peer receipt from A's request and from A's replay identity.
  Carry the run deadline. Keep A's reservation before connect and its claim on
  the 101.
- [ ] Implement the release transition and the recoverable pre-claim refusal
  at A. Keep burn-on-failure for every failure after the 101.
- [ ] Implement B's deadline-bounded wait and claim-then-upgrade in the wallet
  object. Recheck ownership and cancellation after each awaited operation that
  can race a fence. Preserve `PairPrepared` idempotent replay of an exact
  repeated preparation. Add the burn tombstone for a missing record.
- [ ] Remove readiness signing at admission and acceptance signing at upgrade.
  Remove every verification of them at Router, A, and B.
- [ ] Add a `deriver_b.await_preparation` span. Keep `deriver_a.websocket_connect`.
- [ ] Retain bounded setup and protocol timeouts and socket closure for
  refusal, disconnect, and local claim failure.
- [ ] Keep deferred completion and admission settlement bound to the exact
  wallet home, ownership generation, session, and physical object.

Bound-root D1 work stays at five round trips and thirteen statements. Reusing
B's freshly admitted target across its preparation and socket requests is a
separate, later, measured change. First establish the benefit of concurrent
dispatch and the simpler handshake.

A must never decrypt B's input or receive B's share. The cryptographic protocol,
the target-proof preface, and the existing encryption are unchanged.

## Phase 3 — remove obsolete paths and verify behavior

- [ ] Delete the receipt and acceptance types, signers, verifiers, header
  constants, timing labels, and the peer-message key reads in the same change.
  Update every caller, fixture factory, export, and native consumer.
- [ ] Remove the retired fault scenarios. Add real Worker/DO scenarios for:
  socket before preparation, preparation before socket, preparation never
  arrives, preparation fails with a D1 error, B preparation reply lost while
  execution completes, pre-claim refusal followed by an exact retry that
  succeeds, late preparation after a terminal outcome refused and settled, late
  preparation after a recoverable refusal used by the retry, duplicate A
  request, duplicate socket, wrong scope, changed generation, mismatched
  role-local digest, disconnect before claim, after B claims, before A claims,
  during the protocol, and after B completes.
- [ ] Run existing scenarios for all four wallet homes, concurrent calls, lost
  replies, object restart, root retirement, admission settlement, cancellation,
  and exact replay after root erasure.
- [ ] Verify one durable execution outcome, no reopened terminal pair, no leaked
  socket, and no retained unaccounted admission after each failure settles.
- [ ] Verify affected recovery, export, and lane paths and the native HTTP
  behavior. Preserve protocol vectors and encoding contracts.
- [ ] Build the affected release Workers and run the exact-tree bloat check.
- [ ] Deployment follow-up in the private deployment repository: remove the
  peer-signing Secrets and verifying-key vars only after an activation of code
  that no longer reads them.

Use behavioral evidence with repeatable commands, source and build hashes, final
pair states, and independently verified signatures. Do not add tests that assert
the implementation's shape. Classify an existing test failure before changing a
fixture or production behavior.

## Phase 4 — measure on existing staging and record the decision

- [ ] Freeze matching SDK, Router, A, B, Signing Worker, Gateway, Runtime, and
  Console versions. Preserve concurrent work and the Phase 6AO baseline.
- [ ] Settle existing ceremonies before activation. Router, A, and B change
  together: a new Router sends no receipt, a new A accepts none, and a new B
  expects no receipt header. Reject mixed versions explicitly. Add no fallback.
- [ ] Reuse existing staging resources within the user's $25 Cloudflare budget.
  No new Worker, object namespace, database, Container, or paid plan.
- [ ] Run sequential baseline, candidate, and restored-control arms on the same
  client with three fresh implicit, unfunded NEAR wallets per arm and identical
  SDK assets.
- [ ] Measure SDK registration, registration → first verified signature, Yao
  execute, B preparation, A execution, connect, `deriver_b.await_preparation`,
  protocol, finalization, and the overlap between B preparation and A execution.
- [ ] Record median, maximum, range, HTTP counts, peer frame counts, and D1
  round trips and statements. Keep subsystem D1 counts separate from totals.
- [ ] Audit actual serving versions. Separate controlled cold runs from warm
  runs. Do not infer colocation from placement hints.
- [ ] Verify each signature independently. Preserve sample artifacts and hashes.
- [ ] Restore original assignments and placement, verify activation, and stop
  observation processes.
- [ ] Record the acceptance decision and commit completed work on `dev`.

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
