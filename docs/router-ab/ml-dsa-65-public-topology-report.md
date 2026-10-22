# ML-DSA public topology screen

Keep the current runtime. This prototype does not show a benefit sufficient to justify its larger Wasm module.
The runtime changes are removed. A reproducible patch and the test evidence remain archived.
The [evidence record](../evidence/ml-dsa-65-public-topology-20261023.json) binds the source patch, generated layouts, binaries, and controls.

This decision applies to the tested encoding and loader. It does not disprove the first-use hypothesis or establish a hosted slowdown.
No Worker was deployed during this screen. The previous [hosted results](ml-dsa-65-client-isolation-report.md) remain the latest hosted measurements.
Consistent registration and signing below five seconds remain unqualified.

## What was tested

A public execution topology maps circuit gates to layers and memory locations.
The prototype generates this table before deployment and embeds it in each Worker.
The evaluator reads fixed-width little-endian fields directly from those bytes.
It retains small layer descriptors and avoids allocating a second decoded graph.

Each loader checks a pinned SHA-256 digest, source schedule identity, counts, lengths, references, and canonical tags.
The build tool compares every gate, global AND ordinal, layer entry, and output against the existing compiler.
Exact order matters because stored private correlations use those AND ordinals.
The loader still performs hashing and validation on first use.

The six public encodings total 29,907,052 bytes. They contain no key, nonce, mask, or private correlation.
The original circuit schedules remain embedded because other runtime operations still use them.
Wallet-seed recovery, standard FIPS export, output ownership, and private commitments stay unchanged.
Preparation makes four candidates; signing consumes two at a time.
The Worker controls retain thirty-two candidates per wallet and require sixteen for admission.

Independent review found one integration issue before testing: registration preparation still created an owned graph.
The prototype was corrected to use the shared encoded cache.
The archived patch includes that correction. Review found no remaining core mapping or bounds issue.

## Measurements

Module sizes below measure the standalone Wasm file. They are not complete Worker packages or Wrangler upload sizes.
MB means decimal bytes; MiB means 1,048,576 bytes.

| Participant A measurement | Current runtime | Prototype |
| --- | ---: | ---: |
| Wasm file | 46.250 MB | 76.162 MB |
| Gzipped Wasm file | 23.165 MB | 34.327 MB |
| Declared minimum Wasm memory | 38.250 MiB | 66.750 MiB |
| Maximum observed Wasm memory | 90.063 MiB | 86.938 MiB |

Participant B's maximum falls from 89.563 to 87.375 MiB.
These maxima describe allocated Wasm pages at logging boundaries. They exclude JS heap and do not establish total isolate peak memory.
The memory counter calibration passes in both runs.
Native graph-size reductions are larger because native indices use 64 bits; Wasm indices already use 32 bits.

One complete local workerd lifecycle runs for each build, sequentially after compilation.
Each passes refill, duplicate and replay handling, restart, interrupted publication, queue handling, and expiry checks.
Both produce three timed standard signatures plus the automatic empty-pool retry signature.

| Timed operation | Current runtime | Pairs | Prototype | Pairs |
| --- | ---: | ---: | ---: | ---: |
| After automatic empty-pool retry | 282.407 ms | 4 | 260.951 ms | 3 |
| First signing call after restart | 244.092 ms | 1 | 464.694 ms | 3 |
| Next signing call | 159.743 ms | 2 | 117.569 ms | 1 |
| Total | 686.242 ms | 7 | 843.213 ms | 7 |

The sample is small, and rejection counts differ. These totals do not prove a performance regression.
The post-restart operation builds four topologies in the current runtime and zero in the prototype.
Its different pair count prevents a controlled cold-start comparison.
Memory sampling covers initial refill; it does not overlap the timed signing requests.
No hosted latency or sustained throughput claim follows from this local screen.

In one native public-layout screen, compilation plus encoding totals 23.500 ms.
Loading, hashing, and validation total 56.853 ms, excluding the preceding owned-buffer copy.
These uncontrolled native observations cannot predict Wasm or Cloudflare speed.
The mixed-role engine test also has asymmetric setup timers. Use that test for correctness, without comparing its setup times.

A separate local Worker registration campaign also passes creation, recovery, and lost-participant restoration through the Gateway integration.
Prepared creation takes 1.422 seconds; recovery takes 1.446 seconds, including client verification.
Those durations exclude 20.837 and 39.288 seconds of initial preparation.
There is no matched registration baseline in this screen. These local results do not establish hosted latency or a registration speedup.

## Correctness evidence

- All six generated layouts pass exact structural comparison and seven rejection controls each.
- Independent decoding confirms every gate, layer entry, and output against the original schedules. All six Worker pins match.
- Separate participants using encoded and computed layouts agree on all 105 mixed outputs and 168 batched AND layers.
- All six native key-generation cases reproduce the canonical key. Authorized export reproduces the canonical FIPS seed.
- Stored computed-layout correlations restore through the encoded layout on A and the computed layout on B.
- The durable signer still rejects changed identity, layout, length, key, and epoch. Replay and duplicate checks pass.

The frozen source manifest covers the new topology module, which the native report's existing source list does not include.
The archived prototype changes public layout access only. Its new indices and branches depend on public circuit data.
This bounded review does not replace the final protocol and library security review.

## Facts and remaining causes

| Fact | Instrument and scope | Check |
| --- | --- | --- |
| Exact circuit and correlation ordering is preserved | Generator, independent decoder, mixed private execution | All six layouts and 105 outputs pass |
| The module grows by about 30 MB raw and 11 MB compressed | Frozen Wasm files, SHA-256, gzip | Exact file sizes and hashes retained |
| Observed Wasm savings are 2–3 MiB | Calibrated page counter in local Workers | Both complete lifecycle controls pass |
| The prototype removes dynamic builds but shows no demonstrated latency benefit | Completed role traces and client timers | Pair counts and first-use markers retained |
| Warm hosted exhaustion can exceed five seconds | Previous hosted campaign | Two operations have zero topology builds |

| Candidate cause or claim | Evidence | Remaining conclusion |
| --- | --- | --- |
| Topology construction explains every hosted tail | Warm exhausted operations exceed five seconds | Insufficient explanation |
| Embedded tables eliminate first-use work | Their loader still hashes and validates about 30 MB | False for this implementation |
| Smaller native topology allocations imply large Worker savings | Wasm fields already use 32 bits; observed savings are small | Native allocation ratios do not transfer |
| The new reader or validation adds cost | Native loader costs more in this screen; local signing has no clear gain | Plausible; no isolated Wasm attribution |
| Test order, retries, or runtime state affect timings | One sequential run per build; different pair counts | Remain possible |
| Protocol exchanges explain long hosted retries | Online depth is unchanged | Requires a separate protocol comparison |

Product parity for cold starts and hosted tails is not established.
A renewed layout experiment needs matched pair counts and first-use CPU measurements, plus complete isolate-memory accounting.
It must demonstrate enough benefit to justify the added module data before deployment.

## Next implementation work

1. Compare half-gates for the private commitment hash with the current GMW path. Keep private bounds in GMW and preserve all existing disclosures.
   The hash accounts for 168 of 214 online AND layers per committed pair.
   Measure preprocessing, input conversion, table delivery, storage, memory, and full successful-signature cost together.
   Two candidate hashes alone need 17,125,376 garbled-table bytes, before other state or transport overhead.
2. Reduce the measured registration critical path. Keep canonical seed derivation, durable role installation, and initial-stock delivery in the request accounting.
3. Run a hosted comparison for a candidate that passes those cost checks. Keep the current pool capacity and record failed operations and empty-pool demand waits.

GPU work and UI changes remain deferred.

## Final validation

Runtime source matches the base revision after prototype removal. The native release rebuild passes.
Archive digests verify, and the archived patch passes `git apply --check` against the restored source.
`pnpm report:bloat --check` still fails on the existing Rust duplicate-line count: 14,030 against a 13,754 baseline.
The baseline remains unchanged. No runtime source change remains from this experiment.

## Reproduction

Use a disposable copy of base revision `593a3351`. The archive contains source changes, not generated topology blobs.
Apply the archived patch, build `tools/ml-dsa-investigation`, and run `export-prepared-fixtures` into a private directory.
Copy its six `.topology` files into `crates/ed25519-yao-cloudflare-bench/src/ml_dsa_schedules/`.
The generator verifies the layouts before writing them. Compare their digests with the evidence record.

Run `prepared-gmw` for the mixed private engine check.
Run `prepared-keygen` with `ML_DSA_WORKER_FIXTURE_DIRECTORY` set to a private output directory for the full native check and Worker fixtures.
Build the three strict release Workers with `scripts/build-strict-worker.sh` from `crates/router-ab-cloudflare`.
Run `tests/e2e/ml-dsa-durable-worker.e2e.mjs` with those fixtures, `--profile-memory`, and `--passive-preparation-observer`.
Use `ML_DSA_TEST_BUILD_ROOT` to select frozen builds and run them sequentially.
The evidence retains the exact analyzer scripts, source hashes, build stamps, and local artifacts.
