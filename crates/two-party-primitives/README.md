# Shared two-party primitives

This crate owns the passive two-party backend used by Ed25519 and ML-DSA.

- `lib.rs`: half-gate garbling, wire labels, domain separation, and label ownership.
- `ot.rs`: oblivious transfer (OT), including sealed protocol family identifiers.
- `gate_aes.rs`: private AES operations and their optional Wasm SIMD implementation.
- `arena.rs`: wire storage for validated circuit schedules.
- `decoding.rs`: output-label validation before decoded bits are returned.

Algorithm-specific key generation, signing, schedules, and transport stay in their
protocol crates. This crate contains no Worker APIs or wallet lifecycle policy.

Protocol domain strings and OT family codes retain their existing bytes.
Some strings contain `ed25519-yao`; these are protocol identifiers, not Rust names.

`simd` enables the SIMD dependency. The implementation requires a Wasm target with
`simd128` enabled. `test-fixtures` supplies deterministic labels for existing
cross-crate wire-equivalence tests. Production dependencies must not enable it.

Secret labels remain private and are wiped on drop. `Garbler::into_delta` transfers
ownership to the output decoder. It does not copy the private offset.
The honest-execution privacy model remains unchanged.
