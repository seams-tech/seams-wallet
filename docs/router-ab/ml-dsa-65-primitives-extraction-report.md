# Shared two-party primitives and shorter ML-DSA namespaces

Date: October 24, 2026. Branch: `ml-dsa`.

`crates/two-party-primitives` now owns the shared Yao, OT, and private AES implementation.
Both Ed25519 and ML-DSA depend on this crate. ML-DSA no longer depends on the Ed25519 protocol crate.
The UI changes in commit `ae41091d` remain intact. This extraction changes no `packages/` or browser-test files.

## Folder and API changes

| Responsibility | Current owner |
| --- | --- |
| Half-gates, secret wire labels, and output decoding | `two-party-primitives/src/lib.rs` and `decoding.rs` |
| Oblivious transfer and sealed protocol families | `two-party-primitives/src/ot.rs` |
| Private AES and optional Wasm SIMD | `two-party-primitives/src/gate_aes.rs` |
| Validated circuit wire storage | `two-party-primitives/src/arena.rs` |
| ML-DSA arithmetic, key generation, and signing | `ml-dsa-threshold/src/signing/` |
| ML-DSA Yao execution and preparation | `ml-dsa-threshold/src/runtime/` |
| ML-DSA Boolean MPC and silent correlations | `ml-dsa-threshold/src/runtime/boolean_mpc/` |

Rust callers use `ml_dsa_threshold::signing`, `::runtime`, and `::runtime::boolean_mpc`.
The previous public namespaces and `ed25519_yao::primitives` facade are removed.
The old `passive-primitives` feature is removed. The shared crate has a `simd` feature.
Its `test-fixtures` feature is enabled only by the Ed25519 development dependency.
The production Worker dependency graph excludes that feature.

Secret label fields remain private. `Garbler::into_delta` transfers the existing offset to the output decoder without copying it.
Existing deterministic fixtures retain their bytes through development-only constructors.
The Ed25519 adapter maps the shared decoder errors to its existing error contract.

OT family codes, domain strings, schedules, and serialized protocol bytes remain unchanged.
Historical `ed25519-yao` domain strings are protocol identifiers and retain their exact bytes.
The generator, benchmark harness, and vendor directories retain their existing names.
Historical benchmark source readers normalize old imports only at their Git-object input boundary.

Wallet-seed recovery, standard FIPS export, two-at-once consumption, and production pool capacity remain unchanged.
The twenty-slot native fixture is a functional test. It does not set production capacity.

## Proofs and E2E checks

- All four production modular-arithmetic proofs pass through pinned Charon, Aeneas, and Lean.
- The Ed25519 export-continuity proof passes with stable generated extraction.
- The theorem assumption checks permit only `propext`, `Classical.choice`, and `Quot.sound`.
- Six native cases and six Node Wasm cases reproduce the canonical ML-DSA key.
- Authorized recovery matches the expanded FIPS key from OpenSSL and produces a verified ordinary signature.
- A threshold signature matches the deterministic reference signature bytes.
- Existing signing checks cover binding refusal, single use, pool exhaustion, and automatic rollover.
- The preparation-four/consume-two campaign verifies eight signatures and twenty distinct consumed pairs.
- Sixteen shared primitive vectors, two exact streamed-wire comparisons, and two Ed25519 process cases pass.
- Existing private AES comparisons pass, including Wasm SIMD and untouched suffix bytes.
- The ML-DSA participant Worker builds in release mode with Wasm SIMD.

Two optional latency benchmarks remain ignored in their existing suites.
The native and Node Wasm artifacts match their recorded source hashes.
No Cloudflare deployment or new hosted latency measurement occurred in this extraction.
The existing UI browser qualification belongs to the separate UI commit.

The scalar proofs establish arithmetic behavior under their documented input bounds.
They do not prove the complete protocol, sampling privacy, or deployment security.

## Compiled selection checks

The optimized host and Ed25519 participant Worker checks pass with the extracted backend.
Native source-line checks reject conditional branches in the secret selection.
An added check rejects conditional branches without a source mapping in the OT helper.
A temporary native secret-branch control fails that check.

The Worker compiler now emits one shared OT XOR helper in both roles.
The checker inspects its choice-to-mask and AND/XOR/store operations directly.
Temporary secret-branch and mask-to-address controls are rejected.
The generic family marker is `label_pad_prefix`; `derive_label_pad` is already nongeneric in the baseline source.

These are compiled selection-shape regression checks.
The current helper's public loops, bounds paths, and callee behavior remain manual-review assumptions.
Textual local overwrites do not prove arbitrary control flow. Changes to that control flow require review.
The checks do not establish complete constant-time behavior for the protocol, Cloudflare JIT, or CPU microarchitecture.

An optional whole-ML Worker scan found four broad pattern matches.
Three occur in compiler-generated destructor state dispatch. The fourth tests the deliberately public sampling acceptance bitmap.
This scan demonstrates the regex's scope limit. It supplies no whole-ML constant-time qualification.

## Validation record and remaining check

The candidate was validated in an exported source tree before application.
The worktree received an immutable patch with before/after SHA-256 checks.
Independent review checked label ownership, domain preservation, and the assembly-check changes.

| Observed failure | Classification and resolution |
| --- | --- |
| Development fixture called a test-only constructor | Extraction regression; use the existing private byte constructor. |
| Process sockets denied by sandbox | Environment failure; both process cases pass with local socket access. |
| Ed25519 proof cache path missing | Environment failure; reuse the installed pinned cache. |
| Public bounds branch attributed to selection line | Measurement mismatch; separate the public load and retain branch rejection. |
| Secret branch moved to debug line zero | Measurement gap; add a negative control and reject unmapped branches in that helper. |
| Worker masks moved into a shared helper | Measurement mismatch; inspect the outlined mask operations in both roles. |

`pnpm report:bloat --check` still fails the inherited Rust duplication limit.
It reports 13,774 duplicated lines, down from the previous 13,804. The baseline remains 13,754.
The extraction does not increase the baseline or change unrelated code to satisfy it.

See the [summary](../evidence/ml-dsa-65-primitives-extraction-20261024.json)
and [compressed evidence](../evidence/ml-dsa-65-primitives-extraction-20261024-data.json.gz).

## Reproduction

```sh
python3 crates/ml-dsa-threshold/formal-verification/check.py
cargo yao-fv aeneas-check
cargo test --release --manifest-path crates/two-party-primitives/Cargo.toml
cargo test --release --manifest-path crates/ed25519-yao/Cargo.toml --lib stream_runtime_tests
cargo test --release --manifest-path crates/ed25519-yao/Cargo.toml --features passive-benchmark --test phase5_processes
cargo run --release --manifest-path tools/ml-dsa-investigation/Cargo.toml -- prepared-keygen /tmp/ml-dsa-native.json
wasm-pack build crates/ed25519-yao/wasm-bench --target nodejs --out-dir pkg-prepared --release
node crates/ed25519-yao/wasm-bench/scripts/run_prepared_keygen.mjs /tmp/ml-dsa-wasm.json
node crates/ed25519-yao/scripts/check_constant_time_codegen.mjs
```
