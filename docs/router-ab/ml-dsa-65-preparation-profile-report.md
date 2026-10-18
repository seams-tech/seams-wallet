# ML-DSA preparation profiling and measurement coverage

Date: 2026-10-18. Status: experimental, with production release gated.

The changes reduce isolated AES and encoder time, with a 1.97% reduction in one complete local reserve comparison.
Hosted candidate preparation takes a median 11.338 seconds per four-candidate group.
Captured preparation work remains 35.738 seconds per successful signature. Fifteen of seventeen successful signatures finish below five seconds.
Neither performance target is qualified. Hosted placement, CPU variation, and different rejection workloads prevent a causal speedup claim.

## Scope

This campaign measures the preparation pipeline and tests two local optimizations.
Preparation stays on Cloudflare Workers. Each wallet retains thirty-two prepared candidates.
Four candidates form one preparation and consumption group. Admission requires sixteen ready candidates.
The service permits one active signer and one preparation producer.
Wallet-seed recovery, standard FIPS seed/key export, and the passive server-blind model remain unchanged.
GPU work remains deferred.

The saturation benchmark uses a one-second wallet cooldown to expose refill limits.
The production cooldown remains sixty seconds. These measurements do not qualify production capacity or latency percentiles.

## CPU profile and changes

The calibrated local Worker baseline attributes 58.60% of A's samples and 50.45% of B's samples to private AES.
Public matrix encoding accounts for 21.10% and 21.56%. Preparation-loop work accounts for 11.11% and 14.37%.
Inlining limits these categories. Sample percentages describe CPU activity, not complete elapsed preparation time.

The AES adapter now encrypts complete eight-block buffers in place.
The caller already owns an erased secret buffer. Removing the extra copy preserves the AES permutation and working-state erasure.
Partial chunks retain an erased padding buffer. Branches depend on public lengths.

The Wasm accumulator now scans one public twenty-five-bit mask for the twenty-four-coefficient configuration.
The final bit represents the mandatory update. Set bits retain the original ascending update order.
The matrix seed, random stream, XOR inputs, wrapping, and encoder output remain unchanged.
Other configurations and native instruction paths retain their existing implementation.

## Measurement coverage

Producer records now carry explicit job IDs, material IDs, and public key scope.
An entry record identifies the producer before its first await.
This can connect an interrupted alarm to its queued job without reconstructing an identity from timing.
Cancellation before the handler starts can still lack an identity.

Signing records identify the exact material taken and checked by each participant.
Immediate events retain evidence when the final aggregate trace is missing.
The coverage summary includes unsuccessful operations and checks for material reuse across operation IDs.
A taken event follows the durable reply. A lost reply can hide a committed burn, so absent events never prove unused material.

Preparation boundaries cover load, cryptographic execution, serialization, sealing, and publication.
Transport counters cover cryptographic payload bytes. They exclude frame headers, storage HTTP, and final handshake messages.
Pending-event counts describe asynchronous waits. They are neither elapsed wait times nor network round-trip counts.
Worker service clocks can omit CPU time. Boundary deltas therefore remain clock observations, not elapsed stage measurements.
The publication boundary excludes the final flush, acknowledgement, and connection close.

Both hosted builds include the same instrumentation. Added logging can affect their absolute performance.
Preparation cost uses captured producer-A invocation wall time. Peer time is reported separately and is never added to it.
Complete demand time includes pool waits. Successful signing HTTP time uses a narrower boundary.

## Cause table

| Candidate cause | Measured evidence | Assessment |
| --- | --- | --- |
| Private AES computation and copying | About 50–59% of local CPU samples | Main CPU target. The copy change affects only part of this work. |
| Public matrix encoding | About 21% of local CPU samples | Secondary CPU target. Preserve the exact public code. |
| Public AES random-stream refill | Only 43 A self samples in the baseline | Insufficient evidence to prioritize a new cache. |
| Storage and protocol waits | Hosted invocation times and public boundary records | Report separately. Local CPU percentages cannot measure them. |
| Measurement overhead | Both builds contain the same trace fields | Absolute timings include this overhead. |
| Hosted placement and CPU variation | Sequential deployments cannot control physical placement | A small hosted difference alone cannot establish an optimization gain. |

## Validation boundary

The isolated AES screen compares the old copying adapter with the borrowed-buffer adapter in the same Wasm module.
It checks full outputs against RustCrypto for 256 keys, including partial lengths and unchanged suffixes.
The encoder screen compares complete old and new outputs for Block and byte coefficients.
It covers four dimensions, three seeds, four accumulator widths, and one or two accumulation passes.
Timing uses warm-up and alternating order. Probe results establish no complete Worker speed claim.

Source review checks public branches, unchanged update order, and retained erasing owners.
Compiled Wasm inspection records the exact packaged functions and their source-symbol map.
These checks do not certify register erasure, the runtime JIT, or malicious-party security.

The hosted campaign runs creation and recovery for two wallets per build.
It starts with full reserves, applies ten minutes of saturation, restores both reserves, and drains trace delivery.
Rejected candidates, failed operations, missing traces, and canceled alarms remain in the evidence.


## Local results

| Measurement | Baseline | Candidate | Change |
| --- | ---: | ---: | ---: |
| AES adapter, isolated Wasm median | 8.400 ms | 8.083 ms | 3.78% lower |
| Complete encoder, isolated Wasm median | 59.915 ms | 55.247 ms | 7.79% lower |
| Full reserve, profiled local Worker | 50.105 s | 49.117 s | 1.97% lower |

The kernel medians each use twenty alternating repetitions after warm-up.
The complete reserve comparison observes 1.97% lower time in one profiled run per build. It establishes no repeatable improvement or percentile guarantee.
Both local Worker fault campaigns pass. Both native campaigns reproduce canonical keys in all six key-generation cases.
The optimized local profile still attributes about 50–58% of samples to private AES and about 21% to matrix encoding.

The measured source snapshot precedes a formatting-only change to Rust 2021 import order in two files.
No executable statement changed. The snapshot and packaged Wasm hashes remain in the provenance evidence.


## Baseline hosted coverage

The baseline verifies nineteen successful signatures in 1.166–3.289 seconds, with a 1.957-second median.
Three additional operations exhaust their candidates. Successful demand, including capacity waits, reaches 202.393 seconds.
After the initial stock is consumed, observed aggregate throughput is 1.267 successful signatures per minute.

The Router and inventory ledger balances forty-three consumed and replenished groups, or 172 candidates.
Successful operations consume thirty-one groups. The three exhausted operations consume twelve groups.
All forty-three replenished groups have completed producer records. Their invocation wall times total 700.779 seconds.
Another forty-three canceled alarms contribute 1.378 seconds and report zero captured CPU.
Captured producer work therefore totals 702.157 seconds, or 36.956 seconds per verified signature.
This includes failed-operation replenishment and final reserve restoration.

Explicit complete participant traces match fourteen of nineteen successful operations.
The other five account for six groups with Router outcomes and no retained participant events.
Immediate events retain all twelve groups used by exhausted operations.
No captured nonzero-work producer invocation lacks a job identity.
Canceled alarms remain unidentified, and the accounting flag stays conservative.

Whole-campaign coverage includes registration and recovery. It contains sixty-four attributed alarms and sixty-four canceled alarms.
These counts differ from the load/restoration window above. The evidence keeps both windows separate.


## Hosted comparison

| Measurement | Instrumented baseline | Optimized candidate |
| --- | ---: | ---: |
| Verified load signatures | 19 | 17 |
| Successful signing below five seconds | 19/19 | 15/17 |
| Successful signing median | 1.957 s | 2.996 s |
| Successful signing range | 1.166–3.289 s | 1.079–5.913 s |
| Exhausted admitted operations | 3 | 1 |
| Four-candidate preparation median | 15.391 s | 11.338 s |
| Four-candidate preparation range | 9.990–29.209 s | 9.789–26.174 s |
| Captured preparation work per successful signature | 36.956 s | 35.738 s |
| Full reserve-to-reserve cycle per successful signature | 46.334 s | 45.436 s |
| Median successful demand, including waits | 45.693 s | 65.534 s |
| Maximum successful demand, including waits | 202.393 s | 139.891 s |
| Unfinished demands at cutoff | 2 | 2 |
| Waits already spent by unfinished demands | 21.825 / 80.996 s | 96.789 / 120.587 s |
| Signing after initial stock depletion | 1.267/min | 1.408/min |
| Online registration/recovery range | 4.065–5.721 s | 4.451–5.811 s |

Both runs consume and replace forty-three groups, or 172 candidates.
Both start and end with thirty-two candidates per wallet. Their material identity ledgers balance.
The candidate's completed preparation invocations total 606.196 seconds.
Canceled alarms add 1.357 seconds during load and reserve restoration, giving 607.553 seconds of captured work.
All forty-three published groups have duration records. No preparation failure occurs in either load/restoration window.

The candidate's whole campaign includes two unsuccessful preparation jobs for earlier key epochs during registration/recovery.
Their work remains in the full campaign evidence. The table's preparation-cost denominator covers the later signing load and reserve restoration.
Initial preparation for candidate registration/recovery takes 55.730–97.203 seconds per ceremony, before the online registration interval.
These costs must remain visible when no generic or signing material is ready.

The candidate has complete matching peer traces for all seventeen successes and all forty-three consumed groups have immediate Taken events.
Its whole campaign has sixty-two attributed alarms and sixty-two unassigned canceled alarms, with no captured unidentified nonzero-work invocation.
Both load/restoration windows have forty-three unassigned canceled alarms. The conservative incomplete-attribution flag remains set.

Each completed four-candidate cryptographic exchange sends 3,497,472 payload bytes from A and 985,280 from B.
The total remains 4,482,752 bytes in both builds. This excludes frame headers, storage HTTP, and final handshake messages.

The candidate has seven successful three- or four-group requests. The baseline has two.
The candidate also has slower one- and two-group requests, so rejection sampling alone does not explain the online difference.
The candidate has a worse signing median, a worse successful-demand median, and longer unfinished-demand waits.
Its lower preparation median is much larger than the local difference. The experiment does not isolate placement, runtime variation, or complete-build effects.
Retain the measured kernel improvements as small optimizations. Do not claim a 26% production speedup from the hosted median difference.

All thirty-six load signatures pass an independent OpenSSL verification pass. Altered messages and signatures are rejected.
Both wallets reproduce the same canonical public keys across creation, recovery, and both builds.
All ten temporary Workers are deleted after collection.

## Evidence and reproduction

- [Comparison](../evidence/ml-dsa-65-preparation-profile-comparison-20261018.json)
- [Hosted clients, sanitized traces, and stock records](../evidence/ml-dsa-65-preparation-profile-hosted-20261018.json.gz)
- [Native checks, local E2Es, and CPU profiles](../evidence/ml-dsa-65-preparation-profile-local-20261018.json.gz)
- [Source snapshots, scripts, build hashes, and instruction review](../evidence/ml-dsa-65-preparation-profile-provenance-20261018.json.gz)
- [Validation and cleanup](../evidence/ml-dsa-65-preparation-profile-validation-20261018.json)

The provenance bundle contains the deployment, load, comparison, and packaging scripts.
The hosted bundle retains the exact client and trace inputs. Recompute coverage with `summarize_preparation_coverage.py`.
Recompute CPU categories with `summarize_preparation_profile.py` and the matching symbol sidecars.
The isolated screens are `run_private_aes_screen.py` and `run_encoding_screen.py`.
The exact measured source snapshot preserves the import order used by the packaged Worker build.

The bloat gate still fails at inherited duplication counts: Rust 13,984 versus 13,754, and TypeScript 10,238 versus 10,216.
This change preserves those counts and leaves the baseline unchanged.

## Next measurements

1. Repeat matched hosted controls before attributing small elapsed-time changes to the kernels. Keep group width, capacity, and admission unchanged.
2. Close the participant trace-delivery gap. Retain the Router ledger and explicit job IDs while investigating missing invocation records.
3. Profile the remaining private AES work and bounded overlap between participants. Measure complete producer cost before adopting another kernel or scheduling change.
4. Repeat paced multi-wallet tests with the production cooldown. Include rejected candidates, failed operations, empty waits, and full reserve restoration.

The current changes preserve the protocol. They do not establish the 5–10-second preparation target or consistently sub-five-second online signing.
Larger pools would change the wait distribution without reducing preparation work. They remain outside this comparison.
