# ML-DSA threshold protocol

This crate owns passive two-party ML-DSA-65 key generation, preparation, and signing.
It preserves wallet-derived canonical seeds and ordinary FIPS key/signature encodings.
It contains no Cloudflare APIs, HTTP routes, database adapters, or wallet UI.

- `signing/`: arithmetic, wallet-seed derivation, key generation, and signing.
- `runtime/`: private circuits, prepared Yao evaluation, GMW, and silent correlations.
- `benchmarks/`: synthetic-fixture adapters enabled only by the `benchmarks` feature.
- `formal-verification/`: Aeneas extraction and Lean proofs of production scalar arithmetic.

The crate depends on `two-party-primitives` for shared Yao, OT, and private AES.
The same implementation serves Ed25519 and ML-DSA. The `simd` feature enables
Wasm SIMD when the build target supports it.
The existing sealed OT family identifiers and wire domains remain unchanged.

Cloudflare admission, durable single use, refill scheduling, and authenticated transport
remain in `router-ab-cloudflare::ml_dsa`. Custody envelopes remain in `signer-core`.
This extraction changes no circuit, nonce, seed derivation, message encoding, consumption
width, or production pool policy. Two-at-once consumption remains a host policy.

The passive honest-execution privacy model and release qualification limits still apply.
The arithmetic proof does not prove complete protocol privacy or deployment security.

Run the production arithmetic proof:

```sh
python3 crates/ml-dsa-threshold/formal-verification/check.py
```

Run the existing complete native preparation/recovery/signing campaign:

```sh
cargo run --release --manifest-path tools/ml-dsa-investigation/Cargo.toml -- prepared-keygen /tmp/ml-dsa-native.json
```
