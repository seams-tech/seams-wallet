# ML-DSA ready pool and rollover

Status: experimental, 2026-10-15. Preparation optimization is deferred at the user's request.
The user accepts approximately 10–20 seconds of preparation for now. Preprocessing remains on Workers.
The measured hosted range is 19.26–22.24 seconds per four-candidate batch.
Feasibility and integration work can proceed. Production release still needs the checks in the investigation plan.

## Hosted results

The [generated summary](../evidence/ml-dsa-65-ready-pool-screen-20261015.json) covers four complete sessions on two temporary Workers.
Registration starts after keygen tables and generic signing material are prepared.
It includes streamed R2 reads, canonical key derivation, key-manifest checks, and pool binding.
Signing includes lazy commitment activation, exhausted batches, automatic rollover, and both Worker verifiers.
The external client verifies each standard signature with OpenSSL and rejects an altered message.

| Measurement | Observed result |
| --- | ---: |
| Registration, four sessions | 1.978–2.676 s |
| Successful signing, 23 requests | 0.214–1.321 s |
| Nonempty-pool signing requests | 26: 23 successful, 3 exhausted |
| Successful automatic rollovers | 11 |
| Registration through first signature, ten-batch initial pool | 2.287–3.414 s, three sessions |
| Registration through first signature, one-batch initial pool | 206.728 s, including exhaustion and refill |
| One-batch refill | 19.256–22.245 s, three observations |
| Ten-batch refill | 203.219 s, one observation |
| Initial keygen plus signing preparation | 49.5–259.3 s |
| Maximum Wasm linear memory | 112,918,528 bytes |

A batch contains four candidates. Ten batches contain forty candidates, with no guarantee of ten successful signatures.
Group preparation is sequential. The ten-batch result gives 20.322 seconds per batch on average and establishes no parallel speedup.
All successful requests meet five seconds. These finite samples do not establish p95, p99, or an empty-pool success guarantee.
The three exhausted requests remain failures in the summary.
Wasm memory excludes JavaScript and other isolate allocations. Concurrent pools and capacities above ten remain unqualified.

The [initial-ten campaign](../evidence/ml-dsa-65-ready-pool-hosted-ten-20261015.json) and [refill-ten campaign](../evidence/ml-dsa-65-ready-pool-hosted-refill-ten-20261015.json) retain every request.
The latter demonstrates the long wait when registration consumes its only available batch without a signature.
Fixture 8 exercises real adaptive SHAKE continuation during canonical key generation.

One refill batch transfers 4,483,008 protocol bytes. Ten transfer 44,827,776 bytes.
A successful request that consumes one batch transfers 2,392,644 bytes online.
Each extra exhausted batch adds 2,382,148 bytes. Repeated failures increase cost per successful signature.
These counters exclude transport envelopes, command frames, and R2 traffic.
Initial keygen preparation is separate from recurring signing preparation.
The initial pool's reported preparation byte count includes both keygen and generic signing preparation.

The [sanitized traces](../evidence/ml-dsa-65-ready-pool-worker-traces-20261015.json) contain four complete invocations per role at the recorded versions.
Their aggregate CPU time is 950,691 milliseconds across both roles.
Request IDs were redacted. Version and invocation counts support aggregate attribution, without an exact per-session trace join.
CPU includes complete sessions, preparation, signing, probes, and cleanup.

## Implemented lifecycle

The pool shares immutable public circuit topology and packs retained Boolean correlations into bytes.
Each four-candidate batch retains 1,919,164 private bytes. Ten retain 19,191,640 bytes.
One public topology allocation is shared across batches. Its measured native allocation is 61,434,392 bytes.
Wasm uses narrower indices. Retained allocation counts exclude scratch space and allocator overhead.

Generic preparation receives no wallet key, seed, epoch, or message.
Activation consumes the generic pool and binds it to a canonical key and epoch.
Each signing request binds its operation ID, message, context, and ordered remaining reservations.
The pool removes a reservation before activation and signing. It automatically consumes the next batch after exhaustion.
Only untouched batches remain available for later requests.
Operation IDs and refill IDs cannot repeat within the live pool.
An empty request returns an explicit result and consumes its operation ID.
A failed or canceled asynchronous operation poisons the pool and drops its private state.

The [native lifecycle E2E](../evidence/ml-dsa-65-ready-pool-native-20261015.json) verifies eight signatures and three successful rollovers.
It checks canonical recovery, changed-message replay, refill replay, empty pools, and cancellation followed by a rejected retry.
The cancellation fixture stops at the first transport await. It does not measure a physical wipe or interrupt an active Worker exchange.
The [mixed-circuit E2E](../evidence/ml-dsa-65-packed-gmw-native-20261015.json) covers partial-byte and multiword correlation groups.

Refill currently holds the pool exclusively. Concurrent signing during refill is not implemented.
The pool is in memory. Durable reservation, rollback protection, restart handling, and production admission remain open.
A persistent adapter must burn generic state before activation and message-bound state before signing.
Each role must store only its own private material.
Independent source review found no blocking lifecycle defect within this disposable passive prototype.

## Preparation work completed before deferral

RustCrypto AES 0.9.1 and Wasm SIMD reduced local generic preparation from 13.12–13.47 seconds to 9.39–9.45 seconds.
The AES-only and SIMD observations use the same single-batch benchmark boundary.
The [AES-only control](../evidence/ml-dsa-65-aes09-worker-local-20261015.json) and [SIMD control](../evidence/ml-dsa-65-aes09-simd-worker-local-20261015.json) retain all outcomes.
The [correlation E2E](../evidence/ml-dsa-65-aes09-correlations-native-20261015.json) verifies every generated triple and shared AND.
The [packaged Wasm inventory](../evidence/ml-dsa-65-ready-pool-wasm-20261015.json.gz) includes deduplicated AES helpers.
This is targeted instruction and data-flow evidence, not complete V8 constant-time qualification.

A larger correlation-copy loop and fat LTO showed no material improvement. Neither change is retained.
Their [bulk-copy control](../evidence/ml-dsa-65-bulk-trial-worker-local-20261015.json), [reproduction patch](../evidence/ml-dsa-65-bulk-trial-20261015.patch.gz), and [LTO control](../evidence/ml-dsa-65-lto-trial-worker-local-20261015.json) preserve the experiment results.

A final public encoder change reduced local generic preparation to 8.15–8.27 seconds.
It visits set bits in a public matrix byte instead of checking all eight bits separately.
The coordinate sequence is unchanged: each iteration removes the lowest set bit and visits its original offset.
Wraparound uses the same subtraction. Matrix bytes and dimensions are public. Secret coefficients enter only XOR updates.
Independent review checked this mapping and public-data control flow.
The [isolated comparison](../evidence/ml-dsa-65-public-encoder-comparison-20261015.json) records matching output prefixes for four repeated full-size fixtures.
The [complete local Worker run](../evidence/ml-dsa-65-public-encoder-worker-local-20261015.json) and [native recovery/lifecycle run](../evidence/ml-dsa-65-public-encoder-native-20261015.json) pass.
The final native pool run verifies seven signatures and two successful rollovers.
This encoder change has no hosted timing qualification. The hosted results above precede it.
The optimization task stopped before a hosted rerun, as requested by the user.

The [earlier profile](../evidence/ml-dsa-65-preparation-profile-before-20261015.json) and [SIMD profile](../evidence/ml-dsa-65-preparation-profile-simd-20261015.json) retain local V8 samples.
They cover whole requests and can perturb latency. They do not attribute hosted billed CPU to individual functions.

## Evidence and limits

| Fact | Instrument | Scope |
| --- | --- | --- |
| Successful prepared operations meet five seconds | External client timers and independent signature verification | Four hosted sessions |
| Empty pools break the success deadline | Complete one-batch session, including refill | One observed 206.728-second first signature |
| Grouping does not shorten preparation | One-batch and ten-batch client timers | Sequential group API |
| CPU work affects preparation | AES/SIMD controls and public encoder control | Local workerd only |
| Replay and cancellation consume state safely | Separate-process lifecycle E2E and source review | In-memory ownership, first-await cancellation |

| Candidate cause of slow refill | Evidence | Conclusion |
| --- | --- | --- |
| Repeated private correlation work | Refills scale approximately with batch count | Fits |
| Public encoder and portable AES cost | Local profiling and controlled implementation changes | Fits local behavior |
| Only network transfer causes the delay | CPU-side changes reduce local complete latency | Insufficient explanation |
| Benchmark clocks distort timing | Hosted Worker clock limitation is known | Use external client timers; profiler remains diagnostic |
| Production Router behavior | No production route in this benchmark | Unknown |

Production parity is not established. Durable storage, Router admission, concurrency, and sustained replenishment require their own E2E evidence.
Wallet-seed recovery and standard FIPS seed/key export remain required.
The passive model, LPN assumption, classical base OT, and direct-random-nonce signing distinction remain unchanged.
See the [prepared-signing review](ml-dsa-65-prepared-signing-review.md) for the disclosure boundary.
The [investigation plan](ml-dsa-65-investigation-plan.md#immediate-work-queue) defines the integration sequence.

## Cleanup

Both temporary Workers and their R2 bucket were deleted. The disposable token and raw trace files were removed.
The [cleanup record](../evidence/ml-dsa-65-ready-pool-cleanup-20261015.json) records these actions. Production services were unchanged.
