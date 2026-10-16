# ML-DSA preparation stage optimization — October 16, 2026

The combined implementation shortens the measured local four-batch reserve from 68.399 to 48.097 seconds, a 29.68% reduction.
The hosted preparation median is 33.441 seconds, compared with 50.907 seconds in the prior campaign.
Observed refill after initial stock rises from 0.895 to 1.199 batches per minute.
The consistent five-second target remains unmet: ten of twelve successful online requests finish below five seconds.
Hosted creation and recovery preserve the same canonical key and verify standard signatures.
Wallet-seed recovery, standard FIPS seed/key export, and the passive two-participant model remain unchanged.
The pool target stays at four batches. Each batch contains eight candidates. One producer runs at a time.

## Profile and changes

The earlier profiler selected online A/B after preparation moved to separate services.
The runner now selects preparer A/B and calibrates the sampling profiler against known workloads.
Both comparison runs use a 1,000-microsecond sampling interval and hash-matched symbols from their exact release Wasm.
The profile covers the first four-batch reserve, including setup, waits, and publication.
Counts are statistical samples. They do not measure billed CPU or elapsed stage time.
An unprofiled candidate repeat also passes. Its four-batch reserve takes 50.127 seconds, compared with 68.781 seconds in the previous unprofiled control.
Inventory takes 30.293 ms while the producer remains Running. The three signatures take 0.365, 0.243, and 0.242 seconds.

| Category | Baseline A | Baseline B | Candidate A | Candidate B |
| --- | ---: | ---: | ---: | ---: |
| Private AES | 53.92% | 47.81% | 57.38% | 50.15% |
| Code matrix encoding | 17.18% | 18.61% | 19.81% | 20.91% |
| Secret erasure | 12.79% | 15.36% | 0.41% | 3.17% |
| Remaining preparation loop | 8.73% | 9.32% | 11.59% | 13.12% |

The categories are disjoint by stack precedence. Inlined work can remain in the preparation loop category.
Inlining also changes attribution. These percentages cannot allocate the combined speedup among individual changes.
Private AES remains the largest observed category.

Three changes target the measured costs:

1. Inline the existing AES substitution and bit-conversion functions. The AES algorithm, round keys, and state wipes remain unchanged.
2. Erase flat secret arrays and block slices through `zeroize`'s whole-value volatile writes and existing optimization barrier.
3. Use an equivalent table-based AES round only in the public code-matrix generator on Wasm.

The private AES screen takes 12.200 ms before and 11.556 ms after the inlining change for 262,144 blocks.
The full matrix-encoding screen takes 45.174 ms before and 33.812 ms after the public-round change, a 25.15% reduction.
These Node Wasm screens compare both implementations in one module. They do not establish complete Worker speedups.

## Privacy and erasure review

The matrix generator's seed and intermediate states derive only from public code configuration.
Secret coefficients enter later as XOR operands. They do not enter the table-based generator.
The configuration API now states that its matrix seed must be public.
The table helper is private to this generator. Shared RNG, OT, PPRF, and triple hashing retain constant-time AES.
The generator still uses the updated previous group as round keys. Its recurrence and dimensions remain unchanged.

`SecretBlockBatch` contains only flat byte arrays and defaults every byte to zero.
All new instances remain inside `Zeroizing`.
The vendored `Block` type is a 16-byte transparent value with a zero default.
Its new `DefaultIsZeroes` implementation lets `SecretBlocks` erase its initialized slice through the existing `zeroize` API.
The dynamic vector's erased extent is unchanged. Current callers never shrink or reallocate it.
This adds no unsafe code to the protocol crate.

Independent inspection of the final A and B Wasm confirms:

- Dynamic blocks receive zero stores across exactly `16 × len` bytes, including the remainder, followed by the nonempty-slice barrier read.
- The PPRF buffer receives a complete 128-byte wipe and a barrier read.
- Both triple buffers receive complete 256-byte wipes, each followed by a barrier read.

Restoring symbols changed no non-custom Wasm section. Each names map matches its original binary hash.
A whole-value volatile write is not an atomic-write claim.
This inspection covers the named buffers and paths. It does not certify every temporary, register copy, or abort path.

## Validation

The public-round screen compares every output byte against RustCrypto for 32 seeds, 512 rounds per seed, and eight blocks per round.
It also compares complete 4,096-byte generator buffers over 512 successive refills for each seed.
Fifteen complete encoder cases match native output in Wasm across three dimensions and five public seeds.
Those cases include the production dimension and default matrix seed.
Timing samples additionally compare full-output SHA-256 values between baseline and candidate.

The private AES screen compares every output byte for 256 keys and 128 blocks per key.
The four existing AES vector and differential checks pass.
Four genuine two-process correlation chunks pass every triple-product and shared-AND check. Mismatched bindings are rejected.
The native campaign reproduces six canonical keys and passes authorized ordinary-key export and recovery checks.
The calibrated local Worker campaign passes signing, duplicate handling, durable restart, refill, and interrupted-peer checks.

## Hosted registration

| Case | Initial preparation | Online registration | Initial-stock signature |
| --- | ---: | ---: | ---: |
| Creation | 138.915 s | 5.541 s | 4.440 s |
| Recovery | 83.516 s | 4.981 s | 2.315 s |

Each case starts with two batches. Background refill restores the unchanged target of four.
Both reproduce the expected canonical key and verify a standard signature.
Registration does not consistently meet five seconds. Preparation remains a separate cost.
These two cases do not establish a percentile or a causal hosted speedup.

## Sustained hosted measurement

All twelve stored signatures pass independent Node/OpenSSL verification.
The campaign includes 491 requests: twelve successful responses, one failed operation, 239 unavailable responses, and 239 declined replays.
The failed operation exhausts twenty-four candidates across three batches in 5.400 seconds.
Three successful operations consume two batches each. All consumed material remains included in the measurements.

| Measurement | Previous campaign | Candidate campaign |
| --- | ---: | ---: |
| Known completed preparation median | 50.907 s | 33.441 s |
| Known completed preparation range | 41.078–80.927 s | 26.163–61.986 s |
| Newly observed pairs per minute after initial stock | 0.895 | 1.199 |
| Successful signatures per minute after initial stock | 0.795 | 0.879 |
| Successful online request median | 2.609 s | 3.126 s |
| Successful online request range | 1.336–3.553 s | 2.041–6.503 s |
| Successful online requests below five seconds | 12/12 | 10/12 |
| Demand median, including capacity waits | 52.546 s | 58.317 s |
| Demand maximum, including capacity waits | 175.969 s | 121.939 s |

Only one of twelve complete demands finishes below five seconds in the candidate run.
The measured preparation median falls 34.3%. Pair-arrival rate rises 34.1%, while successful-signature rate rises 10.6%.
These compare complete campaigns with different random rejection patterns and runtime variation. They do not isolate individual optimization gains.
Both campaigns encounter a runtime reset. Worker and Durable Object colocation is not independently verified or pinned.

The first success and three-batch exhaustion consume the four initial pairs by 8.990 seconds.
The remaining 750.483 seconds contain eleven successful signatures and fifteen newly observed pairs.
Eighteen distinct batches supply 144 evaluated candidates across thirteen terminal operations. No batch identity repeats.
The final balance is `4 initial + 18 new = 18 consumed + 4 remaining`.
Restoring that final reserve adds 102.138 seconds after the client interval.

One producer alarm reports `runtime_code_update_reset`. No deployment occurs during the load interval.
Its batch is observed paired and is later consumed by a verified two-batch signature.
The later alarm records an unknown outcome. No normal completion record is available for this batch.
Observed stock balances, while complete-publication-accounting remains false because that normal completion record is missing.
The reset cause remains unknown. No preparation rerun for the same identity is captured.

Matched producer invocation CPU has medians of 16.175 seconds for A and 19.094 seconds for B.
A's matched set includes the brief interrupted-job settlement. Its separate reset invocation consumes 26.363 seconds of CPU.
These per-invocation observations do not establish total billed CPU or a dollar cost.
The test cooldown is one second. The product default remains 60 seconds.
The small screen does not establish production percentiles, sustained one-per-minute signing capacity, or multi-wallet capacity.

## Diagnosis record

| Fact | Instrument | Scope and check |
| --- | --- | --- |
| Private AES, erasure, and encoding dominate the local samples | Calibrated V8 profiler | Exact Wasm hashes, both producer targets, same pool policy |
| Full encoder outputs match the reference | Native and Wasm screen | Complete bytes, repeated refills, production seed and dimension |
| Secret-buffer wipes remain in optimized code | Wasm disassembly | Both roles, original code sections retained |
| Four-batch local reserve drops by 29.68% | Complete Worker E2E | One profiled campaign per implementation |

| Candidate cause | Profile evidence | Validation | Status |
| --- | --- | --- | --- |
| Per-byte erasure overhead | Large baseline category | Bulk erasure remains in final Wasm | Changed without removing the named wipes |
| Software AES work | Largest baseline category | Equivalent outputs, inlining-only private changes | Remains the largest observed category |
| Public matrix generation overhead | Encoder category and isolated screen | Complete output equality | Faster in the local screen |
| Larger reserve hides preparation | Pool policy and stock records | Target remains four | Excluded by test design |
| Profiler overhead or runtime variation explains the complete gain | Profiled and unprofiled local candidate checks | Hosted campaigns also differ in rejection patterns and runtime | Individual causal attribution remains open |

## Reproduction and evidence

Run the existing durable Worker E2E with `--profile-preparation` and fresh disposable fixtures.
Use `summarize_preparation_profile.py CAMPAIGN BUILD_ROOT OUTPUT` with the exact release binaries and symbol maps.
For hosted work, use the existing registration and sustained-signing runners with temporary role-separated Workers.
Use the same eight-candidate batches, four-batch target, one producer, and one active operation.
Capture all five Worker tails. Sanitize them before retention, then run `summarize_refill.py` with exact deployment versions.
Keep failures and final stock in the evidence. Remove temporary Workers, credentials, and raw tails after the campaign.

- [Baseline profile summary](../evidence/ml-dsa-65-stage-baseline-summary-20261016.json) and [candidate profile summary](../evidence/ml-dsa-65-stage-candidate-summary-20261016.json).
- [Private AES screen](../evidence/ml-dsa-65-stage-aes-screen-20261016.json), [unprofiled local repeat](../evidence/ml-dsa-65-stage-unprofiled-local-20261016.json), and [public encoder screen](../evidence/ml-dsa-65-stage-encoder-screen-20261016.json) and [Wasm wipe inspection](../evidence/ml-dsa-65-stage-wipe-inspection-20261016.json).
- [Genuine correlation checks](../evidence/ml-dsa-65-stage-correlations-20261016.json) and [canonical keys and authorized recovery](../evidence/ml-dsa-65-stage-native-20261016.json).
- [Hosted creation and recovery](../evidence/ml-dsa-65-stage-registration-hosted-20261016.json).
- [Previous hosted throughput campaign](ml-dsa-65-preparation-throughput-report.md).

- [Hosted client results](../evidence/ml-dsa-65-stage-sustained-hosted-20261016.json), [recomputed summary](../evidence/ml-dsa-65-stage-sustained-summary-20261016.json), and [sanitized traces](../evidence/ml-dsa-65-stage-hosted-traces-20261016.json).
- [Source, build, and deployment provenance](../evidence/ml-dsa-65-stage-provenance-20261016.json).

## Next step

Keep these protocol-preserving changes. Private AES remains the largest sampled cost.
Evaluate a wider portable AES backend in an isolated equivalence screen before changing the implementation.
Also isolate hosted multi-batch signing and registration overhead. Both still miss five seconds in this campaign.
Retain the current pool cap and report actual added compute for any later concurrency experiment.
GPU work and public Wallet integration remain deferred.

The bloat check retains the inherited duplication failure: Rust 13,984 lines and TypeScript 10,304 lines.
The current changes do not increase either count. The baseline file remains unchanged.

All five temporary Workers were deleted. Tail sessions stopped. Benchmark credentials, private fixture directories, and raw tails were removed after the credential scan.
