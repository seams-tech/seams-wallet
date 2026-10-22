# Router A/B ECDSA Lean Model

This workspace proves structural and algebraic properties of a handwritten
role-local model. Cryptographic privacy remains unproved.

[TrueBlind.lean](RouterAbEcdsaDerivationPrivacy/TrueBlind.lean) models scalar
addition modulo the secp256k1 order, public identity, role views, and export.
[TrueBlindBoundary.lean](RouterAbEcdsaDerivationPrivacy/TrueBlindBoundary.lean)
models retained state, wire envelopes, signing sessions, and authorized export.

The retained claims establish:

- role-view equality when the role's own share and public identity are equal;
- additive export reconstruction under the stated public-key assumptions;
- signing-session identity and context agreement;
- explicit-export-only access through the modeled relayer-share selector; and
- digest-valid authorization for every bound export session, including
  impossibility of binding a wire with an invalid authorization digest.

Stage types and selectors describe data shape. They do not constrain arbitrary
information encoded in public byte fields. The removed constant `none` getters
and circular non-derivability predicates supplied no cryptographic guarantee.

The model has eight abstract function symbols: scalar encoding, base
multiplication, point addition, address derivation, two role-share derivations,
transcript digest, and authorization digest. Algebraic laws are explicit theorem
premises. Digest equality does not prove collision resistance or signature
unforgeability. `secp256k1Order_pos` uses kernel-checked `decide`.

The imported Aeneas package comes from a verification-only Rust mirror.
Production behavioral refinement and probabilistic privacy proofs remain open.

```sh
lake build RouterAbEcdsaDerivationPrivacy
# From the repository root:
just router-ab-ecdsa-derivation-fv-privacy
```

See the [shared implementation plan](../docs/implementation-plan.md).
