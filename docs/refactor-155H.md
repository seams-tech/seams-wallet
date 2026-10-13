# R155H — Custody execution at setup, Console exchanges off the path, and the registration floor

Status: **in progress; the target is reached on staging.** Release 0.9.3
carries Phase 2 and Phase 4's yield, SIMD build and start-up ceremony. On the
Singapore staging lane, registration after the passkey step measures
1,734 ms at the median and 2,221 ms at the 90th percentile, against 2,332 ms
and 3,044 ms on 0.9.0: 164 and 198 wallets, client in Tokyo. 80% of the
wallets finish in less than 2.0 s after the passkey step. The
[record](evidence/refactor-155h-release-093-staging.md) holds the chain.
Phases 1 and 3 are decided and not implemented. Date: October 13, 2026.

[R155J](refactor-R155J-p99.md) owns the follow-up investigation of startup
outliers and the combined p99 comparison. It reuses this plan's Phase 1 design
and keeps Phase 3 conditional on measured need.

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
  Phase 2 turned out not to need it: the NEAR-only path never cancels its
  home after respond, and the specification keeps a retained claim until
  the hosted reconciliation that is its own release gate. No release route is
  built. The decision stands for the day a path that can cancel takes the
  early claim.
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
- [x] Run one staging group of at least nine wallets, after a discarded
  warm-up group, and classify the CPU factor. The
  [yield and SIMD comparison](evidence/refactor-155h-yield-simd-hosted.md)
  ran 27 measured wallets with the counter. The counter read zero in every
  execution, in both roles: each new wallet's objects run the protocol in an
  isolate that never ran it. Deriver A's CPU on these first runs has two
  modes, near 300 ms in two thirds of the executions and 450–640 ms in the
  rest; Deriver B's has 255–290 ms and 360–450 ms. On the benchmark pair's
  warm isolates the platform's CPU for one build varies 1.4 to 1.6 times
  between serving machines, so the slow mode is a slower machine, a colder
  isolate, or both. The staging data cannot separate them.
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
  does, so Phases 2 and 3 have a per-span baseline. Staging's serving Gateway
  does not expose server timing or D1 counts. Take this with the first
  comparison that serves a measurement Gateway, which is Phase 2's.
- [ ] Record the staging D1 cost per call type across the run: reads, single
  writes and batches, with p50 and p90. The chain uses this to separate a slow
  database from a slow object. Same condition as the item above.

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

### What the October 12 tails add

Read from the tails of the [yield and SIMD comparison](evidence/refactor-155h-yield-simd-hosted.md),
36 executions with the warm-up groups. No new deployment. The chain table
of Phase 4 puts these waits under admission, connection and re-read; the
tails show what they are.

| Wait on the execute path | Measured | Count |
| --- | ---: | ---: |
| One database round trip from a Deriver wallet object, read or write | 53–65 ms at the median | 105 |
| One database read from the stateless Deriver Worker, wall less CPU | 12–20 ms | 15 |
| Deriver A starts its connection, until Deriver B's stateless Worker starts | 43–63 ms, median 50 | 24 of 25 |
| Deriver B's stateless Worker starts, until its wallet object starts | 7–142 ms, median 70 | 25 |
| Stateless Deriver A Worker starts, until its wallet object starts | 4–33 ms in 12, 217–412 ms in 8 | 20 |
| Stateless Deriver B Worker starts, until its wallet object prepares | 1–75 ms in 26, 166–242 ms in 8 | 34 |
| One Router wallet-object command, as the Router Worker sees it | 59–74 ms at the median, 3–18 ms of it CPU | 108 |
| Deriver A's background settle, one database write after its completion write | 119–131 ms | 3 read |

What the code says about them:

- **Fifty milliseconds before the connection leaves Deriver A.** `execute_work`
  in `deriver_a_pair.rs` writes the prepared record and the reservation to the
  object's storage, then connects. The platform holds an outgoing request until
  the object's earlier writes are durable. The steady 43–63 ms fits that hold,
  and so does the 45 ms that every Router object command waits. The plan's
  must-not-regress list relies on this hold for the claim: a persisted claim
  precedes protocol material. The reservation is a different write. A
  [probe](evidence/refactor-155h-write-hold-by-colo.md) confirmed the
  mechanism and its size: 34 ms per durable write in Hong Kong, 9 ms in
  Tokyo. Phase 6 holds the consequence.
- **A slow start of a stateless role Worker in a third of the executions.**
  The slow group uses 76–181 ms of CPU before the object call, against 3–7 ms
  in the fast group. This fits a Worker that the serving machine had not
  loaded. `load_deriver_b_worker` and the wallet-start request load the
  Workers from one machine; a later request can arrive at another.
- **A database read from a wallet object costs as much as a write.** The
  cause is not established. Two explanations are ruled out. The objects ran
  in Hong Kong in the [placement record of October 8](evidence/near-overlapped-target-20261008.json),
  beside their databases. The five `CREATE TABLE IF NOT EXISTS` statements
  at the top of each object request hold nothing, by the probe.

Consequences for this phase. Admission and connection at setup remove two
of Deriver A's round trips, the 50 ms hold before the connection and the
Deriver B Worker's start from the execute path, so the estimate of 0.3 s
stands. The slow starts and the hold before the first protocol message stay
at execute.

- [ ] **Place these waits before coding the object states.** One measurement
  build of the two Deriver Workers on staging, with the user's go-ahead, that
  logs a clock reading after each await of `execute_work` and of Deriver B's
  connection handler, the colo of each wallet object, and one extra database
  read at the start of `execute_work` before any object write. It answers
  three questions: why a database read from an object costs 53–65 ms, what
  Deriver B's object waits for before it starts the connection, and how often
  a stateless role Worker starts cold. Decide Phase 6 first: in Tokyo each
  durable step of this phase costs a quarter of its Hong Kong price, and the
  estimate of 0.3 s shrinks with it.

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

   Checked on October 12: it has none. `enforceRoutePolicy` authenticates and
   nothing else, and the only rate limits in the Gateway belong to Email OTP
   (`core/authService/rateLimits.ts`). A text search of Console's wallet
   placement code found no rate limit for registration setup either; an edge
   rule in the Cloudflare account was not checked. Phase 1 therefore waits for
   the user's choice of the
   limit: its key (publishable key, source address, or both), its window, and
   where its counter lives.

Acceptance: the chain's admission, connect and B re-read columns read 0 on
the execute path; new spans `router.prepare_pair_at_setup`,
`deriver_a.admit_at_setup` and `deriver_b.admit_at_setup` appear before
respond; the real protocol measures 450 ms or less at p50 on staging;
`pnpm test:intended` passes all cases; `cargo yao-fv all` passes; the
`router-ab-cloudflare` test target passes; composed scenarios for an
abandoned setup, an expired prepared session, an execute after expiry and a
retry after a lost reply pass.

## Phase 2 — The passkey claim ahead of finalization

Finalization runs three requests side by side: the Router consume, the
Console passkey claim and the Console route claim of the custody commit. The
wallet commit waits for the first two. On the 27 measured finalizations of
October 12 the consume took 92 ms at the median and the route claim 166 ms;
the passkey claim is the same kind of Console request. The step therefore
costs the claim, and moving the claim saves the difference from the consume.

The first design fired both claims from the execute route and added a
release route. Reading the code and the specification changed three points:

- The route claim needs the client's custody commit, which arrives with
  finalization. It stays there. The wallet commit does not wait for it.
- The specification keeps retained claims on purpose and makes their release
  a hosted release gate. This phase adds no release route.
- The NEAR-only path never cancels its home after respond, and a failed
  finalization already leaves its claim behind today. An earlier claim
  therefore strands nothing new. Mixed registration can cancel its home
  inside respond, so it keeps the claim in finalization.

- [x] **Respond starts the claim.** `respondEd25519OnlyRegistration` starts
  the claim from the request's background continuation after its reply, for
  a newly verified passkey. `claimPasskeyAhead` in
  `d1WalletRegistrationCommitStore.ts` records a granted claim in
  `registration_passkey_claims`, a new table of Gateway migration `0078`.
  A refusal, a failure or an unfinished claim records nothing.
- [x] **Finalization reads the record.** `readFinalization` reads it in its
  initial batch, one more statement and no more round trips.
  `reserveAuthority` skips the Console request only when the record names
  the same wallet, relying party and credential. The cleanup of a finalized
  ceremony removes the record. The new span `near_finalize_authority_reserve`
  measures the step.
- [x] **Specification and scenarios.** The registration paragraph of
  `docs/intended-behaviours.md` states the early claim. The public
  `registration-credential-reservation.e2e.mjs` covers the record, the skip
  and the mismatch cases. The private `registration-claim.scenario.ts`
  injected its fault on the first claim request, which is now respond's;
  classified `valid_test_needs_update`, it now refuses the early claim and
  then finalization's claim after the consume. The private completion
  scenario asserts one claim request per registration, before finalization.
- [x] Measured on staging with release 0.9.3 on October 13. Migration `0078`
  went to the four regional Gateway databases in the deployment's migrate
  job. All 164 finalizations found the early claim:
  `near_finalize_authority_reserve` measured 0 ms in each. In the run of 98
  wallets the Console received 98 claims, each before the execute request
  started and 968 ms before finalization at the median. The Gateway's
  finalization total fell from 306 ms to 228 ms at the median and from
  595 ms to 434 ms at the 90th percentile. No claim record stayed behind,
  and no early claim failed.

Must not regress: the distinct outcomes of a refused ownership claim and a
rejected custody route claim, exact retry, and the competing-wallet refusal.

Expected gain: 50–100 ms of finalization at the median, the difference
between the claim and the consume. Cost: one Console request and one
database write per registration move from finalization to the time of the
Yao execution, and one database write is new.

Release note: the private round-trip ceilings count database work per
request. Respond's background write may count against the respond request;
check the ceiling when the private repository takes the release.

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
| Protocol, real time | ~850 ms; 634 ms with the yield and SIMD | 520–640 ms; 277 ms with the yield and SIMD | 450 ms | this phase |
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
  about 3 ms per ceremony. On staging, nine wallets per side: the Router's
  execute request fell from 1,605 ms to 1,340 ms at the median and from
  1,752 ms to 1,602 ms at the 90th percentile; the real protocol time from
  821 ms to 686 ms; Deriver A's wait for Deriver B from 435 ms to 240 ms while
  its CPU stayed at 340 ms. The
  [record](evidence/refactor-155h-yield-simd-hosted.md) holds the chain.
- [x] **Frame profile.** Production binds `Activation128KiBDeriverA` and its
  128 KiB siblings in `crates/router-ab-ed25519-yao/src/lib.rs`: 17 table
  frames, the benchmark pair's profile. No change.
- [x] **Per-message cost and the write gate.** Both closed by the probe: the
  cost was the missing event-loop turn, and the time after the last frame is
  the clock's exclusion of own CPU.
- [x] **First run in a new isolate: the experiment.** Every staging execution
  is one. On the benchmark pair, with the yield and SIMD builds, ten cycles of:
  deploy a new version, load Deriver A's module with a request that runs no
  ceremony, wait two seconds, run five ceremonies. The first ceremony of an
  isolate used 541–647 ms of Deriver A's CPU in seven cycles and 869 and
  1,015 ms in two; the 36 later ceremonies used 150–334 ms, median 184 ms.
  Deriver B, whose module the load request does not reach, used 162–466 ms
  first, median 301 ms, against a median of 162 ms later. The client's wall
  time was 889–1,086 ms first against a median of 313 ms later. A loaded
  module is therefore not a warm one: the first ceremony costs Deriver A
  about 390 ms of CPU over a later one, above the 150 ms bar.
- [x] **First run in a new isolate: the compute prewarm.** Implemented in
  commit `f33e071f` and verified locally: 519 native tests of the crate, the
  13 release cases of the local Yao contract and the 14 cases of the
  registration contract. Released in 0.9.3 and measured on staging; the
  answers follow this item. `ed25519_yao_prewarm.rs` in
  `crates/router-ab-cloudflare` runs one activation ceremony in memory, both
  roles in one isolate over an in-memory transport, on fixed public inputs
  from `build_activation_prewarm_pair_v1`. Each Deriver's pair object starts
  it from its wallet-start request with `wait_until`, once per isolate. It
  turns the event loop after every message and stops at the next turn when
  any other request reaches a pair object of the isolate, so it never holds
  the CPU against real work for more than one message. Its output is
  discarded, and it reads no storage, no secret and no request data. Each
  protocol start logs the prewarm state beside the isolate counter, and the
  prewarm logs `router_ab_yao_role_isolate_prewarm_v1` with its outcome.
  Staging, October 13, with a virtual authenticator that answers in about
  0.5 s: the prewarm completed before the execution in 144 of 147 Deriver A
  starts and 148 of 151 Deriver B starts, and arriving work stopped it 2 and
  3 times. A first execution after a completed prewarm used 217 ms of
  Deriver A's CPU and 182 ms of Deriver B's, against 332 ms and 286 ms on
  0.9.0 without it and SIMD. A later execution in the same isolate used
  160 ms and 151 ms, so a first run still costs about 55 ms and 30 ms more.
  A real passkey prompt takes longer than the virtual one, so the prewarm
  has more time there. The cost: each Deriver's wallet-start invocation rose
  from about 20 ms to about 300 ms of CPU, so a setup that nobody finishes
  costs about 0.6 s of Deriver CPU. That raises the weight of the setup rate
  limit gap recorded under Phase 1.
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
  local Yao contract and the 14 cases of the registration contract pass. On
  staging, as the third side of the same comparison: the Router's execute
  request at 1,300 ms and 1,464 ms at the 90th percentile, the real protocol
  time at 634 ms and 647 ms, Deriver B's CPU from 286 ms to 239 ms and
  Deriver A's from 344 ms to 314 ms. A first run gains less than a warm run.
- [ ] **A wider gate hash.** Only if the staging chain still shows the gate
  hash on top after SIMD: the `aes` crate's software cipher works on two
  blocks per call on `wasm32`. A four-block or eight-block bitsliced cipher
  with the same outputs is crypto engineering with its own vectors and
  constant-time evidence. Not started.
- [ ] **Product work in the protocol span.** The target-proof exchange, the
  commitment checks and the HPKE seal are product additions the benchmark
  pair does not run. Place them with the local profiler and move what does
  not need the execution's result to the admitted session of Phase 1.
- [x] Per-execution CPU of both Derivers with the counter, release 0.9.3 on
  staging: Deriver A 216 ms and Deriver B 178 ms at the median, 263 ms and
  222 ms at the 90th percentile. The Router's execute request measures
  669 ms at the median and 1,113 ms at the 90th percentile, against 1,100 ms
  and 1,625 ms on 0.9.0. The release holds the yield, SIMD and the prewarm
  together; the run does not separate them.

Measured gain on staging: 265 ms of the Router's execute request from the
overlap and 40 ms more from SIMD at the median, 150 ms and 140 ms at the 90th
percentile. With Phase 1, the Router's execute request should measure about
1,050 ms: the claim, the delivery and the finish, about 280 ms of durable
bookkeeping, one D1 round trip per Deriver, and a protocol of about 630 ms.

### Phase 4 notes

- The benchmark pair is the fast loop for this phase: build both roles with
  `worker-build` 0.8.5, deploy B then A, drive, tail, delete. A run costs
  about a minute and needs the user's go-ahead for the two benchmark Workers
  only. The measurement-only feature `yield-after-table-frame` of the crate
  holds the same yield as production's transport.
- A Worker clock span plus the tail's CPU time for the same invocation is
  the real duration. Never compare a clock span with a client-side wall time.
- Compute prewarm: `ed25519_yao_prewarm.rs` holds it, and the two pair
  objects start it on `wallet_startup::PATH`. A staging execution reads its
  state in the `prewarm` field of `router_ab_yao_role_isolate_counter_v1`:
  `completed`, `running`, `stopped`, `failed` or `none`.

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
- [x] Start setup's best-effort preflight when a registration-configured wallet
  runtime initializes. Reuse the existing browser preflight helper. Same-origin
  and signing-only clients skip it. This overlaps the exchange with initialization;
  immediate registration may still wait for an unfinished preflight.
- [ ] Measure the setup preflight change on staging. The earlier serial exchange
  took 125–191 ms from Tokyo; that is an upper bound, not a measured saving.
  Local implementation and SDK completion evidence are recorded in
  [setup and SDK completion](evidence/refactor-155h-setup-sdk-completion.md).

Expected gain: 50–100 ms from the batch and up to 190 ms from the preflight,
for direct callers only.

## Phase 6 — Where the APAC home runs

Four exchanges cost about 400 ms from Tokyo and nothing from Hong Kong. This
phase decides; it implements nothing.

The location also sets the price of every durable write. The
[probe of October 12](evidence/refactor-155h-write-hold-by-colo.md) measured
the hold that follows one durable object write: 34 ms in Hong Kong, 32 ms in
Seoul, 29 ms in San Jose, 14 ms in Ashburn, 13 ms in Sydney, 9 ms in Tokyo
and London, 2 ms in Singapore. Staging's APAC Gateway, role databases and
wallet objects are in Hong Kong, the slowest location measured. A
registration after setup waits for about 13 durable writes in series, an
estimate from the code: 450–650 ms in Hong Kong against about 130–200 ms at
Tokyo's hold. With the distance, a Tokyo home is worth about 0.7 s of a
registration for a user in Tokyo. For a user elsewhere the gain is the 0.3 s
of holds less the added distance to Tokyo: about zero from Hong Kong or
Singapore, by typical round-trip times that this plan did not measure. A
Singapore home would save about 0.4 s of holds and is the central choice for
users outside Japan. For a user in Japan, no other phase of this plan is
worth as much, and this one changes no code.

The cause is in the platform's storage design
([Cloudflare's description](https://blog.cloudflare.com/sqlite-in-durable-objects/)):
each object's change log goes to five followers in five different data
centers, and a write is confirmed when three have it. The hold is therefore
the round trip to the third-nearest follower. Which data centers follow a
Hong Kong object is not published and was not measured. The same design
explains why the October 10 move of the role databases to Hong Kong showed
no gain: it shortened the distance to the Gateway and raised the price of
each write, since one of the old primaries was in Singapore.

- [x] Measure the hold after a durable write by location. Done; the record
  holds eight locations.
- [x] Check that the Hong Kong hold is not a variation of one evening. Done:
  52 staging runs of October 7 to 12 hold 1,662 Router wallet-object
  commands, and every run's median wait is 39–44 ms. Sixteen new Hong Kong
  objects measured 33–40 ms each, and sixteen new Singapore objects 2–5 ms.
- [x] Check that D1 follows the object hold. Done from older tails: Deriver
  B's write batch measured 62 ms at the median with a Singapore primary and
  62 ms with a Hong Kong primary, called from Hong Kong both times. The
  distance to Singapore, about 35 ms, equals the difference of the holds.

**The user's APAC users** (stated October 12): most in Singapore and
Malaysia, some in Hong Kong and mainland China. That makes Singapore the
candidate, not Tokyo. Estimates against the Hong Kong home, for a
registration after setup: about 0.6 s faster for a user in Singapore or
Malaysia, and equal to 0.2 s faster for a user in Hong Kong, whose added
distance uses up most of the saved holds.

Two cautions. First, the stalls. The
[record of October 13](evidence/refactor-155h-write-stalls.md) found what
triggers them: the machine that hosts an object stops confirming durable
writes on a cycle of 5,000 ms, and for a shorter time on a second cycle of
30 s. Every object on the host waits, whatever its age, write rate or
storage API, and D1 waits the same way. A write, a response or an outgoing
request that arrives in the pause waits until its end, also for a request
that wrote nothing. A pause lasted 70–400 ms at the median. The longest
ones, in Singapore and Sydney, grew while the probe ran, from about 150 ms
to about 400 ms within 30 s in three rounds of seven; the probe's own load
is the likely cause, so they are not shown to be a property of those cities.
At the start of a round Singapore's median pause was 97–183 ms, like Hong
Kong's and Tokyo's. For 13 writes in series a Singapore home waits less than
a Hong Kong home at the median and the mean in every reading of the data;
the tail of the Singapore estimate is an upper bound, and half of it is one
event of seven seconds. Staging's own single-write commands of October 7 to
12 stalled less than the probe: 0.6% waited more than 50 ms over the median.
Two earlier statements were wrong and are corrected in the records: the
cycle does not start with an object's first write, and most of staging's
slow Router commands were claims that waited for a new object to start. The
probe is a reproduction, and its match with staging is not established: the
tails name no host. The facts leave one kind of cause, a step that each host
starts on its own timer and that probably waits for something the hosts of
a region share; what it is, is not known, and Phase 7 holds the report for
Cloudflare. Second,
the benchmark pair met a new isolate in 20 of 31 ceremonies in Singapore
against 7 and 10 of 31 in Hong Kong, in one run each. That one is not settled.
The measurement seat is a third point: from Tokyo, a Singapore home shows
about 70 ms of round trip per exchange, so the hosted driver needs a
Singapore vantage or the server-side totals to show what users get.

**Decided on October 12, by the user:** the APAC components of a lane must
not be dispersed. The Gateway, Console, the Derivers, the Signing Worker and
all their databases run in one place, and that place is Singapore. This
replaces the Hong Kong anchor of R155G Phase 1 for every lane.

Where each lane stands, from `deployment/wallet-system/targets.json` and a
`SELECT 1` against each database on October 12:

| Component | Staging | Production testnet | Production mainnet |
| --- | --- | --- | --- |
| APAC Gateway placement | Hong Kong | Singapore | Hong Kong |
| APAC Gateway database | HKG | SIN | HKG |
| Console database | HKG | SIN | SIN |
| Deriver A placement and database | with its caller, HKG | Tokyo, NRT | with its caller, HKG |
| Deriver B placement and database | with its caller, HKG | Tokyo, NRT | with its caller, SIN |
| Signing Worker placement and database | with its caller, HKG | Osaka, KIX | with its caller, SIN |

What moves to reach one Singapore anchor:

- **Staging:** five databases and the Gateway and Console placements. Empty
  candidates with Singapore primaries are created under
  `.artifacts/r155h-singapore-anchor/` in `seams-monorepo`; nothing serves
  them yet.
- **Production testnet:** three role databases and the three role
  placements. Its Gateway, its Gateway database and its Console database are
  in Singapore already.
- **Production mainnet:** the Gateway placement, the Gateway database and
  Deriver A's database. The other three databases are in Singapore already.

The Singapore anchor needs five production database moves. The Hong Kong
anchor needed eight. Each cutover needs a window from the user: writes are
frozen during the copy. Existing wallet objects never move, so a wallet
registered before a lane's move keeps objects in the old city until it is
relocated or discarded. An unpinned role Worker runs where its caller runs,
so a role pin is needed only where another region's Gateway must not pull the
role away from its database; with one set of role databases per lane, the
other regions' custody calls cross to Singapore in either case.
- [x] Staging clean switch to Singapore. The user ruled on October 13: no
  lane is live, every wallet and all data are discarded, downtime is
  accepted, and nothing is copied. Done on October 13: eight new empty
  databases, five in Singapore and three for the other regions; migrations;
  the target change (private `281e48f`); the Console and backend workflows.
  All 14 staging Workers serve versions that bind only the new databases,
  and the APAC components run at `aws:ap-southeast-1`. The owner created a
  new organisation and project, the protected activation passed, and twelve
  fresh registrations with a first signature each passed, all verified
  independently. The owner deleted the old staging databases on October 13.
  The private record is `docs/singapore-clean-switch-20261013.md` in
  `seams-monorepo`.
- [x] First measurement on the Singapore lane: nine wallets, client in
  Tokyo, published 0.9.0 code, no control arm. Finalization's server total
  measures 265 ms at the median against 602 ms in Hong Kong: wallet commit
  63 against 187 ms, custody commit 19 against 61 ms, session issue 28
  against 68 ms. Registration after the passkey step measures 2,671 ms
  against 2,988 ms. The 90th percentiles are wide, setup 1,193 ms and Yao
  execute 2,596 ms, and need a larger run. The yield, the SIMD build, the
  prewarm and Phase 2 are not in 0.9.0 and are not in these figures.
- [x] Larger measurement on the Singapore lane, with server-side totals
  beside the Tokyo client's numbers: 198 wallets on 0.9.0 and 164 on 0.9.3
  on October 13. On 0.9.0 the lane measures 2,332 ms after the passkey step
  at the median and 3,044 ms at the 90th percentile; the first nine-wallet
  figure of 2,671 ms was high. Run medians of 33 wallets on one release
  differ by up to 213 ms, so a claim under 150 ms needs about 100 wallets
  per side. The [record](evidence/refactor-155h-release-093-staging.md)
  holds both sides.
- [ ] Production testnet, then mainnet. Empty databases exist for both
  lanes. The deployment is blocked by more than placement: the lanes run
  September builds, their regional Workers do not exist, the testnet workflow
  needs an environment id before its Console exists, and mainnet has no
  tenant activation path. The private record lists the six blockers.

- [ ] Count the reads and writes per request from the Phase 0 D1 record.
  Finalization is write-heavy, so D1 read replication near a regional Gateway
  cannot carry it. Record the number.
- [ ] Cost the Tokyo home: a role database set and a Console lane per home,
  the R155G Phase 1 cutover method per lane, and a hazard list per home.
- [x] Decide: Singapore, one place for all components. The move repeats the
  October 10 method for the three role databases and the October 11 method
  for Console, adds the regional Gateway database, and pins the Gateway to
  `aws:ap-southeast-1`. A D1 primary cannot be placed by city: a database is
  created until it reports the wanted primary.

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
- [ ] Pauses of durable writes. The
  [record](evidence/refactor-155h-write-stalls.md) gives the cause that is
  visible from outside: each host pauses write confirmation every 5 s for
  110–400 ms, and a write that arrives then costs the rest of the pause. The
  application cannot avoid a pause. It can lower how many it meets and what
  each one costs:
  - Count the durable commits that a registration and a signature wait for
    in series, per object and database, from the measurement build of
    Phase 1. The 13 is an estimate. Put the writes of one object and one
    step in one commit.
  - Overlap commits on different objects and databases. Their hosts pause at
    different times, so overlapped waits do not add.
  - Keep background writes off an object while it serves the path. A
    background write that lands in a pause holds every response of that
    object.
  - Add no timeout and retry for a stalled write. A retry goes to the same
    object and waits behind the same gate. The longest pause measured was
    3.2 s; keep every timeout of a step with a durable write above that.
  - Ask the user before any write becomes unconfirmed. `allowUnconfirmed`
    on a KV-style `put` takes the pause and the hold out of the response;
    that is measured. A write that follows the response should do the same;
    that is not measured. In both cases the response leaves before the write
    is durable. The claim must stay confirmed.
  - Report the share of clean single-write commands more than 20, 50 and
    100 ms over their median in every hosted comparison. `staging_tails.py`
    in the private probe folder computes it.
  - Make the pause visible in the product's own logs. Done in code, not
    deployed: each wallet object logs `wallet_do_host` with its role, object
    id, colo and host once per instance, beside its first command and off
    the response. The host is the `fl` value of
    `https://cloudflare.com/cdn-cgi/trace`. Open: in the next hosted run,
    fold the stalled commands of each host on 5,000 ms. Until then the
    share of a registration's tail that the pause explains is the probe's
    estimate.
  - Before another probe round, measure one region with a single light
    stream and then add load from a second deployment at a known time. The
    probe's own load may lengthen the pause that it measures.
  - Do not measure lateness with the object's clock. `Date.now()` in a
    timer callback is the scheduled time, and the clock leaves out the
    object's own CPU time. Use the caller's round trip or a request that is
    not gated.
- [ ] Report the pauses to Cloudflare. The user sends it; the draft is
  `.artifacts/r155h-write-stall-probe/cloudflare-support-draft.md` in
  `seams-monorepo`. Ask what the hosts do every 5 s and 30 s, and whether
  the confirmation can stop waiting for it. The D1 team has said in public
  that storage operations on one machine can starve each other and that the
  threading is being changed; the record links the threads. Ask whether the
  pauses are that problem.
- [ ] Report p90 in every comparison from here on.

## Phase 8 — Measure and record

- [ ] A discarded warm-up group of three wallets before each measured group,
  and at least six wallets per measured group; nine when a phase claims less
  than 0.3 s.
- [ ] Build every candidate with `WASM_SDK_BUILD_MODE=prod` and the release
  Worker profile. Record the build stamps and the module sizes in the run's
  frozen inputs. Every hosted comparison before October 12 carried a
  development build of the seal module.
- [x] The accumulated changes of release 0.9.3, measured on the Singapore
  layout from Tokyo on October 13: registration after the passkey step,
  registration without the passkey step and the first signature with p50,
  p90, minimum and maximum; the stages; the Worker chain with wall and CPU
  time and the isolate counter; and the finalization spans. One lane serves
  one release, so the sides ran one after the other, with six runs before
  and three after to show the noise. The
  [record](evidence/refactor-155h-release-093-staging.md) holds it. The
  spans of Phase 1 do not exist yet.
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
