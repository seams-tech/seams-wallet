# R155H — Custody execution at setup, Console exchanges off the path, and the registration floor

Status: **in progress.** Phase 0 starts on October 12. Phases 1 to 3 wait
for the decisions listed below. Date: October 12, 2026.

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

The Yao execution has its own objective. The online protocol must move from
about 800 ms toward the July probe's 202 ms, and the Router's execute span
from 1,624 ms to under 600 ms. The probe never paid the Router's claim, the
Signing Worker delivery and the Router's finish, about 250 ms of durable
bookkeeping, so the Router span cannot reach 202 ms. The protocol can approach
it. Phase 4 owns this objective; Phase 1 removes the admission, the
connection and the garbling from the online path on its way there.

Decisions this plan needs before Phases 1 to 3 start:

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
  86 and 84 ms for the same work. The hosted factor is 4–8 and varies twofold
  between wallets on one version. Public single-core benchmarks put a loaded
  server core at roughly a third to a quarter of an M4 core, so the hardware
  explains about 2.5–4 of the factor. The rest, and the variance, come from
  the isolate's state or its neighbours. Isolate starts do not explain it:
  Deriver A's execution met a new isolate in 2 of 24 executions. The Deriver
  Workers are release builds: `build-strict-worker.sh` builds `--release`
  unless `ROUTER_AB_WORKER_BUILD_PROFILE=dev`, so the factor is not a build
  artifact like the seal's.
- The same ceremony ran in **202 ms p50 on deployed Workers** in the July
  probe campaign, the same-account Service Binding WebSocket pair of the
  phase 9b report (`crates/ed25519-yao/docs/phase9b-same-account-report.md`),
  and in 141 ms on local workerd. The production path runs it in about
  800 ms. The 4× between the probe and production is product wrapping, the
  Durable Object write gate after the last frame, or isolate state. It is not
  the hardware. In this week's candidate-4 timeline Deriver A's handler ended
  at its clock reading 904 ms and the Router received the reply at 1,246 ms.
- The native floor, measured on October 12: the raw 64k activation ceremony
  takes **67 ms** wall on an M4 Pro, both roles over Unix sockets, 33 frames,
  eight runs with `benchmark_phase5_role`; the native local registration
  lifecycle through `router-ab-dev` measures 94 ms p50. WASM costs 2–3×
  native, the deployed platform 1.4× local workerd in July, and production
  4× the probe. A bigger server core running the same WASM would land near
  the laptop's WASM figures, not below them.
- The protocol's 800 ms is close to the sum of both CPU figures plus three
  round trips. The garbler streams its tables after the oblivious transfer, so
  garbling and evaluation overlap little.
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

- [ ] Add an isolate-local execution counter to Deriver A and Deriver B, a
  module-level atomic incremented per protocol run, and log it in the
  existing `deriver_a.yao_protocol` and `deriver_b.yao_protocol` span records.
  The Worker tail already reports CPU per invocation; `yao-chain.py` joins
  both.
- [ ] Extend `yao-chain.py` with the counter and with p50, p90 and maximum per
  column. Extend the comparison analysis with p90 for registration,
  registration after setup and each stage.
- [ ] Run one staging group of at least nine wallets on the current versions,
  after a discarded warm-up group. Classify the CPU factor. If CPU falls with
  the counter, warmness is the cause and Phase 4 takes the compute prewarm. If
  CPU is flat at four times local or more, the core is the cause and Phase 4
  takes the SIMD path.
- [ ] Measure the core ratio directly. Add a fixed micro-workload to the
  prewarm handler, a few thousand gate hashes and a hundred field
  multiplications, and log its CPU with the counter. CPU per unit of work in
  a fresh isolate, in a warm isolate and on the laptop separates the hardware
  from the isolate's state.
- [ ] Redeploy the phase 9b benchmark pair on today's platform and measure
  twenty warm ceremonies. About 200 ms means the platform is unchanged and
  the 4× is ours. 600–800 ms means the platform changed, and Phase 4 starts
  with Cloudflare before any code.
- [ ] Attribute the time after Deriver A's last frame. Log a clock reading
  after the outcome record's storage write settles and one before the reply
  leaves, so the gap splits into the write and its output gate, the seal, and
  the response path through the stateless Worker.
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
- **Micro-workload.** Enable the existing `passive-wasm-benchmark` Cargo
  feature of `ed25519-yao` for the Deriver Worker builds and call its
  export-circuit run (`passive/phase5_wasm_benchmark.rs`, 1,275 AND gates)
  from the `/internal/prewarm` handler in `strict_worker/mod.rs` when the
  counter is zero. Log `{"event":"prewarm_microwork","role":...,
  "execution_index":N}`. The tail's `cpuTime` on that invocation is the CPU
  per unit of work. Run the same function once on the laptop through the
  wasm-bench scripts (`crates/ed25519-yao/wasm-bench/scripts/`) for the
  local figure.
- **Probe pair.** The engine benchmark lives in `crates/ed25519-yao/wasm-bench`
  with `scripts/run_phase5_streaming.mjs`. The deployed July pair, two
  Workers on one `DERIVER_B` Service Binding WebSocket, is described in
  `crates/ed25519-yao/docs/phase9b-same-account-report.md`. If no deployable
  pair exists in the tree, build one from `wasm-bench` under a temporary
  directory in `tests/` with the Derivers' `apac` placement, one warm-up and
  twenty ceremonies. Deploying it to the staging account needs the user's
  go-ahead first.
- **Write gate.** In `deriver_a_pair.rs`, around the `Complete` command near
  line 860, log `worker::Date::now()` immediately before the command, after it
  returns, and before `Ok(outcome)`. The Router's `router.deriver_a_execute.http`
  span end is the receipt time. `Date.now()` advances only at I/O, so the
  distance from the last reading to the Router's receipt is the output gate
  plus the response path; `yao-timeline.py` shows all four readings per
  execution.
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
phase moves the session mint to setup and the pair preparation into the
prompt. It leaves at execute only what needs the client's inputs or the
verified credential.

R155G reviewed two smaller versions of this move and declined both. The
admission stores the digest of the custody binding, whose pair digest covers
the client's two encrypted inputs, and those inputs exist only after the
respond reply; an admission bound to the session and the epoch alone would
change the admission identity for about 50 ms per Deriver. Deriver B's object
accepts A's connection only after its own admitted preparation, which carries
the client's input today. The base transfer seeds must serve exactly one
extension. This phase takes the admission identity change because the pair
preparation and the garbling ride on it, worth ten times the admission alone.
It splits B's preparation into a setup-time admission and an execute-time
input, so the connection is accepted at setup. The one-use rule for seeds and
tables is stated below.

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
- [ ] **Garble before execute.** Deriver A garbles the activation circuit into
  its table buffer during the prompt. Step one keeps the wire order: at
  execute, A streams the buffered tables after the oblivious transfer, as
  today. This removes A's garbling CPU from the online path without a wire
  change. Step two, only if the Phase 8 chain shows the 2.1 MB transfer on the
  critical path, moves the manifest and the table frames ahead of the
  oblivious transfer and lets Deriver B buffer them in its wallet object. Step
  two changes the transcript order, so it changes the stream KATs, the
  specification's online ceremony and the formal verification tasks
  (`cargo yao-fv all`, including `ed25519-yao-fv-passive-security`).
  Regenerate the goldens only with that intended change.
- [ ] **Precompute the base oblivious transfers, optionally.** With the pair
  prepared during the prompt, A and B can also run the base transfers and the
  extension on random choices before execute, and derandomize them against
  the real inputs at execute. This is the standard precomputed-transfer
  construction. It changes the transcript, so it needs the same formal
  verification path as step two. Take it only if the Phase 8 chain shows the
  transfer rounds and B's curve work, 17 ms local, still on the critical path.
- [ ] **Execute binds, then runs the online part.** The execute request carries
  the client's encrypted inputs and the admission receipt as today. The
  Router's claim verifies the receipt against the session minted at setup and
  binds the prepared pair session to this execution. Both Derivers record the
  custody binding digest against their admitted session at this point and
  verify it before the online phase; the attempt-conflict rule moves there.
  The Router sends B its
  input through the existing preparation endpoint, which now attaches the
  input to the admitted session instead of creating it. A and B continue from
  the oblivious transfer. A prepared session that no execute claims expires
  with the deadline, and both objects destroy the labels, the buffer and the
  garbling state. An execute after expiry prepares inline, as today.
- [ ] **One session, one use.** The buffered tables bind to the session and the
  execution id. A second claim, a retry after a lost reply, or a relocation
  fence must find the prepared state consumed or destroyed, never reused.
  Reuse of a garbled circuit with a second set of input labels breaks the
  construction. The one-use rule is a protocol invariant, not a performance
  detail.
- [ ] **Bound the exposure at setup.** Setup already starts objects and reserves
  a home for any caller with the publishable key. The prepare adds two D1
  admissions and 300–600 ms of Deriver CPU per setup. Enforce the existing
  setup route policy per publishable key and source IP before the prepare, and
  cap prepared sessions per wallet to one. Record the measured cost of an
  abandoned setup.
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

Expected gain: 0.5–0.7 s of the execute request at the median. Admission,
connection and B's re-read leave the path, and garbling's CPU moves into the
prompt. The oblivious transfer, the evaluation, the sealing, the delivery and
the two Router commands stay.

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
4. **Deriver A** admits, opens the connection to B's object, creates its
   garbler seed and delta, and garbles the activation circuit into a buffer
   through `GarblerMachine` in `crates/ed25519-yao/src/passive/runtime.rs`
   with the production chunk profile. It holds `Prepared { session, garbler,
   tables, deadline }` in memory. The wire labels derive from the seed, so the
   tables are the same bytes that today's online garbling produces.
5. **Execute** arrives as today. The Router claims, builds the pair binding
   from the client's inputs, chooses the execution id, sends B its input
   through the existing prepare endpoint, now an attach to the admitted
   session, and sends A the execute request. A verifies the binding against
   its prepared session, writes the binding digest into its attempt record
   (this is the admission identity change R155G costed at one D1 write), then
   selects its direct input labels with `prepare_labels` from the same garbler
   (`passive/phase4.rs`), runs the oblivious transfer, streams the buffered
   tables after `AwaitExtension` in `passive/role_protocol.rs`, and finishes
   as today: returned labels, translation, seal, `Complete`, reply.
6. **States and one use.** A: `Prepared → Bound(execution_id) → Running →
   Completed`; a second execution id against `Bound` or `Running` is refused;
   `Completed` is the durable record that a retry replays. B: `Admitted →
   Attached(input) → Running → Completed`. A Durable Object alarm at
   `deadline_ms` destroys `Prepared` and `Admitted`: zeroize tables, labels,
   seed and OT state, close the socket, and release the admission. An execute
   that finds no prepared state runs today's inline path; keep that path.
7. **Engine entry points.** Add to the passive role protocol a garbler
   constructor that takes a prebuilt table buffer and the same garbler, and a
   function that produces that buffer without an input. The transcript bytes
   do not change, so `stream_kats.rs` and `cargo yao-fv all` pass unchanged.
   Any change that alters the transcript is step two of the garble item and
   needs the user's go-ahead.
8. **Exposure.** `enforceRoutePolicy` in
   `packages/wallet-server/src/router/framework/enforceRoutePolicy.ts` runs
   before setup with the publishable-key principal and `sourceIp`. If it has
   no per-key rate limit, stop and ask before adding one. The object refuses a
   second prepare while one is live.

Acceptance: the chain's admission, connect and B re-read columns read 0 on
the execute path; new spans `router.prepare_pair_at_setup`,
`deriver_a.pregarble` and `deriver_b.admit_at_setup` appear before respond;
the online protocol measures 350 ms or less at p50 on staging;
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

Expected gain: 150–250 ms of finalization.

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

## Phase 4 — Close the Yao execution gap to the July probe

The Router's execute span, 1,624 ms at the median of 24 executions, against
what the July probe paid and what each part should cost after this plan:

| Part | Today | July probe | Target | Owner |
| --- | ---: | ---: | ---: | --- |
| Router claim in its wallet object | 96 ms | 0 | ~90 ms | durable one-use; slim the 16 KB command bodies |
| Dispatch to the roles | 26 ms | 0 | ~25 ms | stays |
| Deriver A admission, two D1 round trips | 113 ms | 0 | 0 online | Phase 1 |
| Pair connection | 196 ms | 0 | 0 online | Phase 1 |
| Deriver B re-read of the admitted session | 56 ms | 0 | 0 online | Phase 1 |
| Protocol, clock-visible and hidden | ~800 ms | 202 ms | 250–350 ms | this phase, with Phase 1's garbling move |
| Signing Worker delivery | 88 ms | 0 | ~90 ms | activation receipt; stays |
| Router finish in its wallet object | 69 ms | 0 | ~70 ms | durable completion; stays |

The 800 ms splits into the clock-visible protocol, 434 ms, and the gap from
Deriver A's last clock reading to the Router's receipt, 373 ms. The probe's
202 ms covered the same frames and transfers with fixed fixtures, warm
isolates, no admission, no product checks and no durable record. Phase 0's
counter, micro-workload, probe redeploy and write-gate attribution say which
of the three causes carries the gap: the isolate's state, the product work, or
the Durable Object write and its output gate. Take the branches that apply.

- [ ] **Frame profile.** The probe streamed 17 frames of 128 KiB. Verify which
  profile the production roles select, from the frame count in B's duplex
  records. If production streams 33 frames of 64 KiB, measure 128 KiB on
  staging; the probe already proved its peak buffer inside the isolate bound.
- [ ] **Per-message cost on the Durable Object path.** The probe's frames
  flowed between two stateless Workers on one Service Binding. Production
  frames flow between two wallet objects through B's stateless Worker. Measure
  B's time per frame from the duplex records. If the per-message cost
  dominates, fewer and larger frames are the lever, not the engine.
- [ ] **Product work in the protocol span.** The target-proof exchange, the
  commitment checks and the HPKE seal are product additions the probe did not
  run. Place them with the local profiler per the Phase 0 method, and move
  what does not need the execution's result to the prepared session of
  Phase 1.

- [ ] **Warmness.** Make the prewarm do compute. The `/internal/prewarm` route
  and the wallet-start handler garble the export circuit once, 1,275 AND
  gates, so the gate hash and the field arithmetic tier up on the server that
  will run the object. Bound the prewarm's CPU and skip it when the isolate's
  counter is above zero. With Phase 1, the prepare at setup warms the same
  server anyway; measure whether the prewarm still matters afterwards.
- [ ] **The core.** Only if Phase 1 has not landed: build the Derivers with
  `-C target-feature=+simd128` and replace the gate hash's AES with a
  fixsliced SIMD implementation in `crypto.rs`, same cipher, same outputs. The
  formal verification vectors and the cross-language task must pass
  unchanged. After Phase 1 the online hash work is the evaluator's two hashes
  per gate, about 70 ms hosted, so the change is worth about 35 ms then. Curve
  arithmetic has no SIMD backend on `wasm32`, and the 64-bit backend is
  slower; the lever on curve work is Phase 1's optional transfer
  precomputation, not faster arithmetic.
- [ ] **The write gate.** If Phase 0 places the time after the last frame in
  the outcome record's write and its output gate, establish what that record
  protects before moving it: the claim must stay persisted before protocol
  material, and a retry after a lost reply must still find one execution. If
  the Router's finish already makes the outcome durable, the record can
  settle beside the reply; otherwise record the reason and keep it.
- [ ] Record the per-execution CPU of both Derivers after the branch, with the
  counter.

Expected gain: 200–400 ms if warmness is the cause. About 100 ms from the AES
change before Phase 1, about 35 ms after it. With Phase 1, the online
protocol should measure 250–350 ms and the Router's execute span
500–600 ms; both are reported per part in Phase 8.

### Phase 4 notes

- Frame profile: `role_protocol.rs` is generic over `C: FixedChunkProfile`;
  the production value is bound where `run_activation_deriver_a` in
  `crates/router-ab-ed25519-yao/src/duplex.rs` reaches `execution.rs`.
  `Chunk64KiB`, `Chunk128KiB` and `Chunk256KiB` exist in
  `passive/stream.rs`. The probe used 128 KiB, 17 frames. The frame count of
  a production run is in B's duplex records.
- Compute prewarm: the Phase 0 micro-workload function, run when the counter
  is zero, in `/internal/prewarm` and in the wallet-start handler.
- Write gate: the `Complete` command near `deriver_a_pair.rs` line 860 is a
  synchronous SQLite write in the object; the output gate holds the reply
  until it is durable. The Router's `finish_registration` in
  `router_wallet.rs` is the second durable write. Before moving anything,
  establish whether a retry reads A's `Completed` record through
  `DeriverAPairDoCommandV1::Read`.

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
  new spans (`router.prepare_pair_at_setup`, `deriver_a.pregarble`,
  `deriver_b.table_buffer`); and the finalization spans.
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
