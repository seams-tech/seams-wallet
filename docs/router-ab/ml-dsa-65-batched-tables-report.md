# ML-DSA bounded table reads — October 16, 2026

Complete hosted registration still exceeds five seconds. Bounded reads preserve canonical recovery and single-use storage, but do not establish the product latency target.
The repeat campaign measures creation at 5.669 seconds and recovery at 6.694 seconds, including client verification.
Successful signing takes 4.978 and 7.942 seconds. An earlier request returns terminal failure after a 9.464-second Router invocation.
Keep that failure in the qualification record. The public Wallet SDK route remains gated.

## Changes and security boundary

The evaluator consumes up to eight contiguous frames from one circuit in one storage transaction.
It authenticates every frame before the transaction commits. The adapter releases plaintext only after commit.
The cache checks circuit, ordinal, and length for every request. It cannot be cloned or serialized into reusable preparation.
Dropping the cache wipes unused plaintext. Those frames remain consumed after restart.
Eight maximum frames hold 524,352 plaintext bytes. This bound excludes ciphertext, decoding buffers, circuit state, and other isolate memory.

The Router also starts one bounded pool-storage read per role while key generation runs.
Each read requires the exact live registration claim and internal service authentication. It installs no material and schedules no refill.
The caller stops waiting for initialization when key generation completes. Dropping its future does not prove cancellation of the remote read.
Initialization has a deadline. The existing key-generation service call still lacks an outer deadline and can stall beyond claim expiry.

Wallet-seed derivation, canonical FIPS export, role separation, and the passive disclosure boundary remain unchanged.
This change adds no circuit disclosures or signing-protocol changes. GPU work remains deferred.

## Evidence

| Fact | Instrument and scope | Result |
| --- | --- | --- |
| Six generated keys match canonical keys | [Native E2E](../evidence/ml-dsa-65-batched-tables-native-20261016.json) | Pass |
| Every successful evaluator consumes 643 frames through 83 transactions | Native E2E and hosted counters | Peak cache: eight frames |
| Corruption in the second frame rolls back the entire batch | Native SQLite transaction followed by real key generation | Pass |
| Served and prefetched frames cannot be consumed after restart | Native E2E reopens storage | Pass |
| Oversized chunk count and wrong cached ordinal fail | Native E2E | Pass |
| Cleanup removes table ciphertext | Native E2E | 85 bounded steps, zero chunks remain |
| Admission and pool lifecycle checks pass | [Lifecycle artifact](../evidence/ml-dsa-65-batched-tables-lifecycle-20261016.json) | Pass |
| Optional initialization does not delay completed key generation | [Local fault campaign](../evidence/ml-dsa-65-initialization-stall-20261016.json) stalls both initialization routes for ten seconds | Registration returns in 2.415/2.208 seconds |
| Initialization rejects an inactive claim | Local Worker routes | Pass |

Native corruption probes run before protocol use. They test storage rollback without retrying a failed key-generation execution.
The fault campaign asserts that both proxy routes received initialization requests. Its delay is therefore an exercised fault.
Local registration verifies exact replay, changed-input rejection, authenticated holder results, the manifest, and canonical recovery after runtime restart.
Source hashes identify the native storage code. Hosted artifacts identify the Wasm bundles and Worker deployment versions.

| Campaign | Create, client | Recovery, client | Signing, client | Preparation before each registration |
| --- | ---: | ---: | --- | --- |
| [Local](../evidence/ml-dsa-65-batched-tables-local-20261016.json) | 1.949 s | 2.217 s | 0.636 s, then cooldown | 53.019/46.718 s |
| Local initialization stall | 2.415 s | 2.208 s | 0.387 s, then cooldown | 47.855/45.006 s |
| [First hosted campaign](../evidence/ml-dsa-65-batched-tables-hosted-failure-20261016.json) | Client duration lost | Not reached | Terminal failure | Router preparation: 156.560 s |
| [Repeat hosted campaign](../evidence/ml-dsa-65-batched-tables-hosted-repeat-20261016.json) | 5.669 s | 6.694 s | 4.978/7.942 s, both verified | 98.967/150.883 s |

Preparation includes key-generation tables and four initial signing batches. One batch does not guarantee a successful signature.
The repeat campaign passes its functional checks and fails its latency target. Across both hosted campaigns, one of three signing requests fails.
These few requests cannot establish a failure rate, percentile latency, or sustainable throughput.

The first harness saved registration measurements only after signing succeeded. Its signing assertion therefore lost the completed registration's client timer.
Classification: `valid_test_needs_update`. The recorder now saves registration first, records terminal signing failures, and continues recovery while retaining a failed campaign status.
The first artifact remains failed with empty cases. Its Router registration duration is 7.099 seconds and cannot replace the missing client measurement.

## Hosted phase measurements

The [first traces](../evidence/ml-dsa-65-batched-tables-hosted-failure-traces-20261016.json) and
[repeat traces](../evidence/ml-dsa-65-batched-tables-hosted-repeat-traces-20261016.json) retain public counters and invocation timing.
The collector removes credentials, headers, complete URLs, exception text, and unrelated logs.
Repeat traces include invocations that overlap the campaign window, including background work from the previous wallet.

| Phase | First hosted create | Repeat create | Repeat recovery |
| --- | ---: | ---: | ---: |
| B key-generation CPU | 2.829 s | 2.371 s | 3.479 s |
| B key-generation wall time | 4.746 s | 3.209 s | 4.300 s |
| Router key-generation RPC | 5.066 s | 3.405 s | 4.540 s |
| Slower initial pool install after key generation | 0.070 s | 0.073 s | 0.212 s |
| Slower material-and-stock installation | 1.430 s | 1.844 s | 1.376 s |

All three evaluator runs load 643 frames and 41,701,400 bytes through 83 transactions.
The [previous cipher campaign](ml-dsa-65-registration-cpu-report.md) used 643 transactions and measured first pool installation at 1.628 seconds.
Early initialization overlaps key generation in the new traces. The subsequent pool-install delay is smaller.
This supports moving startup work earlier. It does not isolate cold-object startup from storage, scheduling, or network time.
Both batching and initialization changed together. Fresh preparation, runtime placement, and background work also differ.
The first hosted B CPU reading is almost unchanged from the previous 2.837 seconds. A batching-specific speedup remains unqualified.

## Signing failure assessment

The first signing request fails after registration. A returns HTTP 200 after 7.843 seconds and its invocation completes normally.
Settlement fences take 83/103 milliseconds. No long refill overlaps that signing window.
The Router combines exhausted candidates and dispatch errors into the same public failed state.

| Candidate cause | A returned HTTP 200 | Short settlement, no overlapping refill | Assessment |
| --- | --- | --- | --- |
| Bounded candidate exhaustion | Fits normal public outcome path | Fits | Strongest inference, explicit outcome absent |
| Ordinary A-side protocol or storage error | Contradicts normal error response path | Says nothing | Unlikely for this capture |
| Router response-read or decode error | Fits | Fits | Unresolved |
| Fresh full 30-second timeout | Says nothing | Total request took 9.464 s | Contradicted |
| Refill blocked settlement | Says nothing | Contradicts | Contradicted for this request |
| Harness reporting defect | Explains missing registration timer | Does not explain server failure | Recorder fixed |

An independent review checked these facts against the executor and Router response paths.
No exact candidate count or final dispatch outcome was captured. An existing terminal-state race also remains technically possible without supporting evidence.
The B WebSocket exception occurs after verified signatures too. It does not identify the failed request's cause.
Runtime terminal exceptions remain an open qualification issue, including those in the repeat campaign.

## Next work

1. Record typed public signing outcomes and candidate counts before the Router reduces them to status. Distinguish exhaustion from response decoding and transport errors.
2. Resolve WebSocket terminal exceptions. Add a bounded registration execution deadline with interruption evidence.
3. Profile material-and-stock installation. Test fewer copies and reseals only with exact one-time key assignment, replay, and interruption checks.
4. Measure registration and signing under a stated load profile, including failed operations, pool depletion, refill, and reserve costs.
5. Complete authoritative Wallet custody and session integration after the private path meets its release gates.

## Reproduce

```sh
cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- \
  prepared-keygen /private/tmp/ml-dsa-batched-native.json
ML_DSA_E2E_REPORT=/private/tmp/ml-dsa-batched-lifecycle.json \
  cargo test --manifest-path crates/router-ab-cloudflare/Cargo.toml --test ml_dsa_durable_pool_e2e
pnpm -C crates/router-ab-cloudflare build:router
pnpm -C crates/router-ab-cloudflare build:deriver-a
pnpm -C crates/router-ab-cloudflare build:deriver-b
node tests/e2e/ml-dsa-registration-worker.e2e.mjs \
  /private/tmp/ml-dsa-keys /private/tmp/ml-dsa-batched-local.json
ML_DSA_REGISTRATION_STALL_INITIALIZATION=1 \
  node tests/e2e/ml-dsa-registration-worker.e2e.mjs \
  /private/tmp/ml-dsa-stall-keys /private/tmp/ml-dsa-batched-stall.json
```

Use fresh disposable role-key directories. Hosted runs additionally require the temporary Router URL and its matching authentication-token file.
The local harness uses real workerd routes. Public login, SDK interaction, NEAR submission, and production placement are outside this campaign.
Parity with the complete public product is not established.

All three temporary Workers are absent after cleanup. Trace listeners, saved disposable credentials, and raw trace files were removed.
Worker A's first deletion command reported an authentication error. A repeated deletion confirmed that the Worker no longer exists.
