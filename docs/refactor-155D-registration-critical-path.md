# R155D — the registration-to-first-signature critical path

Status: **in progress; the 3–4 s target remains unmet.** Stored unique IDs,
setup-time startup, and the registration status seed are implemented and measured.
The latest hosted comparison measures **4.354 s** for registration alone and
**5.253 s** with the first signature, excluding user interaction. Registration
baseline medians were **5.184 s** before and **4.227 s** after the candidate.
This run does not establish an overall latency improvement. It verifies one fewer
Console request and six fewer completed D1 calls per registration. All nine
signature proofs and 18 comparison checks pass. The [hosted evidence](evidence/refactor-155d-allocation-hosted.md)
records ranges, counts, frozen versions, limitations, and restoration status.
The [capability storage changes](evidence/refactor-155d-capability-persistence.md) remove redundant ceremony work and combine wallet/capability writes, reducing that persistence step from three D1 calls to two locally; hosted savings remain unmeasured.
Hosted validation, preparation during confirmation, the staging role-database cutover, and the documented interrupted-recovery failure remain open. See the [implementation record](#implementation-record).
Plan dated October 9, 2026; record updated October 10.

## Objective and relationship to R155B and R155C

Bring NEAR-only registration followed by the first independently verified
NEP-413 signature below 3–4 seconds as measured inside the SDK, with 1–2
seconds preferred. At the start of this plan, the hosted flow measured **10.6 s**
with the R155C backend and the accepted Phase 6AM SDK. It measured **11.5 s**
with the Phase 6AR SDK and Gateway on the older backend. The combined versions
and subsequent changes are now measured in the implementation record.

[R155B](refactor-155B.md) owns Gateway, Console, and SDK request reductions
through Phase 6AR and the regional-execution design rules. [R155C](refactor-155C-yao-peer-connection.md)
removed the serial Deriver A/B stage and recorded a 2.0 s Router Yao
execution. This plan takes the measured remainder across every component. It
keeps R155B's design rules and R155C's trust model. It records its own
implementation and evidence here.

The starting flow made eight browser requests in series, six before the first
signature could start. No single stage dominated: Yao execute and
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

- [x] Freeze a combined candidate: R155C backend `580cb508` with the Phase 6AR
  SDK and Gateway. Measure it as the baseline of this plan with the existing
  three-arm protocol. Record the SDK-measured number and the harness rows
  separately from the first run on. Measured on October 10 as the baseline arm
  of the [hosted comparison](#hosted-comparison-october-10): the SDK flow
  without interaction takes 7,955 ms, median of three wallets. Its control arm
  did not run. The later stored-address, entry/finalization, and completion
  comparisons include repeated baseline controls with exact versions recorded.
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
  locally and on staging on October 10. Later comparisons use identical
  Gateway D1 and service instrumentation in all three arms. The completion
  comparison also measures Console D1 in every arm.

Exit: one evidence file with the combined baseline, the location map, D1
latency per location, and the dispatch-cost matrix.

## Phase 1 — object addresses, startup, and role databases

### Address wallet objects by stored unique IDs

The implementation separates a wallet's logical identity from its four physical
Durable Object addresses. Router, Deriver A, Deriver B and SigningWorker open
wallet objects with `idFromString`. Logical names remain in encryption context,
relocation receipts and diagnostic records. They no longer select these objects.

Allocation happens during registration setup, before custody execution:

1. The authenticated Router allocates its address. Each role allocates an address
   from its own namespace. Allocation does not start the objects.
2. The Gateway inserts the four addresses in `wallet_object_addresses`. The key
   includes namespace, organization, project, environment, wallet and ownership
   generation. Concurrent insertions return the same persisted winner.
3. Setup waits for persistence. A failed allocation can retry through the saved
   setup reservation. An exact replay reads the existing addresses.
4. Background startup warms the persisted objects. Its failure affects latency
   only. Every custody request must find the persisted addresses.

The home binding replaces incoming address and region headers. It reads addresses
for the admitted wallet and generation. Each role retains its existing owner,
generation, authority, replay and relocation checks. An address grants no authority.
Deferred work carries the selected route through protocol messages and continuations.

Relocation prepares the destination address row after its authorization-import
reservation. This runs before custody preparation and placement inspection. Source
addresses remain available for cleanup and exact retries. Destination addresses
are allocated in the destination namespaces. Address rows are never copied as
wallet content and cannot be updated or deleted independently.

Deriver admission reconciliation stores the physical object ID. Retirement checks
open that ID after a lost completion acknowledgement. Encryption context retains
the logical name. The separate presignature-session objects retain their existing
addresses and carry the parent wallet's stored route for callbacks.

Migrations written for this change:

- Gateway `0077_wallet_object_addresses.sql`, for each of the four regional
  Gateway databases. Each Runtime shares its region's Gateway database.
- Deriver A and B `0019_wallet_object_addresses.sql`, renaming their admission
  locator to `pair_object_id`. Old admissions and wallets must be discarded
  together before activating this incompatible candidate.

Initial scope covered code and migration files. The subsequent authorized hosted
comparison uses existing staging resources. Production testnet and mainnet remain
excluded from wallet discard and deployment. There is no name-based fallback.
Gateway, Runtime, Router, Deriver A, Deriver B and SigningWorker must use the
matching candidate. Their internal route messages changed together.

The current binding performs one regional D1 lookup per wallet custody dispatch.
The hosted full-flow timings below include this cost. The separate trace measured
7 ms median per address-read batch, including the regional deployment check.
The earlier 13 ms unique-ID probe and 448 ms named-ID probe motivated
the change. The actual comparison shows a 1.63–2.25 s browser-median reduction
against the two named-ID arms. It does not establish a fixed 2.5 s saving.

- [x] Allocate, persist and reuse one address set before custody work.
- [x] Route the four wallet objects by stored ID. Preserve logical record identities.
- [x] Carry the route through signing, export, linked-device work and continuations.
- [x] Allocate destination addresses during relocation preparation.
- [x] Preserve physical admission locators for retirement reconciliation.
- [x] Verify setup retry, lost allocation reply, concurrent allocation, tenant
  isolation, generation isolation and immutable address rows against local D1.
- [x] Complete local four-home Worker registration, signing, destination
  preparation and source/destination address-selection checks.
- [x] Run a complete composed NEAR relocation with copy, activation and source
  cleanup against the matching stored-address candidate. Verify destination signing
  and replay after eviction by its persisted object ID.
- [x] Run the authorized controlled hosted comparison. Verify stored-address use,
  matching versions and independent signatures. Record the baseline, candidate
  and repeated baseline below. Full-flow timings include the added D1 lookup.
- [x] Isolate the added address lookup's duration in the hosted D1 trace below.
  A 50 ms dispatch remains a measurement target, not a Cloudflare guarantee.

### Stored-address local verification — October 10

The setup scenario uses the assembled registration service and local D1. It
verifies exact setup replay, a lost allocation reply, eight competing allocations
with one persisted winner, distinct ownership generations, tenant isolation, and
replacement of caller-supplied addresses. It also checks that address rows cannot
be changed. Run `node tests/e2e/registration-setup-startup.e2e.mjs` from the public
repository. Evidence: `.artifacts/registration-setup-startup/result.json`.

The private Runtime scenario verifies destination allocation after its import
reservation and rejects the wrong writer, request and reservation. Run
`SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server node tests/e2e/runtime-preparation-addresses.e2e.mjs`
from the private repository. Evidence:
`.artifacts/r155d-addresses/runtime-preparation.json`.

All four local homes (US, WEUR, APAC, OC) completed real Rust Worker registration,
NEAR signing and ECDSA signing. Eight signatures were independently verified.
The checks also cover exact completed-result replay, warm-object reuse, physical
admission locators, destination preparation and distinct source/destination IDs.
Run `ROUTER_AB_WORKER_BUILD_PROFILE=release node crates/router-ab-cloudflare/scripts/wallet-home-placement-evidence.mjs`.
Full evidence is in `.artifacts/wallet-home-placement/evidence.json`. The
[committed evidence](evidence/refactor-155d-stored-unique-ids-local.json) includes
public keys, digests and signatures for independent verification. It contains no
secret shares. This run does not verify a complete relocation or hosted placement.

The first Worker run caught a stale logical-name argument in B's admitted-root
read. It conflicted with B's newly stored physical ID. The call now supplies the
stored ID, and the four-home run passes.

The native HTTP suite passed 34 scenarios and exposed one stale cleanup assertion.
The scenario now advances the existing `Cleaning` response until `Cleaned`; its
focused rerun passes. Two long-outage scenarios remain ignored by default.

SDK TypeScript checks, address type fixtures and the repository bloat check pass.
The private candidate typecheck now passes. The local host supplies established-home
admission to recovery, export and linked-device routes. The directory client supplies
its regional session home, and OTP delivery accepts wallet relocation.
These local checks do not establish hosted latency. They changed no live databases
or Workers and deleted no existing wallets.

### Complete stored-address relocation — October 10

The composed NEAR scenario now completes WEUR generation 1 → APAC generation 2.
It runs the release Rust Workers, separate wallet-object namespaces, local D1,
production directory and Runtime handlers, and Chromium session reconciliation.
The Gateway databases contain the IDs used by both test traffic and Runtime calls.

The scenario verifies these outcomes:

- A pending signature holds source settlement. A lost finalization reply recovers
  the same signature before cutover.
- Copy, verification, destination activation and source cleanup complete.
- All four destination addresses differ from their source addresses. Source rows
  remain unchanged after cleanup.
- The retired source rejects signing. The destination replays the completed source
  signature and rejects changed request material and a stale generation.
- A new destination NEAR signature verifies independently. Prepare and finalize
  replay exactly after eviction of the persisted SigningWorker object.
- The browser locks the old session once. Reload retains its generation fence.

Run from the private repository:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
ROUTER_AB_WORKER_BUILD_PROFILE=release \
node tests/e2e/relocation-custody.e2e.mjs
```

Evidence: `.artifacts/r155d-addresses/composed-relocation/`, with a compact copy
in [the committed evidence](evidence/refactor-155d-stored-unique-ids-local.json).
The run covers NEAR relocation. It does not claim mixed-curve relocation, browser
registration, fresh unlock after cutover, hosted placement, or latency savings.
This local relocation run changed no live resources. Hosted comparison results are
recorded separately below.

### Stored-address hosted comparison — October 10

Stored unique IDs reduced registration and first-signature latency in this sample.
Three fresh implicit NEAR wallets ran in each arm: named IDs, stored IDs, then
the same named-ID versions again. The final arm is the control. It checks timing
variation after reverting the change. All nine NEP-413 signatures verified with
an independent Node.js Ed25519 verifier. Altered signed fields failed verification.

The browser used the APAC staging Gateway. The SDK payload and placement
configuration stayed fixed. Only NEAR signing was enabled. The NEAR signer worker
loaded, and no ECDSA signer worker loaded. Shared JavaScript and custody code can
still contain both protocols. The flow excludes funding and blockchain confirmation.
Worker and Durable Object cold state was not established.

| Measurement | Named-ID baseline | Stored-ID candidate | Named-ID control |
| --- | ---: | ---: | ---: |
| Browser registration → verified signature | 9.108 s (8.314–10.748) | **6.855 s (6.809–8.517)** | 8.484 s (7.573–9.076) |
| SDK registration | 6.287 s (5.370–6.992) | **5.074 s (4.496–5.337)** | 5.746 s (4.662–6.268) |
| SDK first signature | 2.061 s (1.507–2.390) | **1.089 s (1.061–1.903)** | 1.892 s (1.011–2.287) |
| SDK registration + first signature | 8.348 s (6.877–9.382) | **6.163 s (5.557–7.240)** | 7.279 s (6.554–8.033) |
| SDK flow excluding measured interactions | 7.770 s (6.094–8.885) | **5.488 s (5.022–6.716)** | 6.680 s (5.792–7.397) |

Each cell gives the median and observed range in seconds. The range's upper value
is the maximum. Browser timings include automation. SDK timings exclude automation
but include the measured WebAuthn and confirmation interactions. The last row
subtracts those interactions per sample. Medians from separate rows cannot be added.

The browser median improved by 25% against the baseline and 19% against the control.
The SDK first-signature median improved by 47% and 42%, respectively. Three samples
per arm establish an observed improvement, with substantial variation. They do not
establish a latency guarantee. The 3–4 s full-registration target remains unmet.

Selected server spans explain where the gain appeared:

| Server span, median | Named-ID baseline | Stored-ID candidate | Named-ID control |
| --- | ---: | ---: | ---: |
| Router Yao execution | 1.792 s | **1.259 s** | 1.647 s |
| Router parse and authorize | 0.501 s | **0.073 s** | 0.496 s |
| Deriver B preparation | 0.640 s | **0.352 s** | 0.633 s |
| Finalize total | 1.489 s | 1.063 s | **0.897 s** |
| Finalize Router consume | 0.559 s | 0.089 s | **0.072 s** |

Spans can overlap. Do not sum them. Router Yao execution meets the 1–2 s target
in this sample. The candidate's finalization improvement over the baseline did not
repeat against the control. This comparison therefore supports no finalization-gain
claim. The finalization path still needs separate measurement.

Every wallet sent six Gateway requests and zero session-status requests. Each
wallet sent one background startup request before respond. The comparison captured
no full D1 trace, so it establishes neither total D1 calls nor individual lookup
costs. Those costs are included in elapsed flow time.

The candidate's invocation logs match all four persisted object IDs for each of
its three completed wallets. All observed invocations on the six tailed components
match their arm's expected versions. The baseline and control use identical versions
for all 13 components. All 17 comparison checks pass.

Frozen sources:

- Public baseline `f16a32e2a364c6ed662e8131d06034018748c788` and candidate
  `28c58d85bab8dc0f67c8d21bf26dd460a50ff2c1`.
- Private baseline `dd5e16d1535eed3e28885111ed5c99ba847881e9` and candidate
  `13a5529e95e138a00ca4f8ab5b485b829d58285d`.

Evidence includes per-sample timings, public signature proofs, version audits and
cleanup checks in
[the hosted evidence](evidence/refactor-155d-stored-unique-ids-hosted.json).
The complete private artifact directory is `.artifacts/r155d-stored-ids-hosted/`.
Its frozen source exports, configurations, hashes, driver and raw logs support a
repeat run. Inspect current staging state before reusing its deployment driver.

Cleanup completed. Live read-back confirms all 13 original Worker versions and
both original Deriver admission-column schemas. The original tenant activation
passed. The four additive Gateway address tables and their migration records remain.
One expired, unclaimed Deriver B admission was cancelled before migration. Its
terminal history remains. No existing wallet was deleted, no new Cloudflare resource
was created, and production was unchanged. The candidate is not permanently active.
No SDK package was published. A coordinated rollout remains for the release.

### Stored-address D1 trace — October 10

Stored-ID implementation and verification are complete. Permanent activation remains
part of the coordinated release. Further registration optimizations belong to the
remaining phases below.

Three fresh implicit NEAR wallets completed registration and independently verified
NEP-413 signing on the same frozen stored-ID candidate. This separate run observed
D1 and service calls. It supplies diagnostic timings rather than another controlled
full-flow comparison. Later session-policy changes are excluded.

| Stored-address operation | Samples | Median | Range / maximum |
| --- | ---: | ---: | ---: |
| Address-read batch, including regional deployment check | 15 | **7 ms** | 6–12 ms |
| Initial insert and winning-address read, including deployment check | 3 | **44 ms** | 41–47 ms |
| Sum of completed address-read batches per wallet | 3 | **41 ms** | 33–48 ms |

All observed address operations were served by D1 in APAC. The 15 reads include
the initial missing-row check for each wallet. Each read shares a batch with
the existing regional deployment check. The reported duration includes network,
that check and the address query. It does not isolate SQL execution alone.
The sum excludes background reads unfinished when the response leaves.

The Gateway trace records these completed calls through the first signature:

| Request | D1 round trips per wallet | SQL statements per wallet | Median summed D1 duration |
| --- | ---: | ---: | ---: |
| Registration setup | 6 | 12 | 170 ms |
| Registration respond | 10 | 24 | 226 ms |
| Yao execute | 4 | 7 | 31 ms |
| NEAR finalization (`near-provisioning`) | 21 | 86 | 594 ms |
| Sign prepare | 8 | 17 | 170 ms |
| Sign execute | 9 | 18 | 123 ms |

Each sample records 58 completed Gateway D1 round trips and 164 SQL statements.
Batch calls contain multiple statements, including deployment checks. These counts
exclude Console and custody-role databases. Setup and finalization each had one
D1 call pending when their response left. Later background calls are also excluded.
Summed durations can overlap and must not be treated as critical-path durations.
Every captured statement with region metadata was served in APAC.

Finalization's Gateway span was 1.109 s median, with an observed 0.875–1.330 s range.
Its service calls measured:

| Finalization service call | Median | Range / maximum |
| --- | ---: | ---: |
| Router consume | 106 ms | 92–110 ms |
| Console passkey claim | 125 ms | 96–259 ms |
| Console route publication | 148 ms | 137–383 ms |
| Console completion | 146 ms | 127–148 ms |

These service spans can overlap with D1 work. The trace supports targeting
finalization's remaining D1 and Console work next. Saving a 7 ms address read
has less impact than those waits. No additional stored-ID abstraction or cache
is required to close this change.

All six observed components ran their expected versions. Three signatures passed
independent Ed25519 verification, including rejection of altered signed fields.
The observer executes the same SQL once through `all()` instead of `first()`
to retain D1 metadata. It records query identities and table names without SQL
parameters, row contents or secret values.

Evidence: [committed trace](evidence/refactor-155d-stored-unique-ids-trace.json).
Full private artifacts: `.artifacts/r155d-stored-ids-trace/`.
An initial launch failed because the dry-run bundle used the wrong output path.
It ran no benchmark and restored staging. The corrected retry produced these results.
Final restoration activation passed. Live read-back confirms all 13 original Worker
versions and both original Deriver schemas. The four additive Gateway address tables
remain. No new resources were created, and production was unchanged.

### Startup and role databases

- [x] Start all four wallet objects at setup. The reservation already carries
  the ownership generation. Keep startup grant-free. The stored-address change also permits replay to retry
  allocation and warm the same objects. The original startup change landed in `e29277df`, `e0a8efec`, and private `ab478bc`. On
  staging the startup now reaches the Router before respond, and no later
  request became faster: see the
  [hosted comparison](#hosted-comparison-october-10).
- [ ] Move the staging role databases to the roles' location, following the
  production-testnet procedure: create and verify replacements, export and
  import, redeploy with the new database IDs, compare snapshots. This creates
  three databases and moves custody data, so it needs the deployment owner.
  The owner approved the move on October 10. Started at 19:18 JST in the
  session that made `b6d9f2a7`: three empty replacements exist with verified
  `HKG` primaries, `router-ab-deriver-a-staging-private-hkg`,
  `router-ab-deriver-b-staging-private-hkg` and
  `router-ab-signing-worker-staging-private-hkg`. No data is copied and no
  Worker is rebound yet. The cutover waits for an idle staging and for the
  owner's choice of deploy path: the staging workflow would also deploy the
  162 commits that `origin/dev` holds since the last full deploy of October 6.
  A Worker version keeps its own database binding. The custody version IDs
  that the hosted drivers store will still use the old databases after the
  cutover, so later comparisons need new baseline versions.
- [x] Measure Yao execute, finalize, and sign against the Phase 0 baseline
  with everything else fixed. The stored-address, entry/finalization, and
  completion comparisons record each source and deployment version.

## Phase 2 — Gateway round trips

- [ ] Fold the deployment-admission read and the routing reads into each
  handler's first batch. Immediate retirement semantics stay: the predicate is
  evaluated in the same transaction as the work it guards. Deployment admission,
  session routing and registration-continuation routing now share one SELECT.
  Each handler retains its deployment-fenced reads and writes. This removes the
  separate local session or ceremony lookup before the handler.
- [x] Setup: combined Console context-and-reserve, one insert batch.
  `42cde7b7` combines the snapshot and ceremony write, beside address initialization.
  The combined Console operation now authenticates and reserves in one invocation.
  The two-curve browser retry verification is recorded below.
- [ ] Respond: overlap home admission and the lineage read with WebAuthn
  verification; one commit batch; no re-read after load. Started in `b338a7e1`
  and `33df3f59` for the Ed25519-only respond: the ceremony update commits in
  the batch of the Yao admission, and the lineage read runs beside the home
  admission and the proof. Setup now saves the home in its ceremony batch,
  which removes the continuation's directory lookup and separate home write.
  The admission commit still reads its record again.
- [ ] Finalize: concurrent consume, claim, and reads; one or two write batches
  including the journal; routes carried by completion; duplicate reads removed.
  Decide the passkey claim's placement with the Console owner and record the
  reason. Started in `6ee17c33`: the repeated ceremony and identity reads are
  gone, 21 round trips became 19. Session issuance now also commits the
  matching ceremony's completion decision in the same D1 transaction.
  This removes one later write batch. `fbebaf9a` commits the local activation
  in the batch that completes the registration journal, which removes one
  more. See [the verification record](#registration-session-and-completion-decision)
  and [the activation record](#activation-in-the-journal-completion-batch).
- [x] Sign prepare and sign: one authorization batch; pinned scope from the
  read-back; completion write ordered after the response where the
  specification allows, or kept before it with the reason recorded. Started
  in `12dca984`: the scope comes from the read-back and sign resolves its
  operation in one read. The completion write stays before the response, and
  the [record](#october-10--gateway-round-trips-first-cuts) gives the reason.
  `bed2e264` includes the active Yao capability in the authorization read.
  Missing capability observations retain persisted reconciliation. The composed
  quota, step-up, linked-device, retirement and relocation cases pass.
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
- [x] Record the two follow-up designs and their constraints below. Neither
  starts here.

## Phase 4 — custody path remainder

- [x] Audit the Signing Worker's registration-based prepare and sign paths.
  Both dispatch directly to the stored wallet object after parsing and validation.
  The D1 replay and material reads below that branch serve other material sources.
  They do not run for this NEAR registration workload. See the custody audit below.
- [x] Measure Deriver A's post-protocol work: output seal, record write,
  deferred D1 settle, output gate. Return the reply before non-essential
  durable work only where one durable execution outcome is preserved; record
  which writes must precede the reply. The entry/finalization comparison records
  these spans. Output sealing and outcome recording read 0 ms on the Worker
  clock, which cannot isolate synchronous CPU or the implicit storage flush.
  Background D1 settlement measured 148 ms median. The encrypted completed
  outcome remains durable before the reply so a lost response can replay it.
- [x] Apply stored addresses to B's socket forwarding. The stored-ID candidate
  measures A's complete WebSocket connection at 261 ms median, 260–269 ms.
  B's stateless duplex invocation measures 129 ms median, 118–136 ms.
  Neither number isolates network time from execution and upgrade work.
- [x] Record observed per-role CPU and its measurement limit. A's complete
  execute invocation uses 262 ms median; B's duplex invocation uses 323 ms.
  These include protocol and lifecycle work, so they are not isolated circuit
  lower bounds. A smaller circuit remains outside this plan.

## Phase 5 — verify and measure

- [x] Run the intended-behaviour contracts for registration, recovery, export,
  signing, Email OTP, and relocation against the combined change. All 132 public
  cases pass on `63acba09`. Private regional cases and restart recovery checks
  are recorded in the combined lifecycle verification below.
- [ ] Run the Worker and wallet-object scenarios from R155C and the four-home
  placement E2E.
- [x] Measure on staging with the R155C protocol: baseline, candidate,
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
| `e4ae2f91` | The session statement of an Ed25519 signing request also reads the session wallet's signer and its policy rows, as the ECDSA statement does. |
| `22ead209` | A contract for the NEAR signing policy, which had none: project rejection, abuse rejection, and rate limit on prepare and finalize, with the quota unchanged. |
| `c77bdf47` | A finalize receipt that names an unknown operation ID is answered `authorized_operation_missing` again. `12dca984` had changed that answer. |
| `42cde7b7` | Setup stores its snapshot and opens its ceremony in one write batch, and initializes the wallet-object addresses beside that write. |
| `b338a7e1` | An Ed25519-only respond commits its ceremony update in the batch of its Yao admission. |
| `33df3f59` | That respond starts its tenant-root read before the home admission and the proof, and the admission awaits it. Private `0ad32c2` adapts the local dev Worker's resolver. |
| `fbebaf9a` | Finalize commits the activation of the wallet's home in the batch that completes its registration journal. |
| `8cfc587a` | The home authority has `publishEstablished` and `cancel` in place of `complete`. |
| `b6d9f2a7` | Finalize claims the recovery-code routes of its custody commit beside Router consumption and the credential claim. |

Gateway database round trips in the composed scenario. "Own work" excludes
the stored-address reads that `cb331a8d` added; "On `dev`" includes them.

| Request | Before | Own work | On `dev` | Target |
| --- | ---: | ---: | ---: | ---: |
| Sign prepare | 6 | 2 | 2 | 1–2 |
| Sign | 8 | 3 | 3 | not set |
| Finalize | 21 | 15 | 15 | 4–6 |
| Yao execute | 1 | 1 | 1 | not set |
| Respond | 8 | 6 | 6 | not set |
| Setup | 3 | 2 | 4 | 2 |

The counts are from public `b6d9f2a7` and private `d804d64`. Since
`81e5f690` and private `be6fb57` the Gateway's admission query carries the
stored addresses, so only setup still reads and stores them. Finalize's 15
follows `07e4da8a`, `73d8b5bb`, `fbebaf9a` and `e7f12f23`. Respond's 6 follows
`1a783da1`, and `bed2e264` took one read from sign prepare and from sign.

Private `1f02f18`, `9b65427`, `0a73bef` and `e38194d` cap the "On `dev`"
counts in the composed scenario. A change that adds a round trip must raise
a ceiling there and give the reason. The finalize ceiling is 16, one above
its count. Finalize's cleanup runs after the response as one read and one
delete, and the trace holds the delete only when it finishes before the
trace is read. Under load it did, and the first ceiling of 16 failed at 17
before `e7f12f23`. Private `d804d64` records that allowance.

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

After `e4ae2f91` sign prepare makes two reads before its admission: the
session statement, then the Yao capability records. The capability read needs
the signer, so it cannot join the first statement. It can run beside it only
if the Gateway reads capability state for the wallet that the request names
before the session admits that wallet. That is a choice for the owner.
A policy scope that the session statement did not select, as for
linked-device material, is still read from the database.

Verified on the committed code:

- Type checks for the server package and both test projects, and a type
  fixture for the new admission input and results.
- `tests/e2e/authorization-storage-transfer.e2e.mjs`, extended: the admission
  and the one-read resolution return the scope that a separate read reports,
  another wallet is refused, an unknown fingerprint is missing, and a
  completed operation replays without a scope.
- The private composed scenarios for registration completion, a lost
  completion reply, and NEAR provisioning reply loss, and
  `tests/e2e/step-up-expiry.e2e.mjs`.

The contract runs first recorded here did not test these changes. The runner
skipped the server package build, and the local Gateway loads that build
output. The output in use was built before the changes. The valid contract
evidence is the full suite in the next section. Rebuild the server package
before a contract run that sets `SEAMS_INTENDED_SKIP_BUILD=1`.

### Full suite on the combined tips, October 10

The suite ran on public `22ead209` with private `1f02f18`, after a rebuild of
the server package and the Workers. It is the first contract run of the
Phase 2 commits, and the first of the whole suite with stored addresses.

| Run | Cases | Pass | Fail |
| --- | ---: | ---: | ---: |
| Combined tips, debug Worker builds | 131 | 124 | 7 |
| With `29812919`, `350231dc` and `c77bdf47` | 131 | 131 | 0 |

The second run used release Worker builds, and 124 cases passed in it. Five
Email OTP cases met a Google test token near its expiry and passed with a new
token. Two cases inject a terminal failure, which only the debug Router has,
and passed with debug builds.

The seven failures have three causes:

| Cases | Cause | Classification | Fix |
| ---: | --- | --- | --- |
| 4 | Device linking. The Router sent the linked-device Ed25519 reservation to the Signing Worker without the wallet's object route. The Signing Worker requires the route. | `production_regression` in `cb331a8d` | The Router sends the route on that call. |
| 1 | NEAR finalize. `12dca984` reads the prepared operation by its fingerprint. A receipt that named an unknown operation ID got `invalid_authorized_operation`. The contract requires `authorized_operation_missing`. | `production_regression` in `12dca984` | The resolution answers `authorized_operation_missing` when the stored operation has another ID. No read was added. |
| 2 | Activation response loss, `mixed` and `mixed_near`. The first Yao execution still runs when the reload retries it, and the Router answers `execution_in_progress`. | `production_regression`: the SDK treated the Router's recoverable answer as a failure. The slower debug Worker build only makes the two requests overlap. This row first said `environment_or_infrastructure_failure`. | The SDK sends the exact execute request again with bounded backoff. The cases pass with both build profiles. |

Other suites on the fixed tree:

- The composed NEAR relocation scenario, private
  `tests/e2e/relocation-custody.e2e.mjs`, passes.
- The private composed suite `tests/e2e/regional-real` passes 20 of 22 cases.
  The two "signs through WEUR, APAC and OC" cases fail in their browser
  relocation harness. The harness does not pass `onAdmitted`, which private
  `2d69e1d` made required on October 7, and it does not wrap the custody
  roles as the Runtime Worker does. Without `29812919` the Ed25519 case
  already fails earlier, at device linking.
- The native target `crates/router-ab-cloudflare/tests/bindings.rs`: 186 pass
  and 4 fail. The same 4 fail on `f16a32e2`, before stored addresses. They are
  not classified yet.

### Review of the stored-address change, October 10

`cb331a8d` and private `86b9899` address wallet objects by stored IDs. This
review read the committed code and ran the suites on the combined tips.
`29812919` fixes findings 1 and 7. `350231dc` fixes finding 2 and the write
order in finding 3.

What the change costs in the Gateway database: one read of
`wallet_object_addresses` for each custody dispatch, and one read and one
write at setup. One registration and first signature make six more round trips
than before. Setup also waits for the Router to allocate the four IDs. These
reads can move into statements that already run: the session statement for
signing, and the home admission for registration. Then no request pays a
round trip for its addresses. The hosted trace measured 7 ms for each read,
so the write batches and the service calls listed below come first.

Findings in the role Workers, each confirmed in the source:

1. Relocation freeze cannot drain a pending registration.
   `router_wallet_relocation.rs`, `handle_freeze`: the replayed execute request
   copies the service secret and the home region, and not the object addresses.
   The execute handler then refuses it. A wallet with a claimed registration
   and an expired lease stays `Draining`. Fixed: the replay copies the
   addresses. No test drives this path yet.
2. The Signing Worker wallet object does not pin its owner or its generation.
   `signing_worker_wallet.rs`, `deliver_registration`, and the ECDSA activation
   store accept material for any owner. The derived name gave this binding
   before. Reads stay keyed by owner, so no secret crosses wallets, but a
   misrouted delivery lands in another wallet's object, and that object's
   cleanup deletes it. The plan requires the owner check in every object
   opened by address. Fixed for the owner: the object records the wallet of
   its first command and refuses a command for another wallet. The object
   does not pin the generation. A first version did, and the composed
   relocation scenario failed: a destination object must replay a signature
   that its source generation prepared.
3. The Deriver objects check the owner and not the generation. Deriver A
   writes its role-database admission before it checks the owner
   (`deriver_a_pair.rs`), so a misrouted request leaves an admission that
   names the wrong object, and the correct retry then conflicts. Fixed: the
   owner check runs before the admission write. The generation is still not
   checked in the Deriver objects.
4. The Router's ECDSA activation and export routes read the addresses with a
   bearer token only (`strict_worker/router.rs`). The Gateway mints that token
   for each call, so the practical risk is low. The token does not bind the
   addresses, and the other routes require the Gateway secret first. Fixed:
   activation and export require the existing Gateway service secret. Both
   forwarders send that secret. No new secret or configuration is introduced.
5. `lib.rs`: the Router's linked ECDSA finalize call to the Signing Worker
   sends no route, and the Signing Worker requires one. Fixed: the admitted
   Router route carries its stored wallet addresses into the Signing Worker call.
6. Role migration `0019` renames the column and keeps old names as values.
   An old admission cannot be opened by ID. The plan already requires that
   old admissions and wallets are discarded together.
7. The Router's linked-device Ed25519 reservation carried no object route
   (`router_coordinator.rs`). Device linking on a wallet with a NEAR key
   failed with HTTP 500. Fixed. The hosted comparison candidate `28c58d85`
   has this fault. That run registered and signed with NEAR only, which the
   fault does not touch.

Findings 2 and 3 need a Gateway routing error to matter, because the roles
trust the Gateway. They are the checks this plan asked for when an address
replaces a name. Findings 1 and 7 are functional regressions. Findings 4 and 5 are now fixed.

The Gateway removes both client-supplied object identity and address headers at
its public entry point. Custody forwarding sets the identity from server-admitted
data, then reads the stored addresses. This no longer depends on every forwarding
path removing client headers separately.

The Router Wasm check and Wallet-server type check pass. The built Router and
Gateway pass two browser contracts: immediate export after passkey unlock, and
three-device linking followed by NEAR/ECDSA signing and both key exports.
The isolated test log is `.artifacts/r155d-route-browser-stable.log`.
An earlier parallel launch failed on occupied ports before a test ran.

### What the stored-address trace leaves for Phase 2

The trace under "Stored-address D1 trace" times every Gateway database call
and service call of three wallets. Its candidate has `12dca984` and `6ee17c33`
and not `e4ae2f91`.

A database read took 6–13 ms. A write batch took 44–63 ms, and the large ones
86–153 ms. Each request runs its calls in series. The write batches and the
service calls set the time; the reads do not.

| Request | Gateway, median | Write batches | Their time | Reads | Service calls, median |
| --- | ---: | ---: | ---: | ---: | --- |
| Setup | 636 ms | 3 | 144 ms | 26 ms | Console context 151, Console reserve 122, Router allocate 215 |
| Respond | 509 ms | 3 | 146 ms | 85 ms | Console home 101, Console lineage 105 |
| Yao execute | 1,572 ms | 0 | 0 ms | 31 ms | Router execute 1,543 |
| Finalize | 1,109 ms | 8 | 467 ms | 127 ms | Router consume 106, Console claim 125, Console routes 148, Console complete 146 |
| Sign prepare | 242 ms | 1 | 62 ms | 108 ms | Router 96 |
| Sign | 253 ms | 1 | 46 ms | 77 ms | Router 130 |

The browser saw each request 140–375 ms longer than the Gateway did. An SDK
stage lasts as long as its browser request, so no preflight hides there.

Cuts in the order of their measured value. Each one keeps the replay and
journal rules of its request, or it is not made.

1. Setup, address allocation. The Router asks three role Workers for an ID.
   The call took 12, 215 and 415 ms, and setup waited for it after its two
   ceremony writes. Done in `42cde7b7`: the address initialization starts when
   the request is valid and runs beside the ceremony write. Started beside the
   Console reservation it saves about 120 ms more, but a refused reservation
   then costs four Worker calls. That is a choice for the owner.
2. Setup, one ceremony write batch in place of two. Done in `42cde7b7`. With
   item 1 the two remove about 100 ms of serial waits from the traced setup.
   The staging number is not measured yet.
3. Finalize, the last four writes: session issue, completion decision,
   activation, and journal completion. The completion decision can commit
   with the session, and the activation with the journal completion: about
   90 ms. Done. The session and completion decision share one transaction
   since `07e4da8a`, and `fbebaf9a` commits the activation with the journal
   completion. Each change removes one write round trip; the hosted latency
   saving is unmeasured.
4. Finalize, the Router consume beside the Console claim: about 100 ms. It
   now runs after ceremony-proof and activation-identity verification. The
   production commit store returns a wallet-bound commit function only after
   the credential claim succeeds. Both remote effects settle before local
   persistence. `b6d9f2a7` claims the recovery-code routes of the custody
   commit in the same interval: about 148 ms in the trace. See
   [the record](#recovery-code-route-claim-beside-router-consumption).
5. Respond, the Console lineage read beside the home admission and the
   authority reads, and one commit batch for the last two writes: about
   100 ms and 44 ms. Done for the Ed25519-only respond. `b338a7e1` commits
   the ceremony update as a companion write of the Yao admission, and respond
   makes 7 round trips. `33df3f59` starts the lineage read once the signed
   setup is verified. That read then runs for a request that can still fail
   its home admission or its proof, at the cost of one Console read. Its
   result is used only after both pass, and the admission refuses a read
   that was started for another signing root ID. The staging numbers are not
   measured yet.
6. Sign prepare and sign. `e4ae2f91` already removes two reads from each. The
   two reads at the Gateway entry, deployment admission and session locator,
   are private code.

The Yao execute's Router call is the largest single item and is Phase 4.

`42cde7b7` was verified with the public setup scenario, which holds the
ceremony write until the allocation is requested and counts one ceremony
write, with all 131 contract cases, and with the private composed suite,
which keeps its two stale-harness failures and no other.

`b338a7e1` and `33df3f59` were verified with
`tests/e2e/registration-admission-companion.scenario.mjs`. It checks the
batch in both directions on a local database: a ceremony that moved rolls the
admission back, and an admission that moved rolls the ceremony update back.
It also drives the request-scoped runtime with a tenant-root read that it
holds open: the admission waits for that read, does not read again, an exact
repeat reads nothing, and a failed read fails only its admission. Each commit
passed the whole contract suite, 131 and then 132 cases, and the private
composed suite with its two stale-harness failures. `33df3f59` ran on the tip
that has `07e4da8a`. Under four parallel stacks a few cases timed out; each
passed when it ran alone. The private package type-checks against the public
build output of `33df3f59`.

These cuts do not reach the target alone. The traced flow was 5.5 s without
interaction. Items 1 to 6 remove about 0.5 s, and the Console merges about
0.25 s. The browser saw about 1.3 s beyond the Gateway time over six
requests, and the Router's Yao execution took 1.5 s. The 3–4 s target needs
fewer browser requests or a shorter Yao execution as well.

### Registration session and completion decision

The direct registration session commit now records `registration_completion =
'established'` in the same D1 transaction. It requires the exact wallet,
ceremony, authority, authentication method, and session mint. A conflicting
ceremony or cancelled registration aborts the transaction.

The later completion call reads that decision and omits its separate write
batch. It still publishes the session and home to Console before activating
the local generation. A lost Console reply therefore keeps ordinary signing
blocked. An exact retry preserves the issued session and repeats publication.
An acknowledged, active completion returns locally.

This removes one serial D1 round trip from direct NEAR and ECDSA registration.
The prior trace measured small write batches at 44–63 ms. That range is context,
not a measured saving for this change. No live deployment changed.

The production D1 scenario covers concurrent issuance, a wrong ceremony,
a lost completion reply, conflicting cancellation, exact retry, and activation.
It verifies one session transaction per attempt. Completion after issuance uses
one read and one activation batch. Reproduce it with:

```sh
node tests/e2e/session-issuance-transaction.e2e.mjs
```

The generated result is `.artifacts/session-issuance-transaction/proof.json`.
A retained copy is [the local transaction evidence](evidence/refactor-155d-registration-session-completion.json).
Server type checking and the wallet state type fixtures pass.
The bloat check passes. Seven isolated browser contracts also pass:

- Email OTP and passkey recovery after a lost NEAR finalization response.
- NEAR session publication without a status request, including lock behavior.
- NEAR exact replay, one commit, and signing after reload.
- Recovery after a lost NEAR finalization credential.
- Mixed NEAR/ECDSA registration and its timing fields.
- An immediately usable owner session before presignatures are ready.

The initial browser launch encountered occupied local ports before any test ran.
The successful run reused the completed builds with `SEAMS_LOCAL_PORT_OFFSET=2000`
and `SEAMS_INTENDED_SKIP_BUILD=1`. Its log is
`.artifacts/registration-session-completion-targeted.log`. No production change
was needed for the port conflict. The runner stopped all its services afterward.

### Credential claim beside Router consumption

NEAR finalization now starts the credential claim and Router consumption together.
The claim must succeed before the commit function becomes available. The function
retains the claimed authority and rejects a commit for another wallet or method.
Both effects settle before the request returns, including failure paths. Exact
retries retain the activation consumer and credential owner.

The earlier hosted trace measured Router consumption at 106 ms and credential
claim at 125 ms. Their overlap removes a serial dependency. Its hosted saving
is unmeasured. ECDSA still claims the credential before persistence. Email OTP
has no passkey claim.

The local production D1 scenario verifies a refused claim, a lost claim reply,
a wrong-wallet commit, transaction rollback, and exact replay. Reproduce it with:

```sh
node tests/e2e/registration-credential-reservation.e2e.mjs
```

Evidence is in `.artifacts/registration-credential-reservation/proof.json`.
Type fixtures reject direct persistence before reservation and replacement of
its bound authority. Wallet-server types and wallet-state type fixtures pass.
The bloat check passes. Four isolated browser contracts pass: Email OTP and
passkey lost-finalization recovery, mixed registration, and immediate session
use before presignatures are ready. Their log is
`.artifacts/registration-claim-browser.log`.

The private composed scenario also passes: the real Router consumes activation,
then the Console credential claim returns 503. The Gateway publishes no wallet.
The SDK receives the failure. An exact retry through WEUR waits for the journal
lease, repeats the same consumer and credential identity, and completes. The
original browser then unlocks with its passkey and signs through OC while Console
is unavailable. The signature is independently verified. Run
`tests/scripts/run-regional-real.mjs --grep 'NEAR registration retries a credential claim'`
with the candidate package and isolated local ports. The evidence is
`.artifacts/r155d-claim-after-consume/proof.json` in the private repository.

The failure test must return the original failure to the SDK. Hiding it while
waiting for the 30-second journal lease exceeds the temporary client-seal
preparation's 30-second lifetime. Recovery uses a fresh exact-method unlock.
This fault-path delay is excluded from the successful registration benchmark.

### Activation in the journal completion batch

Finalize ended with two local write batches: one set the wallet's home to
`active`, and the next recorded the completed operation in the registration
journal. `fbebaf9a` commits both in one D1 transaction, for the
`near_provisioning` journal and for the `registration_activate` journal.

The order before that batch is unchanged. The session commit fixes the
completion decision. The Gateway then publishes the session and the home to
Console and waits for the acknowledgement. Only an acknowledged publication
returns the activation statements, and only the journal's completion commits
them. The activation's guard directly follows its update, so a home that may
no longer become active fails the whole batch.

| Failure | State it leaves | Retry |
| --- | --- | --- |
| Console refuses, or its reply is lost | Home `registering`, journal still a claim | Publishes again with the original session |
| The batch does not commit | Home `registering`, journal still a claim | Publishes again, then commits both |
| The batch commits and its reply is lost | Home `active`, journal complete | Returns the stored response and publishes nothing |
| The activation's guard refuses | Home unchanged, journal still a claim | Refused again while the home may not become active |

Before this change a failure between the two batches left an active home
beside an incomplete journal. That state no longer exists: ordinary signing is
enabled exactly when the journal holds the completed registration.

The home authority no longer takes the directory's completion call. `8cfc587a`
gives it `publishEstablished` and `cancel`, and removes the form that published
and then activated in a batch of its own. Only storage scenarios called that
form. They now publish and commit the activation through one test helper, and
private `6009bd4` follows in the session-routing scenario.

The production D1 scenario runs the registration journal against the real
authority and stores. It verifies the write sequence, a home that stays fenced
between publication and completion, an exact replay that publishes nothing, a
lost completion, and a refused activation that leaves the operation
incomplete. Reproduce it with:

```sh
node tests/e2e/authorization-storage-transfer.e2e.mjs
```

Its evidence is the `activationCompletion` observation in
`.artifacts/r153/authorization-storage-transfer/evidence.json`.

Server type checking, the wallet-state type fixtures, the contract type
check and the bloat check pass. The private server package type-checks
against this tree. Hosted latency is unmeasured.

The full suites ran with this change on public `1a783da1` and private
`2a0520b`. The contract suite passed 132 of 132: 128 in three parallel shards
on release Workers, two load-sensitive cases alone, and the two
terminal-fault cases on dev Workers. The composed private suite passed 23 of
23, its two restart cases alone. After the merge onto public `7546d3ed` and
private `1f931b2` the type checks, five storage scenarios, the composed
registration and lost-reply cases, and the 46 registration contract cases
passed again. On the committed tip the server type check, that scenario and
the two composed cases passed.

For `8cfc587a` the type checks, three storage scenarios, the private
session-routing scenario, four composed registration cases and 17
registration contract cases passed.

### Recovery-code route claim beside Router consumption

The custody commit of a registration first claims its recovery-code routes at
Console and then writes its records. Both steps ran after the wallet commit,
beside the capability installation. The stored-address trace measured the
claim at 148 ms, and it was the longer branch of that pair.

`b6d9f2a7` splits the custody commit. The claim now runs beside Router
consumption and the credential claim, for the NEAR leg, and beside the
credential claim for the ECDSA leg. The write still follows the wallet commit.
The custody store has one entry, `reserveRegistration`, which claims the
routes and returns the function that writes the records.

What stays as it was:

- The three remote effects are exact-retryable, and all settle before local
  wallet persistence or a failure reply.
- Custody never fails a registration. A refused or failed claim reports the
  custody commit as `rejected`, the registration continues, and the client
  retries. The claim cannot reject its caller.
- Console accepts routes for a reserved home, as it did before. An exact retry
  repeats the same claim and is accepted.

What is new: a finalize that fails after the claim leaves its routes in the
directory. Before, that state existed only when the custody write failed
after its claim. A retry with new recovery codes adds routes beside the old
ones. Console has no route cleanup: the routes of a cancelled registration
are not found by lookup, but they still refuse another wallet that names the
same locators. Recovery codes are random per custody ceremony.

The composed claim-failure scenario covers the new order with the real
Console: the first finalize claims the routes once before any wallet record
exists, the credential claim then fails, and the exact retry repeats the same
route claim and completes. Run it with
`tests/scripts/run-regional-real.mjs --grep 'NEAR registration retries a credential claim'`.
The four-region service scenario covers the store: an unavailable Console
refuses the reservation and stores nothing, a reservation alone stores
nothing, its commit stores the records, and a repeat is answered
`already_exists`.

Server type checking, the wallet-state type fixtures, the contract type
check and the bloat check pass. The private server package type-checks
against this tree. Hosted latency is unmeasured.

The full suites ran with this change on public `dfea8246` and private
`6009bd4`. The contract suite passed 132 of 132: 128 in three parallel shards
on release Workers, two load-sensitive cases alone, and the two
terminal-fault cases on dev Workers. The composed private suite passed 23 of
23: 19 in the parallel run, three load-sensitive cases alone, and the
registration case after its ceiling was corrected as recorded above. After
the merge onto public `e7f12f23` and private `17f83da` the server type check,
the composed registration and claim-failure cases, and every rerun case
passed. Private `d89cc0e` holds the two scenario changes.

### Decisions

Decided on October 10:

- The wallet-object address change in Phase 1 proceeds. Staging wallets are
  disposable. Production testnet and mainnet are outside the discard scope
  until a separate reset-or-migrate decision. The owner's subsequent instruction
  to proceed authorized the temporary staging comparison recorded in Phase 1.
  Permanent activation remains part of the coordinated release. Version 0.9.0
  follows the change.

Open decisions and work:

1. Complete the separately tracked staging role-database cutover. The Phase 4
   record names the replacements and outstanding deployment-path decision.
2. Freeze new baseline versions after that cutover. The completion and allocation
   comparisons are finished; their saved custody versions retain the old database bindings.

Remaining scope, with the reason:

- The four-to-six-round-trip finalize target remains open. Credential claim
  now overlaps Router consumption. Session issuance commits its completion
  decision atomically, and activation commits with journal completion.
  Finalize still makes three Console requests. Since `b6d9f2a7` the
  recovery-code route claim runs beside Router consumption and the credential
  claim, and only the custody write still overlaps capability installation.
  Combining the claim with completion could remove a request but no elapsed
  time. Further batch changes must retain exact replay, ownership fences, and
  publication order.
- Sign prepare during confirmation. An admitted prepare claims one use of the
  session's quota, so a declined confirmation would spend a use unless prepare
  gains a release. It also sends the operation to the server before the user
  approves it.
- The five-browser-request target conflicts with the explicit exclusion of
  combined execute/finalize. The current flow has six requests and no status
  request. Moving prepare into confirmation changes timing, not request count.
  Reaching five requires a scope decision about the combined endpoint.

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

### Custody path audit after stored addresses

The [custody audit evidence](evidence/refactor-155d-custody-path-audit.json)
extracts three-wallet measurements from the existing stored-ID candidate
`28c58d85`. It adds no new deployment or latency claim.

| Work | Median | Range |
| --- | ---: | ---: |
| A preparation within execution | 148 ms | 143–149 ms |
| A WebSocket connection | 261 ms | 260–269 ms |
| A Yao protocol span | 336 ms | 259–394 ms |
| B Yao protocol span | 211 ms | 201–222 ms |
| A whole execute invocation CPU | 262 ms | 251–272 ms |
| B whole duplex invocation CPU | 323 ms | 233–352 ms |
| Signing wallet object CPU, prepare and sign | 21 ms | 19–26 ms |

A already settles its D1 admission through `wait_until` after it records the
completed outcome in its wallet object. That settlement stays in the background.
The encrypted outcome and completion state must commit before the reply. A lost
reply then recovers the same outcome instead of executing Yao again. Moving that
write after the reply would break this guarantee.

Cloudflare's invocation wall time can include background settlement after the
response. Subtracting it from a parent request would give a false dispatch cost.
The existing application clock also advances at I/O, so a zero-millisecond output
span does not prove that output encryption has no cost. Separate output-seal and
storage-flush measurements remain open.

### Follow-up designs beyond this plan

**Return registration finalization with Yao execution.** The execute route would
carry the exact registration authority and client custody commitment that finalize
currently receives. It would return only after the same durable journal, custody,
session, discovery and home-completion steps succeed. A lost response must replay
the exact committed outcome. This removes a browser exchange; it does not remove
those completion requirements. Mixed-signature registration and recovery must retain
their separate lifecycle identities.

**Issue signing commitments before the message.** A one-request signature would
need one-use server commitments bound to the exact wallet, material activation,
session and ownership generation. The server must atomically admit the message and
consume the commitments. Cancellation, expiry, relocation, revocation and competing
signatures must never permit nonce reuse. This requires protocol design, Rust
vectors and formal verification before implementation. It is separate from moving
the existing prepare request into the confirmation interval.

### Fresh admission skips the absent-record read

A fresh Yao admission expects its ceremony record to be absent. The D1 adapter
now reads prior state only for mutations that expect an existing version. The
conditional insert still rejects a competing creation. Its ownership fence,
ceremony activity projection and companion registration write remain in the same
transaction. This removes one D1 read from a fresh respond request. Updates still
read prior state to identify changed wallet ownership.

`node tests/e2e/authorization-storage-transfer.e2e.mjs` passes. Its registration
companion scenario checks atomic admission, stale ceremony refusal and stale
admission refusal. The broader scenario verifies authorization transfer and
ownership fences. Evidence: `.artifacts/r153/authorization-storage-transfer/evidence.json`.
Wallet-server type checking and the bloat check pass. Hosted latency is unmeasured.

### Deriver A completion spans

The candidate emits `deriver_a.output_seal` for activation,
`deriver_a.outcome_record` for the durable completed result, and
`deriver_a.admission_settle_background` for the D1 acknowledgement.
The acknowledgement remains in `wait_until`. It does not gate the successful reply.
The encrypted completed result remains durable before the response leaves the object.
Cloudflare's output gate enforces that ordering. No extra flush or network request
was added for measurement.

These spans use the existing Worker wall clock. A zero-duration synchronous span
does not establish zero CPU cost. Hosted timing remains pending. The Deriver A
WASM target check and the bloat check pass.

### Gateway registration-continuation routing

The entry query selects the active deployment, the session wallet and the
registration wallet together. The ceremony selector remains scoped to the exact
tenant and registration origin. The handler checks a supplied session against
that wallet and performs its existing authorization and write fences.
The old separate continuation query is removed.

The local session-routing E2E and the four-region service-routing E2E pass.
The latter covers credential retirement, linked devices, recovery, registration
completion and directory failures. Three old fixture expectations needed updates:
established completion requires session publication, home conflicts have a
structured code, and unrelated publications must not change an expected total
row count. The directory assertion now checks each issued session's wallet.
Candidate TypeScript checks pass. Hosted latency remains unmeasured.

### Gateway address snapshots and combined setup — October 10

Public `81e5f690` and private `be6fb57` include stored custody addresses in the
Gateway admission query. Forwarding reuses that request's exact tenant, wallet,
and ownership-generation snapshot. A changed generation reads the current
address. Caller headers cannot supply the snapshot. Four regional browser
scenarios passed: owner signing after relocation, retirement during a write,
relocation during admitted signing, and retry after a failed credential claim.

Setup now combines publishable-key authentication, environment resolution, and
home reservation in one Console invocation. Console checks the publishable key,
origin, tenant, and active environment before it reserves anything. Gateway reuses
the returned assignment only for the same operation and request digest. Each
forwarded request still authenticates independently at its destination.

Both real browser scenarios passed: NEAR-only and mixed-signer setup reply loss,
reload, foreign-region retry, and three signatures with Console unavailable.
An invalid credential created no directory row. Each attempt or forwarded
request made one combined Console call. Neither the separate context call nor
the separate reserve call ran. Server builds, public and private type checks,
and the public bloat check passed. This setup merge is newer than the frozen
`81e5f690` / `be6fb57` hosted comparison and has no hosted latency result yet.

Local evidence: private `.artifacts/r155d-setup-local/browser.log` and
`.artifacts/r155b/console-outage/setup-retry-{near-only,mixed}/setup-retry.json`.
The browser scenarios are repeatable with `tests/scripts/run-regional-real.mjs
--grep 'setup reply loss survives reload'` against matching public build output.

### Entry and finalization comparison — October 10

The [controlled hosted evidence](evidence/refactor-155d-entry-finalization-hosted.json)
compares public `28c58d85` / private `13a5529` with public `81e5f690` /
private `be6fb57`, then repeats the baseline. All arms already use stored unique IDs.
The SDK, placement configuration, and measurement wrappers stayed fixed.
Each arm registered three fresh NEAR-only wallets and verified one NEP-413 signature per wallet.

| Measurement | Baseline median | Candidate median | Repeated baseline median |
| --- | ---: | ---: | ---: |
| SDK registration through first signature, excluding interaction | 6.132 s | 6.001 s | 6.616 s |
| SDK registration, including WebAuthn | 5.487 s | 5.457 s | 5.859 s |
| SDK first signing call, including confirmation | 1.349 s | 1.674 s | 1.658 s |
| Router Yao execution | 1.584 s | 1.423 s | 1.741 s |
| Finalization service | 1.098 s | 1.047 s | 1.230 s |

Candidate SDK flow excluding interaction ranged from **5.792 to 8.077 s**.
The maximum was **8.077 s**. These three-sample medians do not establish an isolated
latency saving. The first signature was slower than the first baseline.
The 3–4 s goal remains unmet.

| Gateway request | Baseline D1 calls | Candidate D1 calls |
| --- | ---: | ---: |
| Setup | 6 | 5 |
| Respond | 10 | 7 |
| Yao execute | 4 | 2 |
| Finalize | 21 | 18 |
| Sign prepare | 8 | 4 |
| Sign | 9 | 5 |
| **Total** | **58** | **41** |

These counts include Gateway entry admission. All three samples in each arm had
these counts. Every flow made six browser requests, with zero session-status requests
and one setup-time wallet startup. Keep the changes: the removed calls are measured,
even though platform variation obscures their elapsed-time effect.

All **17 comparison checks** passed. All **nine signatures** passed independent
verification, including rejection after signed-field changes. Candidate invocations
matched all four stored role IDs for each of the three wallets. Readback verified
restoration of **13 Worker versions** and **two Deriver schemas**. The four additive
Gateway address tables remain. The comparison created no resources.

A's output sealing and outcome recording each measured 0 ms on the Worker clock.
That clock advances at I/O, so these readings do not establish zero cost.
Background admission settlement measured 148 ms median, 138–176 ms. It remains
off the response path. The durable encrypted outcome must precede the response
so a lost reply can recover the same result. The evidence retains raw invocation
CPU and wall times without subtracting child invocation times from their parents.

The combined Console setup (`7546d3ed`, private `1f931b2`) landed after this
candidate froze. Its hosted saving remains unmeasured. Its local six-case regional
matrix passed, covering concurrent setup, completion replay, Email OTP step-up,
foreign ingress, and relocation during signing.

### Exact-version lifecycle snapshots — October 10

`73d8b5bb` removes the prior-record read from a normal lifecycle update when the
store just loaded that exact version. The store preserves an immutable copy of
its latest read batch. The write consumes that observation. Missing observations
still require a read. The existing atomic version check rejects concurrent changes.
Ownership fences and companion writes stay in the same transaction.

The authorization-storage-transfer E2E passed. It covers admission/ceremony rollback,
stale retries, frozen-wallet writes, and unrelated-wallet progress. Type-checking and
the bloat check passed. Evidence remains in
`.artifacts/r153/authorization-storage-transfer/evidence.json`. Hosted timing is pending.

### Signing authorization and Console reads — October 10

`bed2e264` includes the active Yao capability in the existing session/signer/policy
statement. It uses the same capability resolver as the lifecycle runtime. A missing
cache entry retains persisted-capability reconciliation. The observation belongs to
the authenticated wallet. Each request still reads its session and enforces admission.

Six composed browser cases passed: Console-independent Email OTP quota exhaustion
and both step-ups, owner and linked-device regional signing, retirement during an
in-flight request, pending-operation relocation fencing, registration completion,
and lost completion replay. The server build and bloat check passed.

Private `3e3c0b7` returns a new home reservation from its atomic insert. A repeat
still reads and validates the existing reservation. Private `19aebf9` updates credential
usage metadata with one `UPDATE ... RETURNING` statement. Previously, it read the key,
wrote usage, then read the key again. Endpoint counters now increment atomically.
These changes remove three Console D1 calls from successful fresh setup.

The production Console service E2E passed, including eight concurrent authenticated
uses, environment changes, origin refusal, rotation, and revocation. The wallet-home
E2E passed, including competing reservations, deployment pauses, travel, and restart.
Three composed browser setup cases also passed, including lost replies for both
signer sets and concurrent NEAR setup through three regions. The private type check
passed. These latest changes still require hosted measurement.

The combined public tree also passes the authorization-storage-transfer E2E,
wallet-state type fixtures, intended-contract type checking, and the bloat check.
Logs are `.artifacts/r155d-combined-*` in the public repository and
`.artifacts/r155d-console-roundtrips-*` / `.artifacts/r155d-setup-local/` privately.

### Production Console activation fixes — October 10

The combined candidate failed its staging registration canary before measurement.
The canary returned `registration_environment_unavailable`. Cleanup restored all
13 original Worker versions and both Deriver schemas. Independent readback passed.
The baseline arm completed, but this attempt produced no candidate latency result.

The canary exposed two production regressions in the combined Console setup:

- The internal fetch adapter accepted a `Request` only. The client passed a URL
  and request options, so the adapter discarded the POST body. It now constructs
  the request from both arguments before calling the handler.
- The combined route required `accounts.create` in a publishable key's scope list.
  Publishable keys have no secret-key scopes. Successful publishable-key
  authentication and the exact organization, project, environment and origin checks
  authorize registration. The incorrect scope requirement is removed.

Private `680bb10` fixes both. The existing production Console Worker E2E now calls
the combined route, reserves in APAC, retries through WEUR, and rejects an invalid
origin. It uses real persisted credentials and the production Worker/service binding.
That scenario and the wallet-home directory E2E pass. Type-checking passes against
the frozen public candidate. A shared test fixture used signer slot zero, which
the current request parser rejects. Its slot is corrected to one.

The resumed comparison preserves the completed baseline, rebuilds the fixed
Console candidate, then measures candidate and repeated baseline. The interruption
and source versions remain in private `.artifacts/r155d-completion-hosted`.
The candidate and control measurements both passed. The final results follow below.


### Combined lifecycle verification — October 10

The frozen public candidate `63acba09` passes all **132 intended-behaviour
contracts**. [The evidence file](evidence/refactor-155d-completion-contracts.json)
records each case and log hash. Two recovery cases initially used a Google test
identity near expiry. Both passed with a fresh identity. Two terminal-failure
cases initially failed local custody startup. Both passed with the matching
local custody build. These were environment failures. Production code did not
change to satisfy them.

The private production Console Worker and home-directory E2E pass. The combined
registration browser case passes. ECDSA and Ed25519 signing both pass after the
Gateway and all five custody Workers restart while Console remains unavailable.
The Google Email OTP recovery case also passes after a lost finalization reply
and restart through another region. It continues through unlock, signing on both
curves, and both key exports.

Private `3a3a971` extends only the test process startup timeout. Four persistent
regional migrations could exceed the old 30-second timeout. Private `17f83da`
fixes an obsolete fixture: restart regenerated the Console deployment revision
while regional databases retained the original revision. The fixture now reloads
the persisted binding and checks that all four regions agree. Production routing
correctly refused the mismatched revision and remains unchanged.

Private `.artifacts/r155d-completion-local/verification.json` records the composed
checks and repeatable restart evidence. The private Console package type-checks
against the frozen public candidate.


### Completion and Console comparison — October 10

This comparison keeps custody Workers and the SDK fixed. Nine host Worker versions
change together: Console, four Gateways, and four Runtime Workers. Public
`63acba09` and private `680bb10` form the candidate. Public `81e5f690` and private
`be6fb57` form the baseline and repeated baseline control. Each arm uses three
fresh NEAR-only wallets and independently verified NEP-413 signatures.

| Metric, median | Baseline | Candidate | Repeated baseline |
| --- | ---: | ---: | ---: |
| SDK registration → first signature, excluding interaction | 9.679 s | **5.574 s** | 5.845 s |
| Observed range for that metric | 6.170–9.770 s | **4.945–7.607 s** | 5.177–6.958 s |
| SDK registration call, including interaction | 6.089 s | 5.587 s | 5.163 s |
| SDK first signing call, including confirmation | 2.164 s | 1.208 s | 1.193 s |
| Router Yao execution | 1.636 s | 1.458 s | 1.397 s |
| Finalize service | 1.149 s | **1.038 s** | 1.381 s |
| Browser registration → independent verification, including harness | 10.714 s | 7.630 s | 6.857 s |

The 3–4-second target remains unmet. The candidate is 271 ms faster than the
repeated baseline by median, but these samples do not isolate that difference.
The initial baseline contains a 4.265-second sign HTTP request. Local lifecycle
checks also ran on the client during parts of the comparison. Browser and SDK
elapsed times can include client scheduling variation. Do not claim the 4.104-second
baseline-to-candidate difference as the change's isolated saving.

The call reductions are consistent across every sample:

| Gateway request | Baseline D1 calls | Candidate D1 calls | Repeated baseline |
| --- | ---: | ---: | ---: |
| Setup | 5 | 5 | 5 |
| Respond | 7 | 7 | 7 |
| Yao execute | 2 | 2 | 2 |
| Finalize | 18 | **16** | 18 |
| Prepare | 4 | **3** | 4 |
| Sign | 5 | **4** | 5 |
| Total | 41 | **37** | 41 |

Fresh setup's Console calls change from context plus reserve to one combined
request. Those operations require **8 → 5 D1 calls**. Across the complete flow,
Console requests change **7 → 6**, and Console D1 calls change **21 → 18**.
Six browser requests remain. All wallets send zero status requests and one
startup request. Startup reaches the Router before respond in all nine samples.
The four stored object IDs match the candidate's invocation logs for all three
wallets.

All **18 comparison checks** pass. All **nine signatures** pass independent
verification and signed-field tampering is rejected. Independent readback confirms
all **13 original Worker versions**, both Deriver schemas, and the four retained
additive Gateway tables. No new resources were created.

[The hosted evidence](evidence/refactor-155d-completion-console-hosted.json) includes
exact versions, public signature proofs, request counts, D1 traces, timing ranges,
and restoration checks. Private `.artifacts/r155d-completion-hosted` retains the
frozen sources and reproduction scripts.


### Ceremony identity reuse — after the completion comparison

Finalization previously queried the active founding identity and substituted its
IDs into the prepared registration. Setup already persists those IDs in the
ceremony and checks them against its reservation on retry. Finalization now uses
that exact persisted identity and rejects a conflicting operation identity. This
removes the preliminary identity SELECT without changing the later transactional
checks for existing authorities, auth methods, or mixed-signer extension.

The [later comparison](evidence/refactor-155d-allocation-hosted.md) measures this
change with the subsequent batches. The server build and bloat check pass. Targeted
NEAR replay, retirement, mixed registration, concurrent signer admission, and
Email OTP lost-finalization checks all pass: four existing browser scenarios.
[The local evidence](evidence/refactor-155d-ceremony-identity.json) records the
results and log hashes. The first isolated launch lacked a workspace package
link and stopped before any scenario ran. Fixing that export required no
production change.

### Persist registration ownership during setup

Setup now saves the authenticated wallet, ceremony, and ownership generation
with both ceremony records in one D1 batch. Address initialization still runs
beside it. This adds no setup round trip and removes the continuation's Console
lookup and separate D1 insertion batch. Missing identities fail locally.
Retries preserve an advanced ceremony and cannot reopen a retired home.
No schema migration is required. The later comparison measures this change.

The assembled setup check covers atomic rollback, lost allocation replies,
local admission, and cancellation while Console is unavailable. Session issuance,
activation completion, relocation storage, regional routing, and three browser
registration scenarios pass. The server build and bloat check pass.
[Local evidence](evidence/refactor-155d-setup-home.json) records the artifacts,
derived registration-only timings, and the remaining measured costs.

Console now batches route publication and registration completion internally,
preserving the early route claim. [Evidence](evidence/refactor-155d-console-batches.md) records the changes and checks.
Address initialization now overlaps the ceremony read. [Evidence](evidence/refactor-155d-allocation-overlap.md) records the diagnosis and verification.
The [controlled comparison](evidence/refactor-155d-allocation-hosted.md) verifies fewer calls; overall latency improvement remains unproven.
