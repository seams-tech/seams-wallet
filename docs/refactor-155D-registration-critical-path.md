# R155D — the registration-to-first-signature critical path

Status: plan. Nothing is implemented. Date: October 9, 2026. Written after
R155C's hosted measurement, from the same staging traces, three code traces,
and the Cloudflare placement and database settings read on this date.

## Objective and relationship to R155B and R155C

Bring NEAR-only registration followed by the first independently verified
NEP-413 signature below 3–4 seconds as measured inside the SDK, with 1–2
seconds preferred. Today the hosted flow measures **10.6 s** with the R155C
backend and the accepted Phase 6AM SDK, and **11.5 s** with the Phase 6AR SDK
and Gateway on the older backend. No run has combined both. The combination is
estimated near **10 s**; Phase 0 measures it.

[R155B](refactor-155B.md) owns Gateway, Console, and SDK request reductions
through Phase 6AR and the regional-execution design rules. [R155C](refactor-155C-yao-peer-connection.md)
removed the serial Deriver A/B stage and recorded a 2.0 s Router Yao
execution. This plan takes the measured remainder across every component. It
keeps R155B's design rules and R155C's trust model. It records its own
implementation and evidence here.

The flow is eight browser requests in series, six of them before the first
signature can start. No single stage dominates any more: Yao execute and
finalization each hold about a quarter, the first signature and the setup pair
about a sixth each. The fastest observed sample of every request still adds up
to 7.5 s. Tuning stages alone cannot reach the target; round trips must merge
or overlap, and the per-hop platform costs that repeat in every stage must fall.

## Frozen starting evidence

Two hosted comparisons on October 9, three fresh implicit, unfunded NEAR wallets
per arm, one client machine in Tokyo:

| Browser stage, medians | R155C candidate (6AM SDK, concurrent A/B) | Phase 6AR candidate (6AR SDK, serial A/B) |
| --- | ---: | ---: |
| Setup | 0.843 s | 0.906 s |
| WebAuthn registration | 0.12 s | 0.13 s |
| Respond | 0.791 s | 0.720 s |
| Yao execute | 2.739 s | 3.993 s |
| Finalize | 2.462 s | 2.234 s |
| Session status | 2 × 0.26 s | 1 × 0.14 s |
| Gap before sign prepare | 0.67 s | 0.71 s |
| Sign prepare | 0.444 s | 0.425 s |
| Sign | 0.849 s | 0.875 s |
| Tail after sign | 0.59 s | 0.62 s |
| Registration → verified signature | **10.599 s** | **11.532 s** |

Evidence: [concurrent pair dispatch](evidence/near-registration-concurrent-pair-dispatch-20261009.json)
and [shared observation](evidence/near-registration-shared-observation-20261009.json).
Raw traces: private `.artifacts/r155c-hosted` and `.artifacts/r155b-phase6ar-hosted`.

### What the harness adds

The browser harness contributes about **1.15 s** that no user sees and no SDK
code spends: 0.23–0.24 s before setup, a 0.37 s automation drain after
registration, a 0.40 s drain after signing, and a 0.15 s settlement wait with
a fixed 100 ms sleep. The confirmation modal's click costs about 0.30 s under
automation and more for a person. WebAuthn costs 0.12–0.13 s. These numbers are
the SDK trace's p50 values across the October hosted runs; the registration
benchmark records none of them. The SDK-measured flow is therefore about
**9 s** today, with 0.4–0.5 s of user interaction inside it.

### Where the server time goes

Candidate-arm medians from the R155C traces, reconstructed per wallet across all
six Workers. Clocks in Workers advance only at I/O, so CPU is invisible to
application spans and is charged to whichever span is open at the next await.

| Observation | Median | Range |
| --- | ---: | ---: |
| Fresh Deriver A wallet object: startup request → object constructed | 959 ms | 905–1,195 ms |
| Fresh Deriver B wallet object: same | 848 ms | 743–979 ms |
| Fresh Signing Worker wallet object: same | 883 ms | 643–942 ms |
| A's execute request waited for its object | 117 ms | 14–445 ms |
| Router wallet object constructed inside Yao execute | 339 ms | 176–418 ms |
| Router handler start → registration claim handler, Yao execute | 436 ms | 434–472 ms |
| Router handler start → consume handler, finalize, warm object | 445 ms | 348–563 ms |
| Signing Worker sign handler → wallet object handler, warm object | 516 ms | 400–637 ms |
| Signing Worker sign/prepare handler → wallet object handler | 16 ms | 13–708 ms |
| Deriver B socket handler → B object socket handler | 518 ms | 151–691 ms |
| Deriver A object: provider wall minus logged spans | 470 ms | — |
| Deriver A object CPU per execution | 317 ms | 294–513 ms |
| Deriver B object CPU per socket | 335 ms | 314–336 ms |
| Bound-root D1 round trip, initial read / batch | 77 / 85 ms | 71–88 ms |
| Gateway work before calling the Router: sign prepare / sign / finalize | 290 / 194 / 250 ms | — |
| Finalize `near_finalize_side_effect` | 1,647 ms | 1,587–2,186 ms |

Inside the Router and Deriver objects, the claim, finish, and consume commands
perform five storage reads and one or two writes each; Phase 6E measured their
invocations at 46–75 ms wall and 3–22 ms CPU. The 0.35–0.45 s that precedes
the claim and consume handlers, and the sign handler's 0.5 s before its object,
sit between the stateless Worker's `stub.fetch` and the object invocation. Phase
6L showed warm calls at 51–67 ms, and first probes at 471–655 ms. The mechanism
is not visible in code.

### Where the components run

| Component | Placement | Source |
| --- | --- | --- |
| Browser and ingress | Tokyo (NRT) | Tail `cf.colo` |
| Gateway Workers | Targeted `aws:ap-east-1` | Deployment settings |
| Console Worker | Targeted `aws:ap-northeast-1` | Deployment settings |
| Router, Deriver A, Deriver B, Signing Worker | No placement; they run with their caller | Deployment settings; inferred |
| Custody wallet objects | `apac` hint; observed in HKG | Phase 6 location probe, 2026-10-07 |
| Every D1 database, Gateway and roles | `running_in_region: APAC`, named `nrt` | Cloudflare API |

If the Gateway and roles execute in Hong Kong while every database sits in
Tokyo, each D1 round trip crosses between them. Finalize makes fifteen to
twenty, sign prepare five to six, respond eight to ten, and each Deriver's
admission two.
The observed 70–90 ms per bound-root round trip is consistent with that
geometry and is not consistent with a database in the same location. Phase 0
measures it directly before anything is moved.

## Trust model and invariants that constrain this plan

The R155C trust model stands: one organisation operates both Derivers, secret
separation between roles is preserved, and authenticated internal calls carry
authority. R155B's design rules stand, in particular:

- Regional checks enforce current authorization, deployment admission,
  ownership, budgets, and one-use material. A cached response cannot preserve
  immediate retirement. Combine predicates with existing transactions instead
  of adding or caching round trips (rules 3 and 4).
- Shared credential claims happen where their inputs become available.
  Registration success requires the ownership and discovery records needed for
  later access. Local pending state stays invisible until one exact publication
  succeeds (rules 5 and 6).
- Registration commits its session locally, then completes the home in one
  Console request, which atomically commits the home and display row. The
  Gateway acknowledges completion before it enables signing. A lost reply is
  reconciled with the original session digest; exact retries reuse the
  ceremony and idempotency key ([intended behaviours](intended-behaviours.md)).
- Sign prepare enforces current revocation, expiry, and quota. Finalize
  requires an admitted prepare for the exact operation. Quota is finalized
  exactly once. Removing a protocol round from the Ed25519 signing lane requires
  separate cryptographic design and verification
  ([optimization 11](optimization-11-NEAR.md)).
- No compatibility switch, second authority path, or disposable-test
  assumption. One final implementation per change.

## Analysis of each stage

Each stage lists what was measured, the cause the code shows, the change, the
expected effect, and what must not regress. Expected effects are hypotheses
from the measured parts; they are not additive guarantees.

### 1. Yao execute request — 2.74 s browser, 2.01 s Router

Measured parts, candidate medians: Gateway before the Router 60 ms;
`router.parse_and_authorize` 510 ms, almost all of it the registration claim's
436 ms dispatch; Deriver A execution 1,900 ms; Deriver B preparation 770 ms,
fully overlapped; Signing Worker delivery 89 ms; Gateway result reconstruction
about 100 ms. Inside A: 117 ms waiting for its own object, 154 ms of two D1
round trips, 622 ms to connect, of which 151–691 ms is B's socket handler
reaching B's object, 404 ms of protocol, and about 470 ms the spans do not
cover: the target-proof exchange that waits for B's post-upgrade D1 read
(about 137 ms), then output sealing, record persistence, and the reply's
output gate after A's last I/O (about 330 ms, including CPU).

Causes:

- Four fresh wallet objects take 0.65–1.2 s each to come up. The startup
  request fires from respond; A's object becomes ready 14–445 ms after A's
  execute arrives, and the Router's own object is constructed inside the
  execute request. Each object's constructor and startup handler do only
  schema statements, so the time is placement and isolate startup. Deriver
  modules are 15.5 MB of WebAssembly.
- The first object call in a Router invocation costs 0.35–0.45 s against 55 ms
  for the next call in the same invocation (Phase 6E, 6L, and this run).
- B's stateless socket handler and the Signing Worker's sign handler show the
  same first-call shape.
- Two D1 round trips per Deriver admission at 70–90 ms each.
- A's post-protocol work: HPKE seal, three SQLite statements, one deferred D1
  statement, and an output gate before the reply.

Changes:

- Start all four wallet objects at setup, not respond. Setup already knows the
  reserved wallet and home; respond fixes the ownership generation that names
  each object. Make the generation available at setup for a fresh wallet, or
  derive the object name from the reservation, so the startup request can go
  out 0.9–1.5 s earlier. Keep the startup grant-free and storage-free.
- Resolve or circumvent the first-call dispatch cost: see Phase 1. If it cannot
  be removed, restructure so the Yao execute makes one object call on its
  critical path instead of three: claim at the Router, execute at A, and B's
  socket.
- Co-locate the roles' D1 with the roles: Phase 1.
- Keep the R155C dispatch shape. Do not move B's preparation onto A's
  connection; Phase 6AD and the first R155C draft showed why.

Expected: 0.3–0.6 s from earlier startup; up to 0.4 s from the Router claim
dispatch; 0.1–0.3 s from D1 placement. The 1,900 ms A execution has a floor
near 1.0–1.2 s of CPU, protocol, and one connect with the present circuit.

Must not regress: one durable execution per pair, exact replay after lost
replies, refusal before claim, ownership fences, and the output-gate ordering
that makes a persisted claim precede protocol material.

### 2. Finalize request — 2.46 s browser, 1.97 s service

Measured parts: Gateway prefix with two D1 reads and local admission, about
250 ms before the Router consume; `near_finalize_side_effect` 1,647 ms; home
completion 306 ms; about 490 ms outside the service in the Gateway. The side
effect is serial: a journal read, two ceremony reads, two founding-identity
reads, a journal claim write, the Router consume at 570 ms, of which 445 ms is
the dispatch to a warm object, a lifecycle-decision read, relay persistence at
371 ms with the Console passkey claim in parallel, capability install and
custody commit in parallel at 275 ms, session issue at 429 ms with two reads,
a generation write, a Console publication, and a commit, then the journal
completion write. Home completion adds two D1 batches around the Console
completion. The Phase 6AR Gateway folds session publication into completion
and drops one identity read; it still measures 2.2 s.

Causes: fifteen to twenty D1 round trips in series at remote-database latency,
three Console calls in series, one Router dispatch with the 0.45 s first-call
cost, and reads whose inputs were known before the previous step finished.

Changes:

- Issue the Router consume, the Console passkey claim, the lifecycle-decision
  read, and the ceremony and founding-identity reads concurrently; they depend
  only on the authenticated finalize request and the journal claim.
- Collapse the four write phases into one or two D1 batches: wallet and
  founding rows, custody outcome, capability install, session issuance and
  commit, journal completion. They write the same database. The journal's
  claim rides with the first batch and its completion with the last.
- Keep the order the specification requires: local session commit, then one
  Console completion that carries the session and lifecycle routes, then the
  acknowledgement. Fold `publish-routes` into `complete` if Console can commit
  routes and home atomically; otherwise keep it parallel to the commit batch.
- Move the Console passkey claim to respond, where the credential first
  exists, only if the claim's expiry and cancellation semantics tolerate a
  registration that never completes. Decide this in Phase 2 with the Console
  owner; it is not assumed.
- Remove the duplicate reads: the ceremony is read twice and the founding
  identity up to three times.

Expected: 2.2 s → 0.8–1.2 s. The remaining floor is one Router dispatch, one
write batch, one Console completion, and the Gateway prefix.

Must not regress: idempotent exact retry under the same key, credential-free
replay after a lost reply, atomic Console completion, pending state invisible
until publication, definitive cancellation before deletion.

### 3. First signature — 1.64 s: prepare 0.44 s, sign 0.85 s, 0.30 s to click

Measured parts: the Gateway spends 290 ms before the Router on prepare and 194
ms on sign, in five to six serial D1 round trips for session admission, signer
read, shared-capability load, policy read, operation admission, and pinned
scope; the Router proxies in about 110 ms; the Signing Worker's sign handler
spends 516 ms before its object command, against 16 ms on prepare; the object
commands take 64–84 ms; the Gateway then awaits a D1 completion write before
replying. The client share depends on prepare's server commitments, so the two
requests cannot merge without a protocol change. No code sends prepare before
the confirmation click.

Changes:

- Batch the Gateway's authorization reads into one D1 round trip per request
  and return the pinned scope from the admission write's read-back.
- Trace the Signing Worker's sign handler before its object command: terminal
  replay lookup, retirement check, and effect claim run before the object call.
  Fold what the object already enforces into the object command, or batch the
  role-private D1 work into one round trip.
- Send prepare while the confirmation modal is open, bound to the exact digest
  the modal shows, and release the admitted operation if the user declines.
  The prepare response already carries session status, so no status read
  follows. Prepare's revocation, expiry, and quota checks keep their timing
  guarantees because they run at prepare.
- Treat a one-request signature as a separate cryptographic design: server
  commitments issued ahead of the message, bound to the Wallet Session and
  delivered with the finalize seal, plus an admit-and-sign route. Record it as
  a follow-up with its own verification. Do not implement it here.

Expected: 0.3–0.5 s from batching and the Signing Worker pre-object work; up to
0.3 s hidden behind the click in product, and about 0.3 s in the benchmark.

Must not regress: exact-operation finalize, one-use admission, quota finalized
once, retired-session refusal as 401, and the displayed digest equal to the
prepared digest.

### 4. Setup and respond — 1.63 s

Measured parts, setup: two Console calls in series, registration context then
reservation, three serial D1 round trips for the ceremony read and two inserts,
and local signing. Respond: the Gateway prefix with two D1 reads and a Console
`registration-home` lookup, a ceremony read, WebAuthn verification, a duplicate
passkey read, home admission with a read and a batch, a registration load, a
Console tenant-root lineage read, a partitioned commit with a re-read and a
batch, and a ceremony compare-and-swap. Everything is serial. The Router
startup request is correctly backgrounded.

Changes:

- Setup: one Console request that resolves the registration context and
  reserves the wallet, if Console can keep its publishable-key, origin, and
  environment checks inside that request; one D1 batch for both inserts.
- Respond: run home admission and the tenant-root lineage read alongside
  WebAuthn verification, since their inputs come from the ceremony's prepared
  context; drop the partitioned store's re-read when the caller just loaded
  the same records; merge the commit and the ceremony compare-and-swap into one
  batch; reuse the routing read instead of re-reading the generation row.
- Hosted deployments resolve the registration home locally after respond; the
  `registration-home` Console call on respond is the only one left on this
  path. Keep it unless Phase 0 shows the local row can be written at setup.

Expected: setup 0.85 → 0.5 s; respond 0.75 → 0.4 s.

Must not regress: fresh publishable-key and environment validation at setup,
reservation authority, duplicate passkey refusal, one-use setup replay rules,
and the local `registering` row that makes later continuations local.

### 5. Session status — 0.52 s with the 6AM SDK, 0.14 s with the 6AR SDK

Measured: Phase 6AQ reduced two reads to one. The remaining read seeds the
local observation that the first signature's lane discovery reuses. The
finalize response already carries the established session: session id, quota,
remaining uses, expiry, and the public session. `WalletSessionStatusReadScope.fromRegistration`
builds an active observation from it with no network, and only the ECDSA
prefill uses it.

Change: seed the post-registration observation from the finalize response for
the NEAR-only path. Sign prepare still enforces current server state, and
explicit `getSession` and `refreshSession` still read fresh status. The
iframe protocol does not change shape; the host observer gains a supplied
observation for the registration case.

Expected: 0.14–0.44 s and one IPC round trip. Browser requests fall to six.

Must not regress: a lock, selection change, or authority change during the
observation still discards it; later explicit reads stay fresh.

### 6. Client and harness time — about 1.6 s

Measured: 0.23 s before setup, 0.12 s WebAuthn, about 60 ms between the other
registration requests, 0.37 s harness drain after registration, 0.30 s from
the signing call to prepare including the click, 0.40 s harness drain after
signing, 0.15 s settlement, and Node-side verification. The NEP-413 path emits
no timing stage before prepare, so its 0.3 s is not split.

Changes:

- Measure the target inside the page: `performance.now()` from the
  `registerWallet` call to the returned signature, published with the existing
  `near_registration_timing` events. Report harness automation, WebAuthn, and
  the confirmation click as separate rows. The 3–4 s target applies to the
  SDK-measured number without the user's interaction time.
- Remove the fixed sleeps and the per-iteration drain from the measured window
  in `harness.ts`; verify signatures after the timer stops.
- Add `ed25519_signing_timing` stages before prepare on the message path:
  lane discovery, planning, confirmation, and prepare-body construction.

Expected: 1.1 s leaves the metric; it was never product time. The SDK's own
inter-request work stays below 0.1 s.

## Target flow

| Step | Today | Target |
| --- | --- | --- |
| Browser requests before the first signature result | 7 (6AR SDK) | 5: setup, respond, Yao execute, finalize, sign; plus prepare sent during confirmation |
| Session status reads after registration | 1 | 0 |
| Console requests per registration | 7 | 5 or fewer: context-and-reserve, registration-home, lineage, claim, complete |
| D1 round trips in finalize | 15–20 in series | 4–6, most concurrent |
| D1 round trips in sign prepare before the Router | 5–6 | 1–2 |
| Wallet objects constructed on the Yao execute's critical path | 1 (Router), plus 0–445 ms waiting for A | 0 |
| First-call object dispatches on the critical path | 4: claim, consume, B socket, Signing Worker sign | 0 if Phase 1 resolves the cost; otherwise 1 per request |
| Components in one location with their databases | No | Yes, measured |

Estimated savings if every item lands, against the 9 s SDK-measured flow:
placement 0.6–1.0 s, object startup at setup 0.3–0.6 s, finalize restructure
0.8–1.2 s, dispatch cost 0.8–1.2 s if resolved, signing path 0.3–0.5 s, setup
and respond 0.6–0.8 s, status read 0.15–0.4 s, prepare during confirmation up
to 0.3 s. That is 3.8–6.0 s, leaving 3–5 s. The 3–4 s target needs the
dispatch cost resolved and finalize restructured. The 1–2 s preference needs
the two follow-up designs: finalize folded into the Yao execute response and a
one-round signature. Neither is in this plan's scope.

## Required code inventory

Paths are relative to the public repository unless marked private.

| Area | Files | Required change |
| --- | --- | --- |
| Gateway entry, private | `packages/wallet-console-server-ts/src/router/cloudflare/d1GatewayWorker.ts`, `tenantDeployment/regionalAdmission.ts`, `walletPlacement/regionalDispatch.ts`, `localSessionRouting.ts`, `gatewaySession.ts` | Fold the per-request admission read and the routing reads into each handler's first D1 batch; stop reading the credential twice on session routes |
| Console placement service, private | `walletPlacement/service.ts`, `serviceClient.ts`, `registrationAdmission.ts` | Combined context-and-reserve request; completion that carries routes; claim lifetime semantics |
| Deployment placement, private | `deployment/wallet-system/targets.json`, render scripts, Worker and D1 settings | One location for Gateway, roles, objects, and databases, chosen from Phase 0 measurements |
| Registration setup and respond | `packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletRegistrationSetupExecution.ts`, `d1RegistrationCeremonyStore.ts`, `d1WalletRegistrationService.ts` (respond), `d1WalletExecutionAuthority.ts`, `d1Ed25519YaoProductRegistrationPartitionedStateStore.ts`, `routerAbEd25519YaoProductRegistrationRequestScopedRuntime.ts`, `hosted-wallet-gateway.ts` (startup) | Batch and overlap; startup at setup; generation known at setup |
| Finalize | `d1WalletRegistrationService.ts` (finalize and `executeWalletRegistrationFinalize`), `routerAbEd25519YaoRegistrationSideEffectBoundary.ts`, `d1WalletRegistrationCommitStore.ts`, `walletRegistrationEstablishedSessionIssuer.ts`, `authorization/service.ts`, `d1WalletExecutionAuthority.ts` (completion) | Concurrent reads, one or two write batches, journal folded in, duplicate reads removed |
| Signing routes | `router/transport/fetch/routes/thresholdEd25519.ts`, `routerAbEd25519NormalSigningRoute.ts`, `signingPrepareSession.ts`, `d1RouterAbNormalSigningAdmissionStore.ts` | One authorization batch; pinned scope from the admission read-back |
| Session status | `router/transport/fetch/routes/sessions.ts`, `d1AuthorizationStore.ts` | Unchanged server contract; fewer callers |
| SDK registration and session | `packages/wallet/src/SeamsWeb/operations/registration/registration.ts`, `core/rpcClients/relayer/walletSessionAuthorizationStatus.ts`, `SeamsWeb/walletIframe/host/sessionObserver.ts`, `walletIframe/coordinator.ts`, `operations/registration/registrationTiming.ts` | Registration-seeded observation; in-page end-to-end timer |
| SDK signing | `core/signingEngine/flows/signNear/shared/signatureOnlySigning.ts`, `ed25519YaoNormalSigning.ts`, `session/operationState/trace.ts`, `uiConfirm/handlers/determineConfirmationConfig.ts` | Prepare during confirmation with release on decline; message-path timing stages |
| Router | `crates/router-ab-cloudflare/src/router_coordinator.rs`, `durable_object/router_wallet.rs`, `router_wallet.rs`, `wallet_home.rs`, `durable_object/wallet_startup.rs`, `strict_worker/router.rs` | Dispatch experiments; one object call per request where possible |
| Deriver A and B | `durable_object/deriver_a_pair.rs`, `deriver_b_pair.rs`, `ed25519_yao_lifecycle.rs`, `ed25519_yao_lifecycle/deriver_b_start.rs`, `ed25519_yao_websocket.rs`, `tenant_root_role_d1/bound_share.rs` | Post-protocol work after the reply where durability allows; B socket forwarding cost; D1 placement |
| Signing Worker | `lib.rs` (normal signing handler), `durable_object/signing_worker_wallet.rs` | Pre-object work folded into the object command or batched |
| Harness | `tests/e2e/intended-behaviours/harness.ts`, `signing-timing-evidence.ts`; private `tests/e2e/hosted-product/near-signing-latency.test.ts` | Automation outside the measured window; separate rows |
| Contracts | `docs/intended-behaviours.md`, `docs/router-ab/deployment.md`, this plan, [R155B](refactor-155B.md) | State the measurement contract, placement requirements, and any changed registration ordering |

Inventory every reader of a removed read or moved call before changing it.
Delete replaced code in the same change. Add no flag, cache, or second path.

## Phase 0 — measurement contract and geography

- [ ] Freeze a combined candidate: R155C backend `580cb508` with the Phase 6AR
  SDK and Gateway. Measure it as the baseline of this plan with the existing
  three-arm protocol. Record the SDK-measured number and the harness rows
  separately from the first run on.
- [ ] Add the in-page timer and the message-path signing stages. Move
  automation drains, fixed sleeps, and Node verification outside the measured
  window. Verify that the harness still clicks the modal and verifies every
  signature.
- [ ] Observe execution location for every context in one registration:
  Gateway, Router, each Deriver Worker, each wallet object, Signing Worker, and
  Console, using the existing outbound trace probe. Measure D1 round-trip time
  from the Gateway and from each role with a trivial statement. Record the
  databases' physical regions from the API. Do not infer colocation from hints.
- [ ] Reproduce the first-call object dispatch cost with real commands on one
  wallet: claim, consume, B socket, and Signing Worker sign, within one
  invocation and across invocations, with the caller's location recorded.
  Compare a Worker placed with the object. Keep Phase 6L's probe harness.
- [ ] Count D1 round trips and statements per request in the Gateway with the
  existing timing wrappers, so later phases can show reductions.

Exit: one evidence file with the combined baseline, the location map, D1
latency per location, and the dispatch-cost matrix.

## Phase 1 — placement and startup

- [ ] Put the Gateway, the roles, the wallet objects, and the databases in one
  location, chosen from Phase 0. If the databases cannot move, move the Workers
  and the object hint to the databases. Preserve the four regional homes'
  semantics; this changes where APAC executes, not what a home means.
- [ ] Start all four wallet objects at setup. Fix the ownership generation for
  a fresh wallet at setup, or name the startup by reservation. Keep startup
  grant-free and storage-free. Verify immediate execution, lost startup replies,
  exact retries, and wrong-home refusal through the four-home E2E.
- [ ] Act on the dispatch matrix. If placement removes the first-call cost,
  record it and stop. If not, restructure the Router's execute so the claim is
  the only object call before dispatch and the consume rides on the finalize's
  first call; and give B's socket forwarding and the Signing Worker's sign
  handler the same treatment.
- [ ] Measure Yao execute, finalize, and sign against the Phase 0 baseline
  with everything else fixed.

## Phase 2 — Gateway round trips

- [ ] Fold the deployment-admission read and the routing reads into each
  handler's first batch. Immediate retirement semantics stay: the predicate is
  evaluated in the same transaction as the work it guards.
- [ ] Setup: combined Console context-and-reserve, one insert batch.
- [ ] Respond: overlap home admission and the lineage read with WebAuthn
  verification; one commit batch; no re-read after load.
- [ ] Finalize: concurrent consume, claim, and reads; one or two write batches
  including the journal; routes carried by completion; duplicate reads removed.
  Decide the passkey claim's placement with the Console owner and record the
  reason.
- [ ] Sign prepare and sign: one authorization batch; pinned scope from the
  read-back; completion write ordered after the response where the
  specification allows, or kept before it with the reason recorded.
- [ ] Verify through the existing registration, lost-reply, cancellation,
  quota, retirement, and relocation contracts. Add scenarios only for new
  orderings: finalize with the Console claim failing after the consume,
  finalize retry after a lost reply with the merged batch, and decline after
  an early prepare.

## Phase 3 — browser round trips

- [ ] Seed the post-registration session observation from the finalize
  response on the NEAR-only path. Remove the status read it replaces. Keep
  explicit reads fresh.
- [ ] Send sign prepare during confirmation, bound to the displayed digest,
  with release on decline. Keep the warm-session path free of WebAuthn.
- [ ] Record the two follow-up designs with their constraints: finalize folded
  into the Yao execute response, and a one-round signature. Neither starts here.

## Phase 4 — custody path remainder

- [ ] Trace the Signing Worker's sign handler before its object command and
  remove or batch the role-private D1 work that the object already enforces.
- [ ] Measure Deriver A's post-protocol work: output seal, record write,
  deferred D1 settle, output gate. Return the reply before non-essential
  durable work only where one durable execution outcome is preserved; record
  which writes must precede the reply.
- [ ] Measure B's socket forwarding from the stateless handler to the object
  and apply the Phase 1 dispatch result.
- [ ] Record the CPU floor of the Ed25519 Yao circuit per role. A smaller
  circuit is outside this plan.

## Phase 5 — verify and measure

- [ ] Run the intended-behaviour contracts for registration, recovery, export,
  signing, Email OTP, and relocation against the combined change.
- [ ] Run the Worker and wallet-object scenarios from R155C and the four-home
  placement E2E.
- [ ] Measure on staging with the R155C protocol: baseline, candidate,
  restored control; three fresh wallets each; versions audited; signatures
  verified independently; originals restored. Report the SDK-measured number,
  the harness rows, request and round-trip counts, and the location map.
- [ ] Record the decision here and commit on `dev` in both repositories.

## Structural acceptance targets

| Work | Starting point | Target |
| --- | --- | --- |
| Browser requests to the first signature result | 7 | 5 |
| Session status reads after registration | 1 | 0 |
| Wallet objects constructed on the Yao execute path | 1 plus waiting | 0 |
| First-call object dispatches on the critical path | 4 | 0, or 1 per request with the cost measured |
| Finalize D1 round trips | 15–20 serial | 4–6, concurrent where independent |
| Sign prepare D1 round trips before the Router | 5–6 | 1–2 |
| Setup D1 round trips | 3 | 2 |
| Console requests per registration | 7 | 5 or fewer |
| Harness time inside the reported metric | about 1.1 s | 0 |
| Components and databases in one measured location | No | Yes |

Keep a change that demonstrably removes a round trip, a dispatch, or a
construction from the critical path even when three samples do not isolate its
latency. Report slower results and unresolved platform costs explicitly.

## Completion criteria

The SDK-measured registration-to-signature flow is recorded with its harness
and interaction rows separate. Every component runs where its database runs,
or the reason it cannot is recorded with the measured cost. No wallet object is
constructed on the Yao execute's critical path. Finalize, setup, respond, and
sign prepare make the round trips in the target table. The post-registration
status read is gone. The dispatch cost is either removed or confined to one
call per request with its cause recorded. All contracts pass. Staging serves
its original versions. The plan records the measured result against 3–4
seconds and names the follow-up designs that remain.
