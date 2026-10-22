# Router A/B ECDSA Proof Inventory

The Verus entries below describe model proofs and executable parity evidence.
The Aeneas extraction uses a verification-only Rust mirror. No proof connects
that mirror's full behavior to the production SDK.

## FV-Router A/B ECDSA derivation-001

Target:

- `encode_context_v2`

Property:

- v2 context encoding is deterministic
- field order is frozen
- participant layout is fixed to `{client=1, relayer=2}`

Planned Verus module:

- [verus/src/shared/context.rs](../verus/src/shared/context.rs)

Status:

- field-order, participant-layout, and determinism lemmas exist
- the encoded key scope is fixed to `evm-family` in the Verus mirror
- fixture parity is wired to the committed corpus
- the current parity bridge checks byte encoding, scalar range, and additive reconstruction on committed fixtures

## FV-Router A/B ECDSA derivation-002

Target:

- canonical `x` derivation

Property:

- for fixed `(y_client, y_relayer, context)`, derivation is deterministic
- output is a valid non-zero secp256k1 scalar

Planned Verus module:

- [verus/src/shared/derivation.rs](../verus/src/shared/derivation.rs)

Status:

- determinism lemma exists
- explicit scalar-domain predicates now exist in the Verus model
- canonical-scalar domain goals are wired to the reduction output shape
- scalar-range theorem now exists in the Verus model
- this theorem currently depends on an explicit trusted axiom for scalar reduction
- executable anti-drift now checks the production `k256` reduction against the
  frozen modulo-`(n - 1) + 1` formula across fixtures, scalar-boundary
  samples, and a generated digest corpus
- committed-corpus parity checks cover scalar-range regression cases

## FV-Router A/B ECDSA derivation-003

Target:

- additive-share derivation

Property:

- `x = x_client + x_relayer mod n`
- `x_client != 0`
- `x_relayer != 0`
- retry counter is deterministic under the frozen active rule

Planned Verus module:

- [verus/src/shared/derivation.rs](../verus/src/shared/derivation.rs)

Status:

- retry-counter output shape and determinism lemmas exist
- explicit reconstruction and share-domain predicates now exist in the Verus model
- additive-share goals are wired to derived output shape in the verifier
- additive reconstruction and non-zero-share theorems now exist in the Verus model
- the relayer-share construction is now proved from the exact modular-subtraction model
- the candidate-share path now follows the actual share-domain hash-reduction shape
- the remaining trusted boundary on this slice is the
  scalar-reduction/selected-counter seam, plus the scalar-int-to-bytes
  encoding bridge
- the former scalar-byte injectivity axiom has been removed; the retry and
  relayer-share proofs now depend on integer-level distinctness instead
- committed-corpus parity checks cover additive reconstruction and non-zero-share regressions

## FV-Router A/B ECDSA derivation-005

Target:

- single-key equivalence

Property:

- exported `x`
- threshold public key
- threshold signing address

all refer to the same logical key.

Planned Verus modules:

- [verus/src/shared/derivation.rs](../verus/src/shared/derivation.rs)
- [verus/src/shared/true_blind_boundary.rs](../verus/src/shared/true_blind_boundary.rs)

Status:

- additive-share reconstruction is proved in the Verus derivation model
- public-identity and export relations are mirrored in the true-blind boundary
- executable production tests establish public-key and address equivalence;
  elliptic-curve group-operation equivalence remains a trusted library seam

## FV-Router A/B ECDSA derivation-006

Target:

- output-policy boundary

Property:

- non-export operations cannot return canonical `x`
- explicit export is the only operation allowed to return canonical `x`

Planned Verus module:

- [verus/src/server/policy.rs](../verus/src/server/policy.rs)

Status:

- explicit-export and non-export output-policy lemmas exist

## FV-Router A/B ECDSA derivation-007

Target:

- retained-state boundary

Property:

- forbidden root material is not retained past the accepted staged boundary

Planned track:

- Verus first for narrow runtime-state shape invariants
- Aeneas + Lean later for the higher-level privacy/boundary story

Status:

- finalized retained-state exclusion theorems now exist in the Verus model
- the model matches the current server-side retained state shape:
  relayer threshold share, relayer public key, threshold public key, threshold address, and retry counter
- forbidden root material is explicitly excluded after finalize:
  raw client root share, raw relayer root share, and canonical scalar

## FV-Router A/B ECDSA derivation-008 — Privacy

Pending. Circular observable-equality claims and constant secret-presence
predicates were removed. They do not prove that a participant cannot derive a
secret from its full protocol view.

## FV-Router A/B ECDSA derivation-009 — Aeneas Boundary

The generated boundary matches the handwritten field-layout model for
non-export/export outputs, retained state, and hidden-eval boundary shapes.
Extraction targets `lean-boundary/rust-boundary/src/lib.rs`, a verification-only
mirror. These are mirror correspondence claims. Production refinement remains
pending.

## FV-Router A/B ECDSA derivation-010 — Role-local Model

[TrueBlind.lean](../lean-privacy/RouterAbEcdsaDerivationPrivacy/TrueBlind.lean)
retains scalar addition modulo the secp256k1 order, typed role views, explicit
export reconstruction, and conditional public-key agreement. Own-share and
public-identity equality imply equal non-export role views. This structural
claim supplies no cryptographic indistinguishability result.

[TrueBlindBoundary.lean](../lean-privacy/RouterAbEcdsaDerivationPrivacy/TrueBlindBoundary.lean)
retains identity/context-bound signing and export sessions. Every bound export
session requires `authorizedExplicitExportWireHasValidAuthorization`, which
includes digest validity. `invalidAuthorizationDigestCannotBindExport` excludes
invalid digests from all such sessions. Reconstruction agrees with the ideal
export view for sessions built from the same well-formed execution state.

Eight abstract functions model encoding, curve operations, address derivation,
role-share derivation, and digests. Public-key laws remain explicit premises.
The digest condition proves equality to the modeled digest function; it does
not prove cryptographic authentication. Arbitrary bytes in public fields remain
unrestricted. Production secrecy, transport, timing, and erasure are unproved.
