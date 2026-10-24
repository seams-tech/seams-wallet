# Standalone ML-DSA crate and production arithmetic proofs

Date: October 24, 2026. Branch: `ml-dsa`.

`crates/ml-dsa-threshold` now owns ML-DSA key generation, signing, preparation, and circuit execution.
Cloudflare adapters and wallet custody remain in their existing crates.
The concurrent UI implementation is preserved. The extraction patch contains no `packages/` paths.

## Crate boundary

The new crate exposes `ml_dsa_signing` and `ml_dsa_runtime`.
Synthetic benchmark adapters use its explicit `benchmarks` feature.
All Rust consumers now depend on the new crate directly where they use ML-DSA.
The old ML-DSA re-exports and `ml-dsa-runtime-benchmark` Cargo feature are removed.

The existing `ed25519-yao` crate remains the shared passive Yao/OT/AES backend.
Its `passive-primitives` feature exposes the primitive operations required across the crate boundary.
Opaque wire state remains private. Small accessors replace direct access to translation bits and public session domains.
Cryptographic primitive implementations are not copied.
Existing wire domains, sealed OT family codes, circuit schedules, and serialization bytes remain unchanged.
The backend's historical crate name is retained; a general backend rename is outside this extraction.

Wallet-seed recovery, ordinary FIPS export, two-at-once consumption, and production pool capacity remain unchanged.
The native fixture's twenty-slot ledger is a functional test. It does not change production capacity.

## Aeneas and Lean proof

The proof facade imports the production `ml_dsa_signing/arithmetic/modular.rs` file directly.
The production polynomial and NTT code calls these same scalar functions.
For `q = 8,380,417`, Lean proves:

- `reduce_once(v)` returns `v mod q` when `v < 2q`.
- `add_mod(a, b)` returns `(a + b) mod q` for reduced operands.
- `subtract_mod(a, b)` returns `(a + q - b) mod q` for reduced operands.
- `multiply_mod(a, b)` returns `(a * b) mod q` for reduced operands.

Every result is below `q`. The extracted computations return successfully under these bounds.
Multiplication retains its original three-fold algorithm. The proof establishes intermediate safety and residue preservation.
Each theorem permits only Lean's standard `propext`, `Classical.choice`, and `Quot.sound` assumptions.
No theorem depends on `sorryAx`, native reflection, or a cryptographic axiom.
Unused upstream library declarations with admitted proofs are outside these theorem dependencies.

The check command validates the existing repository tool pins, regenerates Aeneas output, checks source drift, and builds the proofs:

```sh
python3 crates/ml-dsa-threshold/formal-verification/check.py
```

The [proof README](../../crates/ml-dsa-threshold/formal-verification/README.md) states the preconditions and trusted toolchain boundary.
This proves scalar arithmetic behavior. NTT correctness, complete FIPS equivalence, protocol privacy, memory erasure, and storage semantics remain separate obligations.

## Validation

- Six native prepared-keygen cases preserve the canonical key.
- Native post-generation checks cover authorized canonical seed recovery, standard signatures, binding refusals, single use, and automatic rollover.
- Six Node Wasm cases complete separate-process preparation, streamed local table storage, consumption, and canonical verification.
- The private AES harness checks full-byte results against RustCrypto, including the Wasm SIMD backend and unchanged suffixes.
- Existing Ed25519 two-process activation and export tests pass. The separate latency benchmark remains ignored.
- The dedicated participant Worker builds in release mode for Wasm with SIMD enabled.
- The applied crate compiles, and the production proof check passes in the actual worktree.

Final native and Node Wasm reports match their recorded source hashes after the extraction's final formatting.
The first exported-tree checks exposed stale report paths and an AES harness import mismatch.
Those were corrected before application. Independent review found no remaining source blocker.
The worktree received an immutable patch with before/after hash checks, after validation in the exported tree.

Compiled scalar arithmetic contains no integer division/remainder or conditional-branch instructions in the inspected optimized AArch64 and Wasm outputs.
This inspection does not qualify the complete protocol, Cloudflare JIT, or CPU microarchitecture as constant-time.
No new hosted latency result is claimed.

`pnpm report:bloat --check` remains above the inherited Rust duplication baseline: 13,804 lines versus 13,754.
The baseline is unchanged. Other agents' source and documentation changes are outside this extraction's ownership.

The [summary](../evidence/ml-dsa-65-crate-extraction-20261024.json) includes the complete proof result and archive digest.
The compressed archive retains the native, Wasm, AES, shared-backend, and source-hash evidence.
