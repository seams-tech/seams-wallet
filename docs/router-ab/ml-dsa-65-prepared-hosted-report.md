# Hosted prepared ML-DSA key-generation investigation

Date: October 14, 2026. Production integration remains paused.

## Baseline result

The first hosted prepared-keygen implementation does not meet the five-second target.
Seven measured requests take 10.08–15.40 seconds, with a 12.65-second median.
An excluded warm-up takes 18.95 seconds.
All eight requests return the expected canonical public key and acknowledge table cleanup.
Five measured recovery fixtures reproduce the same key with fresh input sharing and preprocessing.
Two additional cases change the wallet seed or wallet identifier and match their different canonical references.

| Measurement | Result |
| --- | ---: |
| Measured requests, excluding warm-up | 7 |
| Client online median | 12.651 s |
| Client online range | 10.081–15.403 s |
| Five-second deadline misses | 7 of 7 |
| Online A/B protocol bytes, including start index | 3,620,367 |
| Online logical messages | 58 |
| R2 writes and streamed reads per request | 19 each |
| Table bytes read | 113,514,952 |
| Hosted stream chunks per request | 27,724–27,743 |
| Largest hosted stream chunk | 4,096 bytes |

The [raw hosted artifact](../evidence/ml-dsa-65-prepared-keygen-worker-hosted-20261014.json) retains all samples and the public recovery oracle.
The [deployment record](../evidence/ml-dsa-65-prepared-worker-deployment-20261014.json) pins the actual Worker versions and build hashes.
The same bundles complete one local workerd case in 1.364 seconds online.
That [local result](../evidence/ml-dsa-65-prepared-keygen-worker-local-20261014.json) does not establish parity with hosted storage or scheduling.

## Measurement boundary

The client opens an authenticated WebSocket to A and waits for a ready message.
A and B complete fresh preprocessing and write all nineteen R2 objects before readiness.
The client starts its timer immediately before sending the selected public fixture index.
A forwards the start to B. Both roles then execute the private wallet-root-to-seed stage and canonical keygen.
The timer stops after the client receives and parses the complete result, including B's completion report.
The client then checks the result against the fixture oracle.
This includes client transport, A/B transport, R2 reads, circuit evaluation, and final public-key handling.
It excludes preprocessing, subsequent table deletion, custody authentication, and durable key activation.
The ready reservation retains private preparation in the same live role invocations. No persistent production pool is measured.

The fixture generator uses the existing wallet-seed KDF and stable wallet/key binding.
Each Worker bundle contains only its own owner-root shares.
The fixture oracle holds known disposable seeds and computes the ordinary reference key independently.
Workers start from owner-root shares. The native fixture generator performs wallet-seed derivation.
The manifest digest in each role report comes from the fixture book. It does not measure deployed manifest verification.
This checks canonical recovery identity. It does not prove production custody or protocol privacy.

## Facts and instruments

| Fact | Instrument | Checked scope |
| --- | --- | --- |
| All measured requests exceed five seconds | Client monotonic clock | Starts before online start message and stops after complete result |
| Both roles agree on public keys and directional byte counts | Client assertions and role reports | All eight cases |
| B performs nineteen R2 GETs | Adapter counters | Each GET produces a stream used across many frames |
| Hosted stream chunks are at most 4 KiB | Adapter byte counts | Approximately 27,700 reads per request |
| Local workerd completes the same adapter much faster | Same bundle hashes and one local run | Compute, storage, and scheduling environments still differ |
| Worker get and stream timings sum exactly to B's online observation | `Date.now()` around awaited operations | These clocks can include preceding synchronous CPU work |

Worker clocks advance with I/O. Their per-operation readings do not isolate R2 latency or CPU time.
The client clock establishes the deadline miss independently of those Worker clocks.
Request metadata reports NRT at A. It does not independently prove B's physical compute placement or R2's storage location.
The bucket has an APAC location hint.

## Candidate causes

| Candidate cause | Evidence that fits | What remains unknown |
| --- | --- | --- |
| Too many stream crossings into Wasm | About 27,700 small chunks | Cost per crossing and effect of larger reads |
| R2 latency or bandwidth | 113.5 MB read through nineteen objects | Pure storage time is not isolated by Worker clocks |
| Wasm evaluator CPU cost | All 3.55 million AND gates remain online | No hosted phase-specific CPU profile |
| A/B protocol latency | Nineteen sequential correction/label exchanges | Actual execution placement and per-flight latency |
| Measurement error | Worker phase observations differ from client elapsed time | Worker clocks cannot support CPU/storage attribution |

The measured failure is real. No single cause is established yet.
A controlled next run will replace only the default stream reader with bounded larger reads.
Cloudflare documents `readAtLeast` for this purpose in its [BYOB reader API](https://developers.cloudflare.com/workers/runtime-apis/streams/readablestreambyobreader/).
The circuit, private outputs, wallet derivation, object count, and table bytes must remain unchanged.

## Assessment of the external optimization review

The prior hosted/local ratio is an extrapolation, not a prepared-evaluator measurement.
The hosted results above replace that forecast for this storage adapter.

Public `t0` has support in the black-box Dilithium security analysis.
The [public-key uncompression paper](https://eprint.iacr.org/2024/1373) also explains its side-channel implications.
Changing its disclosure still requires review of the threshold transcript and implementation.

The [TCHES sensitivity analysis](https://research.dial.uclouvain.be/server/api/core/bitstreams/db763926-a2e9-4daa-8993-489aed9a3eca/content) supports investigating public sampling decisions.
Its section 3.2 explicitly treats rejected `w1` disclosure as requiring an additional LWR hardness assumption.
It also studies a conservative variant that protects `w1`.
These results are useful inputs to a threshold composition review, rather than an automatic change to the current disclosure contract.

A fixed 408-byte sampler cap conflicts with [FIPS 204 Appendix C](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.204.pdf).
Table 3 sets 481 bytes as the minimum allowed cap for `RejBoundedPoly`.
An adaptive implementation may consume fewer bytes normally while retaining a compliant continuation or fallback.
This hosted campaign changes neither sampling limits nor public disclosures.

## Independent review

An independent agent reproduced the counts and client timing from the raw artifact.
The review checked role-specific bundle contents and the distinct input shares in repeated-wallet cases.
It confirmed that the baseline has no reliable split between storage waits and evaluation CPU.

Successful runs acknowledge deletion of their nineteen R2 objects.
Cancellation cleanup has a gap: A closes its peer socket only on success, and B waits for start or cleanup without a deadline.
A cancelled session can therefore depend on runtime teardown. No orphaned object is demonstrated by these successful runs.
Production use requires bounded reservations, cancellation cleanup, durable one-time consumption, and a complete recovery/signing test.
The final campaign removes the temporary Workers and bucket independently of per-run cleanup.

The separate deployment record contains Cloudflare version IDs and local module hashes.
Remote module readback was not performed.
