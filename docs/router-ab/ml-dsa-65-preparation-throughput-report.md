# ML-DSA preparation cost and refill throughput — October 16, 2026

All twelve hosted signatures verify. Their successful online requests take 1.34–3.55 seconds.
The median is 2.61 seconds. One signature consumes two batches, or sixteen evaluated candidates.
Supply remains the bottleneck. After initial stock depletion, eight signatures take 603.61 seconds, or 0.795 signatures per minute.
This short, reset-affected run falls below one signature per minute. It does not demonstrate sustained one-per-minute capacity.

| Measurement | Hosted result |
| --- | --- |
| Successful online request | 1.34–3.55 s, median 2.61 s, 12 independently verified signatures |
| Demand including capacity waits | 1.34–175.97 s, median 52.55 s |
| Post-initial-stock signing rate | 8 signatures / 603.61 s = 0.795 per minute |
| Consumed material | 13 unique batches, 104 evaluated candidates, no repeated batch identity |
| Observed refill after initial stock | 9 new paired batches / 603.61 s = 0.895 batches per minute |
| Known completed batch preparation | 41.08–80.93 s, median 50.91 s, eight candidates per batch |
| Requests | 436 total: 12 successful, 212 unavailable, 212 declined replays |
| Complete demands under five seconds | 3 of 12 |
| Minimum initial preparation | 151.36 s creation, 189.84 s recovery, two batches each |
| Prepared registration | 4.975 s creation, 6.040 s recovery |

This campaign keeps eight candidates per batch and a four-batch ready target.
It preserves canonical wallet-seed recovery, standard FIPS seed/key export, and the passive two-participant model.
GPU and native preparation services remain deferred. Public Wallet integration remains gated.

## Changes under measurement

1. Reuse the existing four-block AES implementation for private PPRF expansion and triple hashing on Wasm.
2. Dispatch refill computation to separate A and B Worker services. Each service stays within its own participant's trust boundary.
3. Yield to the event loop after eight public preparation transport calls. Online signing and keygen execution do not use this scheduling mode.
4. Commit public garbled-table writes in groups of 16. Flush the final group before publishing private preparation.
5. Bind prepared-batch publication to the exact durable producer claim and its deadline.

The pool target remains four batches. The service still permits one producer and one admitted signing operation at a time.
The saturation test uses the existing configurable one-second cooldown. The product default remains 60 seconds.
Each test targets twelve verified signatures and retains every refusal, failed operation, and client error.
Final HTTP latency, complete demand latency including retries, and throughput after initial stock depletion are separate measurements.

## AES control and security boundary

The previous AES 0.9.1 dependency already selects 64-bit fixslicing on Wasm.
This change compares wrappers and generated code. It does not change from a 32-bit algorithm to a 64-bit algorithm.
Fixed AES keys, input ordering, the XOR after encryption, correlation dimensions, and fresh randomness remain unchanged.
The adapter uses the existing reviewed AES code on Wasm and RustCrypto on native targets.
Batch lengths and padding depend on public dimensions. Temporary block buffers are wiped.

The public-input Wasm screen contains eight paired measurements of 262,144 blocks.
Median times are 19.117 ms for the prior path and 12.807 ms for the reused path, a 33.01% reduction.
All 128 input bits vary. The timing screen compares a 32-bit output checksum, not every output byte.
Four existing AES tests separately pass full-output vector and differential checks, including 2,000 generated key/block groups.
This screen does not establish a complete preparation speedup on Cloudflare.

## Execution separation and scheduling

A's durable pool retains admission coordination, reconciliation, and the producer lease.
It dispatches an authenticated job through `ML_DSA_PREPARER`. A producer Durable Object returns a durable queue receipt.
An independent alarm runs preparation. The pool actor waits only for that receipt.
The producer commits `Running` before randomness generation. A retried `Running` job is abandoned, with an unknown publication outcome.
The producer records completion before releasing the global lease. Terminal retries repeat only idempotent lease settlement.
An error after durable publication can still leave usable paired stock. Inventory determines whether that stock exists.
A watchdog supports crash recovery. It cannot interrupt its own running alarm.
The producer services communicate through the existing WebSocket protocol and publish only their own encrypted preparation.
Their pool namespace bindings point to the existing role-owned stores.
The producer path does not load signing material. Its own-role wrapping key and storage binding remain broader capabilities than that path uses.

[Cloudflare documents same-thread execution as the default for service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/).
Separate services therefore do not prove separate CPU scheduling.
The local service-only control verifies three signatures, but background work delays an independent one-second timer to 19.224 seconds.
Its idle timer measures 1.015 seconds. Its stalled signing peer closes after 0.956 seconds.
Classification: a production responsiveness failure under concurrent preparation. The test tolerance remains unchanged.

The correction yields after every eight preparation `send` or `receive` calls through a zero-delay timer.
The cadence depends on public protocol structure. It adds no protocol messages and changes no frame order or acknowledgment rule.
Each peer resumes independently. The transport checks its deadline again after a yield.
This does not bound synchronous work between those boundaries.

The local cooperative control passes. Its refill-concurrent timer takes 1.132 seconds, and its stalled peer closes after 0.962 seconds.
Three verified signatures take 0.534, 0.249, and 0.302 seconds. The full four-batch refill takes 73.499 seconds.
The earlier service-only control takes 76.061 seconds for that reserve.
These are separate small runs with different randomness and host activity. They do not isolate a preparation speedup.

The asynchronous local check passes with the final release bundles.
Inventory takes 49.969 ms while the same producer remains Running before and after the request.
Three signatures verify in 339.314, 388.420, and 363.579 ms. The stalled peer closes in 988.434 ms.
Duplicate queue receipts preserve the job. A changed claim is rejected.
The initial four-batch refill takes 68.781 seconds. This confirms responsiveness, without a demonstrated preparation cost reduction.
The final local registration check verifies creation and recovery at 0.967 and 1.011 seconds online.
Their preparation takes 36.530 and 82.407 seconds. Recovery can overlap refill for the prior key.
Both cases reproduce the canonical key and verify an initial-stock signature.

## Durable publication and table writes

`Put` now requires the complete refill job. Router admission authenticates it before the role transaction starts.
The transaction checks the exact stored start marker, producer expiry, key, batch, material expiry, active key, role, and duplicate identity.
A late publication after lease expiry is rejected. A fresh replacement job can publish.
Global early revocation remains a cross-object check, with a possible race before the local transaction. This is not an atomic global revocation claim.

The table writer buffers at most 16 public frames, or 1,048,704 payload bytes.
Runtime copies, capacities, and other preparation state add memory.
Each flush uses one existing storage transaction and retains all frame HMAC, ordering, duplicate, and retirement checks.
An error after an earlier write rolls back that whole transaction. Private preparation becomes ready only after the final flush commits.
The native corruption scenario confirms rollback and then verifies canonical key generation.
Local Worker creation and recovery each write 2,711 frames in 170 transactions, with a peak buffer of 16 frames.

The proposed pool-index capacity concern was withdrawn before any change.
Normal consumption already removes active index entries while retaining replay tombstones. No pool-index behavior changed.

## Hosted controls and evidence limits

The first hosted control, before scheduling yields and grouped table writes, fails its preparation request with HTTP 500.
B's captured preparation invocation takes 296.685 seconds of wall time and 99.618 seconds of CPU.
The final A and Router invocation records are unavailable in that capture. The failure does not identify a unique cause.
Keep this failure in the campaign totals. It produces no registration or signing latency sample.

The synchronous colocated and separate-service controls use the same compiled code and pool policy.
Only A's producer service binding changes between these controls. Each control records exact deployment versions.
The inventory and outcome joins must match all verified operations before a throughput result is credited.
Published batch IDs must appear in the tested wallet/epoch inventory. Unknown publications remain excluded and reported.
Initial and final paired stock, consumed identities, and unaccounted expiry or retirement are retained.
Client completion times define the post-depletion interval. Whole-invocation wall time can include background lifetime and is unsuitable for that boundary.

### Minimum initial stock

Registration now prepares the minimum admission reserve, with a two-batch format floor.
This policy produces two initial batches. The background refill target remains four.
This change shortens initial preparation by deferring two batches. It does not remove their compute cost.
Local creation and recovery verify the same canonical key and standard signatures.

Hosted creation takes 151.356 seconds for preparation and 4.975 seconds online. Its first signature takes 3.703 seconds.
Hosted recovery takes 189.836 seconds for preparation and 6.040 seconds online. Its first signature takes 10.105 seconds.
Both signatures use one eight-candidate batch. The five-second target fails across these cases.
An earlier four-batch run expires near 300 seconds. Both failed setup controls remain part of the evidence.

### Synchronous dispatch controls

The colocated saturation run verifies seven signatures, then ends with HTTP 500 and an unknown final server outcome.
It includes 112 requests and 52 unavailable responses. Verified final requests take 7.434–12.761 seconds.
Captured producer completions take 43.481–56.081 seconds per eight-candidate batch.
Two observed paired arrivals lack completion records. Complete publication accounting is unavailable for this run.

The separate-service run verifies one signature in 7.539 seconds. Its next request reaches the 45-second client timeout.
Captured pool RPCs wait about 50 seconds while the producer runs for 51–52 seconds.
Separate service bindings with synchronous dispatch do not keep this pool actor responsive.
These failures prompted the durable asynchronous dispatch change described above.

The asynchronous run verifies twelve signatures in 663.754 seconds. Its captured paired completions span 41–81 seconds.
One producer alarm ends with Cloudflare's `runtime_code_update_reset` exception, despite no deployment during the load interval.
Both stores had already published that interrupted batch. The two-batch signature consumed it from the recorded reservation prefix.
The later alarm records an unknown outcome and releases only that job's lease. Fresh batch IDs continue preparation.
Only one B preparation invocation for the interrupted batch appears in the capture. There is no captured preparation rerun for that identity.
The traces cannot distinguish an alarm retry from the watchdog. They also cannot establish an operator deployment as the reset cause.
The reset invocation consumes 38.140 seconds of A CPU and 76.729 seconds of wall time.
Its CPU remains separately reported because its completion log cannot identify that invocation's batch.
That cost is not necessarily wasted: the published stock was used.
The missing normal completion record prevents a complete-publication-accounting claim, despite observed paired publication and consumption.
The initial and final inventories each contain four paired batches. Restoring the final reserve adds 185.615 seconds after the client interval.
The stock balance accounts for thirteen newly observed pairs and thirteen consumed pairs, including the interrupted published batch.
Twelve normal completion records remain, plus one unknown completion. The observed stock has no unexplained disappearance.
Captured matched producer spans report median CPU of 25.360 seconds for A and 24.329 seconds for B.
A's matched set includes the brief interrupted-job settlement. Its separate reset invocation adds 38.140 seconds of CPU.
These are per-invocation observations. They do not establish total billed CPU or a dollar cost.
This campaign does not pin or independently verify Worker and Durable Object colocation.

Twelve signatures form a short saturation screen. They cannot establish production capacity or percentile guarantees.

## Diagnosis record

| Fact | Instrument | Scope and check |
| --- | --- | --- |
| Service-only local execution delays a one-second timer to 19.224 seconds | Durable Worker E2E | Idle control 1.015 seconds, signatures independently verified |
| Cooperative execution reduces that timer to 1.132 seconds | Same E2E and policy | Separate small run, different randomness |
| Synchronous hosted separation still times out | Client artifact and five Worker tails | Exact deployment versions, public batch identities |
| Table writes fall from 2,711 individual frames to 170 transactions | Both role logs | Local and hosted registration, peak 16 buffered frames |

| Candidate cause | Timer evidence | Hosted synchronous separation | Status |
| --- | --- | --- | --- |
| Unyielding preparation monopolizes local execution | Fits service-only failure and cooperative result | Does not explain all hosted blocking | Confirmed local contributor |
| Pool actor awaits the complete producer request | Timer alone says nothing | Fits blocked inventory and producer duration | Asynchronous dispatch tests this cause |
| Cryptographic output is invalid | Contradicted by independent signature verification | Verified requests still slow | Removed for those successful requests |
| Measurement includes warm stock | Initial stock and prestarted jobs are counted | Post-depletion interval excludes their signatures | Controlled, subject to capture completeness |

Parity with the public Wallet product is not established. These are authenticated experimental Router routes.
Authentication, public login, network-to-user variation, and NEAR submission are outside the measured request boundary.

## Reproduction

Use the existing registration and durable Worker E2E runners with fresh disposable role keys.
`ML_DSA_TEST_COOLDOWN_MS=1000` selects the hosted saturation policy in the registration runner.
`ML_DSA_TEST_BUILD_ROOT` can pin an immutable snapshot of compiled bundles for a control.
Run `tests/e2e/ml-dsa-sustained-worker.e2e.mjs` with the successful registration artifact and an output artifact path.
The current runner reads the verified key scope from registration and requires no native role fixture.
Supply the private Router URL and a benchmark-token file through the existing environment variables.

Collect all five Worker tails with `collect_worker_traces.py`, including `--preparer-a` and `--preparer-b`.
Run `summarize_refill.py CLIENT TRACES OUTPUT --versions ROLE_VERSION_MAP` after final stock is observed.
Retain sanitized evidence and hashes. Remove test Workers, credentials, fixture keys, and raw tail captures after the campaign.

Deployment needs the `ML_DSA_PREPARER` service binding on online A.
Preparer A needs its own `ML_DSA_PRODUCER_DO` namespace and migration.
Each preparer receives only its own role key and a binding to its own online pool.
Preparer A reaches preparer B through its dedicated service binding.
The E2E runners define this topology. Public production deployment remains gated.

## Validation limits

The repository bloat check fails at the inherited duplication baseline.
The same command on unchanged HEAD reports the same counts: Rust 13,984 and TypeScript 10,304 duplicated lines.
This change does not increase either count. The baseline file remains unchanged.
The native canonical-key, authorized export, lifecycle, and table rollback checks pass.
The source review covers the changed lifecycle and public scheduling decisions. It is not an independent audit of the complete cryptographic protocol.

## Decision and next experiment

Keep durable asynchronous dispatch and the existing four-batch cap.
It resolves the demonstrated pool-actor stall in this small experiment. It does not establish a five-second demand guarantee.
Keep grouped table writes and the equivalent AES adapter. The AES microbenchmark improves, while a complete hosted compute reduction remains unproven.
The next cost experiment must profile preparation stages, then compare complete matched runs with the same candidate count and protocol dimensions.
Report total participant CPU, bytes, failed attempts, fresh-pair rate, and successful signatures after stock depletion.
Any concurrency experiment must report added compute capacity and interference with online signing.
Do not use a larger ready reserve to claim better preparation efficiency.
GPU work remains deferred. Canonical wallet-seed recovery and standard FIPS export remain required.

## Evidence

- [Hosted client signatures and every request](../evidence/ml-dsa-65-refill-queued-hosted-20261016.json).
- [Stock, throughput, CPU, and latency summary](../evidence/ml-dsa-65-refill-queued-summary-20261016.json).
- [Sanitized hosted traces](../evidence/ml-dsa-65-preparation-hosted-traces-20261016.json) and [deployment versions](../evidence/ml-dsa-65-preparation-deployments-20261016.json).
- [Final local durable lifecycle](../evidence/ml-dsa-65-producer-queued-local-20261016.json) and [creation/recovery](../evidence/ml-dsa-65-producer-queued-registration-local-20261016.json).
- [Native canonical-key and table rollback checks](../evidence/ml-dsa-65-producer-native-20261016.json), [lease lifecycle](../evidence/ml-dsa-65-producer-lifecycle-20261016.json), and [AES screen](../evidence/ml-dsa-65-preparation-aes-screen-20261016.json).
- [Synchronous colocated control](../evidence/ml-dsa-65-refill-colocated-hosted-20261016.json) and [synchronous separate-service control](../evidence/ml-dsa-65-refill-synchronous-services-hosted-20261016.json).
- [First hosted preparation failure](../evidence/ml-dsa-65-preparation-first-hosted-failure-20261016.json), [full-reserve failure](../evidence/ml-dsa-65-preparation-full-reserve-hosted-failure-20261016.json), and [minimum-reserve hosted registration](../evidence/ml-dsa-65-minimum-registration-hosted-20261016.json).
- [Source and final build hashes](../evidence/ml-dsa-65-producer-build-provenance-20261016.json).

All ten temporary Workers across the two owned cohorts were deleted. Tail sessions stopped. Test credentials, private fixtures, and raw credential-bearing tails were removed.
