# ML-DSA storage and candidate-batch controls — October 16, 2026

Five successful hosted signatures take 2.720–11.561 seconds. Each uses one eight-candidate batch.
Registration takes 6.420 seconds, and recovery takes 5.732 seconds. The five-second target remains unmet.
Wallet-seed recovery and canonical FIPS export pass.
This campaign reduces storage calls and repeated public schedule validation. It also tests eight candidates per signing batch.
Production integration and GPU preparation remain deferred.

## Changes

- Read and delete preparation chunks in groups of 16. Await every grouped write before its transaction commits.
- Store chunks as binary values in Worker storage. Reconstruct numeric order explicitly after bulk reads.
- Cache validated immutable circuit schedules. Cache no private inputs, labels, correlations, or signing state.
- Prepare eight signing candidates per batch. Keep automatic rollover under the same operation and cooldown.
- Authenticate public garbled tables with HMAC-SHA256 instead of encrypting each frame with HPKE.
- Consume up to 32 contiguous frames per table transaction. Burn unused prefetched frames after interruption.

Private preparation and signing material retain HPKE. Role RPC bodies still use JSON and base64 for ciphertext.
The Worker profile requires fresh preparation. Old string chunks and old table records fail closed.
The candidate count is checked during prepared-state restoration. Inventory schedule identity alone does not distinguish four-candidate stock from eight-candidate stock.
These tests therefore use fresh Workers and stores. They do not qualify a rolling deployment with mixed stock.

## Public-table privacy review

The table writer stores an eight-byte public header followed by garbled AND ciphertexts.
It does not store private input labels, OT choices or pads, the global label difference, seeds, or output translations there.
A generates these frames. B already receives them during preparation. This change adds no view to either passive participant.
A storage-only reader gains the garbled transcript. Its secrecy relies on the existing half-gates and fixed-key-hash assumptions.
The [half-gates construction](https://www.cs.virginia.edu/~evans/pubs/ec2015/halfgates.pdf) defines that transcript boundary.

HKDF-SHA256 derives a separate role-local authentication key from the existing wrapping seed.
The full HMAC-SHA256 tag covers a new domain, the complete frame-binding digest, and every frame byte.
The binding includes role, reservation, schedule, circuit, ordinal, length, expiry, and wrapping-key version.
Constant-time tag verification precedes release from the storage transaction. A bad later frame rolls back the whole consume.
The existing lifecycle tombstones enforce single-use consumption. A MAC does not prevent rollback of the lifecycle database.
This change does not extend the passive model to malicious participants.

Independent review found no blocker for this bounded experiment.
The explicit derived-key buffer and cached frame buffers are wiped.
The pinned HMAC and HKDF libraries do not guarantee erasure of their internal keyed digest state.
This review does not certify complete memory erasure or compiler-level constant-time behavior.

The maximum cached frame payload is 2,097,408 bytes. Temporary buffers, vector capacity, runtime copies, and other state add memory.
The 16-chunk I/O payload is bounded at 786,432 bytes. This is also not a total-memory bound.

## Measurement boundary

Registration includes the authenticated Gateway request, private key generation, durable role installation, initial signing stock, and client custody verification.
Signing includes admission, prepared execution, signature verification, and settlement.
These are private-route timings from the test client to hosted Workers. Public login, browser UX, and NEAR submission remain outside the measurement.
Preparation runs before online timers. Empty pools return an explicit retry response and do not meet a successful-operation latency target.

These sequential campaigns are controls, with fresh randomness and provider scheduling between runs.
They are too small for a p95 or p99 claim. The final control combines public-table authentication and the larger frame cache.
Do not attribute its total effect to HMAC alone.

## Controls before public-table authentication

| Control | Create | Recover | Successful signing | Preparation, including four signing batches |
| --- | ---: | ---: | --- | --- |
| Grouped I/O, four candidates, base64 storage | 7.488 s | 9.619 s | 4.363 / 6.783 s | 146.547 / 115.677 s |
| Grouped I/O, eight candidates, cached schedules, base64 storage | 8.019 s | 8.334 s | 5.187 / 6.517 s | 194.553 / 290.117 s |
| Binary storage, eight candidates, cached schedules | No result | No result | No result | Client header timeout before registration |

The [control artifact](../evidence/ml-dsa-65-storage-controls-20261016.json) retains both successful campaigns and the failed binary-only attempt.
The first two controls pass functional checks. Each signature uses one batch, so batch rollover cannot explain these slow samples.
The binary-only campaign reaches approximately 300 seconds during preparation and returns no registration result.
Its A invocation reports an exception near the deadline. The Router request is cancelled. This does not establish the root cause.
The timeout is retained as a failed preparation attempt. It is not excluded from the record or counted as successful registration.

## Validation

The [native campaign](../evidence/ml-dsa-65-public-tables-native-20261016.json) reproduces six canonical keys, including injected 5 ms and 20 ms transport delays.
It checks a modified table-body byte, wrong role/key/ceremony, prefetched-frame replay after database reopen, and complete bounded cleanup.
That replay probe does not terminate a process or cancel an in-flight table consume.
The same 643 online frames require 24 table transactions, compared with 83 before this change.
The [lifecycle E2E](../evidence/ml-dsa-65-storage-lifecycle-20261016.json) passes recovery epochs, replay, capacity, cooldown, failed delivery, and transactional rollback checks.

The [local Worker registration campaign](../evidence/ml-dsa-65-public-tables-local-20261016.json) passes creation and recovery at 1.242 and 1.312 seconds.
Its verified signatures take 0.251 and 0.241 seconds.
The [durable Worker campaign](../evidence/ml-dsa-65-storage-durable-local-20261016.json) verifies three signatures, restart replay, automatic refill, authority checks, and a stalled peer.
The peer closes after 0.939 seconds under a one-second permit. Both roles store batches across 56 chunks, covering numeric ordering across chunk 9/10 and 15/16.
Local registration and durable tests ran concurrently. Their timings are functional evidence, not a controlled speedup estimate.

## Final hosted public-table control

The [hosted client campaign](../evidence/ml-dsa-65-public-tables-hosted-20261016.json) passes functional checks and fails the combined latency target.
It verifies both holder results, the canonical key, the manifest, exact retry, changed-request rejection, and recovery continuity.

| Measurement | Create | Recovery |
| --- | ---: | ---: |
| Preparation, including four eight-candidate signing batches | 273.996 s | 203.543 s |
| Complete registration with client verification | 6.420 s | 5.732 s |
| Verified signing through settlement | 3.449 s | 2.906 s |
| Consumed batches / evaluated candidates | 1 / 8 | 1 / 8 |
| Router key-generation service call | 4.320 s | 3.844 s |
| Slower role's initial-stock installation call | 1.698 s | 1.442 s |

The hosted evaluator reads 41,701,400 bytes in 643 frames, using 24 transactions and a peak cache of 32 frames.
Its complete key-generation invocation uses 1.752 and 1.863 seconds of CPU. These counters include restoration and table handling.
The corresponding A invocation uses 0.389 and 0.277 seconds of CPU.
RPC wall times overlap. Do not add role timings or infer pure network latency by subtracting an uncalibrated phase clock.

The final client signing times exceed the server-only Router trace times. Client and server measurement boundaries must remain distinct.
The preparation figures include the complete initial reserve. They are not per-signature preparation costs.
Eight candidates reduce the chance of another batch but increase prepared-stock size and work. This campaign does not establish the best candidate count.

The [first continuation](../evidence/ml-dsa-65-public-tables-signing-20261016.json) preserves both requests.
The first request arrives during cooldown and is refused. The next request verifies in 2.720 seconds with one eight-candidate batch.
The runner marks the pair unsuccessful because it requires two signatures. The cooldown response is expected admission behavior.
This sample missed the runner's initial cooldown precondition. No production change is needed for this refusal.

The [second continuation](../evidence/ml-dsa-65-public-tables-signing-repeat-20261016.json) waits for cooldown, then verifies both signatures.
They take 11.561 and 7.185 seconds. Exact operation IDs in the [sanitized traces](../evidence/ml-dsa-65-public-tables-traces-20261016.json) show one eight-candidate batch each.

| Repeat request | Complete client time | Slower inventory RPC | Signing RPC |
| --- | ---: | ---: | ---: |
| First | 11.561 s | 8.469 s | 2.532 s |
| Second | 7.185 s | 4.183 s | 2.193 s |

The delay is concentrated before signing, in the inventory RPC boundary. It includes dispatch, queueing, execution, and response delivery.
The first slow request overlaps a B preparation invocation with 33.423 seconds of CPU across 69.188 seconds of wall time.
This supports investigation of preparation interference. It does not prove which scheduler or storage wait caused the delay.
Role storage handling, Worker dispatch, and producer CPU need separate instrumentation or an isolated-producer control.
No final-profile request exercises multiple batches. Multi-batch latency remains unqualified, and one-batch results already fail consistency.

## Facts and remaining causes

| Fact | Instrument | Scope and check |
| --- | --- | --- |
| Several one-batch signatures exceed five seconds | Client monotonic clock and exact-ID Router outcome | Real hosted routes, verified standard signatures |
| Eight candidates consume more preparation time in this campaign | Client timer | Two fresh cases, provider variance uncontrolled |
| Binary-only preparation returns no usable result | Client header timeout and sanitized invocation outcomes | Approximately 300 seconds, server work not fully attributed |
| Final table reads fall from 83 to 24 transactions | Native adapter counters | Same 643 frames, cache limit checked at 32 |
| Final local custody and durable flows pass | Real strict Worker bundles in workerd | Same compiled code as hosted deployment, different hardware/runtime conditions |
| Slow continuation spends 8.469 / 4.183 seconds in an inventory RPC | Exact-ID Router outcomes and public RPC counters | Signing RPC itself takes 2.532 / 2.193 seconds |

| Candidate cause | One-batch slow results | Local pass, hosted misses | Assessment |
| --- | --- | --- | --- |
| Rejected candidate batches alone | Contradicts | Says nothing | Removed as the sole explanation |
| Chunk serialization and storage crossings | Fits | Fits | Control changes code, but does not isolate total latency |
| Public schedule validation and topology compilation | Fits | Fits | Schedule validation is cached; topology costs need profiling |
| CPU scheduling and service placement | Fits | Fits | Whole-invocation counters do not isolate individual stages |
| Instrument or deployment mismatch | Hashes and operation IDs reduce this risk | Clock environment differs | Preserve provenance; avoid cross-runtime scaling claims |
| Our execution, installation, or transport code | Fits | Fits | Still open; profile before another protocol change |

The continuation narrows the immediate signing problem to the inventory RPC boundary.
Preparation interference, storage serialization, and dispatch queueing remain candidate causes. The traces do not identify a unique root cause.

The source shows fewer storage calls. The hosted controls do not establish a speedup from grouped I/O or eight candidates.
Hosted Worker phase-clock zeros from the earlier campaign remain invalid CPU measurements. These tests do not use them to attribute cryptographic work.

## Outstanding qualification

- Isolate inventory reads from producer work in a measured control. Compare bounded cooperative yields with a separate Worker producer per role.
- Retain separate role trust boundaries and single-use publication. Measure producer and request overlap before choosing a scheduling change.
- Measure multi-batch signing with exact operation IDs and consumed-batch counts after the inventory delay is controlled.
- Profile role transport and repeated key activation during signing. Keep private preparation inside its existing trust boundary.
- Compare installation of the minimum admission-ready stock with installation of the full refill target. Preserve reserve and background-refill requirements.
- Compare bounded concurrent stock installation with the current serial loop. Verify exact retry, failed delivery, and memory bounds before changing it.
- Qualify fixed-load latency, sustainable refill, cold starts, and total isolate memory.
- Complete lifecycle-wide deadlines and interruption tests before public integration.

## Reproduction and provenance

The [provenance artifact](../evidence/ml-dsa-65-storage-provenance-20261016.json) records source hashes and deployed versions for each control.
Client artifacts record exact Worker Wasm hashes and the runner hash. Sanitized traces retain public counters and outcomes only.
Temporary authentication tokens, role keys, request headers, and raw tail captures stay outside the repository.

Run from the Wallet repository. Use fresh disposable directories:

```sh
ML_DSA_E2E_REPORT=/tmp/ml-dsa-lifecycle.json cargo test --locked --manifest-path crates/router-ab-cloudflare/Cargo.toml --test ml_dsa_durable_pool_e2e
ML_DSA_WORKER_FIXTURE_DIRECTORY=/tmp/ml-dsa-role-fixtures cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- prepared-keygen /tmp/ml-dsa-native.json
pnpm -C crates/router-ab-cloudflare build:router
pnpm -C crates/router-ab-cloudflare build:deriver-a
pnpm -C crates/router-ab-cloudflare build:deriver-b
node tests/e2e/ml-dsa-registration-worker.e2e.mjs /tmp/ml-dsa-registration-keys /tmp/ml-dsa-registration.json
node tests/e2e/ml-dsa-durable-worker.e2e.mjs /tmp/ml-dsa-role-fixtures /tmp/ml-dsa-durable.json
```

For hosted runs, deploy fresh role-separated Workers with the same admission policy recorded in the client artifact.
Use independently generated role keys and benchmark credentials. Set `ML_DSA_REGISTRATION_ROUTER_URL` and `ML_DSA_GATEWAY_TOKEN_FILE` for the registration runner.
The key directory must match the deployed role keys. The runner verifies canonical recovery and both holder results.
Use `ml-dsa-existing-worker.e2e.mjs` for further signing requests against the resulting disposable key.
Collect tails with `tools/ml-dsa-investigation/research/collect_worker_traces.py` before removing the temporary Workers and credentials.
