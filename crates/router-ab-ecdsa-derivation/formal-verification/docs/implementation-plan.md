# Router A/B ECDSA Verification Plan

Keep the suite focused on key continuity and authorized secret release.
The [inventory](proof-inventory.md) records the current model guarantees.

Current checked boundaries:

- Verus algebra with explicit scalar/encoding/public-key trust;
- Aeneas correspondence to the verification-only Rust boundary mirror;
- Lean signing-session identity/context agreement;
- Lean export reconstruction and digest-valid authorization.

Remaining high-impact work:

1. Select one stable production operation and state its exact output, error,
   and panic behavior independently of its implementation.
2. Extract the actual production operation and prove that behavior.
3. Replace the mirror claim only when production refinement is checked.
4. Pursue a privacy claim only with an explicit observation model, sampling
   distribution, simulator, and cryptographic assumptions.

Public-field shape and equality of already-equal views are insufficient for
secrecy. Keep those claims structural. Add no theorem-count targets or
constant secret-presence predicates.
