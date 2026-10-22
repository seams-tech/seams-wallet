# ML-DSA private commitment-hash comparison

Keep GMW for the current streamed private-hash path. Prepared half-gates loses this Cloudflare latency comparison.
The complete probe is archived and removed from the active runtime. Its shared R2 cleanup fix remains.
The [evidence record](../evidence/ml-dsa-65-private-hash-20261023.json) contains measurements, archive hashes, and scope limits.

This screen measures one signing component. It establishes no improvement to complete signing, registration, or sustained refill.
The [independent-client campaign](ml-dsa-65-client-isolation-report.md) remains the latest complete hosted signing measurement.
Consistent registration and signing below five seconds remain unqualified.

Each session prepares four private commitment hashes, then consumes two independent pairs under different requests.
The existing circuit has 267,584 AND gates per hash. GMW evaluates both hashes in 168 dependent AND layers.
Both backends use that circuit, fresh preparation, separate participants, and the same public synthetic inputs.
The backend order alternates across three rounds. No build, deployment, or competing benchmark runs during timing.

| Hosted measurement | Prepared GMW | Prepared half-gates |
| --- | ---: | ---: |
| Four-hash preparation, median | 3.972 s | 6.714 s |
| Four-hash preparation, range | 3.923–6.100 s | 6.329–8.165 s |
| Two-hash online execution, median | 0.145 s | 0.816 s |
| Two-hash online execution, range | 0.066–0.194 s | 0.699–1.134 s |
| Preparation A/B payload | 1,312,809 B | 35,468,705 B |
| Online A/B payload per pair | 1,070,661 B | 608,101 B |
| R2 tables written per preparation | 0 | 34,254,944 B |
| R2 tables read per pair | 0 | 17,127,472 B |
| Private encoded state per pair, A / B | 802,976 / 802,976 B | 606,432 / 198,432 B |

There are six online pair measurements per backend. Every GMW pair finishes before the fastest half-gates pair.
The ratio of online medians is 5.63. This small screen does not establish a tail-latency bound.

The client preparation timer starts before connection setup and stops after both participants report ready.
Half-gates readiness requires both R2 objects to finish uploading. No table is read before readiness.
The online timer starts when the client sends the pair request.
It includes input conversion, private execution, streamed reads, exact end-of-stream checks, and both participant reports.
Only then does the client send a separate finish request. Cleanup and clean WebSocket closure occur afterward.
Cleanup takes 11–13 ms for GMW and 312–363 ms for half-gates in this screen.

Each half-gates pair reads one R2 object containing 262 frames.
Its raw tables occupy 17,125,376 bytes; frame headers add 2,096 bytes.
The A/B payload counts exclude WebSocket envelopes, acknowledgements, completion reports, TCP/TLS, and R2 transport overhead.
They are useful protocol counts, not total billed traffic.

Half-gates has resource benefits despite its higher latency.
Its aggregate provider CPU is 9,411 ms across six participant invocations, compared with 12,608 ms for GMW.
Those CPU totals cover preparation, both online pairs, and cleanup together. They cannot isolate online CPU or storage waits.
GMW's internal readiness clocks report 0–4 ms despite 3.9–6.1 seconds of client preparation time.
Those phase clocks remain unqualified. The latency comparison uses the client's independent clock.
Half-gates also has smaller encoded private state and lower observed Wasm page allocation.
Wasm page counts exclude the JS heap and host buffers, so total isolate peak memory remains unknown.

The A request enters through NRT. B location is unavailable, and no R2 location hint was supplied.
This record does not establish participant or storage colocation.
Provider traces contain the expected versions and thirteen `ok` outcomes, including the unauthorized-request control.
Public kernel names identify each backend. B cleanup events join all six B invocations to exact client run IDs.
A run IDs are redacted. No exact A run join is asserted.

The fresh standalone GMW setup differs from production refill, which shares correlation setup with other circuits.
The probe holds private state in live role memory and stores raw input-independent garbled tables in R2.
It excludes authenticated persistence, durable admission, private-state restoration, and restart costs.
The measured preparation times are not complete presignature preparation times.
Full-signer parity is not established, and these component durations must not be subtracted from previous signing results.

Wallet-seed recovery, standard FIPS seed/key export, and private commitment handling remain unchanged.
Production still prepares four candidates and consumes two at a time, with thirty-two candidates per wallet and sixteen required for admission.
The sixty-second production cooldown remains unchanged. GPU work and UI changes remain deferred.

The native E2E passes eleven scenarios: normal execution, pair/request/message mismatches, first-pair interruption for both backends, and backend mismatch.
The local Worker E2E passes six normal sessions and twelve controls.
Those controls cover cancellation, duplicate and out-of-order consumption, corrupt or truncated tables, timeout, disconnect, storage failure, and lost completion replies.
All six hosted sessions pass. An independent SHAKE implementation verifies twenty-four hash results and both roles' forty-eight reported copies.
All hosted sessions observe normal peer closure before normal client closure.
Each consumed half-gates object is deleted and checked after the online timer stops.

The storage controls exposed a cleanup gap. The old completion path removed the writer before awaiting the R2 completion reply.
A lost reply could therefore remove the upload identity and object key from cleanup's inventory.
The retained fix keeps both until completion returns. Cleanup includes the pending key even when the provider may have committed the object.
Cleanup attempts object deletion even if abort fails, and it preserves the abort error instead of acknowledging success.
The local lost-reply control completes a real 17,127,472-byte object, stalls its reply, reaches the deadline, and verifies removal.
Creation-response loss and durable private-state recovery remain outside this probe.
R2 completion and resume semantics follow the [Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).

Two earlier local failures remain in the archive.
The first relied on delayed console output and interrupted after uploads had completed; it did not exercise the claimed partial-upload boundary.
The final control injects the fault inside the storage wrapper immediately after actual persistence.
The second was a Miniflare module-loading error. An explicit ESModule rule fixed loading of the generated Worker entry point.
These failures do not count as passing controls. The final local artifact passes both replacement cases.

| Fact | Instrument and scope | Check |
| --- | --- | --- |
| Workload and outputs agree | Native processes, Worker roles, independent SHAKE oracle | All expected outcomes and all hosted results pass |
| Table I/O is online | Adapter counters and client timer boundaries | Zero reads before ready; one complete object per pair |
| GMW is faster in this screen | Six client pair timers per backend | Disjoint observed ranges |
| Half-gates uses less whole-session CPU | Backend-labelled provider traces | 9,411 ms versus 12,608 ms; stage attribution unavailable |
| Cleanup survives a lost completion reply | Local R2 wrapper after actual completion | Completed object removed; normal and failure closures checked |

| Candidate claim or cause | Evidence | Conclusion |
| --- | --- | --- |
| Fewer dependent exchanges make this hash faster | Half-gates loses every observed pair comparison | Rejected for this streamed implementation |
| Rejection counts explain the difference | Both backends run the same fixed four hashes | Rejected for this screen |
| Table transfer or storage waits cause the slowdown | Half-gates adds 17.13 MB of R2 reads per pair; whole-session CPU is lower | Plausible; storage and evaluation are not separately timed |
| GMW dominates all resource costs | Half-gates has smaller private state and lower measured CPU | Rejected |
| This result predicts complete signing latency | Durable storage, other circuits, and rejection loops are absent | Unsupported |

Next implementation work:

1. Reduce registration stock delivery and activation cost. Preserve canonical key derivation, durable installation, and full client timing.
2. Measure complete multi-pair signing at storage/restore and protocol boundaries before another backend change.
3. Test the resulting change with complete hosted registration, signing, and sustained refill. Keep capacity fixed and count failed and waiting operations.

The final active change is limited to streamed benchmark-table cleanup. Both Worker roles compile for Wasm after probe removal.
Independent review supports the bounded result and the archive decision.
Both temporary Workers and the R2 bucket are deleted; their cleanup receipts are retained.
`pnpm report:bloat --check` still reports the existing Rust duplicate-line excess: 14,030 against a baseline of 13,754.
The baseline remains unchanged.

To repeat the experiment, use a disposable checkout of base `90cb95423d51564af7f8c9570efdbdb62f96db91`.
Decompress and apply [the prototype patch](../evidence/ml-dsa-65-private-hash-20261023-prototype.patch.gz).
The patch was replayed through a temporary Git index and reproduced all fourteen frozen source hashes.
The [provenance archive](../evidence/ml-dsa-65-private-hash-20261023-provenance.json.gz) contains public fixture books, schedule hashes, build commands, deployment versions, and the extraction source.
It contains no authentication token or cloud account credential.

```sh
cargo build --locked --release --manifest-path tools/ml-dsa-investigation/Cargo.toml
tools/ml-dsa-investigation/target/release/ml-dsa-investigation prepared-hash /tmp/hash-native.json
tools/ml-dsa-investigation/target/release/ml-dsa-investigation export-worker-fixtures /tmp/hash-fixtures
tools/ml-dsa-investigation/target/release/ml-dsa-investigation export-prepared-fixtures /tmp/hash-fixtures
```

Copy the generated schedules and fixture books into `crates/ed25519-yao-cloudflare-bench/src/ml_dsa_schedules/`.
For the captured fixture bytes, replace the generated JSON books with those in the provenance archive.
Build A and B sequentially from the benchmark crate with `worker-build --release --out-dir build/ml-dsa-a --features ml-dsa-a`, then the corresponding B command.
Set `CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS='-C target-feature=+simd128'` for both builds.
Run `node tests/e2e/ml-dsa-private-hash.e2e.mjs /tmp/hash-local.json local` from the repository root.
For a new hosted screen, use fresh disposable Worker names, an R2 bucket, and a benchmark token.
Pass the A URL and token-file path in place of `local`. Collect both tails and delete all temporary resources afterward.
