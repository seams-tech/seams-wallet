# Router A/B ECDSA Formal Verification

This track proves model-level algebra and boundary properties. Production
cryptographic privacy remains unproved.

- [Verus](verus/README.md) models context encoding, scalar/share algebra,
  output policy, and role-local boundary invariants. Scalar reduction,
  encoding, and public-key primitives retain trusted seams.
- [Aeneas boundary](lean-boundary/README.md) extracts a verification-only Rust
  mirror. Its Lean bridge proves correspondence to that mirror. It has no
  behavioral refinement proof to the production SDK.
- [Lean model](lean-privacy/README.md) proves additive export reconstruction,
  identity/context binding, typed export disclosure, and authorization-digest
  validity. These claims describe the modeled fields and operations.

The circular non-derivability claims and constant secret-presence predicates
have been removed. View equality alone does not establish secrecy, and public
byte fields can carry hidden information unless a protocol proof restricts them.

Run the existing combined gate with:

```sh
just router-ab-ecdsa-derivation-fv
```

Use the [proof inventory](docs/proof-inventory.md) for exact scope and trust.
The [implementation plan](docs/implementation-plan.md) lists the remaining
production linkage work.
