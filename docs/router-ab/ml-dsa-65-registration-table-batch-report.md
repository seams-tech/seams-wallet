# ML-DSA registration table I/O comparison

Retain grouped table chunk reads and deletions as a bounded reduction in storage API calls.
This screen establishes no end-to-end speedup. Consistent registration and signing below five seconds remain unqualified.
The [evidence record](../evidence/ml-dsa-65-registration-table-batch-20261023.json) contains all case timings, source receipts, provider outcomes, and cleanup receipts.
The [data archive](../evidence/ml-dsa-65-registration-table-batch-20261023-data.json.gz) contains public client artifacts, sanitized traces, CPU profiles, symbol maps, and reproduction scripts.

The implementation keeps the existing transaction and thirty-two-frame cache.
It validates frame metadata, reads the batch's chunks together, then authenticates every frame before deletion.
It deletes the chunks together and writes each consumed record inside the caller's transaction.
No frame reaches evaluation before that transaction commits.
The existing storage adapter preserves requested key order when the provider returns a sorted map with missing keys omitted.
The batch requires at most sixty-four chunk keys, below the storage API's 128-key limit. See [Cloudflare's storage API](https://developers.cloudflare.com/durable-objects/api/legacy-kv-storage-api/).

| Successful online table consumption, per ceremony | Control | Candidate |
| --- | ---: | ---: |
| Frames and bytes read | 643 / 41,701,400 B | 643 / 41,701,400 B |
| Take transactions | 24 | 24 |
| Peak cached frames | 32 | 32 |
| Chunk-read Store calls, source-derived | 643 | 24 |
| Chunk-delete Store calls, source-derived | 643 | 24 |
| Metadata reads and consumed-record writes, each | 643 | 643 |

These call counts exclude failed attempts, retirement, and cleanup. They are not measured network-hop or billing counts.
Four ceremonies require 2,572 metadata reads and 2,572 consumed-record writes per profile.
The change leaves storage formats, circuits, authentication, recovery, and signing policy unchanged.

The Cloudflare screen uses two synthetic wallets per profile, with creation and canonical recovery for each wallet.
Wallet identifiers, role keys, canonical public keys, fixture hashes, client source, and policy match across profiles.
The control uses Worker binaries built from `373f29de`. The candidate adds grouped I/O and public execution/memory diagnostics.
Profiles run sequentially; the control Workers are deleted before candidate timing.
No build, deployment, local CPU benchmark, or compression runs during either measurement window.
Provider versions match the deployment receipts.

| Complete hosted measurement | Control | Candidate |
| --- | ---: | ---: |
| Prepared registration/recovery, median | 4.365 s | 4.086 s |
| Prepared registration/recovery, range | 3.772–4.960 s | 3.935–5.992 s |
| Registrations below five seconds | 4/4 | 3/4 |
| Initial signing HTTP time, median | 3.048 s | 5.226 s |
| Initial signing HTTP time, range | 1.635–3.915 s | 2.577–6.421 s |
| Initial signatures below five seconds | 4/4 | 2/4 |
| Preceding preparation, range | 51.076–84.717 s | 51.973–80.627 s |
| B execution invocation CPU, median | 1.708 s | 1.428 s |
| A installation invocation wall time, median | 1.037 s | 1.509 s |
| B installation invocation wall time, median | 1.160 s | 1.353 s |

All eight ceremonies pass canonical-key, holder-result, and manifest verification. All eight initial signatures verify independently.
Registration timing starts before the admitted request and ends after client custody verification.
It includes key generation, durable two-role installation, initial stock delivery, and activation. Preparation runs before this timer.
The preparation timer covers key-generation material plus eight signing pairs: sixteen candidates. It does not measure one four-candidate group.
Signing timing includes the complete admitted HTTP request and response. Independent signature verification follows the timer.
Public login, browser interaction, saturated demand, and sustained refill capacity are outside this screen.

The control signatures check 2, 3, 2, and 1 candidate pairs. The candidate signatures check 3, 5, 4, and 1 pairs.
Cache histories also differ. The observed signing difference cannot be assigned to grouped registration reads.
The lower B CPU median is an observation from four sequential cases, without alternating repeats or a matched resource-load control.
It does not establish a causal reduction in total registration cost or latency.

The slowest candidate registration takes 5.992 seconds.
Its Router trace records 3.725 seconds from admission completion to execution completion, followed by a 1.749-second installation span.
B's execution invocation reports 2.023 seconds of CPU. Remaining execution and activation work warrant separate investigation.
Role phase clocks can remain fixed during real work. Some internal spans also exceed their provider invocation wall times.
Those instruments have different or unqualified boundaries; their differences cannot partition CPU, storage waits, and protocol waits.
The independent client clock supplies the complete latency result.

All selected execution and installation invocations have provider outcome `ok`.
The record also retains twenty-five canceled invocations in the control and twenty-three in the candidate. Their causes remain unassigned.
One candidate Router `/control` invocation reports `InvalidGateDecision: Registration operation was changed`.
Its timing and surrounding operation agree with the changed-replay negative control. An exact nested request identifier join is unavailable.
It is preserved separately from successful admitted ceremonies. No `exceededMemory` or `loadShed` outcome appears in the collected traces.

Candidate post-keygen allocated Wasm capacity is 111.8125 MiB on A and 89.5625 MiB on B.
The control has no matching memory readings. Hosted executions have distinct module identities, so repeated-module behavior remains unqualified.
A repeated local Gateway lifecycle reaches 141.375 MiB on A, which reads zero table frames.
This observation does not identify grouped table reads as its cause. It requires investigation before repeated-module resource qualification.
Page capacity excludes JS and host buffers; total live isolate peak memory remains unknown.
Cloudflare documents a 128 MB isolate limit covering JS and Wasm. See [Workers memory limits](https://developers.cloudflare.com/workers/platform/limits/).

The calibrated local control attributes 31.49–33.29% of B's samples to inclusive table loading.
Local prepared creation/recovery takes 1.220/1.354 seconds for the control and 1.134/1.435 seconds for the candidate.
Those mixed timings establish no local end-to-end gain. CPU sample categories overlap and are not hosted CPU milliseconds.
The data archive retains the raw profiles, zero/small/large calibration cases, symbol maps, and extraction source hashes.

The final native E2E passes six canonical key-generation cases and the existing recovery, export, signing, and replay checks.
New controls reject a missing later-frame chunk and inject failure on the second consumed-record write.
The latter first deletes real SQLite chunks and writes one consumed record. Reopening SQLite confirms transaction rollback restored the prior state.
Modified-frame authentication, restart replay, canceled preparation, bounded chunk counts, and cleanup controls also pass.
The complete local Worker/Gateway lifecycle passes enrollment, signing, recovery, participant restoration, and interrupted publication checks.
An initial Wasm diagnostic build failed because `core::arch` resolved to the registration module. The corrected `::core::arch` builds pass for all three roles.
Formatting checks use each crate's declared Rust edition. JavaScript syntax, Python parsing, and diff whitespace checks pass.

Wallet-seed recovery, canonical FIPS seed/key export, passive server-blind execution, and private commitments remain unchanged.
Preparation still produces four candidates. Signing consumes two at a time.
Capacity remains thirty-two candidates per wallet, with sixteen required for admission.
The hosted functional screen uses a one-second cooldown. The production default remains sixty seconds.
UI and GPU work stay deferred. Both sets of five temporary Workers are deleted.
Independent review found no correctness blocker and corrected the call-count scope before publication.
The bloat check retains its existing failure: 13,972 duplicated Rust lines against 13,754 allowed.
Starting HEAD had 14,022 duplicated lines. This change removes fifty; the baseline remains unchanged.

Next work:

1. Isolate remaining registration metadata/consumed-record CPU and activation delays before another storage change. Check repeated-module memory in the same screen.
2. Profile complete multi-pair signing at restoration, activation, and protocol boundaries. Keep rejection counts and first/reused module calls separate.
3. Repeat the selected change under sustained demand with unchanged capacity. Count waiting, failed, and unfinished operations as well as successful signatures.

To repeat the functional checks, run from the repository root:

```sh
cargo build --locked --release --manifest-path tools/ml-dsa-investigation/Cargo.toml
tools/ml-dsa-investigation/target/release/ml-dsa-investigation prepared-keygen /tmp/ml-dsa-table-native.json
```

Build `router`, `deriver-a`, and `deriver-b` sequentially with `scripts/build-strict-worker.sh` from `crates/router-ab-cloudflare`.
Set `ROUTER_AB_WORKER_BUILD_PROFILE=release`. The script supplies the SIMD target flags.
Then run `ML_DSA_TEST_COOLDOWN_MS=1000 node tests/e2e/ml-dsa-registration-worker.e2e.mjs /tmp/ml-dsa-table-wallet /tmp/ml-dsa-table-local.json` from the repository root.
For profiling, set `ML_DSA_REGISTRATION_CPU_PROFILE` and use `tools/ml-dsa-investigation/research/summarize_registration_profile.py` with the matching B Wasm and symbol map.

For a hosted repeat, use fresh names and credentials for five Workers per profile, following the archived public configs and captured policy.
Keep the same generated wallet fixtures across profiles. Record preparation separately and stop competing work during timing.
The archive's `run_hosted.py` records both wallet runs and sanitized provider traces; its campaign-local paths require adjustment for a fresh run.
Delete completed control Workers before candidate timing. Delete candidate Workers after trace collection.
Do not reuse archived deployment names, upload hashes, or credentials.

To verify the captured result without deploying, decompress the data archive and materialize its `files` entries at their recorded relative paths.
Write JSON entries as JSON and script entries as text. Run the extracted `analyze.py` beside those files.
Its assertions verify key/policy/source parity, exact execution/install joins, all stock ordinals, and provider versions.
Its `analysis.json` profile results must equal the evidence record's `profiles` object.
The embedded source patch and source hashes identify the candidate against base `373f29de`.
The archive excludes raw request headers, role keys, authentication tokens, and cloud account credentials.
