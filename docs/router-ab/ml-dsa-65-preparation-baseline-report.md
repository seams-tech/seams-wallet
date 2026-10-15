# ML-DSA preparation baseline — October 15, 2026

Keep the hybrid Yao/GMW design for the next optimization experiment.
Target silent-OT correlation generation, especially software AES in PPRF expansion and correlation conversion.
This path preserves the current key shares, disclosure boundary, wallet-seed recovery, and canonical export.
It is the best-supported next experiment. Its speedup remains unmeasured.

Two complete unprofiled local Worker runs needed **39.15 and 42.18 seconds** to fill four batches.
They first observed the two batches needed for admission at **20.12 and 21.14 seconds**.
Their six successful signatures took **314–488 milliseconds**.
The preparation target is not established. The four-batch reserve clearly exceeds twenty seconds in these runs.

## Scope and retained evidence

The investigation follows the [preparation comparison plan](ml-dsa-65-preparation-comparison-plan.md).
The [summary artifact](../evidence/ml-dsa-65-preparation-baseline-summary-20261015.json) recomputes observations, sample categories, and circuit counts from raw artifacts.
Its input hashes identify these files:

- [Native canonical key and signing campaign](../evidence/ml-dsa-65-preparation-baseline-native-20261015.json.gz).
- [Dedicated wallet-seed recovery campaign](../evidence/ml-dsa-65-preparation-baseline-recovery-20261015.json.gz).
- [Historical inventory observer control](../evidence/ml-dsa-65-preparation-baseline-control-20261015.json.gz).
- [Passive observer run](../evidence/ml-dsa-65-preparation-baseline-passive-20261015.json.gz).
- [Passive observer with raw V8 profiles](../evidence/ml-dsa-65-preparation-baseline-profile-20261015.json.gz).
- [Repeated passive observer run](../evidence/ml-dsa-65-preparation-baseline-repeat-20261015.json.gz).

The compiled source revision was `8ed3ae90b89fff1218f88eeaf79f8e3387c3a6ff`.
All four Worker runs used identical Router, A, and B Wasm hashes.
The complete runs also record JS hashes, harness hashes, and runtime versions.
Concurrent integration edits after compilation are outside this baseline.

Environment: macOS ARM64, Node 26.4.0, Miniflare 4.20260710.0, and workerd 1.20260710.1.
Worker builds used release optimization, Wasm SIMD, and `worker-build --no-opt`.
They retained function names for profiling. They omitted the additional `wasm-opt` pass, matching the earlier local baseline setting.
These are local workerd measurements. No Cloudflare resources were deployed for this campaign.

The Worker E2E injects canonical role material and verified Gateway authority inputs.
It exercises actual Router admission, role-private storage, automatic refill, signing, result verification, replay, and timeout handling.
It does not establish public registration or recovery through hosted Worker routes.

## Measured results

Each batch contains four candidates. Each candidate can fail rejection checks.
Admission requires two matching Ready batches. The configured reserve target is four batches.
The service allows one producer and one admitted signing operation at a time.
The producer lease lasts ninety seconds. Prepared material expires ten minutes after the job starts.
The test uses a one-second wallet cooldown. Production's configurable default remains sixty seconds.

| Run | First observed admissible reserve | First observed four-batch reserve | Verified signing times | Outcome |
| --- | ---: | ---: | --- | --- |
| Historical observer control | 18.72 s | 37.57 s | 344 ms | Later test assertion failed |
| Passive observer | 20.12 s | 39.15 s | 374, 314, 316 ms | Passed |
| Passive observer with profiler | 20.12 s | 40.15 s | 519, 316, 458 ms | Passed |
| Repeated passive observer | 21.14 s | 42.18 s | 373, 472, 488 ms | Passed |

The control clock starts after activation and material installation, matching the historical harness.
The later runs start before activation. Activation and installation took approximately 82–93 ms.
The profiler stops after the initial reserve. Later signing measurements still use a runtime with an inspector enabled.
Keep the profiled run separate from unprofiled latency observations.
Signing requests start with a full reserve. These timings do not establish signing latency at the two-batch threshold during active refill.

SQLite observations occur approximately once per second.
The first passive run bounds initial admission readiness between approximately 19.12 and 20.12 seconds.
The repeat bounds it between approximately 20.14 and 21.14 seconds.
These are observation bounds during monotonic initial fill. Separate A/B reads are not an atomic snapshot.
The data does not establish consistent readiness below twenty seconds.

Router request timing includes standard RustCrypto verification and durable result storage.
An additional OpenSSL check occurs after that timer stops.
Every saved successful signature passes OpenSSL. Modified messages fail verification.
The three complete runs record no failed signing operations, but nine successes cannot establish p95 or 99% availability.

## Instrument checks and test repair

The first control failed an assertion that expected `refill_due` to remain true after consumption.
Classification: **valid_test_needs_update**.
Consumption records demand. Later inventory recomputes demand from current Ready and Reserved stock.
A completed refill can therefore clear that flag before the test reads it.

The updated test accepts either outstanding demand or a restored paired reserve.
It retains the durable producer-start check and subsequent readiness checks.
The first passing run records four identical Ready batch IDs at both roles after its first signature.
This directly demonstrates the completed-refill state that the old assertion rejected.
No production lifecycle behavior changed.

Inventory polling also affects the workload.
An authenticated inventory request writes inventory state and can advance a refill alarm.
The passive observer reads local SQLite without sending Worker requests.
It filters the exact key and epoch, Ready state, matching IDs, and sufficient material lifetime.
At full stock, it checks its result against authenticated inventory.
The recorded read intervals expose polling resolution and observer cost.

The active and passive runs use different randomness and runtime scheduling.
Their difference does not isolate polling overhead.
They establish the same preparation scale and identify the observer limitation.

## CPU profile interpretation

V8 sampled each participant during activation and initial refill.
The collector stops both profilers before summarizing either result.
It records raw samples and reports the profile window separately from sample weights.

| Diagnostic | Participant A | Participant B |
| --- | ---: | ---: |
| Samples with silent-OT generation in their stack | 89.5% | 89.6% |
| Samples whose current function is software AES | 61.8% | 56.9% |
| Sample weight attributed to silent-OT ancestry | 70.3% | 77.7% |
| Sample weight attributed directly to AES | 46.6% | 53.9% |

These categories overlap. Do not add them or add A's window to B's window.
Sample weights represent sampled wall intervals. They are not billed CPU or an end-to-end speedup bound.
Intervals above 100 ms contribute approximately 30.5% and 33.4% of total weight, despite occurring rarely.
That skew limits numerical attribution.

A sensitivity calculation excludes intervals above 10 ms.
Silent-OT ancestry still accounts for approximately 90% of the remaining weight for both roles.
AES accounts for approximately 67.7% and 61.9% directly.
This preserves the hotspot ranking. It is a sensitivity check, not corrected CPU accounting.

The sampled stacks point to `silent::generate_chunk`, `silent::pprf::expand_level`, and RustCrypto's portable AES routines.
Public code expansion and correlation packing also appear.
This supports a focused correlation-generation experiment before broad storage or transport changes.

## What batching can save

The native protocol counters report these gates for one four-candidate reservation:

| Work | AND gates |
| --- | ---: |
| Nonce conversion | 435,200 |
| Commitment decomposition | 1,216,512 |
| Challenge hashing | 1,070,336 |
| Private bound checks | 1,250,260 |
| Final decisions | 40 |
| Total | 3,972,348 |

Each silent-OT chunk supplies 262,144 correlations. One reservation therefore requires sixteen chunks.
Four separate reservations require sixty-four chunks.
One sixteen-candidate reservation would require sixty-one chunks for the same gate count.
The theoretical chunk-padding reduction is **4.7%**.

This arithmetic does not measure a grouped durable producer.
It excludes other possible setup savings and changes in memory use.
It shows that reduced padding alone cannot explain the roughly twofold improvement needed for the full reserve.
Simply launching more jobs also needs a separate CPU, memory, and contention test.

The native four-candidate case sends 4,482,754 protocol bytes across both directions during preparation.
This excludes Worker framing and durable storage traffic.
Native preparation timing includes SQLite roundtrip, activation, and barriers.
Its ratio to Worker refill time cannot isolate Wasm overhead.

## Fact and cause record

| Fact | Instrument and scope | Check |
| --- | --- | --- |
| A full reserve takes about forty seconds | External Node clock, fresh local Worker stores, repeated unprofiled runs | Matching Wasm hashes and recorded read intervals |
| Admission needs two batches | Deployed test policy and Router coordinator | First readiness is reported separately from one batch |
| Signing remains below two seconds in these samples | Complete Router response timer | RustCrypto verification, OpenSSL cross-check, result replay |
| Refill demand can clear before inspection | Stored post-sign inventories | Both roles hold the same four Ready batches |
| Correlation generation dominates sampled stacks | Raw V8 profile | Independent recomputation and long-interval sensitivity check |
| Canonical recovery remains intact | Separate native roles and authorized test recipient | Same seed/binding reproduces the key and expanded key matches OpenSSL |

| Candidate cause | Evidence | Assessment |
| --- | --- | --- |
| Alarm delay dominates refill | Passive observation still permits the producer’s own alarms | Unquantified. Profile evidence prioritizes computation, while stage-level delay measurement remains necessary |
| Storage or network is the dominant cost | Most sampled stacks concern correlation generation | Weak basis for prioritizing either first. Neither cost is fully isolated |
| Silent-OT computation is a major cost | Profile ranking survives the sensitivity check | Best-supported optimization target |
| Pool capacity alone explains the apparent burden | Four batches take about twice as long as the admission reserve | Relevant to readiness. It does not remove recurring resource consumption |
| Correlation padding causes most of the cost | Grouping sixteen candidates saves only three of sixty-four chunks | Contradicted as the principal explanation |
| The measurement changes scheduling | Inventory requests schedule alarms and write state | Confirmed concern. Passive observation removes those requests |

## Next bounded experiment

1. Benchmark constant-time AES implementations and bulk execution in the exact Wasm correlation path.
2. Separate PPRF expansion, final correlation conversion, public code expansion, and correlation packing in the next instrumented control.
3. Keep all cryptographic dimensions, fresh randomness, domain bindings, and single-use checks fixed.
4. Verify generated correlations and complete signatures before interpreting speed results.
5. Repeat native wallet-seed recovery and canonical export after any protocol implementation change.
6. Compare repeated unprofiled Worker runs with the same passive observer, admission threshold, and four-batch reserve.
7. Test signing at the two-batch admission threshold while the producer continues toward four batches.
8. Advance a successful local change to a small hosted A/B campaign before claiming a product latency gain.

Retain both targets: two-batch readiness below twenty seconds and a substantially faster equivalent full reserve.
A small improvement may suffice for first readiness. Halving full-reserve time needs a larger measured gain.
Public-data caching may help, but must respect the Worker memory budget.
Secret-dependent AES lookup tables are outside the accepted optimization path.

Moving slow correlation generation into a signing request is not yet supported by the two-second budget.
Measure a specific component before moving it online.
Quantus remains a separate candidate until private canonical conversion, short-share privacy, and repeat recovery pass review.
This campaign provides no comparative Worker measurement of that construction.

## Reproduction and remaining limits

Use the recorded revision and dependency locks for the compiled baseline.
Generate disposable fixtures with the main plan's `prepared-keygen` command and `ML_DSA_WORKER_FIXTURE_DIRECTORY`.
Run `wallet-recovery` separately to verify the full wallet derivation binding.
For each role, build from `crates/router-ab-cloudflare`:

```sh
RUSTFLAGS='-C target-feature=+simd128' worker-build --release --no-opt \
  --out-dir build/deriver-a --features strict-worker-deriver-a-entrypoint
```

Repeat for `router` and `deriver-b` with their matching output names and features.
The profiling build must retain function names.
Run the existing Worker E2E with fresh storage each time:

```sh
node tests/e2e/ml-dsa-durable-worker.e2e.mjs /private/tmp/ml-dsa-baseline-fixtures \
  /private/tmp/passive.json --passive-preparation-observer
node tests/e2e/ml-dsa-durable-worker.e2e.mjs /private/tmp/ml-dsa-baseline-fixtures \
  /private/tmp/profile.json --passive-preparation-observer --profile-preparation
```

Use [the summary script](../../tools/ml-dsa-investigation/research/summarize_preparation_baseline.py) with native, recovery, control, passive, profile, and repeat artifacts, followed by an output path.
It reads plain JSON or gzip files and checks bundle identity before summarizing.
An independent read-only review reproduced the profile attribution and challenged the measurement boundaries.

Still unmeasured: hosted latency, direct Worker CPU, peak memory, billed cost, exact Worker traffic, storage-byte totals, and sustained refill capacity.
Native recovery does not establish public Worker recovery parity.
No production percentile, availability guarantee, or completed preparation speedup follows from this campaign.
