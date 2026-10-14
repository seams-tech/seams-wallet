# Native ML-DSA research screens

These harnesses use disposable public fixtures or fresh disposable correlation secrets.
They provide resource measurements. They do not implement a production Wallet route.
The [communication plan](../../../docs/router-ab/ml-dsa-65-low-communication-plan.md) records decisions and limitations.

## Silent binary triples

Prerequisites: CMake, Ninja, a C++20 compiler, and Git.
The recorded host uses macOS arm64, native ARM AES, and a release build.
Use temporary source and build directories. Do not modify the system toolchain.

From the Wallet repository:

```sh
git clone https://github.com/osu-crypto/libOTe /private/tmp/ml-dsa-libote-screen
git -C /private/tmp/ml-dsa-libote-screen checkout c1796737a91e5142b22ad7564f22bed1d9f2d957
git -C /private/tmp/ml-dsa-libote-screen submodule update --init --recursive
mkdir -p /private/tmp/ml-dsa-libote-screen/out
cp tools/ml-dsa-investigation/research/silent_triples_screen.cpp /private/tmp/ml-dsa-libote-screen/silent_triples_screen.cpp
```

Append this target to the temporary clone's `CMakeLists.txt` once:

```cmake
add_executable(ml_dsa_triples_screen silent_triples_screen.cpp)
target_link_libraries(ml_dsa_triples_screen libOTe)
target_compile_features(ml_dsa_triples_screen PRIVATE cxx_std_20)
```

Configure and build:

```sh
cmake -S /private/tmp/ml-dsa-libote-screen -B /private/tmp/ml-dsa-libote-build -G Ninja \
  -DLIBOTE_BUILD_DIR=/private/tmp/ml-dsa-libote-build \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX=/private/tmp/ml-dsa-libote-install \
  -DFETCH_AUTO=ON -DENABLE_BOOST=OFF -DENABLE_OPENSSL=OFF \
  -DENABLE_SIMPLESTOT=ON -DENABLE_IKNP=ON \
  -DENABLE_SILENTOT=ON -DENABLE_SOFTSPOKEN_OT=ON \
  -DENABLE_SPIN=OFF -DENABLE_LOGVOLE=OFF -DENABLE_MOCK_OT=OFF
cmake --build /private/tmp/ml-dsa-libote-build --target ml_dsa_triples_screen -j4
python3 tools/ml-dsa-investigation/research/run_silent_triples_screen.py \
  /private/tmp/ml-dsa-libote-screen /private/tmp/ml-dsa-libote-build \
  /private/tmp/ml-dsa-silent-triples.json
```

The runner records source, dependency, binary, harness, and CMake-cache identities.
Each sample starts a new process and fresh real base OT.
The harness configures both inner engines before base setup and records effective dimensions.
It includes a warm-up, an unaligned request, and three repetitions at each bounded chunk size.
All generated triples, including padding, must pass the product relation and independent shared-AND checks.
Socket counters must agree in both directions.

The shared-AND check reconstructs disposable values in the harness after timing.
It proves algebraic correctness for these samples. It does not prove party isolation or triple privacy.
The measured memory peak covers both roles in one process. It is not a per-Worker measurement.
The primitive's native AES implementation remains outside constant-time qualification.

## Mithril comparison

Prerequisites: Go and Node with OpenSSL ML-DSA support.
The retained artifact uses Go 1.27.2 and Node 26.4.0 / OpenSSL 3.6.3.
It records the checksum-verified temporary Go toolchain.

```sh
git clone https://github.com/Threshold-ML-DSA/Threshold-ML-DSA /private/tmp/ml-dsa-mithril-screen
git -C /private/tmp/ml-dsa-mithril-screen checkout 66e269e75dd8f5d722675a3d276a1aedc58bc4ef
mkdir -p /private/tmp/ml-dsa-mithril-screen/threshold-mldsa-bench/screen
cp tools/ml-dsa-investigation/research/mithril_screen.go /private/tmp/ml-dsa-mithril-screen/threshold-mldsa-bench/screen/main.go
```

From `/private/tmp/ml-dsa-mithril-screen/threshold-mldsa-bench`:

```sh
GOCACHE=/private/tmp/ml-dsa-go-cache GOPATH=/private/tmp/ml-dsa-go-work GOTOOLCHAIN=local \
  go run ./screen /private/tmp/ml-dsa-mithril.json
```

From the Wallet repository:

```sh
node tools/ml-dsa-investigation/research/verify_mithril_screen.mjs /private/tmp/ml-dsa-mithril.json
```

The harness creates one warm-up and 100 measured signatures with a public zero seed.
It counts all retry messages, both parties, all rounds, and both final combinations.
Verification and consumed-state replay checks follow the timer.
The Node verifier independently checks every standard signature and rejects an altered message.
It also imports the canonical FIPS seed through OpenSSL and confirms the ordinary reference public key.
The threshold library's default seed path yields a different public key and fails the canonical identity requirement.
This result excludes that default path. It does not establish that every possible canonical sharing construction is impossible.

## Payload model

Run the model against retained evidence:

```sh
python3 tools/ml-dsa-investigation/research/low_communication_model.py \
  docs/evidence /private/tmp/ml-dsa-low-communication-model.json
```

The model verifies its packed opening formula against existing four- and 32-candidate GMW wire counters.
It uses recorded circuit counts and measured silent-triple chunk bytes.
It includes byte-lane padding and final correlation-chunk padding.
It lists excluded costs and unmeasured integration work in the output.
Its expected attempt count and p99 reservation count are mathematical models.
They do not establish measured service latency, reliability, or complete signing traffic.

Do not hand-edit measured values. Rerun the relevant harness and retain new provenance.

## Complete Rust and Worker prototype

The [October 15 report](../../../docs/router-ab/ml-dsa-65-silent-prototype-report.md) contains the complete implementation and hosted results.
The Rust adapter uses the pinned core/code dependencies under `crates/ed25519-yao/vendor`.
It uses real full-block IKNP, fixed PPRF dimensions, and a consuming correlation stream.
Its 262,464-byte chunk cost supersedes the earlier libOTe chunk forecast for this implementation.

From the repository:

```sh
cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- \
  silent-correlations /private/tmp/ml-dsa-silent-correlations.json
cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- \
  prepared-keygen /private/tmp/ml-dsa-silent-complete.json
cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- \
  prepared-gmw /private/tmp/ml-dsa-silent-mixed.json
```

The first command uses separate role processes and reconstructs disposable correlations only after timing.
It checks every triple, a shared AND, directional counts, and a mismatched reservation.
The complete command verifies threshold signatures before authorized canonical recovery.
Its GMW controls use four and eight candidates. An exhausted reservation is a recorded unsuccessful request.

Build both Worker roles with the [pinned Wasm helper](../../../docs/router-ab/ml-dsa-65-prepared-hosted-report.md#reproduce-the-worker-campaign).
Then inspect the exact bundles and run the local control:

```sh
cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- \
  inspect-silent-wasm /private/tmp/ml-dsa-silent-wasm.json
node crates/ed25519-yao-cloudflare-bench/scripts/run_prepared_keygen.mjs \
  --operation gmw-signing --local --indices 0,1,2 --output /private/tmp/ml-dsa-silent-local.json
```

The Wasm command records selected function bodies and the containing async caller.
It retains divisions, branches, selections, and indirect calls for data-flow review.
The separate secret-arithmetic inspection retains its strict division and indirect-call checks.
An instruction inventory alone proves no timing property.

The current Worker benchmark uses four candidates per reservation.
The eight-candidate hosted control changed only that public capacity before rebuilding and deploying both roles.
Record source/build hashes and deployment versions for every control.
Use temporary Workers, a private temporary bucket, and a benchmark-only route token.
After the campaign, confirm every cleanup acknowledgment and remove its cloud resources.

Capture runtime traces privately. This collector retains only selected public fields:

```sh
python3 tools/ml-dsa-investigation/research/collect_worker_traces.py \
  /private/tmp/tail-a.jsonl /private/tmp/tail-b.jsonl /private/tmp/public-traces.json
```

Remove raw traces and the token after preserving the sanitized artifact and confirming resource cleanup.
Cloudflare can redact query request IDs. The product summary therefore matches aggregate operation/version counts.
Reproduce the retained summary with:

```sh
python3 tools/ml-dsa-investigation/research/summarize_silent_prototype.py \
  --four docs/evidence/ml-dsa-65-silent-four-worker-hosted-20261015.json \
  --eight docs/evidence/ml-dsa-65-silent-eight-worker-hosted-20261015.json \
  --keygen docs/evidence/ml-dsa-65-silent-keygen-worker-hosted-20261015.json \
  --traces docs/evidence/ml-dsa-65-silent-worker-traces-20261015.json \
  --four-versions 2b453983-71b2-4f46-845f-f97dc9702b4d b92763b2-bc83-479c-b94f-a398530cc1cf \
  --eight-versions 21436376-aec4-4329-a716-8561aa67b2b6 0b3cd47b-d198-4e2b-9db2-8126f10d8460 \
  --output /private/tmp/ml-dsa-silent-summary.json
```

The summary excludes exhausted requests from successful-signature latency statistics.
It includes their CPU cost when computing the observed cost per verified signature.

## Generic preparation and activation

The [follow-up report](../../../docs/router-ab/ml-dsa-65-generic-preparation-report.md) separates generic preparation from key activation.
The current `gmw-signing` Worker benchmark includes activation and signing in its client timer.
The initial hosted control's zero activation-clock readings are invalid timing evidence.

Reproduce the native E2E, including key/epoch mismatch rejection and canonical recovery:

```sh
cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- \
  prepared-keygen /private/tmp/ml-dsa-generic-native.json
```

After building both benchmark Workers, run the existing harness locally or against temporary hosted Workers:

```sh
node crates/ed25519-yao-cloudflare-bench/scripts/run_prepared_keygen.mjs \
  --operation gmw-signing --local --indices 0,1,2 \
  --output /private/tmp/ml-dsa-client-activation-local.json
```

Regenerate the retained summary from its raw artifacts:

```sh
python3 tools/ml-dsa-investigation/research/summarize_generic_preparation.py \
  --hosted docs/evidence/ml-dsa-65-client-activation-worker-hosted-20261015.json \
  --native docs/evidence/ml-dsa-65-generic-native-20261015.json \
  --traces docs/evidence/ml-dsa-65-client-activation-worker-traces-20261015.json \
  --control docs/evidence/ml-dsa-65-generic-worker-clock-control-20261015.json \
  --versions 3a9a67ff-670b-4fe4-94f5-892e200291db 01ad4839-efe7-42bb-8de2-75afc68c05d8 \
  --output /private/tmp/ml-dsa-generic-preparation-screen.json
```

The summary includes exhausted requests in payload and CPU totals.
Generic preparation still runs for every benchmark request; no persistent ready pool is implied.

## Ready pool, rollover, and refill

The [pool report](../../../docs/router-ab/ml-dsa-65-ready-pool-report.md) separates registration, signing, exhaustion, and replenishment.
Preparation optimization is deferred. The integration queue lives in the investigation plan.
The native `prepared-keygen` command above also runs drain, refill, replay, and cancellation scenarios.

Build each role from `crates/ed25519-yao-cloudflare-bench`:

```sh
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS='-C target-feature=+simd128' \
  worker-build --release --out-dir build/ml-dsa-b --features ml-dsa-b
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS='-C target-feature=+simd128' \
  worker-build --release --out-dir build/ml-dsa-a --features ml-dsa-a
```

From the repository root, run the complete local pool scenario:

```sh
node crates/ed25519-yao-cloudflare-bench/scripts/run_ready_pool.mjs \
  --local --initial-batches 10 --refill-batches 1 --indices 0,1,8 \
  --output /private/tmp/ml-dsa-ready-pool-local.json
```

For hosted runs, deploy the two temporary prepared configs from their crate directory.
Supply an approved disposable `PROBE_TOKEN` to both Workers.
Replace `--local` with `--endpoint URL --secrets-file PATH`.
The private JSON file contains the token and must never enter an evidence artifact.
Use `--initial-batches 1 --refill-batches 10 --indices 2` to exercise ten-batch refill.
Collect both Wrangler JSON tails, sanitize them with `collect_worker_traces.py`, and remove the temporary Workers and R2 bucket afterward.

Regenerate the frozen hosted summary:

```sh
python3 tools/ml-dsa-investigation/research/summarize_ready_pool.py \
  --campaigns docs/evidence/ml-dsa-65-ready-pool-hosted-ten-20261015.json \
    docs/evidence/ml-dsa-65-ready-pool-hosted-refill-ten-20261015.json \
  --traces docs/evidence/ml-dsa-65-ready-pool-worker-traces-20261015.json \
  --native docs/evidence/ml-dsa-65-ready-pool-native-20261015.json \
  --versions 9bac490b-4b82-453d-ac61-fad56389f427 72956410-1b8c-48dc-b30d-a33efa5e493b \
  --output /private/tmp/ml-dsa-ready-pool-summary.json
```

The current source includes the later public encoder iteration change, with native and local evidence only.
The hosted summary pins its earlier exact binaries and source hashes.
A profiler is available for deferred optimization work:

```sh
node crates/ed25519-yao-cloudflare-bench/scripts/profile_prepared_worker.mjs \
  /private/tmp/ml-dsa-preparation-profile.json
```

Fat-LTO trials use the same build and harness with `CARGO_PROFILE_RELEASE_LTO=fat` and `CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1`.
The bulk-copy trial has a retained patch in the report. Neither trial is enabled in the selected source.
