# ML-DSA producer calibration and masked-shift experiment

The masked-word AES transpose provides no consistent useful preparation gain. The prototype is removed.
Its outputs are correct, its source review finds no new secret-dependent control or addresses, and candidate-generated material signs standard ML-DSA-65 messages.
Its producer CPU improvement over one control does not repeat against the return control.
Production cryptographic source and local Worker artifacts are restored to the selected baseline.

The fresh instrumented Workers again complete four-candidate jobs in roughly 9–11 seconds.
This does not establish a production speedup over the preceding 17-second campaign.
Calibration changes first-touch and warmup conditions. The cause of the broader CPU variation remains unresolved.

## Complete comparison

Two synthetic wallets retain thirty-two candidates each, represented by sixteen independently consumable pairs.
Preparation stays on Workers. Signing consumes two candidates at a time.
The policy retains the sixteen-candidate admission minimum, sixty-second cooldown, and one active signing operation.
Two preparation slots are experimental. The production default remains one slot.
Wallet-seed recovery, canonical FIPS export, separate participant custody, and the passive model remain unchanged.

Each cost window retires thirty-two unused pairs, publishes thirty-two distinct fresh pairs, and restores both full reserves.
These screens measure preparation cost. They do not measure sustainable signatures/minute or public SDK latency.

| Window | Primary / secondary jobs | Paired producer invocation CPU | Client observes restored reserves | Latest paired publication checkpoint |
| --- | ---: | ---: | ---: | ---: |
| Initial control | 9 / 7 | 142.282 s | 93.979 s | 88.737 s |
| Matched-route baseline | 9 / 7 | 149.294 s | 99.318 s | 96.287 s |
| Masked-word candidate | 8 / 8 | 148.516 s | 96.999 s | 95.538 s |
| Return control | 10 / 6 | 144.013 s | 98.189 s | 97.019 s |

CPU includes both participant invocations for every complete job, including publication and terminal work in those invocations.
It excludes controller, Router, pool-actor, calibration, and collector CPU. It is not a billing total.
Client restoration includes five-second inventory polling. Checkpoint clocks have limited precision.
The unequal slot allocation is also a comparison limit.

The candidate uses 0.5% less paired CPU than the matched-route baseline and 3.1% more than the return control.
Its publication and restoration fall within control variation.
Per-slot CPU changes are mixed. These results support rejection rather than a causal regression percentage.

| Window | Primary A / B CPU medians | Secondary A / B CPU medians |
| --- | ---: | ---: |
| Initial control | 3.852 / 4.075 s | 4.442 / 4.831 s |
| Matched-route baseline | 3.935 / 4.574 s | 4.826 / 4.708 s |
| Candidate | 4.070 / 4.118 s | 4.713 / 4.777 s |
| Return control | 3.932 / 4.081 s | 5.169 / 5.041 s |

All sixty-four selected jobs complete successfully with matching versions and no truncated crypto record.
Every window's final IDs match both participants' fresh publication IDs.
No retired pair returns. All 128 fresh pair IDs across the four windows are distinct.
This replaces the same fixed reserve each time, so larger pools cannot explain the result.

## What calibration establishes

The diagnostic module runs fixed public-input SIMD AES, scalar AES, a small public encoder workload, and an empty control.
It uses three fixed public seeds. AES results match an independent native AES reference.
The module declares a four-MiB linear-memory maximum. Local observed allocation is 1,703,936 bytes.
Combined core-Wasm, auxiliary-Wasm, JavaScript, and native memory peaks remain unqualified.

A's workload runs inside the same named Producer Durable Object.
B's workload initially uses a direct front-to-B service call.
Those direct B calls have no software-instance match to protocol B invocations, so their readings cannot explain protocol CPU.
Routing B calibration through A's actual `DERIVER_B` binding improves matching in the later cohorts.
A change of caller and a deployment also occur at this boundary. The experiment does not isolate the cause of the earlier mismatch.

Eligibility requires the same role, JavaScript module UUID, core-Wasm instance epoch, and actor identity.
These identify software instances. They do not identify physical hardware or placement.
The auxiliary module stays unchanged across candidate and control deployments.

| Window | Eligible calibration samples | Total samples |
| --- | ---: | ---: |
| Initial control | 48 | 96 |
| Matched-route baseline | 74 | 96 |
| Candidate | 72 | 96 |
| Return control | 72 | 96 |

The initial direct-B subset has zero eligible samples out of forty-eight.
Unmatched samples remain in the archive and are excluded from protocol-instance comparisons.

| Window | Primary A / B eligible SIMD AES CPU medians | Secondary A / B medians |
| --- | ---: | ---: |
| Initial control | 294.5 ms / unavailable | 307.5 ms / unavailable |
| Matched-route baseline | 305 / 368 ms | 311 / 317 ms |
| Candidate | 303 / 387 ms | 320 / 321 ms |
| Return control | 289 / 283 ms | 332 / 327 ms |

These controls show variation for unchanged fixed workloads.
They do not isolate host contention, placement, runtime tiering, or compiler behavior.
Per-role empty controls remain necessary because B's diagnostic authentication also derives a public recipient key.
Raw A/B HTTP differences cannot isolate computational speed.

The calibration working set, code layout, and separately compiled module differ from production.
The encoder control uses a smaller public working set than production.
Calibration cannot directly establish stage CPU or predict a speedup.
It also first touches A producer objects before ordinary wallet setup, which can affect warmup or placement.
The fresh 9–11-second jobs therefore remain an instrumented observation, without a code-gain claim.

## Non-overlap and timestamp limits

Heavy calibration and fresh replacement work run in separate ordered phases.
A refuses calibration while its alarm is active.
B's HTTP WebSocket upgrade return is not completion of its asynchronous preparation.
Post-job calibration waits for both participants' complete publication records.
Cloudflare documents that Tail Workers receive events after producer execution finishes. [Tail Workers documentation](https://developers.cloudflare.com/workers/observability/logs/tail-workers/).

The initial capture barrier checks only already-observed A receipts and misses one delayed A record.
A later capture contains that complete record. No material is missing.
The corrected barrier requires every expected final pair at both participants before continuing.
The incomplete snapshot and later complete snapshot remain retained.

Provider timestamp metadata does not always bound the logs.
For initial B record 35, `eventTimestamp` is 1793179774172 and `wallTime` is 8611 ms.
Its protocol logs run from 1793179808577 through 1793179815919.
The cause of that mismatch remains unresolved. The raw provider values are preserved.

Overlap checks therefore use the envelope of provider metadata and retained log timestamps, with instance matching.
That wider check finds zero eligible heavy-calibration overlaps in all four windows.
It corroborates the ordered execution and A's runtime guard. It does not establish an exact cross-host timeline.
The derived `all_outcomes` field remains an event-timestamp cohort, rather than all work causally belonging to a window.
Paired CPU accounting includes B through exact job identity, including records outside that timestamp cohort.

## The rejected optimization

The eight-block AES path transposes private bit planes before and after encryption.
The prototype replaces byte-lane shifts with masked 64-bit-lane shifts.
It keeps the AES equations, inputs, outputs, protocol messages, domains, and stored formats unchanged.
No dependency, protocol parameter, recovery rule, or pool setting changes.

The masks discard cross-byte contributions from the right shift and prevent left-shift carry.
Both transforms are linear over GF(2), the field with two values.
Equality on the complete input basis therefore proves equality on every input pair.
All 771 zero/basis cases pass for the three actual shift/mask pairs, including the 64-bit lane boundary.
The independent reviewer reproduces this proof and checks all caller indices.

The full-byte Wasm screen passes against RustCrypto AES for 256 keys and 256 blocks per key.
Partial correlation batches zero through thirty-three also pass, including unchanged suffixes.
Isolated SIMD medians are 5.9440 and 5.9392 ms, with a paired median ratio of 1.0017.
The candidate is slower in eleven of twenty pairs. No isolated speedup is established.
Scalar control timings also vary despite unchanged scalar source.

The source review finds only public fixed indices, masks, and shifts.
By-value casts add no aliasing or alignment-dependent accesses.
Named state and key erasure remain unchanged. Register and compiler-temporary erasure retain their earlier limits.
This is a focused source/equivalence review, rather than a complete protocol audit.

Two hosted signatures consume three and two pairs from the candidate window's fresh stock.
Both standard signatures verify independently. Altered messages fail verification.
Both participants agree on their exact take sequences and public-key digests.
The two wallets also pass canonical creation and wallet-seed recovery during setup.

## Retained changes, failures, and next work

The runtime prototype is removed. Baseline cryptographic source and local build artifacts are restored.
The reusable AES screen now says that its harness does not modify checked-in source.
This corrects a misleading generic sentence when the tool measures an already-modified candidate.
Measured artifacts retain their original text and hashes.

Local diagnostic setup catches two harness errors: an export lint rejects raw C symbols, and Workers rejects global-scope random ID creation.
Their corrected runs pass. These are measurement setup failures, with no production cryptographic repair.
Review also catches an ambiguous A diagnostic auth check. Empty configuration now fails closed before calibration.
All local missing-credential and empty-configuration refusal checks pass.

The complete hosted capture includes four earlier Router exceptions, outside the first comparison window.
They remain retained. The report limits its successful-invocation claim to qualified protocol jobs.

| Cause or hypothesis | Evidence | Status |
| --- | --- | --- |
| Changed core code explains the earlier slow baseline | Frozen core Wasm matches the earlier selected implementation | Unsupported |
| Any B calibration diagnoses B protocol speed | Direct B samples have no matching protocol instances | Rejected |
| Provider metadata alone gives an exact timeline | Some log spans fall outside `eventTimestamp + wallTime` | Rejected |
| Masked-word shifts improve complete preparation | CPU benefit does not repeat against the return control | Rejected as a retained optimization |
| Calibration itself changes conditions | It changes first-touch, warmup, code, and memory footprint | Remains a confound |
| Execution conditions contribute to CPU variation | Fixed workloads vary, with incomplete placement information | Unresolved |

The next useful comparison should separate first-touch/warmup effects from ordinary uninstrumented execution.
It should retain exact instance identities and complete job accounting.
Further correlation optimizations need a repeated hosted gain before inclusion.
The six-second preparation target and sustained four-wallet throughput target remain open.
GPU and dedicated-server preprocessing remain deferred.

All eight temporary Workers are deleted, with independent absence checks.
The required bloat check retains its inherited Rust duplication failure: 13,992 lines against the 13,754-line baseline.
No baseline is weakened.

[Replayable evidence](../evidence/ml-dsa-65-producer-calibration-20261028.json) contains raw captures, exact versions, proofs, signatures, calibration eligibility, and cleanup receipts.
