# ML-DSA-65 investigation

This host tool measures public reference operations and Boolean hashing kernels.
It is a benchmark tool. It has no production signing route.

Every seed, share, private key, message, and signature is a fixed public fixture.
The CLI accepts fixture names, sample counts, and an output path.
It does not accept seed bytes or wallet material.

## Run

Use Rust and an OpenSSL version with ML-DSA support. OpenSSL 3.6.3 is the first
independent implementation used for this evidence.
The tool resolves `openssl` through `PATH` and records the executable digest.

From the repository directory:

```sh
cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- \
  --samples 100 --output docs/evidence/ml-dsa-65-foundation-20261013.json
```

The tool fails when any reference comparison or rejection check fails.
The JSON contains source digests, dependency versions, raw timing samples,
public fixture digests, measured circuit counts, and reproducible command arguments.
Timing samples vary between runs. Fixed fixture digests and circuit identities
must remain stable for unchanged source and dependencies.

## Checks

The tool checks four public seeds: zero, incrementing bytes, all `ff`, and alternating
`aa` and `55`. RustCrypto `ml-dsa =0.1.1` and OpenSSL independently derive each key.
The tool compares the complete encoded public key and exported seed.
OpenSSL also exports its 4,032-byte expanded private key for a size and digest record.
RustCrypto deprecates expanded-key export. This tool uses its current seed APIs.
It compares deterministic signatures with empty and nonempty FIPS contexts.
Each implementation verifies the other implementation's signature.
Both implementations must reject a changed message, context, signature, and public key.

The message is a fixed 32-byte SHA-256 digest. Its length matches the NEAR
transaction digest interface. This tool does not encode a NEAR transaction or
invoke a NEAR verifier.

A separate recipient process reconstructs the public seed from fixed XOR shares.
It must reproduce the same complete signing key, public key, and signatures:

```sh
tools/ml-dsa-investigation/target/release/ml-dsa-investigation recover-public-fixture incrementing
```

This process check does not implement authenticated export or confidential recovery.
The complete private key exists in host memory during each reference operation.

## Hash kernels

The existing generator compiles these fixed Boolean circuits:

- Full Keccak-f[1600], with all 24 rounds.
- `SHAKE256((share_a XOR share_b) || [6, 5], 128)` for seed expansion.
- `SHAKE256(rho_prime || LE16(nonce), 481)` for each nonce from 0 through 10.

The tool compares cleartext circuit output against `keccak =0.1.6` and
`sha3 =0.10.8`. Seed expansion checks every pair of the four independent share
patterns. Each kernel rejects malformed input lengths.

The report counts AND gates, reusable schedule slots, and encoded artifact bytes.
It estimates half-gate table bytes as `AND gates × 32`, assuming 128-bit labels.
The hashing total adds one seed circuit and eleven polynomial circuits.
The permutation control circuit is separate from that total.

The fixed polynomial prefix does not implement rejection sampling or exhaustion
handling. The traffic estimate excludes sampling, arithmetic, rounding,
share conversion, oblivious transfer, input/output labels, authentication, and framing.
Encoded IR and schedules are local artifacts. Their sizes are separate from
estimated table traffic.

## Limits

Cleartext Boolean evaluation provides no privacy or constant-time guarantee.
This tool does not execute Yao garbling, a threshold signing protocol, or Cloudflare.
Host timing does not establish Worker CPU time, bandwidth, latency, or cost.
Cross-implementation agreement does not establish FIPS module validation.

API sources:

- [RustCrypto ML-DSA 0.1.1](https://docs.rs/ml-dsa/0.1.1/ml_dsa/)
- [OpenSSL ML-DSA keys](https://docs.openssl.org/3.6/man7/EVP_PKEY-ML-DSA/)
- [OpenSSL ML-DSA signatures](https://docs.openssl.org/3.6/man7/EVP_SIGNATURE-ML-DSA/)
