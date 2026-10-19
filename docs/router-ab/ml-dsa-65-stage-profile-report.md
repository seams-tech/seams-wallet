# ML-DSA signing and registration stage profiling

Campaign: 2026-10-19 JST. Profiling identifies initial-stock installation as a registration optimization target.
Signing has separate material-response and client-dispatch delays. Their detailed causes remain partly unresolved.
The five-second targets remain unqualified. This change adds diagnostics and makes no performance optimization claim.

This change adds public timing boundaries to the existing Worker protocol.
It keeps four-candidate preparation, two-at-once consumption, and thirty-two candidates per wallet.
Admission still requires sixteen ready candidates. One producer and one signing operation can run at a time.
The production cooldown remains sixty seconds. The saturation screen uses the existing one-second benchmark cooldown.
Wallet-seed recovery, ordinary FIPS seed/key export, and preparation on Workers remain unchanged.
UI changes and GPU work remain deferred.

## Question and prior evidence

The prior campaign verifies fifty-eight signatures, with three successful requests above five seconds.
Those three requests spend most time in warm role execution and consume four or five pairs.
The slowest includes 1,500 milliseconds from taking to taken on A, and 1,805 milliseconds from restoration to activation on B.
These intervals overlap. They do not identify separate storage and network costs.
Prepared registration/recovery takes 3.850–5.702 seconds, with preceding preparation measured separately.

The current question is which storage, authorization, execution, installation, or activation boundaries account for those delays.
This campaign changes observation only. It makes no protocol optimization claim.

## Measurement boundaries

Signing adds two records for each material consumption:

- Caller: before local dispatch, response headers, and completed response decoding.
- Role store: after input decoding, authorization completion, transaction completion, and response construction.

The store's first interval includes the live Router permit lookup.
Its transaction interval includes scheduling where applicable, durable reads/writes, and conversion to a JSON value.
Response construction and caller decoding are separately bounded.
A successful store record means response construction succeeded. It does not prove that the caller received the response.

Registration adds an exact HTTP-attempt ID at the Router.
The Router records admission, role execution, initial activation, installation, final activation, and durable completion.
Participant records cover authorization, schedule loading, execution reservation, input opening, prepared-state consumption/restoration, key generation, material sealing/persistence, and result exchange.
Initial-stock records separately bound each batch's load, resealing, delivery persistence, delivery acknowledgment, and installed marker.
Already-installed retries emit a short record and remain distinct from fresh installations.

Table reads use aggregate counters to limit logging volume.
The count includes attempted table-read transactions, including a failed attempt.
Measured count, summed service-clock duration, and maximum service-clock duration remain separate.
Here, measured means that both clock values exist and their difference is nonnegative. It does not qualify the difference as elapsed time.
Table reads include validation and authentication inside the transaction. They are not isolated disk latency.

All records contain public operation/material/job identities, participant role, module identity, stage names, counters, and nullable clocks.
They contain no seed, private key, signing share, garbled label, or prepared ciphertext.
Diagnostic state never controls domain transitions.

## Clock and matching limits

Worker clocks can omit CPU execution and remain fixed across real storage work. A zero interval does not prove zero work.
Platform invocation wall time and CPU time apply to the complete enclosing invocation.
Several stage records can share one invocation, especially registration stock installation. Do not sum the same invocation cost repeatedly.

Material joins require exactly one retained caller and store record for the operation, role, and material ID.
Registration HTTP joins require unique client and Router attempt IDs, matching operation/status, and the echoed ID.
Role contexts identify logical work, not a particular HTTP retry. Repeated contexts remain visible and unassigned to a specific HTTP attempt.
Missing traces can conceal retries even when retained observations are unique.
Incomplete traces retain their partial marks. The client recorder retains failed `post()` attempts with their request ID, failed stage, and available timings.
Direct `raw()` refusal and fault probes remain outside this recorder.

Local calibration injects a known 200-millisecond delay into each matching A-side authorization lookup for the first signing operation.
It checks the actual role-store trace across a verified signing flow.
Those injected timings are excluded from ordinary latency conclusions.
The registration profiler uses the existing independent CPU calibration and exact compiled Wasm symbol map.
Local CPU samples cannot establish hosted CPU attribution by themselves.

## Fact list

| Fact | Instrument | Scope | Check |
| --- | --- | --- | --- |
| Prior slow signing uses warm role caches | Exact Router joins and paired role traces | Previous hosted campaign | Verified standard signatures |
| Taking-to-taken does not separate authorization from storage | Existing boundary placement | Worker source | New caller and store boundaries |
| Registration includes initial-stock installation after key generation | Router and role lifecycle | Worker source | Separate stage records |
| HTTP failures can occur before decoding | Client transport behavior | E2E client | Preserve partial attempts before I/O |

## Cause table

| Cause | Distinguishing observation | Status |
| --- | --- | --- |
| Signing permit lookup dominates material consumption | Matched authorization clock spans are small, but other storage clocks freeze | Unproven. Clock data cannot rank all costs. |
| Durable transaction or serialization dominates | Store invocation wall/CPU is nonzero while transaction/response clock spans are zero | Unresolved by these clocks. Preserve both candidates. |
| Body delivery or decoding contributes to material-call tails | Matched caller intervals after headers reach 875–915 ms | Candidate for a controlled transport/decoder screen. This interval combines both. |
| Key-generation role execution accounts for substantial registration cost | B execution invocations take 2.754–4.135 s with 1.795–2.713 s CPU | Supported for the whole execution call, which also includes storage and result handling. |
| Initial-stock installation drives the longest registration tail | Worst A/B installation invocations take 6.835/6.853 s, against 0.414/0.474 s CPU | Supported as a whole-call bottleneck. Individual I/O causes remain unpartitioned. |
| Activation dominates registration | Combined activation clock spans are about 0.3–1.4 s across four cases | It remains measurable overhead, but does not explain the largest observed whole-call cost. |
| Instrumentation itself perturbs the result | Sequential deployments have different latency and CPU observations | Unresolved. No isolated instrumentation-overhead estimate. |

## Validation and results

The first local calibration measures the injected A-side authorization delay at 202–204 milliseconds.
Its signature verifies, then an existing refill assertion fails because it includes the delayed signing request in a three-second budget.
Classification: `valid_test_needs_update`.
The test now starts the wake-up interval after receiving the completed signing response.
It retains the three-second bound and the following live-producer, inventory, interruption, and recovery checks.
The failed artifact and its source remain evidence. Production behavior is unchanged by this correction.

The corrected run passes the refill timing check, then exposes an existing inspector configuration gap after restart.
Classification: `valid_test_needs_update` in the profiling harness.
All local runtime constructions now use the same inspector option when profiling is requested.
The second failed artifact and its source remain evidence. Worker binaries remain unchanged.

The final durable E2E passes with three independently verified signatures.
Seven A-side material lookups record 202–204 milliseconds for the 200-millisecond injection.
The injected first signature takes 3.226 seconds and is excluded from ordinary latency conclusions.
The next two signatures take 297 and 259 milliseconds. Response-to-refill observation takes 1.074 seconds.
Restart, stalled settlement, stale-request rejection, replay, and producer handoff checks pass.

Local registration and recovery take 1.122 and 1.313 seconds with profiling enabled.
Both preserve the canonical key. B records twenty-four table-read transactions per ceremony, with summed clock spans of 214 and 311 milliseconds.
Exact Wasm symbol maps and independent profiler calibration accompany all CPU summaries.

B's local registration samples include 32.5–41.6% in circuit execution and 24.7–30.2% in table loading.
These categories overlap. Storage-cipher primitive samples account for 4.3–4.9%.
The ordinary signing profiles show topology construction after restart and no sampled topology construction in the subsequent warm operation.
The warm operation has 31.6–38.8% of samples in GMW execution, excluding higher-priority categories.
These are small local sample sets. They do not identify hosted CPU fractions or billed milliseconds.

## Hosted comparison

Each profile uses two synthetic wallets, a ten-minute saturation window, and complete reserve restoration.
The control uses the prior reusable-producer binary. The instrumented profile adds this task's diagnostics.
Both keep the same admission policy and capacity.

| Measurement | Control | Instrumented |
| --- | ---: | ---: |
| Verified load signatures | 36 | 25 |
| Successful HTTP requests below five seconds | 2/36 | 17/25 |
| Successful HTTP minimum / median / maximum | 4.761 / 7.398 / 33.344 s | 1.084 / 3.434 / 15.287 s |
| Complete demand median / maximum, including admission/refill waits | 33.117 / 91.312 s | 36.778 / 251.654 s |
| Failed admitted operations | 0 | 2 |
| Unfinished demands at cutoff | 2 | 2 |
| Four-candidate preparation invocation median | 11.482 s | 16.892 s |
| Captured producer invocation time per verified signature | 13.456 s | 27.187 s |
| Restored-stock cycle per verified signature | 19.547 s | 31.876 s |
| Signatures per minute after starting stock is consumed | 3.336 | 1.714 |

Both material ledgers balance. Neither observed pool exceeds thirty-two candidates per role/wallet.
The control consumes 164 candidates. The instrumented profile consumes 156, including material used by failed operations.
Different rejection outcomes, runtime conditions, and instrumentation prevent a causal speed comparison.
The control binary itself is substantially slower than its previous campaign. Earlier latency ranges are not service guarantees.
The control client also overlaps local profiling work, while the instrumented hosted client starts after local tests finish.

No producer completion reports failure. Captured preparation accounting remains incomplete because canceled/unassigned invocations remain.
The conservative cost analyzer reports twenty-nine and thirty-nine unknown producer invocations respectively.
Whole-campaign coverage retains fifty and fifty-eight unassigned canceled zero-CPU alarms.
Both profiles have complete paired signing traces for verified load operations, but the new material-store trace coverage is partial.

The first control wallet uses a client snapshot before local stdout capture was added.
The HTTP request/timing code is identical to the later client. Source hashes verify both snapshots.
The hosted harness is the private Worker path. It does not qualify the browser SDK, public Gateway flow, or NEAR confirmation latency.

## Registration findings

All creation and recovery cases reproduce the canonical FIPS public key and authenticated manifest.
The following times include client verification and exclude preceding preparation:

| Wallet | Control create / recovery | Instrumented create / recovery |
| --- | ---: | ---: |
| 1 | 10.863 / 15.195 s | 5.614 / 5.151 s |
| 2 | 11.416 / 10.308 s | 6.886 / 13.475 s |

Instrumented preceding preparation takes 59.385–87.556 seconds, including the initial signing reserve.
Generic preparation remains a separate cost from online registration.

Registration coverage is complete for the four instrumented ceremonies:

- Ten recorded registration HTTP attempts have unique Router joins, including empty-pool and replay responses.
- All eight role-execution records and eight role-installation records are present.
- All sixty-four stock-installation records cover ordinals zero through seven exactly once per role and ceremony.

Platform invocation measurements separate execution and installation:

| Ceremony | A execution wall / CPU | B execution wall / CPU | A installation wall / CPU | B installation wall / CPU |
| --- | ---: | ---: | ---: | ---: |
| Wallet 1 create | 2.795 / 0.235 s | 2.754 / 1.975 s | 2.187 / 0.365 s | 2.242 / 0.396 s |
| Wallet 1 recover | 2.922 / 0.295 s | 2.870 / 1.927 s | 1.493 / 0.442 s | 1.299 / 0.292 s |
| Wallet 2 create | 2.934 / 0.344 s | 2.891 / 1.795 s | 2.426 / 0.528 s | 1.610 / 0.476 s |
| Wallet 2 recover | 4.626 / 0.312 s | 4.135 / 2.713 s | 6.835 / 0.414 s | 6.853 / 0.474 s |

A and B run concurrently. Do not add their wall times.
Execution includes authority checks, prepared-state loading, key generation, result persistence, and exchange.
Installation includes share installation, eight initial signing batches per role, and durable completion markers.

The longest recovery takes 13.227 seconds in the Router invocation.
Its stage clocks show 4.669 seconds awaiting execution and 6.905 seconds awaiting installation.
The role invocation measurements support installation as the largest whole-call cost in this case.
Per-batch clock advancement concentrates around delivery acknowledgment. Its sums are 6.038 seconds on A and 6.298 seconds on B.
These sums are diagnostic observations. They do not separate transport, remote authorization, target storage, or output gating.

Every hosted B ceremony records twenty-four table-read attempts with nonnegative clock pairs, yet every summed duration is zero.
Five stage records contain a clock interval larger than their enclosing invocation wall time.
The local 200-millisecond calibration qualifies the observed remote-wait boundary only. It does not validate hosted storage clocks as elapsed time.
Thus, the records cannot eliminate table reads, authentication, copying, or serialization as meaningful costs.

## Signing findings

All twenty-five successful instrumented attempts have unique Router joins.
Across all 675 load attempts, 506 join and 169 lack a retained Router trace.
All successful operations have complete paired role traces.

The material-call capture contains 182 caller records and seventy store records across the whole instrumented campaign.
Seventy contexts match uniquely: forty on A and thirty on B. The remaining 112 caller contexts stay unpaired.
The following medians use that matched subset only:

| Boundary | A, 40 matched calls | B, 30 matched calls |
| --- | ---: | ---: |
| Caller start to response headers, service clock | 184.5 ms | 167 ms |
| Caller body receipt and decoding after headers, service clock | 234.5 ms | 129 ms |
| Store authorization, service clock | 18 ms | 9 ms |
| Store complete invocation wall time | 188 ms | 148.5 ms |
| Store complete invocation CPU | 33.5 ms | 21 ms |

The caller body/decoding interval reaches 875 ms on A and 915 ms on B within these matched calls.
The host library's `Response::json()` first reads the response text, then deserializes it.
This interval therefore combines body delivery, copying, UTF-8 handling, and JSON decoding.
It cannot identify which component dominates. The local samples do not support assuming that JSON alone explains these tails.

Store transaction and response-construction clock spans are zero for every retained store call, despite nonzero invocation wall time and CPU.
These clocks cannot partition the remaining store cost. Missing store records cannot be replaced with zero durations or inferred from other calls.

The eight successful requests above five seconds consume two to six pairs, with warm schedule caches on both roles.
Several have both material-consumption clock gaps and repeated protocol checks.
The longest request takes 15.287 seconds at the client, including 7.991 seconds before request writing.
Its roles take 5.943 and 5.838 seconds of invocation wall time while checking four pairs.
Another successful request waits 9.211 seconds before writing, then completes in 14.189 seconds total.
Both use existing client sockets, have one event per observed transport stage, and no overlapping recorded event-loop gap above one hundred milliseconds.
The control has a larger 16.320-second pre-send wait on a successful request.
Across all attempts, pre-send maxima are 17.016 seconds for the control and 10.795 seconds for the instrumented profile.
These are Node benchmark observations. Browser SDK transport behavior remains unmeasured.

## Next optimization experiments

1. **Registration installation:** test bounded groups of initial-stock deliveries per participant.
   Preserve persistence-before-delivery, exact job/ordinal binding, installed markers, replay handling, and the current capacity.
   Compare the complete Router latency, participant memory use, and interruption behavior against sequential delivery.
2. **Signing material responses:** separate body arrival/copying from decoding before choosing a transport change.
   Run matched response-size/encoding screens and retain every live permit check and consume-before-release rule.
   A binary ciphertext response is a candidate if these measurements establish a meaningful JSON/copying cost.
3. **Client dispatch:** reproduce the pre-send waits with explicit connection-queue observations and a real browser SDK harness.
   Keep operation IDs stable and distinguish benchmark contention from product transport behavior.
4. **Execution and storage:** use calibrated local stacks and isolated hosted invocation measurements where fine clocks fail.
   Measure table authentication, loading, and circuit evaluation with matched inputs and payload sizes before changing them.
5. **Qualification:** repeat fixed-capacity screens with the production cooldown and additional wallets.
   Report online signing, complete demand, refill throughput, and censored operations separately.

UI work remains deferred. No permission check, storage binding, candidate policy, wallet-seed derivation, or FIPS export rule was weakened.

## Evidence and cleanup

All sixty-one hosted load signatures verify independently. Altered messages and signatures are rejected.
Local lifecycle and registration E2Es pass. All canonical creation/recovery/profile key comparisons pass.
Strict Worker builds, syntax/format checks, and the independent contradiction review pass.
The bloat gate remains red at unchanged inherited duplicate counts: Rust 13,984 against 13,754, and TypeScript 10,238 against 10,216.
All ten temporary Workers were deleted. Private campaign files were removed after sanitized bundles passed hash and credential-pattern checks.

- [Comparison summary](../evidence/ml-dsa-65-stage-profile-comparison-20261019.json)
- [Hosted records and analyses](../evidence/ml-dsa-65-stage-profile-hosted-20261019.json.gz)
- [Local profiles, calibration, and E2Es](../evidence/ml-dsa-65-stage-profile-local-20261019.json.gz)
- [Source, runners, review, and deployment provenance](../evidence/ml-dsa-65-stage-profile-provenance-20261019.json.gz)
- [Validation and cleanup receipts](../evidence/ml-dsa-65-stage-profile-validation-20261019.json)
