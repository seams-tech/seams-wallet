# R155D — the registration-to-first-signature critical path

Status: two changes are committed, verified locally, and confirmed on staging.
The registration response now supplies the post-registration session status,
and wallet startup moved to setup. Their hosted comparison ran on October 10
and measured no end-to-end gain: the time a Worker waits to reach its wallet
object is larger than both savings and varies from request to request. Phase
0's probes had already changed the plan: the largest remaining cost is how
wallet objects are addressed, and placement is not the cause. The address
change is approved for staging and nothing of it is committed yet. Phase 2
started: sign prepare, sign, and finalize each make fewer Gateway database
round trips. The staging database move still waits on its owner. See the
[implementation record](#implementation-record). Plan dated October 9, 2026;
record dated October 10. Written after R155C's hosted measurement, from the same
staging traces, three code traces, and two probe runs recorded under
[Phase 0 findings](#phase-0-findings).

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
is not visible in code. [Phase 0 findings](#phase-0-findings) measures it.

### Where the components run

Measured on staging on October 9. Database primaries come from the D1 query
metadata, and execution locations from the location probe.

| Component | Runs in | Its database primary |
| --- | --- | --- |
| Browser and ingress | Tokyo (NRT) | — |
| Gateway, APAC home | Hong Kong, targeted `aws:ap-east-1` | HKG |
| Console | Tokyo, targeted `aws:ap-northeast-1` | NRT |
| Router Worker and wallet objects | HKG, every invocation | none |
| Deriver A Worker and wallet objects | HKG, every invocation | KIX |
| Deriver B Worker and wallet objects | HKG, every invocation | SIN |
| Signing Worker and wallet objects | HKG, every invocation | ICN |

The Gateway is with its database: its single-read spans measure 11–22 ms. An
earlier draft of this plan guessed the Gateway's database was remote; it is
not, so the Gateway's serial D1 chains cost tens of milliseconds per read. The
three role databases sit in three other cities. Each bound-root round trip from
Hong Kong costs 70–109 ms. The production-testnet lane fixed this for the
Derivers on September 23 by moving both databases to one verified location;
staging was never moved.

## Phase 0 findings

Two single-arm probe runs on October 9, three fresh wallets each, on the
accepted backend with R155C's concurrent dispatch. Staging was restored after
each. [Sanitized evidence](evidence/near-custody-dispatch-probe-20261009.json).

**Location is not the cause.** Wrappers around the unchanged Worker builds made
every Worker and wallet-object invocation report its Cloudflare location. All
84 observed custody invocations ran in HKG: 45 Worker invocations and 39 object
invocations across the four roles reported nothing else.

**A Worker reaches a wallet object quickly only from a server that already
called it.** Of 23 Worker-to-object dispatches, 3 took 14–23 ms and 20 took
308–872 ms, median 515 ms. The three fast ones ran on the server that had
already called that object: Deriver A's and B's work landed on the server that
performed their startup, and one Signing Worker prepare landed on the server
that delivered that wallet's packages. Every other dispatch came from a server
with no completed call to that object. No Worker ever shared a server with its
object. The cost is a route lookup per server and object.

**Name-derived object IDs cause the lookup. Unique IDs do not pay it.** The
second run created two storage-free objects in the Router wallet namespace per
registration, one with `newUniqueId` and one by name. Later Router invocations
for the same wallet, on other servers, timed their first call to each:

| First call from another server | Samples | Median | Range |
| --- | ---: | ---: | ---: |
| Object addressed by unique ID | 8 | 13 ms | 9–18 ms |
| Object addressed by name | 7 | 448 ms | 419–513 ms |
| Object addressed by name, from a server that called it before | 1 | 16 ms | — |
| Second call in the same invocation, either kind | 18 | 7 ms | 5–9 ms |

The objects were 2–8 seconds old. An older named object showed the same
split: 505–587 ms from a server that had not called it, 10–19 ms otherwise.
Cloudflare documents the difference: a name-derived ID does not say where its
object lives, so a caller must find it, and `newUniqueId` "can skip this
check". Creating an object cost 599–979 ms by unique ID and 667–674 ms by name,
so creation stays off the critical path either way.

Every custody wallet object is addressed by a name derived from the owner and
ownership generation. The flow makes these first calls on its critical path:
the Router's claim, Deriver A's execution, Deriver B's socket, the Router's
consume, and the Signing Worker's prepare and sign. At 0.31–0.87 s each that is
about 2.5 s of the 9 s flow. Every later signature pays it again on
prepare and sign unless the request lands on a server that served the wallet
before.

**Cold isolates add 0.1–0.3 s to some invocations.** 19 of 45 Worker
invocations started 99–303 ms after their event, with matching CPU time. The
modules are 9–16 MB of WebAssembly, and staging traffic is sparse, so many
requests meet a server that has not loaded the module. Object invocations
started within 4 ms.

Not yet measured: the combined baseline with the Phase 6AR SDK. D1 round trips
per Gateway request were counted later; see the
[implementation record](#implementation-record). Whether a name-derived ID
passed as a string still pays the lookup no longer matters, because no wallet
keeps a name-derived address.

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
- One final implementation per change. No compatibility switch, no second
  authority path, and no compatibility path for disposable test wallets
  ([R155B](refactor-155B.md) design rule 10).

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
- Phase 0 found the cause of both: a server that has not called a name-derived
  object must look it up, at about 0.45 s. Unique IDs avoid the lookup.
- Two D1 round trips per Deriver admission at 70–90 ms each, to a database in
  another city.
- A's post-protocol work: HPKE seal, three SQLite statements, one deferred D1
  statement, and an output gate before the reply.

Changes:

- Start all four wallet objects at setup, not respond. Setup already knows the
  reserved wallet and home; respond fixes the ownership generation that names
  each object. Make the generation available at setup for a fresh wallet, or
  derive the object name from the reservation, so the startup request can go
  out 0.9–1.5 s earlier. Keep the startup grant-free and storage-free.
- Address wallet objects by stored unique IDs: Phase 1. This removes the
  lookup from the claim, A's execution, and B's socket.
- Co-locate the roles' D1 with the roles on staging: Phase 1.
- Keep the R155C dispatch shape. Do not move B's preparation onto A's
  connection; Phase 6AD and the first R155C draft showed why.

Expected: 0.1–0.4 s from earlier startup; about 1.3 s from the three
lookups on this request; 0.1–0.2 s from D1 placement. The 1,900 ms A execution
has a floor near 0.6–0.8 s of CPU, protocol, and one connect with the present
circuit once its lookups are gone.

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

Causes: one Router dispatch with the 0.45 s object lookup, three Console
calls in series from Hong Kong to Tokyo, fifteen to twenty D1 round trips in
series at 11–22 ms each, and reads whose inputs were known before the previous
step finished. Phase 6AS has since cut three of those reads.

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
| Object lookups on the critical path | 6: claim, A execution, B socket, consume, Signing Worker prepare and sign | 0 |
| Role databases in the roles' location, staging | No: KIX, SIN, ICN against HKG | Yes, measured |

Estimated savings if every item lands, against the 9 s SDK-measured flow:
object addresses about 2.5 s, object startup at setup 0.1–0.4 s, finalize
restructure 0.4–0.8 s beyond its lookup, role databases 0.2–0.3 s, signing
path 0.1–0.2 s, setup and respond 0.3–0.5 s, status read 0.15–0.4 s, prepare
during confirmation up to 0.3 s. That is 3.8–5.5 s, leaving 3.5–5 s. Object
addresses are more than half of it. The 3–4 s target needs them and the
finalize restructure. The 1–2 s preference needs the two follow-up designs:
finalize folded into the Yao execute response and a one-round signature.
Neither is in this plan's scope.

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
  separately from the first run on. Measured on October 10 as the baseline arm
  of the [hosted comparison](#hosted-comparison-october-10): the SDK flow
  without interaction takes 7,955 ms, median of three wallets. Its control arm
  did not run, so the item stays open.
- [x] Add the in-page timer and the message-path signing stages. The test app
  times the message-signing call. NEP-413 signing emits its pre-confirmation,
  confirmation, and signing stages. The hosted sample reports SDK time, the
  WebAuthn and confirmation interactions, and harness time as separate fields.
  The harness keeps its drains and sleeps; they fall outside the SDK-measured
  number, and it still clicks the modal and verifies every signature.
- [x] Observe execution location for every custody context in one
  registration: Router, each Deriver Worker, each wallet object, and Signing
  Worker, using the outbound trace probe. Record each database's primary
  location from the D1 query metadata. Gateway and role D1 round-trip times
  come from existing spans: 11–22 ms and 70–109 ms.
- [x] Reproduce the first-call object dispatch cost with real commands: claim,
  consume, A execution, B preparation and socket, and Signing Worker prepare,
  sign, and delivery, with each caller's location and server recorded. Compare
  unique and name-derived IDs from other servers.
- [x] Count D1 round trips and statements per request in the Gateway with the
  existing timing wrappers, so later phases can show reductions. Counted
  locally on October 10; the table is in the
  [implementation record](#implementation-record). Their staging durations
  still need the comparison's fourth arm, where a measurement-only Gateway
  entry returns each request's D1 and service round trips.

Exit: one evidence file with the combined baseline, the location map, D1
latency per location, and the dispatch-cost matrix.

## Phase 1 — object addresses, startup, and role databases

### Address wallet objects by stored unique IDs

Today each role derives its wallet object's name from the owner and ownership
generation and asks its namespace for that name. The name is the address, so
nothing stores it, and every server that has not called the object pays the
lookup. Replace the derived name with a stored address:

- Wallet startup mints the addresses. The Router creates its own object with
  `newUniqueId`, and each role does the same in its own namespace and returns
  the ID. Startup returns the four IDs to the Gateway.
- The Gateway stores them with the wallet's ownership generation, in the row
  it already reads on every custody request, before any custody state exists.
  One generation has one set of addresses, written once.
- Every Gateway-to-Router custody request carries the wallet's addresses beside
  its home and generation. The Router passes each role its own address the same
  way it passes the home today. A role opens the object by `idFromString`.
- Authority does not move, and one check is added. An object checks the
  requested generation against the one it stored. On ordinary commands the
  derived name alone binds it to its owner. An object opened by address must
  record its owner at first use and check it on every command, so an address
  for another wallet's object is refused there. An address selects an object;
  it grants nothing.
- Relocation mints the destination generation's addresses when it prepares the
  destination, and stores them with that generation.
- There is one address mechanism. A wallet created before this change has
  name-derived objects and no stored addresses. It is not carried over: design
  rule 10 allows no compatibility path for disposable test wallets. An earlier
  version of this plan kept such wallets on their names; that was a second
  path and is withdrawn.

This reaches every custody request type, the Gateway's generation row in all
four regional databases, relocation, and the scenario harnesses. It needs its
own change set, coordinated with R153's relocation work, and its own hosted
comparison. It is the largest saving in this plan. Work has started and
nothing is committed.

Constraints found while reading the code on October 10:

- Names stay. A derived name is also a stored identity: relocation receipts
  name source and destination objects, the role databases store a pair's
  object name with its admission, and session identities embed it. The address
  travels beside the name; it does not replace it.
- The owner check above was confirmed missing for the Router wallet object.
  Confirm or add it for the Deriver and Signing Worker objects.
- Startup becomes authoritative. Today it is best-effort, and a lost startup
  costs only time. Once startup mints the addresses, the first custody command
  of a generation must not run before they are stored, or it creates named
  objects beside the minted ones. Store the addresses insert-once. A custody
  request for a new generation with none stored mints them first and uses the
  row that won the insert.
- The Gateway writes the generation row when respond admits the home. Startup
  now fires at setup, before that row exists. The addresses need their own
  insert-once row keyed by wallet and generation, read in the statement that
  reads the generation row.
- A generation with no stored addresses is refused. No row records a kind of
  address, because there is one kind.
- The seams are narrow. Roles open wallet objects at fewer than twenty call
  sites. The Gateway attaches the home region in one binding wrapper, and the
  addresses can ride the same way. The Router parses that header in one place.

- [ ] Confirm with the owner which environments hold wallets that this change
  discards, and agree the change with the relocation owner.
- [ ] Mint, return, and store addresses at wallet startup. Refuse a custody
  request whose generation has no stored addresses.
- [ ] Carry addresses on every Gateway-to-Router and Router-to-role request.
  Open objects by stored ID in every role. Delete name derivation.
- [ ] Mint destination addresses in relocation.
- [ ] Verify with the Worker and wallet-object scenarios, the four-home E2E,
  relocation, and the intended-behaviour contracts. Measure against the Phase 0
  probe: no dispatch above 50 ms from a server that never called the object.

### Startup and role databases

- [x] Start all four wallet objects at setup. The reservation already carries
  the ownership generation. Keep startup grant-free. A replayed setup starts
  nothing again. Done in `e29277df`, `e0a8efec`, and private `ab478bc`. On
  staging the startup now reaches the Router before respond, and no later
  request became faster: see the
  [hosted comparison](#hosted-comparison-october-10).
- [ ] Move the staging role databases to the roles' location, following the
  production-testnet procedure: create and verify replacements, export and
  import, redeploy with the new database IDs, compare snapshots. This creates
  three databases and moves custody data, so it needs the deployment owner.
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
  reason. Started in `6ee17c33`: the repeated ceremony and identity reads are
  gone, 21 round trips became 19.
- [ ] Sign prepare and sign: one authorization batch; pinned scope from the
  read-back; completion write ordered after the response where the
  specification allows, or kept before it with the reason recorded. Started
  in `12dca984`: the scope comes from the read-back and sign resolves its
  operation in one read. The completion write stays before the response, and
  the [record](#october-10--gateway-round-trips-first-cuts) gives the reason.
  The single authorization batch is open.
- [ ] Verify through the existing registration, lost-reply, cancellation,
  quota, retirement, and relocation contracts. Add scenarios only for new
  orderings: finalize with the Console claim failing after the consume,
  finalize retry after a lost reply with the merged batch, and decline after
  an early prepare.

## Phase 3 — browser round trips

- [x] Seed the post-registration session observation from the finalize
  response on the NEAR-only path. Remove the status read it replaces. Keep
  explicit reads fresh. Done in `defb230c`. A registration that includes ECDSA
  still observes the server, because its session changes after the response.
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

## Implementation record

### October 10 — status seed and setup-time startup

| Change | Public commit | Private commit |
| --- | --- | --- |
| The registration response supplies the session status. The wallet host publishes the session before it returns the registration result, and the client's follow-up read is deleted. Message-signing timer and NEP-413 stages. | `defb230c` | — |
| Wallet startup fires at setup. The reservation result carries the ownership generation. The respond-time and activation-time triggers are deleted. | `e29277df`, fixed by `e0a8efec` | `ab478bc` |
| A stale credential literal in the status-scope unit test, repaired before the change above extended that test. | `e748147c` | — |
| The hosted sample splits SDK, interaction, and harness time. | — | `244b8eb` |

The first version of the startup change did not work. The service options
are normalised by copying fields one by one, and the new starter was not
copied, so the assembled Gateway never started a wallet's objects. The
normalised type is derived with `Omit`, so the dropped optional field still
type-checked, and the first end-to-end test called the setup function directly.
The private composed registration scenario caught it: the Router received no
startup request. `e0a8efec` copies the field and routes the end-to-end test
through the assembled service.

Verified locally:

- The NEAR registration contract asserts that registration and the first
  signature send no session-status request, that explicit queries still read
  the server, and that a lock is respected. Browser requests to the first
  signature fall from seven to six.
- The private composed registration scenario runs the hosted Gateway
  composition, the real Console service, and local role Workers. It asserts no
  status request during registration and exactly one wallet startup, sent
  before the browser's respond request: 0.84 and 0.87 s before it in two runs.
- Five unit cases cover the issued session: one wallet-host observation reads
  it once, every other read asks the server, and a server answer replaces it.
- `tests/e2e/registration-setup-startup.e2e.mjs` runs setup through the
  assembled service against a local D1: one startup per reserved wallet, none
  for a replayed setup, and a completed setup on a host with no starter. It
  fails without `e0a8efec`.
- 61 intended-behaviour cases across the NEAR registration, registration,
  resume, Email OTP resume, add Email OTP, unlock, and Ed25519 Yao files, run
  on `e0a8efec` with fault-injection Worker builds: 56 pass. Five fail, and
  fail the same way on the parent commit: custom review before a live Arc
  signature, a signing prepare that read its session before NEAR provisioning
  committed, sustained Tempo and Arc signing, a status answered before
  deferred NEAR provisioning, and page-refresh hydration. Two more cases, the
  burned execution and the terminal NEAR execution, fail on release builds
  only because those builds carry no fault injection. Recovery, export, and
  relocation files were not run.
- Three more private composed scenarios pass on `e0a8efec`: regional routing
  rejections, concurrent NEAR-only setup through three regions, and a lost
  combined completion reply. A fourth, the NEAR-only fixed-home scenario,
  failed the same way on the parent commit: it expected a separate Yao
  admission request, which NEAR-only registration stopped sending in
  `dadf80a2`. Private `b0402d4` repairs it: the scenario now observes the
  admission on respond through a foreign region, and passes on `947a8843`.
- On `947a8843`, where another session's signing-plan fixes build on the
  status seed: the status-scope unit cases, the NEAR registration contract
  file, and the composed registration scenario all pass.
- Type checks for the SDK, the server package, and the test projects, and the
  bloat check on each committed tree.

Confirmed on staging on October 10: the candidate sends no status request,
and startup reaches the Router before respond. Not verified: any hosted
latency gain.

Database and Console work per request, counted in the composed scenario and
recorded with each round trip's statements in the
[evidence file](evidence/near-registration-gateway-round-trips-20261010.json).
The counts cover the service and exclude the two or three reads each request
makes before it runs. They are structural: a local D1 says nothing about
staging's round-trip time.

| Request | D1 round trips | Statements |
| --- | ---: | ---: |
| Setup | 3 | 3 |
| Respond | 8 | 13 |
| Yao execute | 1 | 1 |
| Finalize | 21 | 66 |
| Sign prepare | 6 | 8 |
| Sign | 8 | 10 |
| Explicit session status | 2 | 2 |

One registration makes seven Console requests: registration context, reserve,
registration home, active lineage, passkey claim, route publication, and
completion. At staging's 11–22 ms per round trip, finalize's 21 round trips are
0.23–0.46 s if none overlap, and sign prepare and sign together are 0.15–0.31 s.

What the sequences show:

- Finalize reads the ceremony and the founding identity for its journal's
  prepare step, then reads both again when execution starts: four round trips
  before the Router consume, two of them repeats.
- Respond loads the Yao registration records, and the store reads them again
  before its commit. The commit and the ceremony update are two round trips.
- Setup writes two ceremony records in two round trips.
- Sign prepare and sign each start with the same four reads in series: session
  admission, signer, capability records, and admission policy. Sign then makes
  four more round trips for the operation it admits and completes.

One behaviour to note: startup now precedes the registration proof. An
abandoned setup leaves four started, empty objects, where before only an
abandoned respond did. Startup still grants nothing.

### Hosted comparison, October 10

The comparison ran from private `.artifacts/r155d-hosted/compare`. The baseline
and candidate arms passed. The control and trace arms did not run: a read of
the live Worker versions timed out against the Cloudflare API while the control
arm settled, and the driver stopped and restored staging. All thirteen Workers
serve their original versions again. This run therefore has no drift
measurement and no per-request round-trip trace. Record:
[evidence file](evidence/near-registration-status-seed-setup-startup-20261010.json).

| Arm | Gateways and SDK | Result |
| --- | --- | --- |
| Baseline | Parent commit `af934879`, plus the two files that only add timing output | Passed, three wallets |
| Candidate | `947a8843` with private `ab478bc` | Passed, three wallets |
| Control | Baseline again | Not run |
| Trace | Candidate behind a measurement-only entry | Not run |

Both arms ran the R155C custody set and one Console built from the current
tips. Ten structural checks pass. Every traced invocation ran its arm's
version. The candidate sends no status request and the baseline sends one per
wallet. Each wallet gets one startup request. Startup reaches the Router
before respond in the candidate and after it in the baseline. An independent
verifier accepts all six signatures.

Medians of three wallets, in milliseconds:

| Measure | Baseline | Candidate |
| --- | ---: | ---: |
| Registration to verified signature, with harness | 9,784 | 10,078 |
| SDK flow without interaction | 7,955 | 8,314 |
| SDK registration | 6,996 | 6,749 |
| SDK message signing | 1,743 | 2,180 |
| Setup request | 655 | 542 |
| Respond request | 677 | 574 |
| Yao execute request | 3,408 | 3,247 |
| Finalize request | 1,906 | 1,763 |
| Session status request | 160 | none |
| Sign prepare request | 509 | 914 |
| Sign request | 418 | 839 |
| Startup at the Router, before respond arrives | 285 after | 593 before |

No end-to-end gain is measured. The ranges overlap: 9,019 to 12,121 ms for
the baseline and 9,123 to 10,688 ms for the candidate.

The Worker tails show why. For a custody Worker request that calls its wallet
object once, the Worker's wall time minus the object's wall time is the time
the request spent outside the object: the Worker's own work, plus reaching the
object. A request "waited" when that time is 200 ms or more.

| Stage | Requests per arm | Baseline waited | Baseline median | Candidate waited | Candidate median |
| --- | ---: | ---: | ---: | ---: | ---: |
| Startup, four roles | 12 | 12 | 734 ms | 12 | 797 ms |
| Yao execute: Deriver A, Deriver B, Signing Worker | 9 | 9 | 440 ms | 9 | 434 ms |
| Registration consume, Router | 3 | 0 | 16 ms | 2 | 405 ms |
| Sign prepare, Signing Worker | 3 | 1 | 32 ms | 3 | 393 ms |
| Sign, Signing Worker | 3 | 1 | 21 ms | 2 | 453 ms |

- Starting the objects earlier shortened no later request. The candidate
  started them about 1.2 s before the Yao request, the baseline about 0.35 s
  before. In both arms every role request in the Yao stage still spent 245 to
  540 ms outside its object. The wait belongs to the call. An object that
  already runs is no cheaper to reach, which is what the Phase 0 probe found.
- After the Yao stage a request spends either 9 to 32 ms outside its object
  or 378 to 536 ms. These requests run in series, so each wait adds to the
  flow: 525, 0, and 492 ms for the three baseline wallets, and 1,251, 1,441,
  and 378 ms for the three candidate wallets.
- That difference is larger than the difference between the arms and larger
  than the saved status request. Three wallets and no control arm cannot tell
  chance from an effect of the candidate.
- Neither change can show a gain while calls reach wallet objects by name.
  The address change comes first; these two changes need a new measurement
  after it.

The same tails split the Yao execute request. Medians of the six wallets:

| Part of the Yao execute request | Time |
| --- | ---: |
| Router request, whole | 3,120 ms |
| Deriver A's request starts after the Router's request starts | 570 ms |
| Deriver A object: wall time, CPU time | 1,998 ms, 444 ms |
| Deriver B preparation object: wall time | 330 ms |
| Deriver B's protocol object starts after the socket request reaches B's Worker | 710 ms |
| Deriver B protocol object: wall time, CPU time | 812 ms, 286 ms |
| Signing Worker object: wall time, CPU time | 1,838 ms, 36 ms |

- The protocol takes about 0.8 s of wall time and less than 0.5 s of CPU time
  in each role. The Signing Worker object waits for Deriver A's output for
  almost all of its life.
- About 1.2 s of the request is time before an object starts: the Router's
  own object before dispatch, Deriver A's object, and Deriver B's protocol
  object.
- Estimate, not a measurement: after the address change the Yao request takes
  about 1.9 s, and the SDK flow without interaction about 6 s. The target then
  still needs Phases 2 and 4. In the Yao stage the next costs are Deriver B's
  preparation, Deriver A's work before it connects, and the work after the
  protocol.

Two facts surfaced while staging the comparison:

- The R155C custody versions only work together: Router `7da081d5`, Deriver A
  `69ba207a`, Deriver B `398dc7d5`, Signing Worker `59936650`.
- A Gateway built after `0d2d859f` refuses a public keyset that still lists
  the retired peer-signing keys, as the staging configuration frozen on
  October 9 does. The comparison's temporary versions carry the keyset without
  them and change nothing else.

### October 10 — Gateway round trips, first cuts

Phase 2 started with the removals that change no ordering.

| Commit | Change |
| --- | --- |
| `12dca984` | Sign prepare takes the pinned owner scope from its own admission. Sign finds the prepared operation in one read that checks its grant and pins its scope. |
| `6ee17c33` | Finalize hands the ceremony and the identity that its preparation read to its own execution. A resumed execution still reads them. |

Gateway database round trips in the composed scenario:

| Request | Before | Now | Target |
| --- | ---: | ---: | ---: |
| Sign prepare | 6 | 5 | 1–2 |
| Sign | 8 | 6 | not set |
| Finalize | 21 | 19 | 4–6 |
| Respond | 8 | 8 | not set |
| Setup | 3 | 3 | 2 |

Two behaviours changed, and both are stricter:

- A finalize request cannot claim an operation. Before, it admitted the stored
  operation again to check its grant, and that admission would have claimed a
  row that had disappeared.
- A reusable-session finalize refuses an operation that a step-up claimed.
  Before, it checked that operation as a step-up and then dispatched it with a
  session binding.

The completion write stays before the response. The response is the
completion row read back, so a retry replays exactly what the first reply
carried.

Sign prepare still makes four reads in series before its admission: session,
Ed25519 signer, Yao capability records, and admission policy. The ECDSA path
reads session, material, and policy in one statement. The Ed25519 path needs
the same fold and a way to read the capability records beside it.

Verified on the committed code:

- Type checks for the server package and both test projects, and a type
  fixture for the new admission input and results.
- `tests/e2e/authorization-storage-transfer.e2e.mjs`, extended: the admission
  and the one-read resolution return the scope that a separate read reports,
  another wallet is refused, an unknown fingerprint is missing, and a
  completed operation replays without a scope.
- 41 intended-behaviour cases: 14 for NEAR signing, 21 for finalize resume and
  replay, and 6 for ECDSA signing. 40 pass with debug Worker builds.
- The private composed scenarios for registration completion, a lost
  completion reply, and NEAR provisioning reply loss, and
  `tests/e2e/step-up-expiry.e2e.mjs`.

One case needs release Worker builds: "Passkey mixed_near activation response
loss resumes the same wallet after reload and signs". With debug builds the
Router refuses the resumed execution as `execution_in_progress`, on the parent
commit too. With release builds it passes on the baseline and on the changed
tree. It is a timing effect of the slower debug build, not of these changes.

### Decisions

Decided on October 10:

- The wallet-object address change in Phase 1 proceeds. Staging wallets are
  disposable. Production testnet and mainnet are outside the discard scope
  until a separate reset-or-migrate decision. No migration is applied, nothing
  is deployed, and no wallet is deleted before the owner's go-ahead. Version
  0.9.0 follows the change.

Still needed:

1. Run the comparison again for its control and trace arms, or wait and
   measure after the address change. The trace arm is the only source of
   staging durations for Phase 2. Private
   `.artifacts/r155d-hosted/compare/launch-trace.sh` runs the trace arm alone
   in about 20 minutes; it changes staging the same way and restores it.
2. Move the staging role databases. That creates three databases and moves
   custody data.

Not started, with the reason:

- The rest of Phase 2. Finalize's steps are ordered by its journal and replay
  rules, each removable round trip is worth 11–22 ms on staging, and the
  durations of the Console and Router calls between them still come from the
  trace arm. Finalize makes three Console requests. The passkey claim runs
  inside the wallet commit. The recovery-code routes run inside the custody
  commit, which already overlaps the capability installation. The completion
  runs with session issuance. Carrying the routes in the completion can save
  at most the difference between those two overlapping branches. Moving the
  claim needs the Console owner's decision.
- Sign prepare during confirmation. An admitted prepare claims one use of the
  session's quota, so a declined confirmation would spend a use unless prepare
  gains a release. It also sends the operation to the server before the user
  approves it.
- Phase 4.

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
