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
