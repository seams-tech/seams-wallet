# ML-DSA-65 investigation

This host tool measures canonical ML-DSA-65 key generation and recovery.
It also measures reference operations and individual Boolean circuits.
It includes an experimental threshold signer. It has no production signing route.

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
  --output docs/evidence/ml-dsa-65-threshold-host-one-and-20261013.json
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

Reference messages use a fixed 32-byte SHA-256 digest.
The separate offline SDK scenario below encodes and threshold-signs a complete NEAR transaction.

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
It starts separate signing roles with their own material files.
After threshold signing passes, it starts the separate authorized test recipient.

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
The role processes produce threshold signatures before recovery.
The recipient checks exact deterministic signature bytes against its recovered ordinary key.
The artifact publishes every test seed, including the disposable joint-random seed.

Each sampler reads a fixed 481-byte prefix and aborts if fewer than 256 coefficients qualify.
An abort destroys intermediate outputs and never substitutes a different seed.
Secure continuation for the same seed remains unimplemented.

## Limits

The private `ExpandMask` benchmark checks five nonce values through separate roles
with genuine OT. It compares all coefficients with an independent SHAKE oracle.
A receives no decoded output. Five polynomials require 34,068,480 table bytes
per signing attempt. Six further signing circuits now pass independent cleartext fixtures.
They check hashing, high bits, norms, hints, and aggregate acceptance.
The complete private signing composition produces standard signatures in separate role processes.

Cleartext Boolean evaluation provides no privacy or constant-time guarantee.
Private kernels use the existing passive protocol. Their complete composition still requires review.
Local arithmetic provides no native constant-time guarantee.
The tool does not implement production admission, transport authentication, durable secret storage, or recipient authorization.
The test recipient's authorization is an explicit harness action.
It does not establish an authenticated export flow.

This tool executes an experimental complete threshold signing protocol.
The host and Worker adapters use the same consuming key-generation and signing state machines.
The [preliminary report](../../docs/router-ab/ml-dsa-65-preliminary-keygen-report.md) records complete hosted key-generation measurements.
The [kernel report](../../docs/evidence/ml-dsa-65-worker-kernels-hosted-20261013.json) preserves the earlier component measurements.
Host timing does not establish Worker CPU time, bandwidth, latency, or cost.
Cross-implementation agreement does not establish FIPS module validation.

## NEAR testnet transaction E2E

The test uses `ml-dsa-e2e-20261014-bb976cccc038.testnet` and the existing public zero-seed fixture.
It creates the account through NEAR's testnet faucet only if the account is absent.
It transfers one yoctoNEAR to the same account and uses faucet test tokens for fees.
The fixed account and fixture are public test data.

```sh
cargo build --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml
python3 tools/ml-dsa-investigation/scripts/run_near_testnet.py \
  --out docs/evidence/ml-dsa-65-near-testnet-e2e-20261014.json
```

The driver records testnet configuration, key-list handles, full-key queries, and rejected handle queries at the same block.
It checks the SDK's distinct key and handle types, including their text, JSON, and Borsh boundaries.
Two role processes generate fresh shares of the public fixture key and threshold-sign the actual SDK transaction.
The authorized test recipient reconstructs the seed only after signing completes.
The driver submits the signed bytes and requires successful finalized execution with receipts and the expected transaction hash.
It saves request and response evidence after each network call and never retries a submission automatically.
If a submission outcome is unknown, query its recorded transaction hash before another run.
This test supplies no Cloudflare signing, production admission, or protected recovery claim.

## Wallet-seed recovery

The selected recovery design derives an ML-DSA owner root directly from the wallet custody seed with a separate HKDF-SHA256 salt.
The stable application binding includes wallet and key identifiers. It excludes participant identities and share epochs.
The client shares this root. A private half-gates circuit derives the canonical FIPS seed and returns only fresh XOR shares.
Each role immediately starts canonical key generation with its seed share.

Run the public-fixture recovery campaign:

```sh
cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- \
  wallet-recovery docs/evidence/ml-dsa-65-wallet-custody-e2e-host-20261014.json
```

The campaign opens real custody envelopes and a recovery code through the native ceremony.
It encrypts each holder input and authenticates both holder results before verifying the manifest.
It repeats one wallet/key binding with fresh sharing and checks that the public key remains identical.
Three further cases change the wallet seed, wallet ID, or key ID.
A sixth case creates a fresh custody seed inside the ceremony and checks all ten recovery codes after signing.
Each case generates shares, signs through separate processes, and only then permits the fixture recipient to reconstruct the canonical seed.
The recipient checks the full expanded key with OpenSSL and verifies ordinary signatures.
A separate SHAKE implementation checks the exported seed against the documented derivation.
The artifact records source digests, exact schedules, wire counters, and role timings.

The extra circuit uses 37,056 AND gates and transfers 1,214,920 protocol bytes across both directions.
It reveals no public seed bytes. Fifteen negative cases check protected delivery, manifest continuity, and custody-state boundaries.
These host checks cover the native custody path. Browser exports, Router admission, durable replay control, activation, and storage remain open.

## Compiled arithmetic inspection

The private polynomial arithmetic uses bounded, division-free reduction.
Run the compiled-code check from an AArch64 host with the Wasm Rust target and `worker-build` installed:

```sh
cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- \
  inspect-arithmetic docs/evidence/ml-dsa-65-arithmetic-dataflow-audit-20261014.json
```

The command compiles the core separately for Wasm and the native host, then rebuilds both Worker role bundles.
It rejects division or remainder instructions in the three private polynomial functions, including their final packaged Wasm bodies.
It requires one named body per function and rejects unresolved indirect calls in those bodies.
It records complete instruction streams, function signatures, local declarations, conditional branches, direct calls, and value-selection sites for manual review.
Secret-dependent Wasm `select` instructions still require target JIT qualification.
The report pins source, compiler, assembly, builder, packaged Wasm, and function-body identities.
Direct callees require separate review. The check does not inspect JIT-generated machine code or establish a blanket timing guarantee.
The [composition review](../../docs/router-ab/ml-dsa-65-privacy-review.md) records the arithmetic bounds and the remaining security work.

## Core lifecycle scenarios

The full report also exercises lifecycle behavior on the zero-seed disposable fixture before authorized recovery.
Each signing request includes a required 32-byte operation identifier.
The core checks agreement on that identifier, public key, message, FIPS context, and randomness mode before the first private signing circuit.
The exchange adds 73 bytes in each direction. Runtime reports count those bytes separately from accepted shares and signature return bytes.
Five mismatch scenarios run separate role processes and require rejection before any private circuit completes.
They check that neither role writes a signature result.
This check establishes peer request agreement. Admission, transport authentication, and durable replay rejection remain deployment requirements.
Separate role processes use the same persistent role-local material files for these scenarios:

1. A exits after the first private signing-mask circuit. Neither role returns a signature.
2. A replays the first mask's OT base-choice message during the second mask circuit.
   The message preserves its family and length but carries the old session.
   B rejects it through the OT boundary. Neither role returns a signature.
3. A fresh operation restarts both roles and produces an independently verified signature.
4. Four concurrent operations sign distinct public messages with independent joint randomness.
   Each signature passes independent verification. All circuit bindings remain distinct across these operations and the restart.

The generated report includes injection diagnostics, expected peer failures, full successful signature results, and independent negative checks.
Use a new output filename to preserve earlier campaigns:

```sh
cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- \
  --samples 100 --garbled-samples 3 \
  --output docs/evidence/ml-dsa-65-threshold-host-lifecycle-20261013.json
```

These scenarios establish core process behavior.
They do not establish durable Router replay rejection, backup restoration, refresh, or Cloudflare lifecycle handling.
Their contended process timings are correctness evidence and must remain separate from serial performance measurements.

## GMW and ABY2.0 kernel comparison

Generate the public Worker fixtures with the export command before this comparison.
Then run:

```sh
cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- \
  compare-boolean-engines docs/evidence/ml-dsa-65-boolean-engine-kernels-host-20261013.json
```

The command checks seed expansion, sampling, rounding, and signing-mask expansion through both Boolean engines.
Each case has three complete measured executions after one excluded warm-up.
Both roles generate private correlations through genuine OT in both directions.
The artifact includes fresh base OT, batch padding, input conversion, online exchanges, and output decoding.
It compares exact private outputs with the independent generated fixtures and checks actual directional pipe traffic.
Every execution begins without prepared correlations. It destroys its correlations after use.
These kernel experiments provide no persistent pool or Cloudflare performance claim.
The [engine report](../../docs/router-ab/ml-dsa-65-engine-comparison.md) records the costs and remaining comparisons.

## Complete native engine comparison

Run the same canonical key-generation and signing state machines with half-gates, GMW, and Boolean ABY2.0:

```sh
cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- \
  compare-complete-engines docs/evidence/ml-dsa-65-complete-engines-host-20261014.json
```

Each engine runs one complete excluded warm-up and one measured execution with the zero-seed public fixture.
Fresh random shares, private preprocessing, and fresh execution bindings remain part of every execution.
The roles sign before a separate test recipient reconstructs the seed and private fields.
The recipient checks the complete expanded key against OpenSSL and the deterministic signature against the ordinary implementation.
The harness requires identical public keys and signature bytes across all three engines.
Both independent verifiers reject changed messages, contexts, signatures, and public keys.
A missing participant must return no signature.

Runtime counters must match actual directional pipe traffic for every circuit and final signature exchange.
Boolean measurements retain preprocessing, input setup, input sharing, gate execution, and output costs separately.
Phase times include peer waits. The binding phase includes topology construction.
The output phase also includes the consuming core transition and preparation for the next circuit.
Complete process times include schedule reads, startup, all signing candidates, and each role's final verification.
Schedule compilation and authorized test recovery have separate measurements outside those process times.

One measured sample establishes no percentile or sustained throughput.
The comparison uses sequential polynomial circuits and fresh base OT for every preprocessing batch.
Prepared pools, reusable base OT, packed-bit OT, polynomial batching, and deployed measurements remain separate work.
The experimental Boolean adapters require both benchmark features and stay outside the default Worker build.

## Offline SDK and NEAR transaction contract

The complete report now uses the SDK's Rust transaction encoder with an ML-DSA-65 public key.
Two separate roles sign its exact SHA-256 transaction digest before authorized recovery.
The scenario uses an empty FIPS context, as required by the pinned NEAR verifier.
The ordinary RustCrypto and OpenSSL checks still pass.
The exact AWS-LC algorithm used by the pinned nearcore source also accepts the signature.

The scenario compares unsigned and signed transaction bytes with a separate encoder of the pinned V0 field schema.
It checks AddKey and DeleteKey action bytes, full-key text and JSON round trips, and unchanged Ed25519 key encoding.
It rejects altered transaction nonces and signatures, hashed identifiers in full-key fields, incorrect key lengths, and mismatched signature schemes.
JSON and Borsh signed-transaction decoders must enforce the same scheme invariant as the checked builder.

```sh
cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- \
  --samples 100 --garbled-samples 3 \
  --output docs/evidence/ml-dsa-65-threshold-sdk-near-host-20261013.json
```

The artifact contains the complete public transaction, signature, digest, hashed access-key identifier, and source identities.
It uses placeholder testnet accounts and a synthetic block hash.
It broadcasts no transaction and provides no chain receipt.
It invokes nearcore's pinned signature algorithm through `aws-lc-rs =1.18.1`.
It does not execute the complete nearcore transaction validator or state transition.
Wallet admission, frontend signing orchestration, and deployed transaction verification remain open.
Classical OT does not establish post-quantum transcript confidentiality.

The [signing options](../../docs/router-ab/ml-dsa-65-signing-options.md) distinguish commitment `w1` from challenge hash `c_tilde`.
Their possible disclosures require separate arguments for this share composition.
The key-generation results approve no additional signing disclosure.

API sources:

- [RustCrypto ML-DSA 0.1.1](https://docs.rs/ml-dsa/0.1.1/ml_dsa/)
- [OpenSSL ML-DSA keys](https://docs.openssl.org/3.6/man7/EVP_PKEY-ML-DSA/)
- [OpenSSL ML-DSA signatures](https://docs.openssl.org/3.6/man7/EVP_SIGNATURE-ML-DSA/)
