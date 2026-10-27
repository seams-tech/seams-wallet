# ML-DSA latency and sustainable preparation

Status: in progress. Date: October 27, 2026.

The [producer profiling checkpoint](router-ab/ml-dsa-65-producer-profile-report.md) records fresh slot controls, complete hosted comparisons, and the retained correlation-consumption improvement.
The historical producer speed difference does not repeat in fresh isolated controls. Its cause remains unknown.
The AES output-bit experiment regressed and was removed.
Two chunked screens use about 2–9% less paired producer invocation CPU than the return control.
The client observes full reserves at 87.6 and 84.0 seconds, versus 88.7 seconds for the control, with five-second inventory polling.
The latest publication checkpoints occur at 86.8 and 79.3 seconds, versus 84.4 seconds for the control.
Thus consistent publication acceleration and stable percentage savings remain unproven.
Wallet-seed recovery, canonical FIPS export, two-at-once consumption, and pool capacity remain unchanged.
The next measured inner-stage opportunity is code-matrix encoding, which accounts for about one quarter of local preparation samples.
Registration, signing tails, and sustained four-wallet throughput still need qualification against the targets below.

## Objective and measurement boundaries

Improve useful preparation throughput first. Then shorten registration and signing without moving hidden costs into pool depletion or background failures.

| Metric | Target | Measurement |
| --- | --- | --- |
| Registration | 5–7 seconds | Automated creation through durable publication and required activation, with generic material ready |
| Signing | 3–5 seconds | Public SDK signing with ready material, excluding human approval and NEAR finality |
| Preparation | 6 seconds on the faster producer, 10 seconds on the slower producer | Four fresh candidates through confirmed publication at both participants |
| Four-wallet throughput | 4–5 verified signatures/minute | Complete load and reserve-restoration cycles, after initial stock cannot explain completions |

Use these ranges as typical-latency objectives. Report median, p95, maximum, and the fraction inside the target for each campaign.
Do not claim a hard signing ceiling: rejection sampling requires a variable number of candidate pairs.
Also report complete user wait, including admission, cooldown, empty pools, and retries.
Measure human approval and NEAR finality separately. Do not silently remove required work from a timing boundary between comparisons.

## Fixed requirements

- Keep preparation on Cloudflare Workers. GPU and dedicated-server work remain deferred.
- Preserve wallet-seed recovery and canonical FIPS seed/key export.
- Preserve the passive, honest-execution model and separate participant custody.
- Prepare four candidates together and consume two at a time.
- Keep capacity at thirty-two candidates per wallet and the sixteen-candidate admission minimum.
- Preserve single use, durable fencing, queue fairness, recovery alarms, and failure accounting.
- Keep protocol formats, circuit identities, and cryptographic domain separation unchanged unless a separately reviewed experiment requires otherwise.
- Keep the production wallet cooldown at sixty seconds. Test a shorter interval only in an explicitly identified benchmark configuration.

## Evidence that sets the priorities

The [admission/refill campaign](router-ab/ml-dsa-65-admission-refill-hosted-report.md) records:

- Faster producer: 8.9–9.2-second median wall time and 4.0–4.2-second median participant A CPU.
- Slower producer: 18.9–19.8-second median wall time and 8.8–9.0-second median participant A CPU.
- Both producers use the same participant binaries. Matched samples have equal protocol traffic and reused topology caches.
- Serialization-to-publication medians are about 0.7–0.8 seconds. Eliminating this interval alone cannot reach the preparation targets.
- Four-wallet throughput is 3.6–3.7 signatures/minute with two preparation slots, including reserve restoration. The runtime default remains one slot.
- Target enrollment/recovery takes 7.5–10.9 seconds. Generic registration preparation separately takes 58–108 seconds.

The [latest public lifecycle](router-ab/ml-dsa-65-waits-retained-stock-report.md) records eight SDK signing samples at 2.74–6.36 seconds.
Its controlled failure test preserves thirty unused candidates. The hosted throughput benefit remains unmeasured.

The [larger AES batch screen](router-ab/ml-dsa-65-aes-batches-report.md) found no useful gain from larger software buffers or its native AES prototype.
Do not repeat those changes without a new profile that explains why the next experiment differs.

## Strategy 1: reproduce the fast producer, then reduce correlation cost

The largest opportunity is the twofold CPU difference. Publication cleanup alone is too small to explain it.
The 6/10-second goals require roughly one-third less time on the fast producer and one-half less on the slow producer.
These reductions are hypotheses, not established available savings.

### Experiment A: distinguish execution conditions from workload

1. Run identical four-candidate workloads on each producer separately, then concurrently, using fresh single-use material each time.
2. Swap equivalent wallet workloads and slot assignments. Preserve payload sizes, binaries, policy, and sample order controls.
3. Alternate baseline and candidate windows. Record invocation IDs, deployment versions, cold/warm state, observable placement, and concurrent activity.
4. Compare participant A and B CPU, bytes, exchange counts, and inner-stage timings. Never infer total protocol CPU from A alone.
5. Check whether slow execution follows a Worker instance, a workload, or overlapping jobs.

If concurrency drives the difference, isolate signing from preparation pressure and adjust dispatch overlap within the existing slot limit.
If placement or isolate state drives it, test reproducible placement or initialization changes that Workers supports.
Do not rely on selecting unusually fast instances or repeatedly redeploying until a benchmark looks good.
If identical work remains slower without a controllable cause, retain that variation in capacity estimates.

### Experiment B: optimize the measured inner stage

Instrument the existing producer and correlation runtime at coarse stage boundaries. Reuse existing evidence fields and invocation correlation.
Measure correlation expansion, private AES, conversion/packing, allocation/copying, transport waits, and publication separately.
Keep labels and secret-dependent values out of diagnostics.

Choose one change based on the largest measured cost:

| Profile finding | Concrete candidate | Safety boundary |
| --- | --- | --- |
| Large repeated allocation or copying | Reuse bounded scratch buffers within a job; remove redundant representations or copies | Never reuse correlations, masks, or consumed protocol state |
| Repeated immutable initialization | Cache validated schedules or other public immutable data | Bind caches to exact identities; interrupted secret streams remain poisoned |
| Private AES or correlation expansion dominates | Optimize the current Wasm inner loop and data layout; check bounds checks and repeated key-schedule work in the profile | Preserve cryptographic outputs and secret-independent execution; no unreviewed PRG replacement |
| Serialization or transport dominates | Remove duplicate encoding and transfer only data the peer needs; overlap independent work if protocol dependencies permit | Preserve message binding, ordering, and participant separation |
| Commit waits dominate | Combine redundant metadata operations at the same durable boundary | Publication still requires both participants; never report success before required commits |

Compare complete published jobs, CPU per usable candidate, memory pressure, and failures.
Keep a change only when repeated hosted comparisons show a useful gain without increased material loss or signing contention.

Primary implementation areas: `crates/router-ab-cloudflare/src/ml_dsa/workers/preparation/producer.rs`, preparation orchestration, and `crates/ml-dsa-threshold/src/runtime/boolean_mpc/`.

## Strategy 2: convert fewer failures into wasted preparation

The latest settlement change retains only the unopened intersection proved by both participants after durable fencing.
This can improve useful throughput without accelerating any cryptographic operation.

1. Repeat hosted interrupted-admission and admitted-failure scenarios with exact take/publication accounting.
2. Measure candidates retained, candidates consumed, candidates retired, and fresh candidates needed to restore the same reserve.
3. Count the failed operation's CPU and time in the denominator. Verify signatures that subsequently consume retained material.
4. Separate loss before publication, consumed pairs, expiry, and unknown outcomes. Do not reclaim uncertainty to improve a graph.
5. If redundant retry executions remain, reconcile durable completion before scheduling replacement work through the existing lifecycle.

Acceptance: both ledgers balance, delayed calls cannot revive consumed material, and restart preserves single use.
The expected gain is lower preparation cost per successful signature. Its size depends on the measured failure rate.

Primary implementation areas: `ml_dsa/pool.rs`, `workers/coordinator.rs`, and the existing producer completion/recovery paths.

## Strategy 3: shorten registration's critical path

First measure creation, role input delivery, key generation, sealing, participant installation, custody publication, and initial signing-stock activation separately.
Identify required dependencies before moving work. Previous optimizations already removed some duplicate sealing and storage.

Pursue these opportunities only where the current trace shows remaining cost:

1. Deliver independent A/B inputs concurrently, then await both confirmations before publication.
2. Reuse public schedules and warmed Wasm initialization where the current role lifetime permits it.
3. Remove repeated reads, encodings, or sealing of unchanged data within the same operation.
4. Overlap independent generic-stock work with key creation. Keep key-bound work behind its actual key dependency.
5. Remove dispatch gaps between completed stages using the current durable lifecycle, while preserving recovery alarms.

Do not report a key as fully usable merely because expensive activation moved after the response.
Record key-created, key-enrolled, signing-ready, and first-transaction latency separately if they differ.

Acceptance: hosted creation and recovery preserve the ordinary public key and independently importable FIPS seed.
Interrupted publication must resume without creating another signer. Verify the restored signer with a standard signature.
The empty-generic-pool case remains a separate cost; larger reserves are outside this plan.

Primary implementation areas: `workers/registration/engine.rs`, `adapter.rs`, `signing_stock.rs`, and Gateway custody publication.

## Strategy 4: reduce fixed and per-pair signing costs

Model signing latency as admission plus first-use setup plus candidate-pair execution plus completion.
Group samples by pairs consumed. This distinguishes a slow protocol from a request that needed more rejection attempts.

1. Compare the first and later signatures on the same key. Cache only public or explicitly reusable setup when initialization dominates.
2. Compare first-pair and subsequent-pair costs. Avoid repeated key metadata reads, decoding, and immutable setup within one admitted operation.
3. Remove redundant participant/storage round trips where a current authenticated result already supplies the required state.
4. Overlap independent participant calls where the protocol allows it. Preserve the two-at-once candidate policy and single-use boundaries.
5. If communication layers dominate, quantify the benefit of a shallower equivalent circuit before implementing it. This requires separate vector and privacy validation.

Do not repeat previously discarded exchange or commitment prototypes without a different measured bottleneck.
Do not increase speculative candidate consumption to improve latency while hiding a preparation regression.

Acceptance: compare median/p95 both overall and at equal pair counts. Verify every retained signature independently.
A faster successful call is insufficient if complete user waits or candidates consumed per success increase.

## Strategy 5: qualify sustainable four-wallet capacity

Use two preparation slots as the explicit experimental configuration. Keep the one-slot production default unchanged until evidence supports changing it.
Test controlled dispatch overlap before adding more slots. More concurrent CPU work can increase load shedding and reduce useful output.

Run two admission profiles:

- Sixty-second cooldown: operational parity with current policy. Four wallets have a theoretical ceiling of four admitted operations/minute.
- Forty-five-second cooldown: benchmark-only headroom to test five verified signatures/minute. Failed admissions that start signing still consume the cooldown.

Keep the same four wallets, per-wallet pool capacity, admission minimum, and service-wide signing limit across each comparison.
Alternate equivalent baseline and candidate windows. Run multiple full consumption/refill cycles and restore the initial reserve before closing each window.

Report:

- Verified signatures/minute after initial stock cannot explain completions, plus whole-cycle throughput including reserve restoration.
- CPU and prepared candidates per verified signature, including failures.
- Queue growth, empty-pool waits, cooldown waits, and complete request latency.
- Per-wallet service share, failures, expiry waste, and participant ledger balance.
- Production one-slot results separately from experimental two-slot results.

Four-candidate jobs at 6 and 10 seconds imply a theoretical combined rate of 64 candidates/minute before scheduling gaps and failures.
That arithmetic is only a ceiling. Convert it using measured candidate consumption and actual duty cycle, not an assumed constant of 5.1 candidates/signature.

## Execution order and stopping rules

- [x] Establish an exact-version baseline and calibrated inner-stage sampling.
- [x] Run producer workload/slot crossover and isolated-versus-concurrent comparisons.
- [ ] Continue optimizing measured preparation costs. The AES experiment regressed. Chunk consumption remains as a small CPU optimization.
- [ ] Qualify retained material under hosted failures and measure useful throughput.
- [ ] Shorten the measured registration critical path.
- [ ] Reduce first-use and repeated-pair signing overhead.
- [ ] Run four-wallet capacity profiles with complete reserve restoration.
- [x] Retain this checkpoint's report, replayable public evidence, exact versions, and cleanup receipts.

Use existing native vectors, type fixtures, and meaningful Worker/browser E2Es. Add no unit tests or source-text guard framework.
Classify failures before changing code. Keep benchmark secrets and raw private payloads out of evidence.
Temporary deployments and new credential destinations require their applicable approval. Never assume earlier payload approval covers a new campaign.

Stop an experiment if its gain disappears across repeated comparable windows or it increases failures, material consumption, or pool waits.
If execution variability remains uncontrolled, state that limit instead of declaring a deterministic preparation target achieved.
If Workers cannot meet sustained demand after these measured changes, document the CPU/wait breakdown for a later dedicated-preprocessor decision.
A new threshold construction or GPU implementation is outside this plan.
