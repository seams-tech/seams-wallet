# Hosted prepared ML-DSA key-generation investigation

Date: October 14, 2026. Production integration remains paused.

## Result after the controlled comparison

Prepared key generation still misses the five-second target on hosted Workers.
The bounded BYOB reader returns one full table frame per read. Its median is 11.57 seconds across seven measured requests.
Every measured request takes more than ten seconds. All sixteen cases across both campaigns return the expected canonical public key.
Wallet-seed recovery identity remains correct for the disposable fixtures. Full production recovery is outside this benchmark.

| Post-warmup measurement | Default stream reader | Bounded BYOB reader |
| --- | ---: | ---: |
| Measured requests | 7 | 7 |
| Client online median | 12.651 s | 11.567 s |
| Client online mean | 12.306 s | 12.394 s |
| Client online range | 10.081–15.403 s | 10.033–15.447 s |
| Five-second misses | 7 of 7 | 7 of 7 |
| Preparation/readiness median | 17.735 s | 19.392 s |
| Data returns from JavaScript into Wasm | 27,724–27,743 | 1,737 |
| R2 GETs per request | 19 | 19 |
| Table bytes read | 113,514,952 | 113,514,952 |

The median falls by 8.56%, while the mean rises by 0.71%. Only three corresponding measured fixtures become faster.
These sequential campaigns do not establish a consistent latency improvement.
They establish that larger reads alone did not meet the target in these runs.
Physical placement, runtime scheduling, and campaign time remain uncontrolled variables.

The [BYOB hosted artifact](../evidence/ml-dsa-65-prepared-keygen-worker-byob-hosted-20261014.json) records the full comparison.
Its [deployment record](../evidence/ml-dsa-65-prepared-worker-byob-deployment-20261014.json) pins the deployed versions.
The matching [local workerd case](../evidence/ml-dsa-65-prepared-keygen-worker-byob-local-20261014.json) takes 1.230 seconds online.
That single warm-up supports functional validation only.
The baseline implementation is retained in commit `92ad5be0`; the current reader replaces it without a compatibility flag.

The reader allocates at most 65,544 JavaScript bytes per read and copies one frame into Wasm.
It performs nineteen additional EOF probes. The data-return counter excludes these probes.
This count describes application reads. It does not count underlying R2 chunks or network hops.
Wasm memory highwater stays at 45,481,984 bytes for A and 66,322,432 bytes for B.
These observations do not bound total isolate memory, which also includes JavaScript and runtime buffers.

Only the table reader changes between the measured implementations.
The canonical derivation, sampler cap, private disclosures, gates, protocol messages, and recovery fixtures remain unchanged.
The online protocol carries 3,620,367 bytes in 58 logical messages over one persistent A/B WebSocket.
These counts exclude transport headers, acknowledgments, completion reports, and client messages.
They do not mean 58 separate HTTP requests.

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
| Excessive small reads in our adapter | BYOB reduces data returns about sixteenfold, but every request still exceeds ten seconds | Larger reads alone are insufficient; their exact benefit remains unknown |
| R2 latency or bandwidth | 113.5 MB read through nineteen objects | Pure storage time is not isolated by Worker clocks |
| Wasm evaluator CPU cost | All 3.55 million AND gates remain online | No hosted phase-specific CPU profile |
| A/B protocol latency | Nineteen sequential correction/label exchanges | Actual execution placement and per-flight latency |
| Incorrect client deadline measurement | Independent review confirms the start/complete boundary | No evidence invalidates the client deadline miss |
| Incorrect CPU/storage attribution | GET plus stream observations equal B online time in all sixteen runs | Worker clocks cannot support a CPU/storage partition |

The measured failure is real. No single cause is established yet.
The controlled run replaced only the default stream reader with bounded larger reads.
Cloudflare documents `readAtLeast` for this purpose in its [BYOB reader API](https://developers.cloudflare.com/workers/runtime-apis/streams/readablestreambyobreader/).
The circuit, private outputs, wallet derivation, object count, and table bytes remained unchanged.

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
The campaign removed the temporary Workers and bucket independently of per-run cleanup.

The separate deployment record contains Cloudflare version IDs and local module hashes.
Remote module readback was not performed.

A second review confirmed the BYOB frame bounds and unchanged cryptographic behavior.
It reproduced both distributions and identified the higher BYOB mean, which prevents a general speedup claim.
It also found an existing final-object limitation: oversized stored metadata can leave unread bytes after the last circuit.
Fresh objects from this writer have the exact expected size. Untrusted persisted pools need a final read-completion check.

## Measured, inferred, and unknown

Measured:

- Both hosted campaigns fail the online deadline. All fixture keys and cleanup acknowledgments pass.
- The larger reader returns fewer, larger frames with unchanged storage bytes, GETs, and protocol messages.
- Local and hosted source, fixture, and module hashes match within each campaign.

Inferred:

- The current reader change is insufficient to reach five seconds. It does not establish a hard lower bound for the protocol.
- Smaller circuits remain a useful next experiment. This campaign does not validate their predicted speed.

Unknown:

- Evaluation CPU versus storage wait: use hosted CPU profiling or a controlled table-access experiment with validated clocks.
- Actual A/B and storage placement: obtain independent placement evidence before making a same-region latency claim.
- Production pool behavior: test admission, restart, cancellation, durable consumption, and empty-pool handling in a separate lifecycle campaign.
- Production recovery and signing parity: exercise custody delivery, manifest verification, durable activation, and signing together.
- Tail latency and throughput: run a larger controlled campaign after selecting a design that meets the preliminary deadline.

Production parity is not established. No hosted prepared-signing result is claimed.
The earlier 4.4× extrapolation cannot establish a prepared-keygen runtime or a five-second floor.
The measured results replace that forecast for this adapter. No storage-only timing claim is supported.

## Cleanup

The [cleanup artifact](../evidence/ml-dsa-65-prepared-worker-cleanup-20261014.json) records deletion of both temporary Workers and their R2 bucket.
Authenticated readback confirms that those resources are absent. The benchmark-only token file was removed.
All sixteen successful sessions also acknowledged deletion of their own nineteen table objects.
No production service or wallet credential changed.

## Reproduce the Worker campaign

The campaign used Wrangler 4.111.0. It used the repository's pinned Rust and Wasm toolchain.
Generate the ignored public fixture files before compiling either role:

```sh
cargo build --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml
tools/ml-dsa-investigation/target/release/ml-dsa-investigation export-worker-fixtures \
  crates/ed25519-yao-cloudflare-bench/src/ml_dsa_schedules
tools/ml-dsa-investigation/target/release/ml-dsa-investigation export-prepared-fixtures \
  crates/ed25519-yao-cloudflare-bench/src/ml_dsa_schedules
source packages/wallet/scripts/build/wasm-toolchain.sh
cd crates/ed25519-yao-cloudflare-bench
with_wasm_bindgen_cli_for_lockfile Cargo.lock worker-build --release \
  --out-dir build/ml-dsa-b --features ml-dsa-b
with_wasm_bindgen_cli_for_lockfile Cargo.lock worker-build --release \
  --out-dir build/ml-dsa-a --features ml-dsa-a
cd ../..
node crates/ed25519-yao-cloudflare-bench/scripts/run_prepared_keygen.mjs \
  --local --indices 0 --output /private/tmp/ml-dsa-prepared-local.json
```

For a hosted run:

1. Check Wrangler authentication. Create the private R2 bucket named in `wrangler.ml-dsa-prepared.b.jsonc`, with the APAC location hint.
2. Generate a fresh benchmark-only token in a mode-0600 JSON file with the `PROBE_TOKEN` field. Do not use a wallet credential.
3. Deploy B, then A, with their `wrangler.ml-dsa-prepared.*.jsonc` configurations and the pinned Wasm helper.
4. Upload the same token file with `wrangler secret bulk` to both configurations.
5. Capture the deployed version IDs and local module hashes. Run the command below from the repository root.
6. Check all eight cases, the deadline result, and every cleanup acknowledgment.
7. Delete A, then B, then the empty bucket. Remove the temporary token file. Retain the evidence JSON.

```sh
node crates/ed25519-yao-cloudflare-bench/scripts/run_prepared_keygen.mjs \
  --endpoint "$ML_DSA_PROBE_ENDPOINT" \
  --secrets-file "$ML_DSA_PROBE_TOKEN_FILE" \
  --output /private/tmp/ml-dsa-prepared-hosted.json
```

Set the endpoint and token-file variables to the resources created for that run.
Fresh fixture generation changes the private share bytes and build hashes. Canonical public keys remain reproducible.
The first fixture is an excluded warm-up. Fixtures 1–5 repeat its wallet with fresh shares.
Fixtures 6 and 7 change the wallet seed and wallet identifier respectively.
The script fails on a functional error. Deadline misses remain explicit artifact results and do not cause a nonzero exit status.
