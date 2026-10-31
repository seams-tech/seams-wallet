# ML-DSA threshold protocol

This crate owns passive two-party ML-DSA-65 key generation, preparation, and signing.
It preserves wallet-derived canonical seeds and ordinary FIPS key/signature encodings.
It contains no Cloudflare APIs, HTTP routes, database adapters, or wallet UI.

## Supported integration

Wallet applications use the public Wallet SDK for registration, signing, recovery, device linking, and export.
`NearSigningKeysLifecycle` in `@seams/wallet/advanced` provides the settings workflow.
The Router A/B adapter owns admission, replay handling, cooldowns, durable pools, and separate participant storage.
The protocol crate supplies consuming cryptographic handles. It does not authenticate a wallet request.

The selected Worker construction uses prepared half-gates for canonical key generation.
Preparation and online signing use silent-OT correlations and batched GMW.
The production API has no runtime engine selector or signing-randomness selector.

| Stage | Protocol entry point | State requirement |
| --- | --- | --- |
| Wallet seed derivation | `signing::wallet_seed::prepare_wallet_keygen` | One participant's owner-root share |
| Key generation | `signing::keygen::KeygenStep` and `runtime::prepared` | Pinned circuits and consumed half-gates preparation |
| Whole in-memory key-generation reservation | `runtime::prepared::keygen::prepare_keygen` | Same key-generation steps; the Worker adapter stores tables separately |
| Generic preparation | `signing::prepared_signing::gmw::prepare_gmw_reservations` | Fresh independent reservation identifiers |
| Key commitment | `gmw::commit_gmw_reservations` | Consumed generic reservations, one public key, and one material epoch |
| Generic storage restoration | `gmw::PreparedGmwReservation::from_consumed_storage` | Durably consumed registration stock |
| Signing storage restoration | `gmw::CommittedGmwReservation::from_consumed_storage` | Durably consumed key-bound material |
| Signing activation | `gmw::CommittedGmwReservation::activate` | Matching key, epoch, and role-local signing share |
| Online signing | `gmw::PreparedGmwSigner::sign` | Fresh operation identifier, exact message, and context |

In this table, `gmw` abbreviates `signing::prepared_signing::gmw`.
A generic reservation contains no key, epoch, message, or wallet seed.
Commitment produces a distinct key-bound handle. Online signing accepts that committed state.
The signing loader rejects generic registration stock. It does not choose a protocol from stored bytes.
Each loader validates its expected format. The host must establish durable, irreversible consumption before restoration.
In-memory ownership cannot prevent database rollback or record replay.

Production circuits have one owner: `circuits/` and `src/circuits.rs`.
The ordered key-generation and signing sets pin the complete circuit bytes.
The Worker default remains four-candidate preparation with two-at-once consumption and thirty-two-candidate capacity.
These widths remain host policy. This cleanup changes no pool setting.

## Reference and measurement APIs

The existing `benchmarks` feature enables these separate APIs:

| API | Purpose |
| --- | --- |
| `signing::reference` | Message-bound nonce signing and deterministic FIPS reference comparisons |
| `signing::prepared_signing::half_gates` | Prepared half-gates signing comparisons |
| `runtime::boolean_mpc::comparison` | Fresh-base GMW and ABY2.0 comparisons |
| `signing::prepared_signing::gmw::pool` | In-memory pool experiments without durable admission |
| `benchmarks` | Synthetic-fixture hashing and circuit adapters |

The production Worker dependency leaves this feature disabled.
The investigation CLI and benchmark Worker adapters enable it explicitly.
Reference modes and the in-memory pool cannot select the production wallet protocol.

## Source ownership

- `signing/`: role material, arithmetic, wallet-seed derivation, key generation, and prepared signing.
- `runtime/`: circuit parsing, prepared half-gates, Boolean GMW, and silent correlations.
- `circuits/`: the eleven production artifacts and their pins.
- `benchmarks/`: synthetic-fixture adapters behind the benchmark feature.
- `formal-verification/`: Aeneas extraction and Lean proofs of production scalar arithmetic.

The crate depends on `two-party-primitives` for shared Yao, OT, and private AES.
The same implementation serves Ed25519 and ML-DSA. Its SIMD implementation is enabled
when the build target supports it.
The existing sealed OT family identifiers and wire domains remain unchanged.

Cloudflare admission, durable single use, refill scheduling, and authenticated transport
remain in `router-ab-cloudflare::ml_dsa`. Custody envelopes remain in `signer-core`.
This extraction changes no circuit, nonce, seed derivation, message encoding, consumption
width, or production pool policy. Two-at-once consumption remains a host policy.

## Security and FIPS scope

The passive honest-execution privacy model and release qualification limits still apply.
Wallet-seed recovery reproduces the canonical FIPS ML-DSA seed and key.
The selected signer produces standard ML-DSA-65 signatures with fresh jointly prepared masks.
This mask derivation differs from FIPS 204's message-bound hedged nonce derivation.
Standard key/signature encodings do not establish FIPS signing-algorithm conformance or module validation.
The arithmetic proof does not prove complete protocol privacy or deployment security.
The [MVP qualification report](../../docs/router-ab/ml-dsa-65-mvp-gates-report.md) records the remaining security assumptions.

Run the production arithmetic proof:

```sh
python3 crates/ml-dsa-threshold/formal-verification/check.py
```

Run the existing complete native preparation/recovery/signing campaign:

```sh
cargo run --release --manifest-path tools/ml-dsa-investigation/Cargo.toml -- prepared-keygen /tmp/ml-dsa-native.json
```

## Production circuit ownership

Workers and benchmarks use the same eleven pinned artifacts from this crate.
Benchmark fixture directories contain disposable inputs and comparison circuits.
They are not a production build dependency.

Regenerate with the existing circuit compiler into a disposable directory:

```sh
cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- export-prepared-fixtures /tmp/ml-dsa-prepared-fixtures
```

The exporter compares every generated production circuit with this crate's bytes
and trusted digest. It fails on a mismatch. An intended circuit revision requires
review of both the generated bytes and their pins. Preserve circuit identifiers,
domain strings, digest ordering, and stored formats during a source move.

## API boundary validation

The [retained validation record](../../docs/evidence/ml-dsa-production-api-20261101.json) covers this API cleanup.
A default-feature consumer compiles. Eight invalid consumers fail with the expected compiler errors.
The production dependency tree excludes `benchmarks`.
The record also covers six canonical recovery cases, both reference engines, and real local Worker lifecycles.
Four retained standard signatures verify independently. Altered messages fail verification.

Default-feature Router, A, and B release builds pass.
The Gateway/SDK campaign covers registration, recovery, linked owners, and participant restoration.
The existing native check still requires generic stock to fail before private activation and remain consumed.
Its specific refusal survives the explicit committed-state parser.
All twenty-five protocol domain literals and all eleven production circuits remain unchanged.
The arithmetic proof passes. No hosted latency or release qualification claim follows from these local checks.

To repeat the protocol and API builds from the repository directory:

```sh
cargo check --locked --manifest-path crates/ml-dsa-threshold/Cargo.toml
cargo check --locked --manifest-path crates/ml-dsa-threshold/Cargo.toml --features benchmarks
cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- compare-boolean-engines /tmp/ml-dsa-comparison.json
ML_DSA_WORKER_FIXTURE_DIRECTORY=/tmp/ml-dsa-roles cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- prepared-keygen /tmp/ml-dsa-native.json
```

Build the three roles with `scripts/build-strict-worker.sh <role> ml-dsa` from `crates/router-ab-cloudflare`.
Then run the existing Worker scenarios from the repository directory:

```sh
node tests/e2e/ml-dsa-durable-worker.e2e.mjs /tmp/ml-dsa-roles /tmp/ml-dsa-parallel.json --parallel-refill-only
node tests/e2e/ml-dsa-registration-worker.e2e.mjs /tmp/ml-dsa-registration /tmp/ml-dsa-registration.json
```

Use fresh disposable directories. These scenarios also require the normal local Worker and native-client dependencies.
The bloat gate retains its inherited excess of 238 duplicated Rust lines. This cleanup does not increase that count.
