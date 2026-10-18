# ML-DSA preparation: fixed AES permutations

Date: 2026-10-18. Production qualification remains open.

The AES optimization reduces isolated median CPU by 24.58% in a matched Cloudflare Worker control.
Complete passive local reserve time stays near 49.15 seconds. The full hosted candidate performs worse in this screen.
The changes therefore establish a kernel improvement, without qualifying overall preparation or signing targets.
A separate inventory-wakeup diagnostic reaches 36.171 seconds locally and identifies the next scheduling experiment.

This experiment targets private AES, the largest CPU category in the latest preparation profile.
It preserves the AES permutation, the preparation protocol, wallet-seed recovery, standard FIPS export, and the pool capacity.
Preparation stays on Workers. Four-candidate groups and thirty-two candidates per wallet remain unchanged.

## Optimization order

1. Simplify private AES permutations and transpose steps. The preceding profile attributes about 50–58% of CPU samples to private AES.
2. Measure packing, copying, and clearing in AES callers. Preserve the owners that erase secret buffers.
3. Measure bounded overlap between participant computations. Adopt a change only if complete preparation improves without increasing ready capacity.
4. Revisit public matrix encoding, which accounts for about 21% of samples.
5. Repeat matched hosted controls and investigate missing participant traces before making capacity or percentile claims.

GPU work remains deferred. Larger pools are outside this experiment.
The targets remain 5–10 seconds of preparation per successful signature and consistently sub-five-second online signing.

## Implementation

The previous SIMD code expressed each combined row/column permutation as two rotations, two masks, and an OR.
The new code directly selects the source cell for each destination cell.
For destination `i`, the source is `((i + 4 * rows) & 12) | ((i + columns) & 3)`.
The four instantiated row/column pairs remain `(1,1)`, `(1,2)`, `(1,3)`, and `(2,2)`.
Every index depends only on public constants. The operation moves complete cells without changing their internal block lanes.

The bit transpose now states its twelve swaps explicitly.
The pair order, shifts, masks, and assignments match the previous nested loops.
This lets the compiler remove loop control and use constant shifts and indices.
The AES substitution equations, round count, key schedule, and erasing owners remain unchanged.

The scalar backend uses the equivalent rotate-and-mask formula.
That backend also serves Ed25519 garbling, so shared cryptographic validation is part of this change.
The existing runtime conformance command passes twelve activation and twelve export boundary/property cases.

## Isolated measurements

| Variant | Baseline median | Candidate median | Lower median |
| --- | ---: | ---: | ---: |
| Direct cell permutation | 7.281 ms | 6.549 ms | 10.04% |
| Direct permutation and explicit transpose | 7.227 ms | 5.455 ms | 24.52% |

Each screen uses twenty alternating repetitions after warm-up in one Node Wasm module.
All paired checksums match, and every paired candidate run is faster.
Current scalar and SIMD outputs match RustCrypto across 256 keys and 256 blocks per key.
The adapter also checks lengths zero through thirty-three, including unchanged suffixes.

The comparison includes the complete baseline AES backend from `bf49d67b`.
The baseline adapter does not call the candidate kernel.
Both variants have source hashes, and the combined receipt matches the exact candidate source.
These are isolated measurements. They do not establish complete Worker latency or the separate contribution of the transpose change.

## Cause table

| Candidate cause | Evidence | Assessment |
| --- | --- | --- |
| Redundant SIMD permutation operations | Source formulas, compiled baseline, and isolated comparison | Measured target for this change. |
| Public transpose loop control | Fixed twelve-swap mapping and combined screen | Combined variant improves the isolated result. Separate contribution remains unmeasured. |
| Protocol traffic or candidate consumption | Both remain unchanged by these functions | This change cannot reduce their quantity. |
| Hosted placement and runtime variation | Earlier sequential campaigns vary beyond their local differences | Keep causal attribution limited. |
| Benchmark implementation | Baseline backend and candidate backend share one harness and inputs | Full-byte checks and alternating order reduce comparison errors. |

## Validation method

Inspect exact packaged Wasm for fixed shuffle operands, public control flow, and retained memory erasure.
Run the complete native ML-DSA campaign for canonical keys, signing, recovery, rollover, and replay behavior.
Run local Worker E2Es in baseline/candidate/candidate/baseline order without simultaneous local builds.
Use the same policy, prepared-candidate capacity, profiling, and passive observer in every local run.

The hosted profiles each use two wallets, ten minutes of saturation, and full reserve restoration.
The benchmark cooldown is one second. The production cooldown remains sixty seconds.
Count rejected candidates, exhausted operations, incomplete demands, and canceled preparation alarms.
Report preparation per four-candidate group separately from preparation work per successful signature.
Preserve both runtime versions and complete material identity ledgers.

Native timings are correctness evidence only in this campaign because native checks overlap compilation work.
Source and Wasm inspection do not certify register erasure or constant-time behavior in every runtime JIT.


## Packaged code review

The independent review checks binary hashes, every inventoried function-body hash, and matching symbol sidecars.
All four direct row/column maps appear as constant `I8x16Shuffle` operands in the candidate.

| Wide AES static code | Baseline | Candidate |
| --- | ---: | ---: |
| Operators | 3,385 | 2,714 |
| Constant shuffles | 128 | 88 |
| `If` instructions | 15 | 1 |
| `BrIf` instructions | 16 | 0 |

The remaining conditional reads a public round counter.
The inspected scalar and wide functions contain no division, remainder, or indirect calls.
Wide-state clearing still covers 128 bytes. Wide-key clearing still covers 1,408 bytes.
Scalar-state clearing retains its zero-vector stores and copies across all eight state words.

Both scalar bodies remain 7,235 bytes with 3,674 operators and identical opcode counts.
Their bodies differ through reordered masked-rotation evaluation and local scheduling.
They are not byte-identical. Source equivalence and reference-output checks support unchanged behavior.
Static instruction counts are distinct from executed instruction counts and elapsed time.


## Local cadence investigation

The first passive local runs observe full reserves at 49.154 and 49.135 seconds.
Their one-second readiness windows overlap. These observations cannot distinguish a sub-second improvement.
Lower CPU sample counts coincide with a largely unchanged job-start cadence.

| First eight jobs, service-clock observations | Baseline | Candidate |
| --- | ---: | ---: |
| Median start-to-start interval | 6.084 s | 6.175 s |
| Median load-to-publication interval | 5.309 s | 4.379 s |
| Median publication-to-next-load gap | 0.796 s | 1.809 s |
| First load to eighth publication | 47.894 s | 47.378 s |

Service clocks can omit CPU. Publication also precedes the final handshake and lease release.
The publication gap therefore includes unsettled protocol work and must not be called idle time.
The controller checks one second after dispatch, then retries five seconds after a busy response.
The producer releases its lease without directly waking that controller.
This mechanism fits the cadence, but actual alarm delivery and lease-release timestamps are not available.

The diagnostic active-observer run uses the same binary and policy with the existing inventory-polling observer.
Inventory requests can advance refill alarms. This is a deliberate intervention and is excluded from production performance claims.
Shorter start intervals would support the scheduling hypothesis. Unchanged intervals would require separate alarm and lease timing.

The next implementation candidate is a completion-triggered controller wake-up after durable settlement.
It must retain queue fairness, single-use publication, crash recovery, the service-wide producer limit, and the existing candidate cap.
This experiment does not change producer or controller scheduling.


## Repeated local results

All four passive runs pass their complete Worker lifecycle checks and three OpenSSL signature checks each.
They run in baseline/candidate/candidate/baseline order with the same frozen binaries and policy.

| Run | Build | Full reserve observation |
| --- | --- | ---: |
| 1 | Baseline | 49.154 s |
| 2 | Candidate | 49.135 s |
| 3 | Candidate | 49.166 s |
| 4 | Baseline | 49.144 s |

The two build means are effectively equal within the one-second observation resolution.
This screen demonstrates no passive local reserve-latency improvement.
AES accounts for about 57%/49% of A/B samples in the baseline and 50–51%/42% in the candidate.
Sample counts and shares describe profiling observations, not billed or elapsed CPU measurements.

The active-observer diagnostic also passes its lifecycle checks and three signature checks.
Its full reserve is observed at 36.171 seconds with the same candidate binary and capacity.
Median job-start spacing falls to 4.136 seconds, and the publication-to-next-start gap falls to 0.128 seconds.
This supports controller wakeup timing as a contributor to the passive fill-time limit.
Across seven gaps, publication-to-next-start spans shrink by about 9.4–10.4 seconds relative to the two passive candidate runs.
Load-to-publication spans also shrink by about 2.1–2.9 seconds. Some one-second gaps remain in the active run.
It does not isolate every effect of extra requests, measure lease-release time, or establish a production-controller speedup.
The diagnostic result is excluded from hosted and passive performance claims.


## Matched hosted kernel control

The slower full-flow candidate prompted a separate test on the hosted runtime.
One temporary Worker loads one Wasm module containing both baseline and candidate kernels.
Each request processes 2,097,152 rounds with public deterministic inputs.
Twenty measured repetitions alternate mode order. Eight initial calls are excluded as warm-up.

| Kernel | Baseline median CPU | Candidate median CPU | Lower median |
| --- | ---: | ---: | ---: |
| Eight-block SIMD adapter | 1,436 ms | 1,083 ms | 24.58% |
| Shared scalar kernel | 3,130.5 ms | 2,933.5 ms | 6.29% |

All eighty measured calls report the same module instance in NRT. Three earlier warm-up calls used another instance.
The SIMD candidate wins seventeen of twenty paired CPU comparisons. The scalar candidate wins sixteen.
Every repetition has matching checksums across all four modes. All eighty-eight tail records match the client requests and deployed version.
CPU values come from invocation metrics and include request handling. HTTP measurements remain separate.

The local module hash matches the Node receipt. The deployment version and upload configuration are retained.
No independently downloaded deployed-module hash is available. This control does not measure complete preparation or signing.
The additional Node scalar control also shows no isolated slowdown: 9.951 to 9.692 milliseconds.

## Hosted complete-flow comparison

| Measurement | Baseline | Candidate |
| --- | ---: | ---: |
| Verified load signatures | 32 | 22 |
| Successful HTTP requests below five seconds | 32/32 | 16/22 |
| Successful HTTP median | 2.055 s | 3.398 s |
| Successful HTTP range | 1.278–4.775 s | 1.543–17.651 s |
| Failed admitted operations | 0 | 0 |
| Completed-demand median, including waits | 38.451 s | 47.244 s |
| Completed-demand mean | 35.743 s | 53.483 s |
| Maximum completed demand | 96.226 s | 151.523 s |
| Unfinished demands at cutoff | 2 | 2 |
| Four-candidate preparation median | 11.695 s | 13.578 s |
| Captured preparation work per success | 18.786 s | 24.968 s |
| Balanced reserve-to-reserve cycle per success | 24.490 s | 37.763 s |
| Signing after initial stock depletion | 2.554/min | 1.805/min |

Baseline unfinished demands have already waited 20.628 and 33.455 seconds.
Candidate unfinished demands have already waited 2.133 and 15.939 seconds.
These demands do not enter completed-demand statistics.

Both identity ledgers balance. The baseline consumes and replaces forty-two groups, or 168 candidates.
The candidate consumes and replaces thirty-six groups, or 144 candidates.
Every wallet starts and finishes with eight matching A/B ready groups and no reservations.
Captured baseline producer work totals 599.827 seconds plus 1.328 seconds of canceled alarms.
Candidate work totals 546.615 seconds plus 2.674 seconds of canceled alarms.
The lower candidate total accompanies fewer groups and signatures. Its observed work per successful signature is higher.

Complete peer traces cover 28/32 baseline successes and 21/22 candidate successes.
Router and inventory records retain complete material accounting. Unidentified canceled alarms keep attribution flags conservative.
Every included producer invocation finishes before the final observation boundary.
Crypto payload bytes remain unchanged at 4,482,752 bytes per four-candidate preparation, excluding framing, storage, and final handshake messages.

The longest candidate request consumes six groups, or twenty-four candidates.
A and B report about fourteen seconds of invocation wall time, with 1.877 and 3.336 seconds of captured CPU.
Both report schedule-cache hits. Each still builds five public topologies, then records increasing topology hits across the groups.
Asynchronous boundary counters contain substantial clock advancement. Those values are not pure network wait and must not be added across participants.
The records establish neither a cold-schedule cause nor an AES slowdown.

All fifty-four load signatures independently verify. Altered messages and signatures are rejected.
Both wallets reproduce identical canonical keys across creation, recovery, and both builds.
Candidate online registration/recovery takes 5.001–9.651 seconds. Initial preparation remains separate at 69.983–106.544 seconds per ceremony.
Sequential full-flow deployments leave placement and runtime variation uncontrolled. Rejection workloads also differ.
No production capacity, percentile, or complete-flow speedup is claimed.

## Evidence and next implementation

- [Comparison summary](../evidence/ml-dsa-65-aes-rounds-comparison-20261018.json)
- [Hosted clients, sanitized traces, and full comparison](../evidence/ml-dsa-65-aes-rounds-hosted-20261018.json.gz)
- [Native checks, local profiles, and diagnostic events](../evidence/ml-dsa-65-aes-rounds-local-20261018.json.gz)
- [Sources, scripts, binaries' hashes, and review](../evidence/ml-dsa-65-aes-rounds-provenance-20261018.json.gz)
- [Validation and cleanup](../evidence/ml-dsa-65-aes-rounds-validation-20261018.json)

The next implementation should wake the refill controller after durable producer settlement.
Keep the recovery alarm as a fallback, preserve fair queue selection, and reject stale or duplicate completion notifications.
Measure actual alarm delivery and lease release, then repeat the same capacity comparison.
The active-observer result is evidence for this experiment, not a substitute for implementing and testing the production wake-up.

All eleven temporary Workers are deleted after collection. Test credentials and raw traces are removed after packaging.
The bloat gate remains blocked by inherited duplication counts: Rust 13,984 versus 13,754 and TypeScript 10,238 versus 10,216.
This change leaves those counts and the baseline unchanged.
