# R155H — Custody execution at setup, Console exchanges off the path, and the registration floor

Status: **in progress.** Phase 0's instrumentation and platform check are
done; its staging group is open. Phase 4's table-frame yield and SIMD build
are implemented, and their staging comparison is running. The decisions for
Phases 1 to 3 are taken. Date: October 12, 2026.

This plan owns the registration latency work that
[R155G](refactor-155G-apac-anchor-and-hidden-exchanges.md) does not: the idle
window between setup and respond, the two Console exchanges inside
finalization, the seal's release-build check, the Deriver CPU factor on Cloudflare,
setup for direct API callers, the browser's distance to the Gateway, and the
tail. R155G keeps its phases and their owners: the production anchors, the
early sign prepare for delegate actions, and its measurement record. Do not
repeat its work here, and do not report its savings again. Phase 1 here
supersedes R155G's two Phase 3 reviews, the early Deriver admission and the
base oblivious transfers ahead of execute.

## Objective and ownership

Registration alone must reach **2–3 seconds at the median** from Tokyo,
including setup, and **2 seconds or less after setup**, which is what a user
of the hosted auth menu waits for. Report the 90th percentile beside the
median from here on: a 2–3 second promise is a tail promise. The first
signature stays a separate metric and stays with R155G. User interaction, test
automation, funding and blockchain confirmation stay outside the SDK metrics,
and the inclusive timings are retained.

The Yao execution has its own objective. The protocol's real time must move
from about 850 ms to 450 ms or less, and the Router's execute span from
1,624 ms to under 800 ms. The July probe's 202 ms is not a real duration: the
Worker clock excludes an invocation's own CPU, and the same pair takes
520–640 ms of real time today
([probe record](evidence/refactor-155h-probe-hosted.md)). With one event-loop
turn per table frame the pair takes 290–350 ms, and that is the reference the
production protocol can approach. The Router's claim, the Signing Worker
delivery and the Router's finish, about 250 ms of durable bookkeeping, stay.
Phase 4 owns this objective; Phase 1 removes the admission and the connection
from the online path.

Decisions this plan needed before Phases 1 to 3 start. The first three are
taken; see "Decided on October 12" below.

- **Setup may prepare custody before the passkey proves anything.** Setup is
  authenticated by the publishable key only. A prepared pair session costs two
  D1 admissions and about one Deriver's worth of CPU without a credential. The
  control is the existing setup route policy; no new quota family.
- **A registration that fails after its passkey claim must release the
  claim.** Console refuses cancellation after a claim today, which is why
  R155F kept the claim inside finalization.
- **Console completion may follow the finalization reply from a tracked
  outbox.** The intended behaviour says the Gateway acknowledges completion
  before it enables ordinary signing. After this change the local transaction
  enables signing on the established session, and the Console display row and
  cross-region discovery lag until the outbox lands, normally within the same
  second.
- **The distance to the Gateway is accepted or gets its own plan.** Phase 6 is
  a bounded study, not an implementation.

Decided on October 12:

- **Setup may admit custody before the passkey proves anything: yes.** The
  admitted session expires with the ceremony, one per wallet object, and the
  setup route policy must hold a per-key rate limit before Phase 1 ships.
- **A registration that fails after its passkey claim releases the claim:
  yes.** The release acts only on a terminal registration without a session.
- **Console completion from a tracked outbox: yes, and last.** Phase 3 runs
  after Phases 1, 2 and 4 are measured, and only if registration after setup
  still needs it.
- **The custody tier stays on Cloudflare.** A native custody service on a
  virtual machine was explored as a hypothesis. The native floor below records
  what it would have bought, so the comparison is not repeated. Phase 1
  proceeds on Workers.

## Measured starting point

Candidate medians of the
[combined comparison](evidence/refactor-155g-combined-hosted.md) of
October 11, twelve wallets from Tokyo on the Hong Kong layout, and the chain
medians of the same run's 24 executions from the private `yao-chain.py`.

| Stage | Browser | Server | Inside the server span |
| --- | ---: | ---: | --- |
| Setup | 692 ms | ~440 ms | Console registration-setup, about 140 ms of Console work plus the hop; four D1 calls; signing. The browser adds its own preflight, 125–191 ms, and the distance |
| Respond | 256 ms | 167 ms | Console active-lineage, five D1 calls, WebAuthn verification |
| Yao execute | 1,741 ms | 1,624 ms | Claim 96, dispatch 26, admission 113, connect 196, B's re-read 56, protocol about 800, delivery 88, finish 69 |
| Finalize | 909 ms | 576–651 ms | Claims 140–242 beside the consume 77–168, wallet commit 164–185, session issue 70–113, custody commit 59–85, Console completion with the seal beside it |
| Registration, excluding WebAuthn | 3,767 ms | | 3,138 ms after setup |

Client work outside the four requests is about 130 ms. The four requests are
96% of a registration.

The [final R155G comparison](evidence/refactor-155g-final-staging.md) of
October 12, on release builds against the verified October 12 staging
deployment, is the current baseline: registration excluding authentication
3.47–3.64 s at the group medians over six wallets each, setup 513–635 ms,
respond 210–235 ms, Yao execute 1,739–1,887 ms, finalization 806–842 ms, and
78–108 ms of Gateway CPU per finalization with the release seal. The per-part
chain figures above come from the October 11 run; the Phase 0 group refreshes
them on the same deployment.

Facts that shape the phases:

- The gap between respond and execute is about 30 ms of client work. The only
  idle window is the passkey prompt between setup and respond: 0.1–0.6 s with
  the automated authenticator, one to three seconds for a person. Only the
  wallet-object startup uses it today. For the hosted menu the window is longer
  still, because setup runs while the user is in the menu.
- Deriver A used 340–746 ms of CPU per execution, median about 400 ms, and
  Deriver B 295–543 ms, median about 330 ms. The
  [local warm profile](evidence/refactor-155g-deriver-cpu-local.md) measured
  86 and 84 ms for the same work. The Deriver Workers are release builds:
  `build-strict-worker.sh` builds `--release` unless
  `ROUTER_AB_WORKER_BUILD_PROFILE=dev`, so the factor is not a build artifact
  like the seal's.
- **The platform costs about four times the laptop, steadily.** The
  [probe record](evidence/refactor-155h-probe-hosted.md) of October 12 ran
  the bare benchmark pair on Cloudflare: 139 ms per ceremony on local
  workerd, 520–640 ms deployed. CPU per ceremony was 200–350 ms for A and
  180–300 ms for B. It varies by serving machine and does not fall over
  twenty warm repetitions, so tier-up is not the cause.
- **A new isolate costs 400–1,000 ms of CPU once.** The first ceremony of an
  isolate used 600–1,370 ms of CPU in Deriver A. With a placement region, 6
  to 8 of 31 probe ceremonies met a new isolate. Production's Deriver A CPU is
  bimodal, near 350 ms and near 600 ms; the isolate counter of Phase 0 says
  how many production executions are a first run.
- **The Worker clock excludes an invocation's own CPU.** A clock span
  measures waits only. The July probe's 202 ms p50, the production
  `deriver_a.yao_protocol` span and R155F's "CPU work that the clock does not
  show" are this one effect. The same probe pair reads 250–400 ms by its clock
  today and takes 520–640 ms. No delay follows Deriver A's last frame: the
  373 ms between its last clock reading and the Router's receipt is its own
  CPU. Real protocol time in production is the clock span plus A's CPU, about
  850–900 ms at the median of the October 11 run.
- **Garbling and evaluation ran one after the other.** The WebSocket
  transport's `send` queues a message and returns without a turn of the event
  loop. Deriver A garbled and queued all 17 table frames before it first
  waited, so Deriver B started evaluating after the last frame was garbled,
  and real time was the sum of both roles' CPU. One zero-length timer after
  each table frame restores the overlap: 290–350 ms against 520–640 ms in
  Tokyo, 455–485 ms against 620–650 ms in Hong Kong, alternating runs, same
  protocol bytes. The production transport has the same `send`.
- The native floor, measured on October 12: the raw 64k activation ceremony
  takes **67 ms** wall on an M4 Pro, both roles over Unix sockets, 33 frames,
  eight runs with `benchmark_phase5_role`; the native local registration
  lifecycle through `router-ab-dev` measures 94 ms p50. WASM costs about 2×
  native on the laptop, and the deployed platform about 4× local workerd.
- Garbled tables depend on the garbler's seed and the circuit, not on either
  party's input. The oblivious transfer and the evaluation need the client's
  encrypted inputs, which arrive with execute.
- The seal is not a lever. Every hosted comparison before October 12 bundled
  a development build of the Shamir module, 654,272 bytes against the
  92,823-byte release build, which made the seal look like 160 ms of
  finalization CPU. R155G's isolated probe of October 12 measured the release
  seal at **5.4–5.9 ms per operation on a Worker**, and finalization's Gateway
  CPU fell to 78–108 ms. The seal stays synchronous in the reply. `num-bigint`
  already uses a windowed Montgomery ladder with 32-bit limbs on `wasm32`; no
  arithmetic change is needed.

## Implementation inventory

| Area | Files |
| --- | --- |
| Setup and respond | Public: `packages/wallet-server/src/router/domains/walletRegistration/walletRegistrationRoutes.ts`, `router/cloudflare/d1/registration/d1WalletRegistrationService.ts` (`setupWalletRegistration`, `authorizeWalletRegistrationNearAdmission`), `router/cloudflare/d1/walletObjectAddresses.ts`; SDK `packages/wallet/src/SeamsWeb/operations/registration/registration.ts` (`setupThreeRouteRegistration`, the NEAR-only path), `core/rpcClients/relayer/walletRegistration.ts`. Private: `packages/wallet-console-server-ts/src/walletPlacement/registrationSetup.ts`, `regionalDispatch.ts` |
| Router and Derivers | `crates/router-ab-cloudflare/src/router_coordinator.rs`, `durable_object/router_wallet.rs`, `durable_object/wallet_startup.rs`, `durable_object/deriver_a_pair.rs`, `durable_object/deriver_b_pair.rs`, `ed25519_yao_lifecycle/deriver_b_start.rs`, `strict_worker/mod.rs` (`/internal/prewarm`), `tenant_root_role_d1/bound_share.rs` |
| Yao engine | `crates/ed25519-yao/src/passive/role_protocol.rs` (`DeriverAState`, `DeriverBState`), `runtime.rs` (`GarblerMachine`), `stream.rs`, `stream_kats.rs`; `crates/router-ab-ed25519-yao/src/duplex.rs`, `execution.rs`, `crypto.rs`; `docs/router-ab/ed25519-yao.md` |
| Finalization and Console | Public: `d1WalletRegistrationService.ts` (`reserveAuthority`, `reserveRegistrationCustody`, `consumeActivated`), `walletRegistrationEstablishedSessionIssuer.ts` (`publishCommittedRegistration`), `router/domains/ed25519Yao/registration/routerAbEd25519YaoHttpRegistrationBackend.ts` (`gateway.d1_commit`), `routerAbEd25519YaoRegistrationTwoPhaseRunner.ts`, `hosted-wallet-gateway-worker.ts` (the scheduled handler). Private: `walletPlacement/d1.ts` (`D1WalletHomeDirectory.complete`), `passkeyClaims.ts`, `walletRouteLocators.ts`, `router/cloudflare/cron.ts` |
| Seal | `wasm/shamir3pass_runtime/`, `packages/wallet-server/src/threshold/session/signingSessionSeal/`, `router/domains/walletRegistration/registrationSessionSeal.ts`; SDK `core/signingEngine/workerManager/workers/shamir3pass/` |
| Specification and contracts | `docs/intended-behaviours.md`, `docs/refactor-155C-yao-peer-connection.md` (the flow description), `tests/e2e/intended-behaviours/passkey.registration*.contract.test.ts`, `passkey.ed25519-yao-local.contract.test.ts`, `tests/e2e/registration-setup-startup.e2e.mjs`, `registration-credential-reservation.e2e.mjs`; the private composed scenarios in `seams-monorepo` |
| Measurement | `tests/e2e/hosted-product/near-signing-latency.test.ts` and the hosted drivers under `.artifacts/` in `seams-monorepo`; `.artifacts/r155f-yao-chain/` (`yao-chain.py`, `yao-timeline.py`, `isolate-starts.py`); `.artifacts/r155g-deriver-cpu/` in `seams-wallet` |

## Execution order

Phase 0 first and alone: it is cheap and it decides Phase 4. Phase 1 is the
largest and the only one that reaches the target with setup from Tokyo; start
it as soon as the setup decision is taken. Phase 2 is independent and small;
it can run beside Phase 1 in different files. Phase 3 waits for the completion
decision. Phases 5 to 7 are bounded and fill the gaps.
Phase 8 measures the accumulated changes once, with the warm-up policy.

Each phase that changes a wire shape or a lifecycle claim updates the
specification and its contract test in the same change set. A registration
wire change moves the wallet-management protocol version with the private
pins, as the 0.9.0 release did. Keep production fixes, valid test updates and
stale-test deletions in separate commits.

## Phase 0 — Measurement contract and the CPU factor

- [x] Add an isolate-local execution counter to Deriver A and Deriver B, a
  module-level atomic incremented per protocol run. Both roles log
  `router_ab_yao_role_isolate_counter_v1` with `execution_index` when a
  protocol run starts (`begin_role_protocol_v1` in
  `ed25519_yao_lifecycle.rs`). The Worker tail reports CPU per invocation;
  `yao-chain.py` joins both.
- [x] Extend `yao-chain.py` with the counter, both roles' CPU, the real
  protocol time (clock span plus A's CPU) and p50, p90 and maximum per column.
  On the October 11 run it reports the Router's execute at 1,636 / 1,970 /
  2,372 ms and the real protocol at 907 / 1,217 / 1,330 ms.
- [ ] Run one staging group of at least nine wallets on the current versions,
  after a discarded warm-up group. Classify the CPU factor. If CPU falls with
  the counter, warmness is the cause and Phase 4 takes the compute prewarm. If
  CPU is flat at four times local or more, the core is the cause and Phase 4
  takes the SIMD path.
- [x] Measure the core ratio directly. Done with the benchmark pair instead
  of a micro-workload in the prewarm handler: the same WebAssembly takes
  139 ms per ceremony on local workerd and 520–640 ms deployed, flat over
  twenty warm repetitions, and a first ceremony in a new isolate costs
  400–1,000 ms of CPU more. The compute prewarm of Phase 4 reuses this
  finding; no micro-workload ships.
- [x] Redeploy the phase 9b benchmark pair on today's platform. The
  [probe record](evidence/refactor-155h-probe-hosted.md) holds eleven runs.
  By the July metric the pair reads 250–400 ms today against 202 ms then. The
  metric is the Worker clock, which excludes own CPU; the real time is
  520–640 ms. The platform is not the cause of a fourfold gap, because the
  gap was a comparison of a clock span with a real duration. The pair is
  deleted.
- [x] Attribute the time after Deriver A's last frame. Closed without new
  logging: the probe shows the same gap with no durable write and no object,
  equal to Deriver A's CPU. It is the clock's exclusion of own CPU, not a
  write gate or a response path.
- [ ] Record the finalization span medians per group from the Gateway's server
  timing beside the browser stages, as the combined run's analysis log already
  does, so Phases 2 and 3 have a per-span baseline.
- [ ] Record the staging D1 cost per call type across the run: reads, single
  writes and batches, with p50 and p90. The chain uses this to separate a slow
  database from a slow object.

Acceptance: one record with the CPU classification, the p90 columns and the
span baseline. No production change.

### Phase 0 design sheet

- **Counter.** One `static` atomic per role Worker in
  `crates/router-ab-cloudflare/src/lib.rs`, incremented once per protocol run
  in `durable_object/deriver_a_pair.rs` (`execute_work`) and in
  `durable_object/deriver_b_pair.rs` (the duplex role execution). Log one JSON
  line beside the existing `emit_role_span_v1(None, "deriver_a.yao_protocol",
  ...)` call: `{"event":"role_isolate_counter","role":"deriver_a",
  "execution_index":N,"session":"<hex>","trace_id":"..."}`. The Worker tail
  delivers it in `logs[].message`; the run's `analyze.py` rows carry
  `cpuTime`, `wallTime` and `logs`, which `yao-chain.py` joins.
- **Benchmark pair.** `crates/ed25519-yao-cloudflare-bench`, restored in
  `67ac0f5d`; its README holds the toolchain, the local run and the deployed
  run. The record of October 12 is
  `docs/evidence/refactor-155h-probe-hosted.md`.
- **Clock.** `Date.now()` in a Worker excludes the invocation's own CPU.
  Read a span as waits only, and add the tail's `cpuTime` for a real
  duration. `yao-chain.py` prints `protocol_real` this way.
- **D1 cost per call type.** From each sample's per-request `d1.services` list
  in the run's `lifecycle.json`, and from the role databases' logs
  `bound_root_d1_timing` (`access`, `round_trips`, `batch_ms`,
  `initial_read_and_open_ms`).
- **The group.** Staging serves the verified October 12 deployment. The
  latest run against it is `.artifacts/r155g-remaining-20261012/` in
  `seams-monorepo` (`compare.py`, `analyse.py`, `arms.json`,
  `current-versions.json`, the role tails); start the Phase 0 folder from
  it, so the frozen versions match today's originals. The chain scripts in
  `.artifacts/r155f-yao-chain/` read the folder shape of
  `.artifacts/r155g-combined-hosted/`; keep `analyze.py`'s `tail()` and
  `path_of()` available in the new folder. Run `preflight.py`, `build.py`,
  `prepare.py`, `freeze.py`, `check-baseline.py`, then `launch.sh`, which
  detaches the driver and restores staging at the end. One arm of nine
  wallets after a warm-up group. Release builds only.

## Phase 1 — Custody execution at setup

Registration today: setup reserves the home and starts the four wallet
objects; respond verifies the credential, mints the Yao session and issues the
admission receipt; execute admits both Derivers, connects them, runs the
oblivious transfer, garbles, evaluates, seals and delivers. The passkey prompt
sits between setup and respond, and nothing of the custody path uses it. This
phase moves the session mint to setup and the pair's admission and connection
into the prompt. It leaves at execute what needs the client's inputs or the
verified credential: the oblivious transfer, the garbling, the evaluation and
the durable bookkeeping.

The table-frame yield of Phase 4 changes this phase's scope. Garbling ahead of
execute was planned because garbling and evaluation ran one after the other.
With the yield they overlap, and the bound of garbling ahead is the difference
between A's garbling time and B's evaluation time, 50–150 ms on the platform.
That does not pay for a 2.1 MB table buffer in an object, a second engine
entry point and a one-use rule for buffered tables. Garbling ahead is
therefore a deferred option, not a step.

R155G reviewed two smaller versions of this move and declined both. The
admission stores the digest of the custody binding, whose pair digest covers
the client's two encrypted inputs, and those inputs exist only after the
respond reply; an admission bound to the session and the epoch alone would
change the admission identity for about 50 ms per Deriver. Deriver B's object
accepts A's connection only after its own admitted preparation, which carries
the client's input today. The base transfer seeds must serve exactly one
extension. This phase takes the admission identity change because both
admissions, the connection and B's re-read ride on it, about 370 ms at the
median. It splits B's preparation into a setup-time admission and an
execute-time input, so the connection is accepted at setup.

- [ ] **Mint the Yao session at setup.** `setupWalletRegistration` creates the
  lifecycle and threshold session identity that
  `authorizeWalletRegistrationNearAdmission` creates at respond today, and
  stores it with the ceremony. Respond keeps verifying the credential and keeps
  issuing the admission receipt, now over the session minted at setup. The
  SDK's respond response keeps its shape; the setup response carries nothing
  new to the client.
- [ ] **Prepare the pair during the prompt.** After the setup transaction
  commits, the Gateway sends one prepare request to the Router with the
  session identity and the run's deadline, through the path that sends the
  wallet-start request today. The Router dispatches Deriver B's admission and
  Deriver A's admission and connection concurrently, as R155C does for execute.
  Both Derivers admit in D1 as today and hold the prepared pair session in
  their wallet objects until the deadline. The wallet-start request stays
  grant-free and storage-free; the prepare is a separate command because it
  writes admissions.
- [ ] **Garble before execute: deferred.** Take it only if the Phase 8 chain,
  with the yield and the setup-time admission in place, shows Deriver A's
  garbling ahead of Deriver B's evaluation by more than 150 ms at the median.
  Step one would keep the wire order and stream a buffer built during the
  prompt. Moving table frames ahead of the oblivious transfer, or
  precomputing the transfers on random choices, changes the transcript and
  needs the stream KATs, the specification's online ceremony and
  `cargo yao-fv all` with it.
- [ ] **Execute binds, then runs the online part.** The execute request carries
  the client's encrypted inputs and the admission receipt as today. The
  Router's claim verifies the receipt against the session minted at setup and
  binds the prepared pair session to this execution. Both Derivers record the
  custody binding digest against their admitted session at this point and
  verify it before the online phase; the attempt-conflict rule moves there.
  The Router sends B its
  input through the existing preparation endpoint, which now attaches the
  input to the admitted session instead of creating it. A and B continue from
  the oblivious transfer. An admitted session that no execute claims expires
  with the deadline, and both objects close the connection and release the
  admission. An execute after expiry prepares inline, as today.
- [ ] **One session, one use.** The admitted session binds to one execution
  id at execute. A second claim, a retry after a lost reply, or a relocation
  fence must find it bound or released, never open for a second execution.
- [ ] **Bound the exposure at setup.** Setup already starts objects and reserves
  a home for any caller with the publishable key. The prepare adds two D1
  admissions and one held connection per setup, and no protocol CPU. Enforce
  the existing setup route policy per publishable key and source IP before
  the prepare, and cap admitted sessions per wallet to one. Record the
  measured cost of an abandoned setup.
- [ ] **Keep the other families online.** Recovery, export and lane
  materialization keep the online path; only fresh registration activation
  prepares at setup. Mixed NEAR and ECDSA registration keeps the same NEAR
  path.
- [ ] Update `docs/router-ab/ed25519-yao.md` (fixed roles and the online
  ceremony), the registration lifecycle text in `docs/intended-behaviours.md`,
  R155C's flow description, and the local Yao contract's stage assertions. Add
  composed scenarios for an abandoned setup, an expired prepared session and an
  execute after expiry.

Must not regress: one durable execution per pair, exact replay after a lost
reply, refusal before claim, the output-gate ordering that makes a persisted
claim precede protocol material, role secret separation (A never carries B's
input), ownership fences and relocation, and cancellation of a registration
that never executed.

Expected gain: about 0.3 s of the execute request at the median. Admission,
connection and B's re-read leave the path, and one D1 round trip per Deriver
stays. The oblivious transfer, the
garbling, the evaluation, the sealing, the delivery and the two Router
commands stay.

### Phase 1 design sheet

Identities today, and where each is created:

| Identity | Created | Where |
| --- | --- | --- |
| Registration ceremony, `registrationCeremonyId`, expiry `ceremony.expiresAtMs` | Setup | `setupWalletRegistration` in `d1WalletRegistrationService.ts` |
| Yao lifecycle `lifecycle_id` and threshold `session_id` | Respond | `authorizeWalletRegistrationNearAdmission`, `d1WalletRegistrationService.ts` line 3056; stored as `descriptor.lifecycle.thresholdSessionId`, lines 693–758 |
| Admission request and receipt | Respond | `RouterAbEd25519YaoRegistrationAdmissionRequestV1` in `crates/router-ab-core/src/protocol/ed25519_yao_router.rs`; the SDK receives both in the respond reply |
| Pair binding, `Ed25519YaoInputPairBindingV1` | Execute | Router, from the client's two `Ed25519YaoEncryptedInputV1` values, `crates/router-ab-cloudflare/src/ed25519_yao_pair_protocol.rs`, `authenticate_for_ed25519_yao_v1` |
| Execution id, `Ed25519YaoExecutionIdV1` | Execute | Router claim, `claim_registration` in `durable_object/router_wallet.rs` |
| Deriver admission, attempt kind `ed25519_yao_pair_session` | Execute | `tenant_root_role_d1/bound_share.rs`, two D1 round trips, keyed by the pair session |
| Wallet objects | Setup | Gateway calls the Router's `/router-ab/router/wallet/allocate` (`walletObjectAddresses.ts`); the Router starts each role through `/router-ab/internal/wallet/start` (`wallet_startup.rs`), grant-free and storage-free |

Requests today: Deriver B `CloudflareEd25519YaoPairPrepareRequestV1 {
pair_binding, tenant_root, work, input }` and Deriver A
`CloudflareEd25519YaoPairExecuteRequestV1 { pair_binding, tenant_root, work,
input, deadline_ms }`, both in `ed25519_yao_pair_protocol.rs`. Deriver A's
object commands are `DeriverAPairDoCommandV1::{Prepare, Complete, Read, ...}`
at `deriver_a_pair.rs` line 197.

The change, in order. Names are proposals; keep the `V1` suffix convention.

1. **Setup mints the lifecycle and the session.** Move the mint out of
   `authorizeWalletRegistrationNearAdmission` into `setupWalletRegistration`
   and store both with the ceremony. Respond reads them and issues the
   receipt as today. The admission request shape does not change.
2. **A prepare route on the Router**, internal and Gateway-authenticated like
   allocate: `/router-ab/router/ed25519-yao/registration/prepare`, body
   `{ owner, ownership_generation, session, tenant_root, work, deadline_ms }`
   with `deadline_ms = ceremony.expiresAtMs`. The Gateway sends it after the
   setup transaction commits, from the same place that calls allocate. The
   Router does not claim; it dispatches concurrently a new
   `CloudflareEd25519YaoPairAdmitRequestV1 { session, tenant_root, work,
   deadline_ms }` to both Derivers, no `pair_binding` and no `input`.
3. **Deriver B** admits in D1 as today and holds `Admitted { session,
   deadline }` in its object. It accepts A's upgrade in that state. Its role
   engine is not constructed yet: the engine needs the client's input.
4. **Deriver A** admits and opens the connection to B's object. It holds
   `Admitted { session, socket, deadline }` in memory. It creates no garbler
   and no protocol material before execute.
5. **Execute** arrives as today. The Router claims, builds the pair binding
   from the client's inputs, chooses the execution id, sends B its input
   through the existing prepare endpoint, now an attach to the admitted
   session, and sends A the execute request. A verifies the binding against
   its admitted session, writes the binding digest into its attempt record
   (this is the admission identity change R155G costed at one D1 write), then
   runs today's protocol unchanged on the held connection: target proofs,
   oblivious transfer, garbling with the table-frame yield, returned labels,
   translation, seal, `Complete`, reply.
6. **States and one use.** A: `Admitted → Bound(execution_id) → Running →
   Completed`; a second execution id against `Bound` or `Running` is refused;
   `Completed` is the durable record that a retry replays. B: `Admitted →
   Attached(input) → Running → Completed`. A Durable Object alarm at
   `deadline_ms` releases `Admitted`: close the socket and release the
   admission. An execute that finds no admitted session runs today's inline
   path; keep that path.
7. **No engine change.** The role engines, the transcript, `stream_kats.rs`
   and `cargo yao-fv all` stay as they are. Any change that alters the
   transcript needs the user's go-ahead.

The admission identity change, concretely. A Deriver admission is one row in
its role database, written by `admit` in
`tenant_root_role_d1/bound_share.rs` in two D1 round trips. Its key is the
pair session (`TenantRootRootUseAttemptV1::Ed25519YaoPairSession`, `key_hex`
in `tenant_root_role_d1.rs`). Its `attempt_digest` and `binding_digest` come
from the `TenantRootCustodyBindingV1` that the Router authenticates for the
pair, and that binding's outer transcript is the pair digest over the
client's two encrypted inputs. A later request for the same session with
another attempt digest is an `AttemptConflict`. At setup the session exists
under item 1 and the pair digest does not. The change therefore needs:

- a custody binding that the Router can authenticate at setup, bound to the
  session, the epoch, the wallet objects and the deadline, without a pair
  digest, under its own attempt kind so it cannot stand in for a pair
  binding;
- the setup-time `admit` under that binding, unchanged otherwise;
- one batch per Deriver at execute that records the pair binding's digest on
  the admitted row, refuses a row that already holds another pair digest, and
  reads the share in the same transaction. For Deriver B this batch replaces
  today's `read_admitted` round trip, so the fresh read at claim time stays.

Execute then costs one D1 round trip per Deriver, in parallel, against two
for A plus B's preparation and re-read today. Expected at execute: about
70 ms before the oblivious transfer instead of about 365 ms. No role database
migration is expected, because the row keeps its columns; confirm that
against `migrations/deriver-a` and `migrations/deriver-b` before coding, and
stop if a column is missing.
8. **Exposure.** `enforceRoutePolicy` in
   `packages/wallet-server/src/router/framework/enforceRoutePolicy.ts` runs
   before setup with the publishable-key principal and `sourceIp`. If it has
   no per-key rate limit, stop and ask before adding one. The object refuses a
   second prepare while one is live.

Acceptance: the chain's admission, connect and B re-read columns read 0 on
the execute path; new spans `router.prepare_pair_at_setup`,
`deriver_a.admit_at_setup` and `deriver_b.admit_at_setup` appear before
respond; the real protocol measures 450 ms or less at p50 on staging;
`pnpm test:intended` passes all cases; `cargo yao-fv all` passes; the
`router-ab-cloudflare` test target passes; composed scenarios for an
abandoned setup, an expired prepared session, an execute after expiry and a
retry after a lost reply pass.

## Phase 2 — Console claims at execute

The passkey claim and the recovery-code route claim need only the ceremony and
the verified authority, both known when the Gateway forwards execute. Today
they run inside finalization beside the Router consume, 140–242 ms at the
group medians, and the slowest one sets the pace.

- [ ] Fire both claims from the Gateway's execute route when it forwards the
  request to the Router. Record their outcomes in the batch that already writes
  the Yao lifecycle record after the Router answers, the `gateway.d1_commit`
  span. The claims keep their idempotency keys, so an exact retry of execute
  repeats the same claims.
- [ ] Finalization reads the recorded outcomes in its initial batch and skips
  the calls when both are present. When an outcome is missing, finalization
  issues the claim as today; the fallback keeps the current retry semantics.
- [ ] Add the claim release. `D1WalletHomeDirectory.complete` refuses
  cancellation after a claim; with an earlier claim, a Yao execution that fails
  terminally would strand it. Release the passkey claim when the registration
  is cancelled definitively and no session exists for it. Keep the refusal for
  a completed registration. Verify that the competing-wallet refusal still wins
  when two registrations claim one credential.
- [ ] Update the custody paragraph of the intended behaviours and the
  credential-reservation scenario.

Must not regress: the distinct outcomes of a refused ownership claim and a
rejected custody route claim, exact retry, and the competing-wallet refusal.

Expected gain: 50–150 ms of finalization. The claim runs beside the Router
consume today, so the step costs the slower of the two: the consume measures
77–168 ms and the claim 130–250 ms as the Gateway sees it. Moving the claim
saves the difference, not the claim.

### Phase 2 design sheet

- The two claims: `D1WalletRegistrationCommitStore.reserveAuthority` at
  `d1WalletRegistrationCommitStore.ts` line 532, the Console passkey claim,
  and `reserveRegistrationCustody` in
  `router/domains/passkeyCustody/registrationCustodyOutcome.ts` line 42, the
  route claim. Finalize calls both near `d1WalletRegistrationService.ts`
  lines 5560–5650, beside `consumeActivated`.
- The execute route lives in `router/domains/ed25519Yao/registration/`
  (`routerAbEd25519YaoRegistration.ts` and the two-phase runner). After the
  Router answers it writes the `yao_lifecycle_decisions` row, created by
  `migrations/d1-signer/0036_r150_yao_lifecycle_decisions.sql`. Fire both
  claims when the request is forwarded, await them with the Router's answer,
  and write their outcomes in that same batch.
- Storage: one additive table in a new `d1-signer` migration,
  `registration_claim_outcomes (namespace, org_id, project_id, env_id,
  registration_ceremony_id, claim_kind, outcome_json, recorded_at_ms)`, primary
  key on the ceremony and the kind. Finalize's initial batch reads both rows.
  A missing row means: call the claim as today. Never edit an applied
  migration.
- Console release: a route beside claim-passkey in
  `packages/wallet-console-server-ts/src/walletPlacement/`,
  `/internal/wallet-placement/v1/release-passkey-claim`, body `{ walletId,
  credentialId, registrationCeremonyId }`. It releases only when the home
  assignment is terminal without a session and the claim's owner is this
  wallet. It is idempotent. `D1WalletHomeDirectory.complete` in
  `walletPlacement/d1.ts` line 270 keeps its refusal for a completed
  registration.
- Tests: `node tests/e2e/registration-credential-reservation.e2e.mjs` in
  `seams-wallet`; the composed registration scenarios in `seams-monorepo`,
  23 cases; the custody paragraph of `docs/intended-behaviours.md` near
  lines 540–548.

## Phase 3 — Completion off the response path

- [ ] Record the completion as pending in the local session transaction, with
  the session digest and expiry that the lost-reply reconciliation uses today.
  Reply to the client after that commit and the local receipt.
- [ ] Write an outbox row in the Gateway's D1 before the reply, so the
  publication is tracked, and send the Console completion from the request's
  background continuation immediately after the reply. Mark the row done when
  Console acknowledges. The Gateway's existing per-minute cron drains rows
  older than its interval with the same idempotent request. The Console's cron
  already runs outbox dispatches for runtime snapshots and webhooks; copy that
  shape.
- [ ] Decide what waits for the acknowledgement. Cross-region discovery through
  Console and the display row do. Established-session signing does not; R155F
  already keeps it independent of Console. Mixed registration and recovery
  continuations that read the home through Console must tolerate a pending
  completion for the outbox's interval, or wait for it.
- [x] Confirm the seal's hosted cost on a release build. Done by R155G's
  isolated probe of October 12: 5.4–5.9 ms per seal on a Worker, 800 seals
  with matching outputs. The seal stays synchronous in the reply, and no
  exponent or arithmetic change follows. A constant-time ladder remains a
  side-channel item outside this plan.
- [ ] Update the intended behaviours: completion follows the reply from a
  tracked outbox, and the Gateway no longer acknowledges completion before it
  enables ordinary signing. Update R155B's rule 6 wording for the tracked
  outbox. Update the completion scenarios and the lost-reply reconciliation
  test.

Must not regress: a lost finalization reply resumes the same operation; exact
retries preserve later display updates; one completion per registration; the
session binding, expiry and durable commit of the seal.

Expected gain: 150–300 ms of finalization.

### Phase 3 design sheet

- Completion today: `publishCommittedRegistration(input.homeCompletion,
  committed)` in `walletRegistrationEstablishedSessionIssuer.ts`, the fresh
  path near line 649 and the retry path near line 746, through
  `WalletRegistrationHomeAuthority.publishEstablished` to Console's
  `/internal/wallet-placement/v1/complete`. The journal completion batch, the
  last finalization call, waits for the acknowledgement.
- Outbox: one additive table in a new `d1-signer` migration,
  `registration_completion_outbox (namespace, org_id, project_id, env_id,
  wallet_id, registration_ceremony_id, session_digest, request_json, state,
  attempts, created_at_ms, updated_at_ms, next_attempt_at_ms)` with `state` in
  `pending`, `done`, `failed`. The session transaction inserts the row as
  `pending`. The route replies, then sends the Console request from the
  request's background continuation and marks the row `done`. The `scheduled`
  handler in `packages/wallet-server/src/hosted-wallet-gateway-worker.ts`,
  line 16, drains `pending` rows whose `next_attempt_at_ms` has passed, in a
  bounded batch, with the same idempotent request. A lost reply reconciles
  with `session_digest` as today.
- Readers to check for a pending completion: Console
  `walletPlacement/gatewaySession.ts`, `authenticationDispatch.ts` and
  `home.ts` in `seams-monorepo`; the Gateway's continuation routing in
  `walletPlacement/regionalDispatch.ts` and `localSessionRouting.ts`.
- Spec and tests: `docs/intended-behaviours.md` near lines 553–560; R155B rule
  6 near `docs/refactor-155B.md` line 204; `passkey.registration.contract.test.ts`;
  `tests/e2e/registration-activation-completion.scenario.mjs`; the private
  composed scenarios for a lost completion reply and mixed registration.
- Seal check: closed. The tail's `cpuTime` for
  `/wallets/register/near-provisioning` read 132–386 ms with the development
  module and 78–108 ms at the medians of the October 12 release-build run.

## Phase 4 — Close the Yao execution gap

The Router's execute span, 1,624 ms at the median of 24 executions, by part.
Clock spans exclude a role's own CPU, so the protocol row is the clock span
plus Deriver A's CPU.

| Part | Today | Benchmark pair | Target | Owner |
| --- | ---: | ---: | ---: | --- |
| Router claim in its wallet object | 96 ms | 0 | ~90 ms | durable one-use; stays |
| Dispatch to the roles | 26 ms | 0 | ~25 ms | stays |
| Deriver A admission, two D1 round trips | 113 ms | 0 | 0 online | Phase 1 |
| Pair connection | 196 ms | 0 | 0 online | Phase 1 |
| Deriver B re-read of the admitted session | 56 ms | 0 | 0 online | Phase 1 |
| Protocol, real time | ~850 ms | 520–640 ms; 290–350 ms with the yield | 450 ms | this phase |
| Signing Worker delivery | 88 ms | 0 | ~90 ms | activation receipt; stays |
| Router finish in its wallet object | 69 ms | 0 | ~70 ms | durable completion; stays |

The [probe record](evidence/refactor-155h-probe-hosted.md) names three costs
inside the protocol row: garbling and evaluation in series, a first run in a
new isolate, and the platform's CPU price for the gate hash and the curve
work. One item each.

- [x] **Overlap garbling and evaluation.** `send` in
  `crates/router-ab-cloudflare/src/ed25519_yao_websocket.rs` now awaits a
  zero-length `worker::Delay` after each table frame, so the frame is written
  before the next one is garbled. The messages, their order and their bytes
  are unchanged; every family that streams tables gains. The benchmark pair
  measured 290–350 ms against 520–640 ms in Tokyo and 455–485 ms against
  620–650 ms in Hong Kong. Commit `6ec1c61d`. The crate's native tests pass,
  and all 14 cases of the local Yao contract pass: 13 on release builds and
  the fault-injection case on dev builds. All 14 cases of
  `passkey.registration.contract.test.ts` pass. On local workerd the yield costs
  about 3 ms per ceremony. Open: the staging comparison of the production
  path. Its folder is `.artifacts/r155h-yield-hosted/` in `seams-monorepo`,
  with a README: three sides, control, yield, and yield with SIMD, each with
  the counter, nine wallets per side after a warm-up group. The five upload
  bodies are built. It waits for the user's go-ahead.
- [x] **Frame profile.** Production binds `Activation128KiBDeriverA` and its
  128 KiB siblings in `crates/router-ab-ed25519-yao/src/lib.rs`: 17 table
  frames, the benchmark pair's profile. No change.
- [x] **Per-message cost and the write gate.** Both closed by the probe: the
  cost was the missing event-loop turn, and the time after the last frame is
  the clock's exclusion of own CPU.
- [ ] **First run in a new isolate.** Read the isolate counter beside the
  tail's CPU on the next staging group. If first runs are common and cost
  200 ms or more of CPU over later runs, make the wallet-start handler run
  one export ceremony in memory, 1,275 AND gates, garbler and evaluator in
  the same isolate, when the counter is zero. That compiles and warms the
  gate hash, the circuit engine and the curve code on the server that holds
  the wallet object, during the passkey prompt. Bound its CPU and measure the
  first run again.
- [x] **WebAssembly SIMD for release Workers.** `build-strict-worker.sh` now
  builds every release Worker with `-C target-feature=+simd128`. No source
  line changes: the compiler vectorizes the label, block and buffer
  arithmetic. On the benchmark pair, both with the yield, the ceremony fell
  from 315–329 ms to 277 ms in two alternating pairs of runs and from 481 ms
  to 364 ms in a third on a slower machine; Deriver A's CPU fell from
  203–258 ms to 164–176 ms. Locally 126 ms against 137–141 ms. The
  constant-time codegen gate found one of three scalar mask sequences in the
  SIMD module, because the compiler vectorized the sender's conditional XOR.
  The generated code is still branchless: the optimizer-resistant bit becomes
  `0 - bit`, is splatted, and is applied with `v128.and` and `v128.xor`.
  Classified `valid_test_needs_update`. The gate now builds with the release
  target features, accepts either form after the optimizer-resistant call,
  counts each selection once, and holds fixtures for the vector form. It
  passes. On the SIMD builds of all five roles, the 13 release cases of the
  local Yao contract and the 14 cases of the registration contract pass.
  Open: the staging comparison, as its third side.
- [ ] **A wider gate hash.** Only if the staging chain still shows the gate
  hash on top after SIMD: the `aes` crate's software cipher works on two
  blocks per call on `wasm32`. A four-block or eight-block bitsliced cipher
  with the same outputs is crypto engineering with its own vectors and
  constant-time evidence. Not started.
- [ ] **Product work in the protocol span.** The target-proof exchange, the
  commitment checks and the HPKE seal are product additions the benchmark
  pair does not run. Place them with the local profiler and move what does
  not need the execution's result to the admitted session of Phase 1.
- [ ] Record the per-execution CPU of both Derivers and the real protocol
  time after each item, with the counter.

Expected gain: 150–300 ms from the overlap. 40–100 ms more from SIMD.
100–250 ms on a first run from the compute prewarm, if first runs are common.
With Phase 1, the Router's execute span should measure 700–800 ms.

### Phase 4 notes

- The benchmark pair is the fast loop for this phase: build both roles with
  `worker-build` 0.8.5, deploy B then A, drive, tail, delete. A run costs
  about a minute and needs the user's go-ahead for the two benchmark Workers
  only. The measurement-only feature `yield-after-table-frame` of the crate
  holds the same yield as production's transport.
- A Worker clock span plus the tail's CPU time for the same invocation is
  the real duration. Never compare a clock span with a client-side wall time.
- Compute prewarm: `durable_object/wallet_startup.rs` holds the start
  handler; `passive/phase5_wasm_benchmark.rs` behind the
  `passive-wasm-benchmark` feature holds an in-memory session for the export
  circuit.

## Phase 5 — Setup for direct API callers

Users of the hosted menu do not wait for setup. Direct callers of
`registerWallet` do, about 0.7 s from Tokyo.

- [ ] Batch the Gateway's setup D1 writes into one batch after the Console
  reply, and keep the admission read first. Do not insert before the Console
  request answers: that request is also the publishable-key authentication
  (`resolveWalletRegistrationContext` in `walletRegistrationRoutes.ts` near
  line 2067), and a write for an unauthenticated caller is an abuse surface.
- [ ] Move Console's API-key usage update off the request. It records the
  last-used timestamps and consumes no quota, as R155F classified it.
- [ ] Decide the setup preflight. Two options exist without a new Worker: a
  route on the wallet origin, so the Gateway API is same-origin from the wallet
  iframe, or an edge answer to `OPTIONS` before the pinned Worker. Measure the
  setup preflight's share with the hosted test first; it is 125–191 ms serial
  from Tokyo.

Expected gain: 50–100 ms from the batch and up to 190 ms from the preflight,
for direct callers only.

## Phase 6 — The distance to the Gateway

Four exchanges cost about 400 ms from Tokyo and nothing from Hong Kong. This
phase decides; it implements nothing.

- [ ] Count the reads and writes per request from the Phase 0 D1 record.
  Finalization is write-heavy, so D1 read replication near a regional Gateway
  cannot carry it. Record the number.
- [ ] Cost the Tokyo home: a role database set and a Console lane per home,
  the R155G Phase 1 cutover method per lane, and a hazard list per home.
- [ ] Decide: accept the 0.4 s for Tokyo users and record it, or open a
  separate plan for role databases per home.

## Phase 7 — Tails

- [ ] Module size. Each Deriver module was 15.6 MB with a 1.3 MB name section
  and 6.2 MB of data. Commit `3f3800a4` now strips the name and `.debug_`
  sections after `worker-build` in release builds. The data is the embedded
  circuit schedules in `crates/ed25519-yao/artifacts/passive-benchmark-v1/`:
  `activation-private-output.schedule.bin` 2.68 MB,
  `lane-materialization.schedule.bin` 2.82 MB and
  `export-private-output.schedule.bin` 56 KB; the two test-only schedules are
  behind `#[cfg(test)]` in `passive/schedule.rs`. R155G's final record shows
  Cloudflare's upload-time startup metric did not move with the strip, 7 to
  8 ms for A and 6 ms for B; the open question is the handler-start delay of
  a new isolate, 91–257 ms in the October 11 runs, which only
  `isolate-starts.py` on a hosted run measures. Measure that on the stripped
  module first. If the load cost is the schedules, compare a compressed schedule
  decoded on first use per isolate against today's; the decode is CPU the
  prewarm can absorb.
- [ ] The Deriver B stall. One preparation took 14.6 s after a version switch,
  with a 506 ms D1 read, and refused the pair as not prepared. Reproduce with a
  version switch on staging and record the cause. Add no retry without one.
- [ ] D1 stalls. From the Phase 0 record, report p90 and p99 per call type.
  Keep the two deliberate admission checks, as R155G records.
- [ ] Report p90 in every comparison from here on.

## Phase 8 — Measure and record

- [ ] A discarded warm-up group of three wallets before each measured group,
  and at least six wallets per measured group; nine when a phase claims less
  than 0.3 s.
- [ ] Build every candidate with `WASM_SDK_BUILD_MODE=prod` and the release
  Worker profile. Record the build stamps and the module sizes in the run's
  frozen inputs. Every hosted comparison before October 12 carried a
  development build of the seal module.
- [ ] Measure the accumulated changes on the Hong Kong layout from Tokyo.
  Report registration, registration after setup and the first signature with
  p50, p90, minimum and maximum; the four stages; the chain columns with the
  new spans (`router.prepare_pair_at_setup`, `deriver_a.admit_at_setup`,
  `deriver_b.admit_at_setup`), the real protocol time and the isolate
  counter; and the finalization spans.
- [ ] Prepare the hosted driver against the current database ids. Drivers
  prepared before the Console move carry the old id.
- [ ] Verify every signature independently, restore staging, and verify the
  restoration, as the R155F and R155G drivers do.
- [ ] Commit accepted changes on `dev`. Link sanitized evidence from this plan.

## Delegation sheet

This plan is implemented by an agent that did not write it. The rules below
replace judgment calls that need the authors' context.

Read before starting a phase: `AGENTS.md` of both repositories; this plan;
R155G's Phase 3 reviews; R155F's serial chain record;
`docs/router-ab/ed25519-yao.md`; the registration section of
`docs/intended-behaviours.md`; `tests/e2e/hosted-product/README.md` in
`seams-monorepo`; the scripts of the latest run folder under `.artifacts/`.

Stop and ask the user before any of these:

- Deploying anything to staging, creating a Cloudflare resource, or starting
  a comparison driver. Staging is shared; check for a running `experiment.py`
  and for live versions equal to the known originals first.
- A migration of a role database or the Gateway D1, beyond the two additive
  tables this plan names.
- Any change to the transcript order of the Yao protocol, any regenerated
  golden or vector, and any change to the admission identity beyond item 5
  of the Phase 1 design sheet.
- A new quota, rate limit, environment variable, secret, Worker, route family
  or configuration framework.
- Any change to R155B's rules or to the intended behaviours beyond the
  paragraphs each phase names.
- A failing test whose classification is unclear after one reading, and any
  production fix that a lower-authority test asks for.
- A hosted number that moves the wrong way by more than its spread.
- Anything that touches production or publishes a package.

Commands, narrowest first:

- Public contracts: `pnpm test:intended` in `seams-wallet`, 133 cases, two of
  them on debug builds.
- Yao formal verification and vectors: `cargo yao-fv all`; individual tasks
  `just ed25519-yao-fv-*`.
- Rust tests: `cargo test --manifest-path crates/router-ab-cloudflare/Cargo.toml`,
  whose `bindings.rs` target holds 186 cases; `cargo test --manifest-path
  crates/ed25519-yao/Cargo.toml`.
- Storage and lifecycle scenarios: `node tests/e2e/<name>.scenario.mjs` and
  `node tests/e2e/<name>.e2e.mjs` in `seams-wallet`.
- Wallet Server: `pnpm -C packages/wallet-server type-check`,
  `pnpm -C tests type-check:wallet-state`.
- Private: `pnpm check`, `pnpm test:relayer`, the composed registration
  scenarios, and the hosted latency test per its README.
- Builds: `crates/router-ab-cloudflare/scripts/build-strict-worker.sh <role>`
  for the custody Workers, release by default; `WASM_SDK_BUILD_MODE=prod`
  for every SDK and server WASM build.
- Local Deriver CPU profile: `node .artifacts/r155g-deriver-cpu/run.mjs` in
  `seams-wallet`, then `python3 .artifacts/r155g-deriver-cpu/split.py results --names`.
- Native floor: build `benchmark_phase5_role` with
  `--manifest-path crates/ed25519-yao/Cargo.toml --features passive-benchmark`;
  run role `b` then role `a` from a short working directory with relative
  socket names, and time the `a` process from one Python process.

Evidence and commits:

- Each hosted or local measurement gets `docs/evidence/refactor-155h-<topic>-<hosted|local>.md`
  and a sanitized `.json` beside it, in the shape of the R155G evidence
  files. Private run directories are `.artifacts/r155h-<topic>-hosted/` in
  `seams-monorepo`.
- Work on `dev` in the main checkouts of both repositories, own files only,
  staged by name. Messages follow the existing form: `perf(custody): ...`,
  `perf(wallet): ...`, `test: ...`, `docs: ...`. Production fixes, valid
  test updates and stale-test deletions go in separate commits.
- Every comparison: a discarded warm-up group, at least six wallets per
  measured group, release builds with recorded build stamps, p50 and p90,
  independent signature verification, restoration and its verification.
- Mark each item of this plan done only with its evidence or a recorded
  reason, in the same commit as the change.

## Scope limits and completion

This plan adds one additive outbox table in the Gateway's existing D1 and uses
the existing Gateway cron. It adds no Worker, secret, environment-variable
family, cache layer, queue or configuration framework. It changes no circuit
and no cryptographic construction: the garbled circuit, the gate hash's
cipher, the oblivious transfer and the seal's group and exponent stay what
they are. Only when and where they run changes.
One-request signing, a Tokyo home, relocation of existing wallets, a native
custody tier on virtual machines or Cloudflare Containers, and the
delegate-action early prepare stay outside it. Production rollout and
publishing remain separate release work.

Complete the plan when each item has implementation and evidence, or a
recorded reason. A completed checklist does not establish that the latency
target was met.
