# ML-DSA-65 investigation

This host tool measures canonical ML-DSA-65 key generation and recovery.
It also measures reference operations and individual Boolean circuits.
It is a benchmark tool. It has no threshold signer or production signing route.

The tool uses four fixed public seeds and one disposable key created jointly by two role processes.
The disposable seed becomes public only after the separate test recipient reconstructs it.
Never use this tool with wallet secrets.
The report CLI accepts sample counts and an output path.
The separate public recovery command accepts a fixture name.

## Run

Use Rust, Unix process pipes, and an OpenSSL version with ML-DSA support.
OpenSSL 3.6.3 is the first
independent implementation used for this evidence.
The tool resolves `openssl` through `PATH` and records the executable digest.

From the repository directory:

```sh
cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- \
  --samples 100 --garbled-samples 3 \
  --output docs/evidence/ml-dsa-65-kernels-20261013.json
```

The tool fails when any reference comparison or rejection check fails.
The JSON contains source digests, dependency versions, raw timing samples,
public fixture digests, measured circuit counts, and reproducible command arguments.
The command records 100 samples for each reference operation and three samples for each successful public garbling workload.
The private pipeline executes each of its five key-generation cases once.
Timing, masks, garbled execution domains, and the disposable key vary between runs.
Fixed reference keys and circuit identities remain stable for unchanged source and dependencies.

## Reference checks

The tool checks four public seeds: zero, incrementing bytes, all `ff`, and alternating
`aa` and `55`. RustCrypto `ml-dsa =0.1.1` and OpenSSL independently derive each key.
The tool compares the complete encoded public key and exported seed.
OpenSSL also exports its 4,032-byte expanded private key for comparison and a digest record.
RustCrypto deprecates expanded-key export. This tool uses its current seed APIs.
It compares deterministic signatures with empty and nonempty FIPS contexts.
Each implementation verifies the other implementation's signature.
Both implementations must reject a changed message, context, signature, and public key.

The message is a fixed 32-byte SHA-256 digest. Its length matches the NEAR
transaction digest interface. This tool does not encode a NEAR transaction or
invoke a NEAR verifier.

A separate reference recipient process reconstructs the public seed from fixed XOR shares.
It must reproduce the same complete signing key, public key, and signatures:

```sh
tools/ml-dsa-investigation/target/release/ml-dsa-investigation recover-public-fixture incrementing
```

This process check does not implement authenticated export or confidential recovery.
The complete private key exists in host memory during each reference operation.

## Public circuit measurements

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

Separate circuits select 256 accepted coefficients in their original order and convert them into additive shares.
Synthetic inputs exercise acceptance boundaries and prefix exhaustion.
Further circuits recombine arithmetic shares, apply `Power2Round`, and produce public high coefficients with masked low coefficients.

Public garbling measurements execute the existing half-gates engine in separate processes.
They transfer both evaluator input labels openly and use no oblivious transfer, abbreviated OT.
This transfer exposes the global label difference and provides no input privacy.
All outputs in these measurements are public fixtures.

The hashing traffic estimate excludes sampling, arithmetic, rounding,
share conversion, OT, input/output labels, authentication, and framing.
Encoded IR and schedules are local artifacts. Their sizes are separate from
estimated table traffic.

The cleartext hybrid check combines seed expansion, bounded sampling, local lattice arithmetic, rounding, and canonical encoding.
It compares the complete public key and expanded private key with OpenSSL for each fixed seed.
This check holds all fixture secrets in one process and establishes arithmetic agreement only.

## Private key generation

Two persistent role processes execute 18 kernels for each key:

1. One seed-expansion kernel accepts one XOR seed share from each role.
2. Eleven sampling kernels consume XOR shares of `rho_prime` and produce additive shares of `s1` and `s2`.
3. Six rounding kernels consume each role's local share of `A*s1+s2` and produce public `t1` with additive shares of `t0`.

The private pipeline uses genuine passive OT and fresh execution domains.
It opens `rho`, `t1`, and each bounded sampler's aggregate success bit.
It never opens complete `rho_prime`, `K`, `s1`, `s2`, `t`, or `t0` during key generation.
Each role discards its `rho_prime` share after sampling.
A generates independent uniform coefficient masks below `q = 8,380,417`.
B receives the corresponding additive residues.
Both roles perform public matrix expansion and linear arithmetic locally.

Four cases split the fixed public seeds with fresh random XOR masks.
In the fifth case, each role independently generates its own random 32-byte seed share.
The parent receives only public results during that case's key generation.
It starts a separate test recipient after both role processes finish.

Each role writes 17,472 bytes of private test material into its own temporary file with mode `0600`:

- A 32-byte seed share and a 32-byte `K` share.
- 2,816 additive residues for `s1` and `s2`.
- 1,536 additive residues for `t0`.

Each residue uses four bytes in little-endian order.
The harness deletes the case directory and its files after the check.
Shared-host files and process separation provide no operating-system isolation or secure-erasure guarantee.

The separate test recipient reconstructs the seed and private components from both files.
It verifies the canonical public key and compares all 4,032 expanded private-key bytes with OpenSSL.
It then signs with the recovered ordinary key and verifies that signature.
These are ordinary recovery signatures. The role processes do not produce threshold signatures.
The artifact publishes every test seed, including the disposable joint-random seed.

Each sampler reads a fixed 481-byte prefix and aborts if fewer than 256 coefficients qualify.
An abort destroys intermediate outputs and never substitutes a different seed.
Secure continuation for the same seed remains unimplemented.

## Limits

The private `ExpandMask` benchmark checks five nonce values through separate roles
with genuine OT. It compares all coefficients with an independent SHAKE oracle.
A receives no decoded output. Five polynomials require 35,584,000 table bytes
per signing attempt. Commitment hashing, checks, hints, and a complete threshold
signature remain open.

Cleartext Boolean evaluation provides no privacy or constant-time guarantee.
Private kernels use the existing passive protocol. Their complete composition still requires review.
Local arithmetic provides no native constant-time guarantee.
The tool does not implement production admission, transport authentication, durable secret storage, or recipient authorization.
The test recipient's authorization is an explicit harness action.
It does not establish an authenticated export flow.

This tool does not execute a threshold signing protocol or Cloudflare cryptography.
Cloudflare transport measurements remain separate from these local process measurements.
Host timing does not establish Worker CPU time, bandwidth, latency, or cost.
Cross-implementation agreement does not establish FIPS module validation.
Classical OT does not establish post-quantum transcript confidentiality.

The [signing options](../../docs/router-ab/ml-dsa-65-signing-options.md) distinguish commitment `w1` from challenge hash `c_tilde`.
Their possible disclosures require separate arguments for this share composition.
The key-generation results approve no additional signing disclosure.

API sources:

- [RustCrypto ML-DSA 0.1.1](https://docs.rs/ml-dsa/0.1.1/ml_dsa/)
- [OpenSSL ML-DSA keys](https://docs.openssl.org/3.6/man7/EVP_PKEY-ML-DSA/)
- [OpenSSL ML-DSA signatures](https://docs.openssl.org/3.6/man7/EVP_SIGNATURE-ML-DSA/)
