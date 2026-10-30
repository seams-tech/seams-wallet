# ML-DSA production preparation profile

Private AES remains the largest sampled cost in real local preparation.
Encoder accumulation contributes about seventeen percent of samples. Public index generation contributes about seven percent.
A small accumulator prototype improves the isolated encoder by 3.5–3.9 percent.
It misses the predeclared ten-percent gate and is discarded.
No production source change, hosted speedup, or new throughput frontier follows from this experiment.

## Real Worker controls

The frozen source revision is `24a3dd453920e51733487365a7fecf4bf88b7849`.
Its production runtime matches the preceding [quiet hosted controls](ml-dsa-65-quiet-producer-hosted-report.md).
This campaign makes no cloud deployment or credential upload.

The existing durable Worker E2E runs ordinary, diagnostic, and ordinary-return builds.
All three full lifecycle runs pass. They include real private preprocessing, standard signing, interruptions, publication recovery, restart, and single-use checks.
Three focused unprofiled controls preserve the same activation-through-first-reserve prefix.
After that window, they verify owner-admitted signing, duplicate replay, altered-message rejection, reserve restoration, and matching participant inventories.
All three focused controls pass.

Each measured first reserve contains sixteen pairs, or thirty-two candidates.
Preparation creates four candidates per job. Signing consumes two candidates at a time.
The profiling window uses one preparation slot. The full lifecycle's later parallel-refill scenario remains outside that window.
The test cooldown is one second. Production defaults remain one group, one preparation slot, one signing slot, and sixty seconds.
Wallet-seed recovery, canonical FIPS export, separate custody, and per-wallet capacity remain unchanged.

| Build | Profiled first reserve | Unprofiled first reserve |
| --- | ---: | ---: |
| Ordinary first | 36.076 s | 38.108 s |
| Diagnostic | 38.102 s | 37.081 s |
| Ordinary return | 39.124 s | 37.079 s |

These are individual local pool-fill observations. They are not single-job, registration, or signing latencies.
The measurements include protocol and storage orchestration. They establish no stable percentage overhead or latency percentile.
Both diagnostic observations fall within their ordinary control ranges.
That comparison constrains gross perturbation, rather than proving identical compilation or production attribution.

## Sample attribution

The existing profiler passes its zero-work and known nonzero-work controls in every profiled run.
Each profile matches its exact Wasm hash and function-symbol map.
The temporary source copy adds no-inline attributes without adding logs, exports, private inputs, or persistence.
Five intended boundaries retain separate symbols. Conversion and expander functions do not remain separately named.
Treat their remaining inlined work as unseparated.

Selected disjoint categories in the diagnostic build are:

| Category | Participant A | Participant B |
| --- | ---: | ---: |
| Private AES | 50.25% | 42.03% |
| Encoder accumulation, excluding separately attributed descendants | 17.09% | 17.03% |
| Public index refill, including inlined generator work | 6.98% | 6.94% |
| Other preparation, including unseparated conversion work | 13.34% | 16.32% |
| Separately named secret erasure | 0.59% | 4.28% |

Ordinary controls also place private AES near 49.5–51.1 percent for A and 41.5–42.3 percent for B.
Their accumulator categories span 16.9–17.8 percent. Public index refill stays near seven percent.
The raw analysis retains all categories, exclusive leaves, and overlapping inclusive function memberships.

These percentages count profiler samples. They are neither billed CPU nor measured component durations.
Inlining can hide copying and erasure inside other categories. The named-erasure row does not measure all erasure.
Do not add inclusive memberships or multiply kernel gains by these shares to predict a complete-job gain.
Local profiles cannot explain the persistent hosted producer difference without hosted parity.

## Accumulator prototype

The measured encoder profile supports one small experiment in the largest distinct encoder function.
The prototype removes redundant bounds checks from the fixed twenty-four-bit Wasm accumulator's main branch.
It preserves the matrix, coefficient order, checked tail, code dimensions, and secret erasure.
The measured candidate also adds a public length check before the main-index subtraction.

Independent review rejects the initial uncompiled prototype because short dimensions invalidate its unsafe proof.
For a suffix of twenty-four elements, release subtraction can wrap and select unchecked access beyond the slice.
The repaired candidate first requires `len > accumulator_size`.
Then the unchecked branch has `i < len - 25`, while the mask contains only bits zero through twenty-four.
Thus `offset <= i + 25 < len`. The checked tail still wraps safely.
No new branch or address depends on secret coefficient values.
This source review establishes no JIT constant-time guarantee.

Both screens use frozen current production as their control. They include the already-retained trailing-bit accumulator optimization.
Each screen compares complete Block and byte outputs over 463 shape, seed, and configuration cases.
Both screens also reject one hundred short-input cases across control/candidate and Block/byte coefficients.
All comparisons and rejection checks pass.

Each timing repetition uses twenty alternating control/candidate pairs after warmup.
The complete encoder kernel includes deterministic input allocation and checksum work.

| Node-Wasm screen | Control median | Candidate median | Difference |
| --- | ---: | ---: | ---: |
| First | 49.339 ms | 47.412 ms | 3.91% lower |
| Repeat | 49.150 ms | 47.429 ms | 3.50% lower |

The predeclared gate requires at least ten percent in both screens before complete Worker comparison.
The candidate misses that gate. Additional unsafe production code is unjustified by this result.
The candidate remains only in the evidence archive. It never enters production Workers or a hosted campaign.
These kernel results establish no registration, signing, preparation-job, or throughput improvement.

## Verification and retained failures

Native fixture generation passes its existing six prepared-keygen cases and component checks.
Independent Node/OpenSSL verification accepts twenty-one retained Worker signatures and rejects twenty-one altered messages.
These include fifteen reported signatures and six nested retained-material recovery signatures.
The six Worker runs preserve the configured reserve and two-at-once behavior.
They exercise synthetic fixtures and injected activation, rather than public browser authentication or NEAR submission.

Two initial launches stop before Worker execution because historical fixture directories or storage keys are absent.
Classification: `environment_or_infrastructure_failure`. Fresh disposable fixture generation resolves setup.
The first symbol matcher omits Rust's `Type>::method` spelling.
Classification: `valid_test_needs_update`. The corrected matcher preserves the original reading and identifies five separate boundaries.
The initial unsafe candidate defect is repaired before compilation or timing. Production code is unaffected.

The required bloat check retains its inherited Rust duplication failure: 13,992 lines against a 13,754-line baseline.
The excess remains 238 lines. No baseline changes.

## Facts and remaining work

| Fact | Instrument | Qualification |
| --- | --- | --- |
| Private AES dominates these local samples | Calibrated profiles and exact symbol maps | Repeats in ordinary and return builds |
| Accumulation and public index refill remain distinct encoder costs | Complete profiles and disjoint attribution | Inlined descendants remain a limitation |
| The repaired candidate preserves tested encoder outputs | Two exact Wasm screens | 463 complete-output cases and 100 rejection checks per screen |
| Kernel medians miss the advancement gate | Forty raw timing pairs across two repetitions | No complete-job or hosted gain established |
| Ordinary signatures remain valid | Independent standard verifier | Twenty-one accepts and twenty-one altered-message rejections |

| Candidate explanation | Evidence | Status |
| --- | --- | --- |
| One cold invocation or initial schedule-cache miss alone explains the hosted producer gap | Earlier quiet/return hosted controls retain the gap | Rejected as a sole explanation. Persistent first-touch or compiler-history effects remain unresolved |
| Conversion or erasure dominates the entire pipeline | Substantial work remains inlined | Unresolved. This profile does not justify removing erasure |
| Bounds-check removal provides a useful complete preparation improvement | Its encoder kernel misses the predeclared gate | Discard this prototype |
| Host hardware, compiler tier, or platform contention explains the hosted gap | This campaign stays local | Remains unknown |

The next useful experiment should inspect compiled accumulator and public-index work before another source rewrite.
Evaluate bounded public schedule reuse only after measuring its generation cost and live-memory budget.
Private AES remains a larger opportunity if a distinct implementation change survives complete matched Worker controls.
Keep the rejected AES and accumulator experiments as stopping evidence when selecting that change.
Larger service-group populations remain a separate capacity qualification. GPU work stays deferred.

## Replay and cleanup

Extract the [public archive](../evidence/ml-dsa-65-production-profile-20261031.tar.gz), then run `python3 production-profile/replay.py`.
The replay checks member hashes, raw profile attribution, original kernel medians, the advancement gate, complete kernel outputs, and standard signatures.
It requires Python3 and Node with ML-DSA and Wasm SIMD support. It makes no external calls and needs no credentials.
The [evidence index](../evidence/ml-dsa-65-production-profile-20261031.json) records hashes, scope, results, and limits.

No cloud resources change in this campaign. The two new local test storage-key files are removed after the archive scan.
The earlier eight temporary Workers still await explicit deletion approval after automatic review rejected their cleanup.
Their deployment/upload approval remains separate from deletion authorization.
