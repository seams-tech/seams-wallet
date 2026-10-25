# ML-DSA refill retry and AES screen — October 26, 2026

Durable retry backoff now limits repeated preparation attempts against a failed producer slot.
Successful publication clears the delay. A healthy second slot can continue serving queued wallets.
The local Worker fault campaign passes, including restart, fresh replacement material, and exact retry timing.

The hosted candidate completes **79 verified signatures**, with **zero empty-pool responses**.
Successful requests take **0.255–5.498 seconds**, with a **1.055-second median**.
Its full reserve cycle reaches **7.069 signatures per minute**, including the observed restoration wait.
This finite screen establishes no maximum capacity or causal throughput gain.
No preparation failure occurs in the candidate cycle, so hosted mitigation of `loadShed` remains unproved.

Wallet-seed recovery, ordinary FIPS seed/key export, two-at-once consumption, and per-wallet capacity remain unchanged.
Preparation remains on Workers. GPU work stays deferred.

The [public evidence index](../evidence/ml-dsa-65-refill-retry-20261026.json) and its archive provide an offline replay of signatures, stock accounting, and profile attribution.

## Implementation

Each preparation slot persists its own failure count and next permitted admission time.
Consecutive failure delays are **2, 4, 8, 16, 30, 30… seconds**.
Failed and unconfirmed interrupted producers increase the delay. Confirmed publication resets it.
Admission records one failure when it observes an expired, unsettled lease before removal.
An exact published job can still settle successfully after its lease deadline.
Duplicate settlement preserves the existing deadline. A stale settlement cannot alter a successor lease.

The queued head retains its turn through the returned retry deadline and existing demand lifetime.
Other wallets retain FIFO order. An available healthy slot remains eligible.
Recovery alarms and permanent participant start markers remain mandatory.
A replacement uses fresh job and pair identities.

Producer restart handling now stores `Published` after confirming paired publication.
It previously stored `Interrupted` even after confirmation.
Settlement sends that typed outcome to admission, and the refill controller honors its returned retry time.

The internal `FinishRefill` request now requires an outcome.
Deploy participating Workers together, then verify effective Durable Object versions before qualification.
Mixed versions can fail closed during rollout. No compatibility default is added.
Cryptographic protocol bytes, domain strings, preparation formats, and canonical key derivation stay unchanged.

## Hosted measurements

Both arms use eight wallets and two separate A/B producer slots.
Each wallet retains sixteen independently consumed pairs, or thirty-two candidates.
Each operation consumes two candidates at a time. Four candidates are prepared per normal job.
A one-pair deficit uses a two-candidate job.
The admission minimum is eight pairs. The wallet cooldown is sixty seconds.
The service permits one signing operation at a time.
The runtime default remains one preparation slot. This campaign explicitly configures two in both arms.

| Measure | Settled control | Retry candidate |
| --- | ---: | ---: |
| Verified signatures in ten minutes | 80 | 79 |
| Successful HTTP range | 0.374–9.749 s | 0.255–5.498 s |
| Successful HTTP median | 1.158 s | 1.055 s |
| Empty-pool responses | 0 | 0 |
| Verified signatures/minute, with restoration | 7.187 | 7.069 |
| Useful replacement candidates/minute, with restoration | 38.810 | 38.837 |
| Failed executing preparation jobs during load | 0 | 0 |
| First full-reserve observation after cutoff | 67.871 s | 70.502 s |
| Full A/B stock ledger | balanced | balanced |

Producer wall time includes waits. These jobs begin during the ten-minute load.

| Producer job | Settled control A median | Retry candidate A median |
| --- | ---: | ---: |
| preparer-a, 2 candidates | 4.122 s | 3.926 s |
| preparer-a, 4 candidates | 7.815 s | 7.631 s |
| preparer-a-secondary, 2 candidates | 6.599 s | 6.976 s |
| preparer-a-secondary, 4 candidates | 13.858 s | 13.131 s |

Successful HTTP time includes private Router execution and settlement.
It excludes prior cooldown and capacity waits, browser transport, public Gateway approval, UI, and NEAR finality.
Complete demand latency includes the recorded retry waits. These measurements must remain separate.
Restoration uses the earliest captured full-reserve observations, each at most forty-five seconds old.
Observation delay remains included in the complete cycle.

The candidate ledger is **128 initial + 217 new = 217 consumed + 128 final pairs**.
Exact A/B take identities agree. No observed pair is reused.
All starting candidate pairs have unique recorded deadlines and at least **40m58.732s** remaining at load start.
The control reversal records exact deadlines before load and applies a starting-lifetime gate.
All seven effective runtime roles must qualify through complete reserve restoration.

The first control retains six unaccounted unused initial pairs.
Their last presence and first absence cross a possible thirty-second readiness boundary.
Its registration artifact lacks the preparation identity needed to prove that deadline binding.
Expiry is plausible. The actual cause remains unknown.
That control stays in the archive and fails complete-cycle qualification.
Its throughput estimate is excluded from the matched comparison.
Future registration artifacts now retain the initial preparation identity.

### Interrupted control retained

An earlier settled control records **62 verified signatures and four interrupted driver requests**.
One request has a recorded server dispatch error, HTTP 500, after admission.
The other three reach the Router, but their response status and body are absent.
A provider outcome of `ok` does not establish HTTP or signing success.
A nearby `loadShed` occurs on ordinary participant B's signing connection.
It lacks an operation identity, so its direct association with that failed operation remains unproved.

All **105 observed preparation publication receipts** in that load window succeed.
The producer alarm exception follows successful publication. A subsequent settlement retry completes.
Its closed summary reports **10 newly prepared pairs** without recorded consumption or retained ready stock.
Their disposal cause remains unproved. The interrupted control fails full-cycle qualification.
It remains in the reliability record and is excluded from the completed throughput comparison.

The frozen driver drops the exact request input when it records interruption.
Its random message and digest cannot be reconstructed from the operation ID.
No guessed request or mutation is replayed.
The final repeat uses unchanged signing code, policy, and capacity.
It adds a direct front-Worker error-only tail and a separate invalid-start calibration request.
The calibration supplies no wallet key and starts no signature. Its two expected exception events are counted separately.
The added observation and different rejection histories also prevent a causal timing claim.

Provider analytics report two front-Worker exception buckets during the failed screen.
Their minute-level aggregates cannot identify the four driver invocations.
The same query returns no participant-B rows despite its known tail event, so that dataset cannot prove absence of B failures.
The historical cause of the four lost outcomes remains unresolved. This is a release qualification gap.

Complete successful demand ranges are control-repeat 1.530–45.500 seconds; candidate 1.676–65.498 seconds.
These include recorded cooldown and admission waits. They exceed successful-call times substantially.
One successful control request takes 9.749 seconds and exceeds the eight-second upper target.
That call remains a release latency gap. This screen does not establish its cause.
The fixed synchronized load and sixty-second cooldown constrain the result.

The settled control ledger is **128 initial + 216 new = 216 consumed + 128 final pairs**.
Its starting pairs have at least **25.984 minutes** remaining at actual load start.
The two arms consume different rejection material when their exact take counts differ.
Provider timing and cache state also vary. This campaign establishes no causal preparation speedup.
Neither settled arm contains a failed executing preparation job, so it does not compare failure rates under an unhealthy slot.
Canceled idle lifecycle alarms remain separate from executing preparation outcomes.

All sixteen hosted creation/recovery calls preserve canonical keys, authenticated holder results, and manifests.
Thirteen setup signatures verify. Three recovery signing requests preserve the existing cooldown.
The setup does not establish a new registration performance claim.

## Local qualification

The native composed SQLite campaign passes with separate Router and participant stores.
It verifies the delay sequence, healthy-slot progress, FIFO fairness, restart, stale completion, expiry, and single-use start markers.
This campaign verifies state handling. It does not measure hosted cryptographic preparation.

The actual Workerd lifecycle campaign injects one controlled publication failure.
Replacement preparation is admitted **10 milliseconds after the two-second retry deadline**.
The failed job never appears as paired ready stock.
Three ordinary signatures verify independently. Their local request times are **0.211–0.314 seconds**.
Restart after confirmed paired publication persists `Published`.
Existing interruption, lost reply, stale operation, and stalled-peer scenarios also pass.

The first Worker run fails an old assertion that required the entire failed-preparation and retry interval to fit three seconds.
Classification: `valid_test_needs_update`. Its measured interval was **6.422 seconds**.
The revised campaign measures the initial wake and replacement admission separately.
The final campaign also captures replacement admission when the preceding signing operation exhausts candidates.
The failed run and passing intermediate run remain archived.

The required bloat check still fails its inherited Rust duplication limit: **13,972 lines versus 13,754**.
This change adds no duplicated Rust lines. The baseline stays unchanged.

## Preparation CPU and native AES probe

Calibrated local sampling attributes **50.56% of A samples** and **42.64% of B samples** to private AES.
Matrix encoding accounts for about twenty-four percent on each participant.
These are sampled-stack shares. They are neither billed CPU percentages nor hosted elapsed-time attribution.
The exact compiled symbol maps and raw profiles reproduce the counts.

A public-input Workerd probe compares the current Wasm AES primitive with the Workers Node crypto API.
Each measured request encrypts **1,048,576 blocks**. Each configuration has four samples.
Thirty exact-output checks cover five call sizes, two native lifetimes, and three keys.
The probe also checks measurement checksums. Native output buffers are wiped.
The external client clock measures bridge calls, copying, setup, wiping, and local dispatch.

| Blocks per call | Wasm median | Native, new cipher each call | Native, cipher reused within one synchronous request |
| --- | ---: | ---: | ---: |
| 8 | 27.645 ms | 1291.376 ms | 255.162 ms |
| 256 | 26.294 ms | 38.509 ms | 19.371 ms |
| 1024 | 26.203 ms | 15.408 ms | 10.067 ms |

At 1,024 blocks per call, a new native cipher gives a **1.70× ratio between whole-request medians**.
Reuse within the synchronous probe gives **2.60×**.
These ratios include bridge calls, copies, setup, erasure, and dispatch.
The retained smaller workload uses 131,072 blocks per request. Its corresponding ratios are **1.47× and 1.94×**.
The gain depends on request volume. Each configuration has only four samples.
Eight-block native calls are much slower. A direct replacement at the current call width is unsuitable.
Production PPRF expansion currently submits eight-block buffers. Larger independent groups need explicit buffer work.

The probe preserves an initial null-IV failure. A zero-length IV passes the ECB output checks.
The [Workers Node crypto documentation](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/) describes the available API.
The installed Workerd result defines this probe's behavior.

Production AES remains unchanged. Protocol parity, hosted speedup, and private-buffer lifetime handling remain unqualified.
The probe does not establish safe reuse across requests or protocol jobs.

## Facts and causes

| Fact | Instrument and window | Check |
| --- | --- | --- |
| Retry delays persist across restart | Native SQLite composed campaign | Exact deadlines, cap, duplicate settlement, and FIFO assertions pass |
| Replacement respects the delay after publication failure | Final actual Workerd lifecycle | Fresh job admitted ten milliseconds after the deadline |
| Candidate has no preparation failure | Closed hosted producer records | Every executing candidate producer has a successful receipt |
| Candidate reserve accounting balances | Final inventory, publication, and exact A/B take records | All 217 consumed pairs replaced |
| Initial control loses six unused pairs | Closed inventory and take records | No unique initial preparation binding proves their deadlines |
| Private AES dominates sampled stacks | Calibrated local CPU profiles and exact symbol maps | Counts replay offline |
| Native AES helps only at sufficiently large calls | Public-input local Workerd probe | Exact outputs and checksums match |
| Four control drivers lose outcomes | Frozen driver records and closed Router traces | One dispatch error is proven. Three response decisions remain unknown |

| Candidate cause or claim | Evidence | Result |
| --- | --- | --- |
| Immediate retries amplify an unhealthy slot | Forced local failure now respects bounded durable delay | Local behavior verified. Hosted failure mitigation remains unproved |
| Retry backoff speeds healthy preparation | Cryptographic work is unchanged and the candidate has no failures | No causal speedup established |
| Mixed effective versions explain measured candidate results | All seven roles qualify through restoration | Excluded for that window |
| Expiry explains six initial control removals | Timing fits a possible readiness boundary, but exact identities lack deadlines | Plausible, unproved |
| Cold topology alone explains slower producer CPU | Slow jobs also have warm-cache evidence | Contradicted as the sole cause |
| Native AES improves eight-block calls | Public-input probe measures much slower native calls | Contradicted |
| Large native calls improve complete preparation | Only the public-input probe request improves | Protocol and hosted parity remain unproved |
| Preparation failure caused the interrupted drivers | The producer exception follows publication; all observed preparation receipts succeed | No failed preparation is established |
| A B loadShed caused the wallet-five dispatch error | Timing overlaps, but the B event has no operation identity | Direct association remains unproved |

The earlier hypothesis that a public request was required for actor code activation was withdrawn.
The actor changed versions without such intervention. The exact rollout mechanism remains unknown.
The gate waited for the actual effective version before each load.

The hosted front was frozen before settlement gained the new outcome field.
It retains settlement identity and wake counts, but strips that extra field in this campaign.
Local evidence verifies terminal outcomes directly. Hosted publication uses independent completion receipts.
The source sanitizer now retains outcome for future campaigns. No historical outcome is fabricated.
Future driver records also retain the exact request, message, and context across failure.
A local Workerd probe verifies HTTP failure, restart, and watchdog retention without another submission.
The current hosted instrument stays frozen. These source changes do not recover the four earlier lost request bodies.

## Next high-impact work

1. Prototype larger fixed public-size buffers around the existing private AES calls. Compare complete correlation preparation before selecting a backend.
2. Review all private copies, erasure, exceptions, cipher lifetimes, and fixed access patterns. Require canonical recovery and ordinary signature verification.
3. Repeat a matched Workers load and restoration cycle. Measure useful material per minute, failures, CPU, and complete demand waits at unchanged capacity.
4. Reproduce a real unhealthy producer interval before claiming mitigation of provider `loadShed` or choosing an operational retry cap.

The underlying historical producer speed difference and material-loading tail remain unresolved.
Warm-cache observations exclude topology rebuilding as the sole explanation of slower measured preparation jobs.
Wasm initialization, provider execution, and the storage tail remain unresolved.
Provider-level execution and memory evidence is still needed to refine those causes.

## Cleanup

All eight temporary Workers are deleted and independently checked for absence.
Synthetic private fixture storage remains outside the public archive.
The archive uses an explicit whitelist and scans all available test credential literals before publication.
