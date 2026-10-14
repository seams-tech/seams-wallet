# R155H — Custody execution at setup, Console exchanges off the path, and the registration floor

Status, October 14, 2026: **core changes are implemented; focused follow-ups remain.**
The last verified staging release is **0.10.1**. Later SDK/finalization changes are
committed on `dev`; their temporary staging comparison was restored to the original
versions. They are not published. Median targets have been demonstrated in named
runs. Tail acceptance remains open under [R155J](refactor-R155J-p99.md).

## Current work and evidence

This table is the current execution list. Older measurements and estimates below
retain their dates; they are not current rollout instructions or promised savings.

| Phase | Current state | Remaining work |
| --- | --- | --- |
| 0 — Measurement | CPU classification and named span/probe records exist | Complete any missing per-call decomposition needed for an actual slow sample |
| 1 — Preparation at setup | Session mint, pair admission/connection, expiry, and 30 setups/minute per key + IP are implemented; released in 0.10.0 | Measure abandoned-setup cost; retain B's deliberate execution-time read |
| 2 — Early passkey claim | Implemented, released in 0.9.3, measured | Preserve claim/retry guarantees in later changes |
| 3 — Console completion after reply | **Deferred** | No outbox implementation now; existing session issue and custody commit already overlap |
| 4 — Yao execution | Yield, SIMD, compute prewarm, label wipes, and four-block hashing are released and measured | Profile product work around the protocol; move only demonstrated result-independent work earlier |
| 5 — Setup and SDK completion | Preflight, background usage telemetry, and session publication improvements implemented | Publish accumulated SDK changes; no separate benchmark for each small change |
| 6 — Singapore placement | Staging switched and verified; Console data-preserving move completed October 14 | Production rollout is separate release work; verify its current prerequisites before a cutover |
| 7 — Outliers | Release metadata stripping and host observations implemented; bounded captures recorded | R155J owns unresolved startup, delivery, signing-503, and B-await causes |
| 8 — Combined measurement | Published-release comparisons and the October 14 42-wallet comparison recorded | Measure the next accumulated candidate; R155J's 500-attempt p99 acceptance remains open |
| 9 — Finalization | Shared-record removal released; Yao admission batch and founding-read overlap committed | Profile remaining CPU; hosted benefit of the founding-read overlap is unmeasured |
| 10 — Combined proof and execution | Implemented and released in 0.10.0 | Recover transient `respond` failures with exact bounded replay and correct error mapping |

Next implementation priorities are Phase 9's CPU investigation, Phase 4's
result-independent product work, and Phase 10's recoverable failures. Implement
only supported changes, run correctness checks, and measure the accepted bundle.
Do not reopen cross-request plaintext caching or the Console outbox as incidental
cleanup.

### Release and comparison record

- [0.9.3](evidence/refactor-155h-release-093-staging.md): 164 successful wallets;
  after-passkey median 1,734 ms and p90 2,221 ms, against 2,332/3,044 ms on 0.9.0.
- [0.9.4](evidence/refactor-155h-release-094-staging.md): engine optimization;
  staged Yao execution shortened by about 60 ms in that comparison.
- [0.10.0](evidence/refactor-155h-release-0100-staging.md): early pair preparation,
  capability-record change, and merged proof/execution; after-passkey median
  1,747 ms against 2,096 ms on its 0.9.4 control.
- [0.10.1](evidence/refactor-155h-release-0101-staging.md): setup patch with no
  latency change of its own. The separate Console scan correction is recorded
  there; its corrected 0.10.0 run measured 1,383 ms after the passkey step.
- [October 14 combined candidate](evidence/registration-completion-20261014.md):
  12 control, 18 candidate, and 12 repeat-control wallets; all 42 signatures
  verified. Candidate finalization median 480 ms versus 571/566 ms in controls.
  Full registration excluding passkey interaction measured 2.597 s versus
  2.676/2.456 s, so no consistent overall gain is established. Candidate maximums
  were 4.765 s for registration and 5.877 s through its first signature. The
  candidate contains `7caae2fa` and `8b4dcf5f`, not the later founding-read change.
- [Deriver B follow-up](evidence/deriver-b-latency-20261014.md): binding-await
  medians 96.5–120 ms in those arms, followed by 12–21 ms in three unchanged
  production-path samples. The historical cause remains unresolved. No migration
  was performed. This shared, variable delay limits attribution of small gains.

The initial control in the 42-wallet run overlapped a local negative test; treat
it as supporting evidence. Do not pool these distinct builds and diagnostic runs
into a p99 claim. All 14 original staging versions were restored after that
comparison. Production deployment and publication remain separately authorized
release operations.

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

Target SDK registration at **2–3 seconds median**, including setup and excluding
user interaction, and **two seconds or less after the passkey step**. Report p90,
maximums, and failures beside the median. These are targets, not guarantees.
R155J owns p99 acceptance. Keep first signature and the combined user flow as
separate measurements; exclude funding and blockchain confirmation.

The Yao targets remain at most 450 ms of measured protocol elapsed time and an
800 ms Router execute request. The October 12 unoptimized pair and clock-only
figures are historical context in the [probe record](evidence/refactor-155h-probe-hosted.md).
Use matched caller/Worker wall and CPU evidence; do not infer actual protocol
elapsed time from a clock-only span. Durable claims, delivery, and completion
remain required. Phase 1 overlaps early admission and connection with the prompt;
B's deliberate execution-time admission read remains.

Historical decisions requested before implementation are retained below. Their
outcomes follow under "Decided on October 12". Phase 1 and Phase 2 are implemented;
Phase 3 remains deferred, and Phase 6's staging move is complete.

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

## Measured starting point — historical October 11–12 baseline

These figures explain the original plan. Later releases and the current work
table supersede their rollout assumptions and projected savings.

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
deployment, was the starting baseline: registration excluding authentication
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

The initial phase ordering has been completed. Use the current work table above
for the remaining work. Keep implementation changes in logical commits and run
correctness checks during development. Measure accumulated changes together;
isolate one only when a regression or failure requires diagnosis.

A wire or lifecycle change updates its specification and behavioral contract in
the same change set. A protocol or custody-state change requires the dedicated
review and verification named by its owning specification. Release planning
must preserve concurrent work and record the exact frozen source revisions.

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
- [x] Redeploy the phase 9b benchmark pair on October 12. The
  [probe record](evidence/refactor-155h-probe-hosted.md) holds eleven runs.
  By the July metric the pair read 250–400 ms against 202 ms in July. The
  metric is the Worker clock, which excludes own CPU; the real time is
  520–640 ms. The platform is not the cause of a fourfold gap, because the
  gap was a comparison of a clock span with a real duration. The pair is
  deleted.
- [x] Attribute the time after Deriver A's last frame. Closed without new
  logging: the probe shows the same gap with no durable write and no object,
  equal to Deriver A's CPU. It is the clock's exclusion of own CPU, not a
  write gate or a response path.
- [x] Record finalization spans beside browser stages. Release records and the
  [October 14 comparison](evidence/registration-completion-20261014.md) include
  initial read, consumption, wallet/custody commits, session issue, and total
  spans. The serving Gateway exposes Server-Timing.
- [x] Record available D1 read/write/batch evidence. The
  [write-pause record](evidence/refactor-155h-write-stalls.md) and
  [B investigation](evidence/deriver-b-latency-20261014.md) retain timings,
  SQL metadata, locations, sample counts, and instrument limits.
- [ ] Complete missing production per-call decomposition only where a slow
  sample needs it. Existing await spans do not isolate D1 confirmation from
  transport, preceding work, or continuation scheduling. R155J owns that capture.

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
- **Clock.** Worker clocks advance at I/O boundaries. Use browser elapsed time
  and matched Worker wall/CPU records for totals. Do not treat a zero as free
  work or an await span as pure network time. Do not add an invocation's entire
  CPU time to a narrower span unless the intervals are proven to match. Older
  `protocol_real` calculations remain historical estimates.
- **D1 cost per call type.** From each sample's per-request `d1.services` list
  in the run's `lifecycle.json`, and from the role databases' logs
  `bound_root_d1_timing` (`access`, `round_trips`, `batch_ms`,
  `initial_read_and_open_ms`).
- **New comparisons.** Snapshot the actual serving versions and database IDs.
  The October 12 restore snapshots are obsolete. Use the current Singapore
  resources, protected activation, and release builds. Keep first-use attempts
  in the primary population; label any separate warmed cohort.

## Phase 1 — Custody execution at setup

Implementation update (October 13): setup dispatches input-free admissions to
both wallet objects and opens A's authenticated connection to B during the
passkey prompt. The user selected **30 setups per minute per publishable key
and source IP**. Counters use the existing regional Gateway database. A
counter failure returns 503; exhaustion returns 429 before reservation or
startup. This is a regional limit, so traffic across regions has separate counters.

Each wallet holds one preparation for at most 30 seconds, bounded by the
ceremony expiry. A retry preserves the first epoch and deadline. The prepared
connection carries no client input or protocol material. Execution binds the
existing admission to the exact encrypted-input pair, then claims each role
before protocol material flows. Expiry releases unused admissions and closes
the socket. Missing or expired preparation uses the online admission path.
Cancelled admissions and ownership fences refuse execution.

The real Worker test verifies connection reuse, exact replay, execution after
expiry, abandoned admission cleanup, and cancellation. Gateway D1 tests verify the
30-request concurrent limit, key/IP separation, window expiry, and failure
refusal. [Evidence](evidence/refactor-155h-prompt-preparation.md) records commands
and limits for the local implementation. That record predates deployment;
the hosted 0.10.0 results below establish its later release and measurement.

Hosted measurement, October 14 (release 0.10.0 on staging): the Router's
preparation request takes 699 ms at the median, in the background of the
prompt, and the browser's setup stage did not change. The Router's execute
request fell from 787 ms to 721 ms and Deriver A's execute work from 602 ms
to 441 ms. The execute request still holds a pair preparation span of
142 ms. The Derivers' start-up ceremony now runs in the preparation request,
and arriving work stopped it in 11% of the cases, against 2% on 0.9.4. The
hosted cost of an abandoned setup is not measured yet. The
[staging record](evidence/refactor-155h-release-0100-staging.md) holds the
runs.

A binds and reads its role state in one D1 batch. B binds during input
preparation and retains its fresh read before execution. That read rechecks
cancellation, fencing, and root state. Cross-request decrypted-share caching is
not an accepted optimization. Moving B's bind into its execution-time load is a
separate, deferred custody-state proposal; its safety is not established here.
Do not treat the original one-batch-per-role estimate as unfinished Phase 1 work.


Before this phase, setup reserved the home and started the four wallet
objects; respond verified the credential, minted the Yao session and issued the
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

- [x] **Mint the Yao session at setup.** The lifecycle id and the threshold
  session id were the ceremony id already. Two values were minted at respond:
  the four ids of the material activation and the 32-byte session id of the
  admission receipt. Setup now mints both for a plan with a NEAR branch and
  stores them in the ceremony record (`ed25519YaoMint`), in the setup
  snapshot and in its copy. A setup retry reads the stored record back, so
  the identity is minted once. Respond builds the admission request over the
  stored material activation, and the NEAR-only admission passes the stored
  session id to the backend, which issues the receipt over it. The minted
  identity binds no authority and admits nothing: the admission still
  follows the verified proof. Setup of a NEAR plan now fails with
  `not_configured` when no SigningWorker is configured; respond failed there
  before. Mixed registration uses the same stored material activation and session
  identity for its later verified admission. No wire changes. A ceremony
  record of a NEAR plan without the identity does not parse, so a
  registration that is between setup and respond during a deployment starts
  again.
- [x] **Prepare the pair during the prompt.** After the setup transaction
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
- [x] **Execute binds, then runs the online part.** The execute request carries
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
- [x] **One session, one use.** The admitted session binds to one execution
  id at execute. A second claim, a retry after a lost reply, or a relocation
  fence must find it bound or released, never open for a second execution.
- [x] **Bound exposure at setup.** The selected limit is 30 setups/minute per
  publishable key and source IP, with one prepared session per wallet and a
  30-second maximum lifetime. Tests cover concurrent exhaustion, separation,
  expiry, and storage failure. Early admission/connection adds no protocol
  computation itself; the existing compute prewarm still consumes CPU.
- [ ] Measure the hosted cost of an abandoned setup under the released design.
  This is a remaining cost measurement, not a missing rate-limit implementation.
- [x] **Keep the other families online.** Recovery, export and lane
  materialization keep the online path; only fresh registration activation
  prepares at setup. Mixed NEAR and ECDSA registration keeps the same NEAR
  path.
- [x] Update `docs/router-ab/ed25519-yao.md` (fixed roles and the online
  ceremony), the registration lifecycle text in `docs/intended-behaviours.md`,
  R155C's flow description, and the local Yao contract's stage assertions. Add
  composed scenarios for an abandoned setup, an expired prepared session and an
  execute after expiry.

Must not regress: one durable execution per pair, exact replay after a lost
reply, refusal before claim, the output-gate ordering that makes a persisted
claim precede protocol material, role secret separation (A never carries B's
input), ownership fences and relocation, and cancellation of a registration
that never executed.

Original full-plan estimate: about 0.3 s of the execute request at the median. Admission,
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

The proposed pre-implementation measurement is superseded: the object states
are implemented and measured on Singapore. R155J owns the remaining handler-entry,
storage, and scheduling investigation. Do not redeploy the old Hong Kong diagnostic
recipe as a prerequisite to Phase 1.

### Phase 1 design sheet

This is the implemented contract; it replaces the original proposed sequence.

1. Setup fixes the ceremony, session, material-activation identity, stored object
   addresses, ownership generation, epoch, and deadline. Exact retries preserve them.
2. After the setup commit, the Gateway schedules input-free pair preparation.
   The Router prepares both roles concurrently and A connects to B's exact object.
3. Each object holds one bounded preparation. This grants no signing execution and
   carries no encrypted client input or Yao protocol material before the proof.
4. Respond verifies the proof. Execution binds preparation to the exact input pair
   and execution identity. Durable claims precede protocol material.
5. B retains its execution-time admission read. No decrypted root share is cached
   across requests. A same-request verified result may be reused only under its
   existing ownership and freshness contract.
6. Missing or expired preparation uses ordinary online admission. Alarms release
   unused preparations. Cancellation and relocation fences still refuse execution.
7. Existing Worker and browser scenarios cover socket reuse, exact replay, expiry,
   abandoned preparation, cancellation, rate limits, and concurrent requests.

Migration and coordinated deployment were completed for staging in release 0.10.0.
The original design's claim of zero online B reads was not delivered and is no
longer an acceptance condition. Further bind/load consolidation remains deferred.
Any such proposal must preserve fresh root checks and one execution winner, with
its specification and tests updated before implementation.

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

**Deferred; not in the current implementation queue.** Console completion costs
about 19–35 ms at the median in recent Singapore records. Larger outliers exist,
but removing this dependency needs durable pending-publication and recovery state.
Session issue (including completion) already overlaps custody persistence.
There is no additional simple overlap to implement.

The checklist below is the retained design for an explicit future reopening.
It is not required to finish the other accepted changes.

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

Historical estimate: 150–300 ms on the older topology. Do not use it as the
current expectation. The remaining overlap and current Singapore timings bound
the available saving; no outbox implementation has been measured.

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
- [x] **Label wipes and a four-block gate hash.** Implemented on October 13
  and released in 0.9.4. The gate hash was not the largest cost: the wipe of dropped
  labels was. The derived wipe of a 16-byte array writes and fences each
  byte, and a ceremony drops several million labels. A label is now a value
  that one volatile write wipes, and the garbler hashes its four blocks in
  one pass of a 64-bit fixslice kept in `passive/gate_aes.rs`. In the engine
  benchmark garbling fell from 60 ms to 30 ms and evaluation from 39 ms to
  25 ms. On Cloudflare the benchmark pair's ceremony fell from 262 ms to
  210 ms on warm isolates, Deriver A's CPU from 166 ms to 121 ms and Deriver
  B's from 146 ms to 123 ms. The transcript is unchanged, and the frozen
  known answers pass. The [record](evidence/refactor-155h-label-wipe-gate-hash.md)
  holds the measurements and the verification. The Yao and registration
  contracts pass on release Workers. On staging with 0.9.4, the garbler's
  CPU per execution fell from 250 ms to 196 ms at the median and the
  evaluator's from 207 ms to 182 ms. The Router's execute request fell from
  783 ms to 720 ms. The [staging record](evidence/refactor-155h-release-094-staging.md)
  holds the runs.
- [ ] **Profile product work around the protocol.** Attribute target-proof,
  commitment, public-parameter, and envelope-preparation work with matched
  CPU and elapsed measurements. These costs are not isolated by the bare pair.
- [ ] Move only demonstrated result-independent work into the existing prompt
  preparation. Reuse verified results within one request where valid. Preserve
  role separation, one-use state, fresh root checks, and request-scoped plaintext.
  Do not implement cross-request share caching or change transcript order as a
  small performance cleanup. Savings are unmeasured.
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

- [x] Batch the Gateway's setup D1 writes into one batch after the Console
  reply, and keep the admission read first. Do not insert before the Console
  request answers: that request is also the publishable-key authentication
  (`resolveWalletRegistrationContext` in `walletRegistrationRoutes.ts` near
  line 2067), and a write for an unauthenticated caller is an abuse surface.
- [x] Move Console's API-key usage update off the request. It records the
  last-used timestamps and consumes no quota, as R155F classified it.
- [x] Start setup's best-effort preflight when a registration-configured wallet
  runtime initializes. Reuse the existing browser preflight helper. Same-origin
  and signing-only clients skip it. This overlaps the exchange with initialization;
  immediate registration may still wait for an unfinished preflight.
- [x] Measure the setup preflight change on staging. Eighteen wallets per arm:
  setup median 545.50 → 522.85 ms, SDK completion 56.91 → 54.88 ms. The combined
  registration-plus-signature median increased, so no reliable overall gain is
  established. Explicit OPTIONS starts only about 30 ms ahead of POST.
  Local implementation and SDK completion evidence are recorded in
  [setup and SDK completion](evidence/refactor-155h-setup-sdk-completion.md).

Implementation follow-up, October 13:
- The Gateway already persists the setup snapshot, ceremony and home reservation
  in one batch after Console authorization. No additional batching change is needed.
- Setup warm-up now starts at validated iframe configuration, before lazy runtime
  loading. The old constructor warm-up is removed. Appearance changes do not repeat it.
- Console publishable-key authentication schedules its usage timestamp write through
  the request's `waitUntil`. Authorization still completes before success. Delayed
  writes cannot move timestamps backwards, and Worker logs retain write failures.
- Successful NEAR-only hydration already consumes the temporary seal. Its redundant
  discard request remains removed; failure cleanup still runs.
- Combined staging comparison complete: 18 wallets per build, all signatures
  verified. Setup 542.70 → 551.15 ms; SDK completion 55.80 → 53.07 ms; combined
  flow 3.537 → 3.356 s. Variation prevents attributing the full difference to this
  batch. See the [combined evidence](evidence/refactor-155h-setup-sdk-completion.md#combined-sdk-and-console-staging-comparison--october-13).

- [x] Remove the informational parity wait from session observation (`7caae2fa`).
  A held-GET contract proves registration returns while the diagnostic is pending;
  required operation parity checks remain enforced. The
  [October 14 record](evidence/registration-completion-20261014.md) includes the
  production-build check and the combined staging comparison. Normal return was
  already about 13 ms. The historical 5.5-second gap is not fully attributed.

The preflight/telemetry implementations and combined comparison are complete.
Their individual end-to-end contributions remain unisolated. The existing Gateway
setup batch is already in the baseline; do not schedule it again.

## Phase 6 — Where the APAC home runs

**Staging placement is implemented and verified.** Singapore replaced the older
Hong Kong layout on October 13. Console moved again within Singapore on October 14
with its complete dataset preserved. Its old database is a write-fenced recovery
copy and must not be rebound by an old restore driver. The private record is
`docs/evidence/console-d1-migration-20261014.md` in `seams-monorepo`.

The following location study and October 12 inventory are historical context.
Their database candidates and old restore instructions are not current deployment
inputs. Production placement and activation remain separate release work.

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
to about 400 ms within 30 s in three rounds of nine; a load test ten hours
later did not reproduce it, so the cause is open and the long pauses are
not shown to be a property of those cities.
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

- **Staging:** this proposed move was completed on October 13. The October 14
  Console move preserved data. Use current serving bindings for every new run.
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
- [ ] Separate release work: production testnet, then mainnet. The last recorded
  inventory listed old builds, missing regional resources, and activation gaps.
  Recheck those prerequisites and available databases before a new cutover; this
  document does not certify current production readiness. The private record
  retains the original blockers and required release decisions.

- [ ] Count the reads and writes per request from the Phase 0 D1 record.
  Finalization is write-heavy, so D1 read replication near a regional Gateway
  cannot carry it. Record the number.
- **Deferred alternative:** a separate Tokyo home. The selected anchor is
  Singapore; no Tokyo provisioning or cost study is active in this plan.
- [x] Decide: Singapore, one place for all components. The move repeats the
  October 10 method for the three role databases and the October 11 method
  for Console, adds the regional Gateway database, and pins the Gateway to
  `aws:ap-southeast-1`. A location hint is not a city guarantee. Record the actual
  served primary for the chosen database; any new placement probe must be bounded
  by the authorized scope and budget.

## Phase 7 — Tails

R155J owns the active outlier investigation and p99 acceptance. Keep its status
there rather than creating a second set of diagnostic tasks here.

- [x] Strip name/debug metadata from release Workers (`3f3800a4`). R155G's
  measurement found no upload-time startup gain. The actual new-object
  handler-entry delay remains unresolved; stripping is not a proven tail fix.
- [x] Record the storage-pause experiments and their limits in
  [write stalls](evidence/refactor-155h-write-stalls.md). The probe found periodic
  confirmation pauses, but their share of product latency is not established.
- [x] Add existing per-object host/colo observations and retain their measured
  overhead. Use these with role versions and exact object IDs in future captures.
- [x] Capture startup/cancellation and delivery-failure evidence; remove temporary
  diagnostics after capture. See [R155J evidence](evidence/refactor-155j-slow-startup.md).
- [x] Investigate the October 14 B binding-await asymmetry. It later disappeared
  in three unchanged production samples. The
  [record](evidence/deriver-b-latency-20261014.md) establishes neither a permanent
  slow database nor the provider-internal cause. Probe resources were removed.
- [ ] Under R155J, explain the original A pre-handler stall, streamed-delivery
  producer stall, isolated signing 503, and any recurring B delay. The older
  14.6-second B preparation after a version switch is a separate unresolved event;
  do not close it from the later fast binding samples.
- [ ] Correlate genuine product stalls with storage/transport/runtime evidence
  before changing object layout, deadlines, or write-confirmation behavior.

Do not add a longer timeout or race replacement objects as an assumed speedup.
Keep required ownership and execution claims durable. Only overlap or batch
operations whose lifecycle permits it. Profile competing background work before
changing it. Worker clocks do not measure CPU-only sections reliably.

A Cloudflare support draft exists in the private
`.artifacts/r155h-write-stall-probe/cloudflare-support-draft.md`. Sending it remains
an external action for the user or a separately authorized task. No contact has
been made by this reconciliation.

## Phase 8 — Measure and record

- [x] Record the accumulated 0.9.3, 0.9.4, 0.10.0, and 0.10.1 release comparisons,
  with their exact populations and limitations. Links are in the current work table.
- [x] Use frozen production builds for the October 14 SDK/admission-batch comparison.
  Both SDKs used identical published 0.10.1 WASM. No concurrent ML-DSA work was included.
- [x] Verify all 42 comparison signatures independently and restore all 14 original
  Worker versions. Protected reactivation succeeded on its second attempt; the
  failed readiness predicate remains unknown. Twelve restored-lane wallets passed.
- [x] Commit SDK completion (`7caae2fa`), Yao admission batching (`8b4dcf5f`), and
  founding-read overlap (`f6422f37`) on `dev`. Each has focused correctness evidence;
  only the first two were in the 42-wallet hosted candidate.
- [ ] Attach the final broader contract-suite result for the founding-read change
  before release. The plan does not infer it from the commit or an interim count.
- [ ] Measure the next accumulated release candidate after accepted changes and
  correctness checks. No separate small staging run is required for a predicted
  10 ms read saving. R155J owns the remaining budgeted p99 acceptance population.

For each new comparison, capture serving versions, bindings, migrations, and source
revisions afresh. October 12/Hong Kong snapshots and the pre-migration Console
binding are invalid restore inputs. Use the existing Singapore lane and protected
activation flow. Keep every attempt in the record; include first-use attempts in
R155J's primary population. Report separate warmed cohorts explicitly.

Report p50, p90, range, failures, and per-arm results. Include p99 only with its
sample count and sensitivity. Do not claim individual savings from a noisy combined
run. Keep analytically sound, verified changes unless a demonstrated regression
requires isolation. The $25 Cloudflare budget remains the cap.

## Phase 9 — Finalization on the Singapore lane

The October 13 profile below motivated this phase. Shared-record removal is
released; two further read-path changes are committed. Remaining CPU work is
explicitly listed after the completed items.

What a finalization costs at the Gateway, about 380 ms at the median:

| Part | Size | Source |
| --- | ---: | --- |
| Serial waits: eight database round trips, the consume beside the route claim, Console completion | 228 ms | `near_finalize_total` |
| Gateway CPU | 96 ms at the median, 37–236 ms | tail `cpuTime` |
| Entry and reply | about 50 ms | remainder |

- **The CPU is cold code.** A warm local finalization uses 5–7 ms outside the
  seal. Staging uses 100 ms because a finalization rarely meets an isolate
  that ran one before. A probe Worker with a Singapore placement served 160
  requests from 17 isolates, and consecutive requests of one connection
  reached different isolates: the finalize isolate equalled the execute
  isolate in 1 of 40 sequences. A warm-up that an earlier request of the same
  registration starts therefore does not reach the isolate that finalizes.
- **The seal costs 19 ms more when cold.** The first seal in an isolate used
  26 ms of CPU at the median and a later one 7 ms, on the published 0.9.3
  module.
- **One shared record is read, checked and rewritten by every
  finalization.** `router-ab-yao:router-ab-ed25519-yao:shared` holds the last
  32 capabilities of an environment and measures 580 KB on staging, 17.7 KB
  per capability. `commitRouterAbEd25519YaoRegistrationCapability` loads it,
  validates it, installs the new capability and writes all of it back under
  one version check, in the wallet commit's batch. Over 40 local profiles its
  CPU rose from 1.7 ms to 4.1 ms as the cache filled, the largest part
  outside the seal. Every unlock, recovery or export of a wallet that is not
  among the last 32 rewrites the same record when it rehydrates. All wallets
  of an environment share its version check, so concurrent registrations
  contend, and a second lost attempt fails the request.
- **The wallet commit span is two round trips.** The founding rows and the
  shared record are read side by side, then the batch commits. Without the
  shared record the founding rows are the only read.

Items:

- [x] The shared record holds recovery state only. Registration reads and
  writes none of it: the wallet commit checks its capability, keeps the fence
  of its wallet and commits its own rows in one batch. A lookup reads the
  signer row beside the shared record and writes nothing. A signing admission
  resolves its material from the signer row that its session read already
  holds, so the session statement no longer reads the shared record. A
  recovery admission still stores and suspends its capability there. The
  record keeps every suspended capability and the four newest others, so it
  stays small. Two registrations no longer share a version check. The
  [record](evidence/refactor-155h-capability-from-signer-row.md) holds the
  guards and the database calls. Released in 0.10.0 and measured on staging
  on October 14: the wallet commit span fell from 175 ms to 56 ms at the
  median, the finalization total from 372 ms to 261 ms, and the Gateway's
  CPU per finalization from 146 ms to 48 ms. The first signature fell from
  532 ms to 362 ms, because a signing admission no longer reads the record.
- [x] Read Yao admission in the initial finalization batch (`8b4dcf5f`). The
  Router retains consumption, replay, and lifecycle enforcement. The combined
  [October 14 comparison](evidence/registration-completion-20261014.md) is recorded;
  the stage gain is not an isolated estimate of this one change.
- [x] Read founding authority/auth-method rows beside Router consumption
  (`f6422f37`, integrated by `24e93a78`). The commit uses those rows and keeps its
  duplicate-insert, extension-CAS, and lifecycle-decision guards. Every retry
  reserves again. The focused credential-reservation scenario and server types
  pass. Hosted savings remain unmeasured.
- [x] Require explicit founding IDs or `null` in the reservation contract
  (`f36b32a1`).
  Keep the omission/`undefined` type fixtures in
  `tests/typecheck/registration-commit.typecheck.ts`; the preceding held-claim
  argument is explicit too. This cleanup was restored after the merge reintroduced
  the defaults. The focused E2E and type checks pass after restoration.
- [ ] Profile remaining finalization CPU using the current release build and
  matched cold/warm samples. The latest candidate used 72 ms median Gateway CPU.
  Attribute parsing, serialization, key imports, and initialization before editing.
- [ ] Remove demonstrated repeated work within one request or reuse immutable
  per-isolate configuration where valid. Preserve authority freshness and secret
  lifetimes. No saving is claimed yet.
- [ ] Evaluate per-isolate seal warm-up only if the profile justifies it. The
  earlier 19 ms cold-versus-warm difference is a historical upper opportunity,
  not a measured saving on the current build.
- Phase 3 stays deferred. On Singapore its part is the Console completion and
  the write after it, about 40 ms.

## Phase 10 — One request fewer after the passkey step

Implemented and released in 0.10.0. The following explains the earlier two-request
flow and why it was combined:

- Nothing in the respond reply depends on the credential. The admission
  request and receipt hold setup-time values and two values minted at
  respond: `session_id` and the four `material_activation` ids.
- The client needs the receipt's binding and the Gateway keyset to seal its
  two inputs. It needs nothing else from respond.
- Nobody signs the receipt. The Gateway stores it and compares the execute
  request's binding with it. The Router never sees it.

With the session minted at setup, the setup reply can carry the admission
request. The client then seals its inputs during the prompt and sends the
passkey proof and the inputs in one request. The Gateway verifies the proof,
admits, and executes.

- [x] Phase 1's first item, the session mint at setup, is done.
- [x] Setup describes the admission of a NEAR-only passkey plan: the request
  and the receipt over the minted session (`ed25519.status = described`).
  The description stores nothing and admits nothing. Email OTP gets
  `after_proof`, because its scope holds the verified provider subject.
- [x] The SDK starts the custody run when setup returns. The run prepares the
  execute request during the prompt. Its Router round waits for the proof and
  sends both in the respond request (`ed25519Execution`). The custody driver
  takes the passkey factor after the round, because the seed is sealed at
  the end of the run. No Rust or WASM change was necessary.
- [x] Respond verifies the proof, stores the admission and then runs the
  execution with the checks of the execute route: the binding, the credential
  digest and the expiry. Its reply has `status = executed` and the activation
  result. When the execution does not complete, the reply has
  `status = admitted`, and the SDK sends the same request to the execute
  route. A reply whose admission differs from the description fails the
  registration.
- [x] The wallet-management protocol is 4: the setup reply has a new field
  and the client parsers accept exact keys.
- [x] Exact replay of the merged request, the refusal of another credential,
  and the separate routes for mixed registration, Email OTP and add-signer
  are kept. The local fault injection reaches an execution inside respond.
- [x] `docs/intended-behaviours.md` and the contract case that pins the
  respond replay are updated.
- [x] The contract suite passes on the change: 132 of 134 cases on release
  Workers and the two debug-build cases on the debug Router. The
  [record](evidence/refactor-155h-one-request-registration.md) holds the
  checks.
- [x] Released in 0.10.0 and measured on staging on October 14: the proof
  and the execution take 1,065 ms at the median against 1,331 ms as two
  requests on 0.9.4, and the Gateway's time for both fell from 1,073 ms to
  936 ms. The [staging record](evidence/refactor-155h-release-0100-staging.md)
  holds the runs. Protocol 4 refuses every earlier SDK; the private Console
  canary and one private test now send 4.
- [ ] Classify transient `respond` storage failures as recoverable service
  failures, with a stable error code and no driver text. The route currently maps
  unsuccessful service results to HTTP 400. A prior 198-wallet run captured one
  such fault; the merged request now carries proof verification and execution.
- [ ] Add bounded exact-request recovery using the existing ceremony, execution
  identity, and encrypted inputs. Preserve terminal refusals and one execution
  winner. Do not apply generic retries to every error or recreate MPC inputs.
- [ ] Exercise a lost request, committed-but-lost reply, exhausted transient
  faults, and terminal execution failure through existing behavioral contracts.
  Setup recovery is already covered by R155J; this item is specifically respond.

Expected gain: one round trip and one Gateway entry, 60–130 ms from Tokyo and
about half of that for a user in Singapore. The client's input preparation,
about 30 ms, also leaves the path.

Garbling ahead of execute needs the same mint: the gate hash's tweak domain
is derived from the session id. After the label wipe and four-block cipher
change its bound is smaller, because garbling costs half of what it did.

## Delegation sheet

This plan is implemented by an agent that did not write it. The rules below
replace judgment calls that need the authors' context.

Read before starting a phase: `AGENTS.md` of both repositories; this plan;
R155G's Phase 3 reviews; R155F's serial chain record;
`docs/router-ab/ed25519-yao.md`; the registration section of
`docs/intended-behaviours.md`; `tests/e2e/hosted-product/README.md` in
`seams-monorepo`; the scripts of the latest run folder under `.artifacts/`.

Use the user's existing authorization and repository instructions. Do not ask
again for scope already authorized. Before a live comparison, check for active
drivers and capture current serving versions. Ask only when a material decision
or action remains outside that authorization, including:

- A new role/Gateway database migration beyond the delivered setup and claim work.
- A change to Yao transcript order, custody claim timing, or admission identity
  beyond the implemented Phase 1 contract. Follow the owning specification when
  an intentional protocol change requires regenerating vectors.
- A new quota, rate limit, environment variable, secret, Worker, route family
  or configuration framework.
- A material change to R155B's rules or intended behaviors outside the accepted scope.
- Production deployment or package publication.

Classify failures against the current specification and domain types before a
repair. Do not change behavior for a stale fixture. A noisy latency result alone
is not a reason to revert a mechanically sound change or request another decision.

Commands, narrowest first:

- Public contracts: `pnpm test:intended` in `seams-wallet`. Resolve the current
  case list from the runner; keep debug-only fault cases on the required build.
- Yao formal verification and vectors: `cargo yao-fv all`; individual tasks
  `just ed25519-yao-fv-*`.
- Rust checks from `seams-wallet`: use the narrow relevant target with
  `cargo test --manifest-path crates/router-ab-cloudflare/Cargo.toml` or
  `cargo test --manifest-path crates/ed25519-yao/Cargo.toml`.
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
- Every comparison: a fixed, budgeted population; release builds with recorded
  inputs; p50/p90 and ranges; independent signature verification; verified
  restoration. Label warm/cold cohorts and preserve first-use tail samples.
- Mark each item of this plan done only with its evidence or a recorded
  reason, in the same commit as the change.

## Scope limits and completion

The shipped setup and claim migrations are complete on staging. The deferred
outbox would require a new migration and lifecycle work; no such migration is
currently scheduled. Add no new Worker, secret, configuration family, cache layer,
or queue for speculative savings.

Released engine optimizations preserved protocol bytes and have their own vector,
constant-time, and formal-verification evidence. Further transcript, claim-timing,
or secret-lifetime changes require dedicated review. The current remaining
profiling work does not authorize cross-request plaintext retention.

One-request signing, a separate Tokyo home, wallet relocation, a native custody
service, production rollout, and package publication remain outside this
implementation work. R155J owns tail acceptance and provider-level unknowns.

Complete the plan when each item has implementation and evidence, or a
recorded reason. A completed checklist does not establish that the latency
target was met.
