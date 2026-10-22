# Ed25519 Yao Export Continuity Proof

One behavioral theorem checks the production public-key gate used immediately
before `complete_client_export_v1` releases its reconstructed seed:

```text
validate_export_public_key(reconstructed, registered)
  = Ok(())                              if every public-key byte matches
  = Err(PublicKeyContinuityMismatch)     otherwise
```

[`ExportContinuity.lean`](Ed25519YaoBoundary/ExportContinuity.lean) proves this
result for every pair of 32-byte keys. The outer Aeneas `Result.ok` excludes
panic, runtime failure, and divergence on both branches. One private list lemma
connects the standard array comparison model to exact byte equality.

[`rust/export_continuity.rs`](rust/export_continuity.rs) imports the production
check and error definitions by path. It contains no copied implementation.
Direct Rust extraction avoids building unrelated HPKE dependencies that need a
newer compiler than the pinned Charon toolchain.

Run from the repository root:

```sh
cargo yao-fv aeneas-check
```

Run `scripts/setup-aeneas.sh` from this directory if the tools are absent.
The gate checks tool pins, regenerates the Lean artifacts, rejects unsupported
external functions and extraction drift, and builds the theorem. Its assumption
check permits only Lean's standard logical assumptions. It rejects admitted
proofs and additional dependency assumptions in this theorem.

The trusted boundary includes Rust compilation, Charon/Aeneas translation, the
pinned standard array/byte comparison models, and Lean's proof checker.
The theorem covers the final public-key gate. It does not prove seed-to-key
derivation, admission, package authentication, call ordering, memory erasure,
constant-time execution, or complete export-protocol security.
