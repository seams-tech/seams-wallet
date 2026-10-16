# Private AES widening and Worker qualification

Status: the AES optimization passes correctness checks. Hosted signing still misses five seconds, 2026-10-16. Production release remains gated.

## Implementation and preserved requirements

Private AES now encrypts eight independent blocks per Wasm call when SIMD is available.
SIMD applies the same operation to several data lanes.
Each byte cell holds one bit from each of eight blocks.
The implementation shares the existing Boolean AES equations with the four-block path.
Small batches and non-SIMD builds keep the four-block path.
Shuffle indexes and width selection depend only on public dimensions.

The protocol, transcript encoding, candidate count, and pool policy remain unchanged.
Wallet-seed recovery and standard FIPS seed/key export remain required.
Each participant retains its separate storage key and signing share.
The privacy claim remains limited to passive, honest execution.
Prepared material remains single-use.
The test uses eight candidates per batch, four ready batches, and one active signing operation.
The test cooldown is one second. The product default remains 60 seconds.

## Correctness and compiled-code review

The isolated Wasm screen compares all output bytes against RustCrypto AES 0.9.1.
It checks 256 keys and 256 blocks per key in the original scalar, revised scalar, and revised SIMD implementations.
It also checks the production adapter at every length from zero through 33 blocks, including unchanged suffixes.
The four existing scalar AES checks pass, including the FIPS 197 vector and lane independence.
Native correlation, canonical-key, recovery, and signing lifecycle checks pass.
Complete local Worker checks pass with and without sampling.
They cover standard signature verification, duplicate requests, restart recovery, refill, and stalled-peer shutdown.

The independent review checks the exact optimized A and B Wasm binaries.
Named private state, input batch, temporary key-byte, and stored key-schedule wipes remain present.
The inspected encryption paths contain no private-input-dependent addresses or branches.
Restoring function names preserves every non-custom Wasm section byte-for-byte.

The constructor retains copies of its 704-byte scalar and 1,408-byte wide key schedules after returning.
All three production callers use fixed public AES keys. The private values are the input blocks.
This review does not establish total stack erasure, arbitrary-secret-key hardening, or a complete protocol security audit.

## Local measurements

| Measurement | Original | Revised |
| --- | ---: | ---: |
| Isolated repeated AES, 262,144 blocks | 9.526 ms | 7.918 ms |
| Profiled first four-batch reserve, active inventory observer | 48.097 s | 45.229 s |
| Three local online signing requests | 0.308–0.470 s | 0.250–0.403 s |

The isolated AES reduction is 16.88%.
The matching active-observer reserve control measures 5.96% less elapsed time than the historical profiled baseline.
Separate passive-observer runs measure 45.083 seconds with sampling and 45.079 seconds without sampling.
The unprofiled passive run also verifies three signatures in 0.244–0.372 seconds.
The initial reserve comparison used different observers. Review identified that active inventory requests can update refill state.
That comparison did not isolate an AES effect. The table now uses matching active inventory observers.
These are small local screens. They do not establish hosted speed or production percentiles.
Signing attempts use fresh randomness. Their timing difference does not isolate an AES effect.
The AES change mainly affects preparation.

The profiler uses a known CPU workload for calibration and selects the correct participant Workers.
Preparation sampling targets the separate producer Workers. Signing sampling targets the online A/B Workers.
The summary recognizes AES inlined into `CorrelationAes::encrypt`.
Function names alone cannot divide inlined erasure and encryption costs exactly.

## Hosted creation and recovery

Hosted measurements cover authenticated private Gateway requests through real Cloudflare Workers.
They exclude public login, wallet confirmation UI, and NEAR transaction submission.

| Operation | Preparation before admission | Online registration with client verification | Initial signature |
| --- | ---: | ---: | ---: |
| Creation | 113.709 s | 7.189 s | 3.547 s |
| Recovery | 106.160 s | 5.250 s | 3.853 s |

Both operations authenticate the holder results, verify the manifest, and reproduce the same canonical public key.
Both initial signatures verify with the standard verifier.
Registration still misses five seconds in this sample.
The preparation column includes the minimum initial signing stock. It remains separate from online registration latency.

## Hosted sustained signing

The sustained campaign starts only after four paired batches are observed ready.
It retains rejected candidates, exhausted operations, empty-pool retries, and final reserve restoration.
All twelve signatures verify. Eleven successful HTTP requests finish below five seconds.
Successful HTTP latency ranges from 2.562 to 7.310 seconds, with a 3.179-second median.
Two successful operations use two batches. They take 3.112 and 7.310 seconds.
One failed operation exhausts two batches and sixteen candidates.
The campaign consumes sixteen distinct batches and evaluates 128 candidates. No consumed batch identity repeats.

Including exhausted-operation recovery and empty-pool waits, successful demand latency reaches 79.613 seconds.
Only two of twelve complete demands finish below five seconds.
After initial stock depletion, observed refill supplies 1.769 paired batches per minute and supports 1.474 successful signatures per minute.
The full client interval is 423.351 seconds. Initial stock is excluded from those post-depletion rates.
This is a one-wallet saturation screen. It does not establish production percentiles or multi-wallet capacity.
Completed batch preparation ranges from 20.727 to 57.342 seconds, with a 28.001-second median.
Matched producer invocation CPU has medians of 13.178 seconds for A and 13.471 seconds for B.
These invocation readings do not establish total billed CPU or a dollar cost.

The earlier campaign reported a 33.441-second preparation median, 1.199 batches per minute, and 0.879 signatures per minute after depletion.
It also encountered a runtime reset and consumed eighteen batches instead of sixteen.
Different rejection patterns and runtime conditions prevent attributing the throughput difference solely to AES.

Final stock balances exactly: `4 initial + 16 new = 16 consumed + 4 remaining`.
Restoring the final four-batch reserve adds 188.282 seconds after the client interval.
All sixteen new publications have completion records. No batch identity repeats, and no captured invocation reports an exception or reset.
Seven other invocations report cancellation without an operation identity or exception. Their causes remain unknown.
Five precede the sustained interval. One occurs during that interval, and one occurs during final restoration.
These records remain in the retained evidence. They do not change the observed stock balance.

The two-batch comparison shows both CPU and elapsed-time variation:

| Measurement | Faster operation | Slower operation |
| --- | ---: | ---: |
| Client HTTP | 3.112 s | 7.310 s |
| A invocation CPU | 0.768 s | 1.950 s |
| A invocation elapsed | 2.718 s | 6.231 s |
| B invocation CPU | 0.761 s | 1.732 s |
| B invocation elapsed | 2.698 s | 6.180 s |

Both operations use sixteen candidates and the same deployed versions.
Network delay alone does not explain the larger CPU readings.
These invocation totals do not separate cold execution, CPU variation, material loading, protocol waits, and storage waits.
Worker placement and isolate reuse remain unverified.
Do not add parallel CPU and elapsed durations to infer a request timeline or billed CPU.

## Diagnosis record

| Fact | Instrument | Scope and check |
| --- | --- | --- |
| Revised AES outputs match the reference | Full-byte Wasm comparison | Current copied production sources and recorded hashes |
| Named secret-buffer wipes survive optimization | Independent Wasm inspection | Exact A/B hashes and unchanged code sections |
| Matching local reserve control measures 45.229 s | Complete Worker E2E | Active inventory observation matches the historical profiled baseline |
| Hosted registration still exceeds five seconds | Registration E2E | Creation and wallet-seed recovery both verify |

| Candidate cause | Evidence | Status |
| --- | --- | --- |
| Private AES is the largest identified preparation sample category | Calibrated producer profile and isolated screen | Wider implementation reduces its measured kernel cost; inclusive samples also contain inlined work |
| Larger pools hide cost | Identical policy and stock accounting | Excluded by test design |
| Per-element erasure dominates online signing | Baseline online profile assigns only about 1–4% of samples to identifiable erasure | Does not support making this the first online optimization |
| Network delay alone causes slow signing | The slower two-batch operation also uses more CPU on both participants | Insufficient explanation |
| Cold execution, CPU variation, or storage and protocol waits contribute | Same candidate count and versions, different CPU and elapsed totals | Unresolved; stage measurements and isolate identity are needed |
| Observer overhead or runtime variation explains part of campaign differences | Fresh rejection patterns and unpinned Worker placement | Remains possible |

## Reproduction and evidence

Run `research/run_private_aes_screen.py OUTPUT --baseline 317aca2b` from the investigation tool directory, or use its full repository path.
Build the strict release Workers with the existing role build scripts.
Run the durable Worker E2E with `--profile-preparation --profile-signing --passive-preparation-observer` for passive observation.
For the matching historical reserve control, run it with `--profile-preparation` alone.
Use `summarize_preparation_profile.py` with the matching release symbol maps and `--phase preparation` or `--phase signing`.
Run the registration and sustained-signing E2Es against temporary role-separated Workers.
Capture all five tails and sanitize them with `collect_worker_traces.py` before retention.
Recompute stock and throughput with `summarize_refill.py` and the exact deployment-version map.

An interrupted campaign lost its temporary files and process handles before its hosted results were retained.
All five Workers from that campaign were removed. Its incomplete hosted measurements are excluded.
The replacement campaign uses the same release binaries and pool policy with fresh benchmark credentials.


## Next work

The five-second signing target remains unmet. Keep public integration gated.

1. Measure hosted online stages: admission, private material loading, schedule/layout construction, protocol exchanges, and final settlement.
2. Record public isolate identity and public-cache hit state. Use matching cold and warm controls to test the CPU-variation hypothesis.
3. Count protocol exchanges and distinguish peer wait from storage wait before choosing the next optimization.
4. Repeat single-batch and multi-batch qualification at the same pool cap. Keep exhausted operations and complete demand latency in the result.
5. Measure multi-wallet capacity after online latency and sustained refill satisfy their acceptance targets.

Keep wallet-seed recovery, standard FIPS export, and single-use protections throughout these steps.
GPU work remains deferred.

- [AES equivalence and timing screen](../evidence/ml-dsa-65-wide-aes-screen-20261016.json).
- [Independent compiled-code review](../evidence/ml-dsa-65-wide-inspection-20261016.json) and [reproduction scripts and instruction evidence](../evidence/ml-dsa-65-wide-inspection-evidence-20261016.json.gz).
- [Native correlation checks](../evidence/ml-dsa-65-wide-correlations-20261016.json) and [canonical-key and recovery checks](../evidence/ml-dsa-65-wide-native-20261016.json).
- [Raw local profiles](../evidence/ml-dsa-65-wide-candidate-profile-20261016.json.gz), [preparation summary](../evidence/ml-dsa-65-wide-preparation-summary-20261016.json), and [signing summary](../evidence/ml-dsa-65-wide-signing-summary-20261016.json).
- [Matching-observer control](../evidence/ml-dsa-65-wide-matched-observer-local-20261016.json.gz), [its summary](../evidence/ml-dsa-65-wide-matched-observer-summary-20261016.json), and [raw calibration profiles](../evidence/ml-dsa-65-wide-calibration-20261016.json.gz).
- [Unprofiled local repeat](../evidence/ml-dsa-65-wide-unprofiled-local-20261016.json) and [earlier online profile](../evidence/ml-dsa-65-wide-baseline-online-20261016.json.gz).
- [Hosted registration and recovery](../evidence/ml-dsa-65-wide-registration-hosted-20261016.json), [sustained client results](../evidence/ml-dsa-65-wide-sustained-hosted-20261016.json), and [stock/throughput summary](../evidence/ml-dsa-65-wide-sustained-summary-20261016.json).
- [Sanitized hosted traces](../evidence/ml-dsa-65-wide-hosted-traces-20261016.json), [two-batch comparison](../evidence/ml-dsa-65-wide-two-batch-comparison-20261016.json), and [source/build provenance](../evidence/ml-dsa-65-wide-provenance-20261016.json).

The independent review verifies all twelve retained signatures. Altered messages and altered signatures fail verification.
See the [signature verification receipt](../evidence/ml-dsa-65-wide-hosted-signature-verification-20261016.json) and [independent stock ledger](../evidence/ml-dsa-65-wide-hosted-stock-verification-20261016.json).

All ten temporary Workers owned by the interrupted and replacement campaigns were deleted.
Fresh benchmark credentials, private fixture directories, and raw tails were removed after scanning the retained artifacts for credential values.
The bloat check retains the inherited duplication failure: Rust 13,984 lines and TypeScript 10,304 lines.
These changes do not increase either count. The baseline file remains unchanged.
