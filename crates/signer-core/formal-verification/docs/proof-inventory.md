# `signer-core` Formal Verification Proof Inventory

Last updated: 2026-04-16

This inventory tracks implemented and planned proof targets for:

- [`crates/signer-core`](/Users/pta/Dev/rust/simple-threshold-signer/crates/signer-core)

## Current Posture

- Verus is the active implementation-proof track.
- Executable anti-drift tests pin the Verus mirror to production helper behavior.
- Lean/Aeneas is not active for `signer-core` yet.

## FV-SIGNER-CORE-005

Target:

- `src/secp256k1.rs`
- public-key helper functions

Property:

- compressed SEC1 public keys are validated strictly
- public-key addition result remains compressed SEC1
- private-key-to-public-key helper matches compressed SEC1 encoding

Status:

- Verus public-key helper model exists
- invalid compressed public keys are modeled as rejected
- valid compressed public-key validation is modeled as byte-preserving
- private-key-to-public-key output is modeled as compressed SEC1
- public-key-to-address output is modeled as 20 bytes
- public-key addition output is modeled as compressed SEC1
- executable anti-drift checks cover helper output shape through committed
  secp256k1 vectors

Remaining trust:

- SEC1 parsing, point addition, Keccak, and `k256` public-key internals remain
  trusted primitive/library seams

## FV-SIGNER-CORE-006 To FV-SIGNER-CORE-008

Target:

- `src/near_threshold_ed25519.rs`

Status:

- `FV-SIGNER-CORE-006` has a first Verus derivation model.
- Threshold client-share derivation determinism theorem exists.
- Non-zero signing-share theorem exists.
- Verifying-share-from-signing-share relation theorem exists.
- Fixed signing/verifying-share layout theorem exists.
- Ed25519 derivation anti-drift checks cover committed client-share vectors.
- `FV-SIGNER-CORE-007` has a first Verus participant/key-package model.
- Participant-ID normalization invariants exist.
- 2P participant-ID validation branch theorems exist.
- Key-package shape theorems preserve identifier, signing share, derived
  verifying share, group key, and fixed 2P min-signers.
- `FV-SIGNER-CORE-008` has a first Verus NEP-413 digest/nonce model.
- NEP-413 prefix, deterministic digest shape, fixed digest width, and exact
  decoded nonce-length validation theorems exist.
- NEP-413 anti-drift checks cover committed digest vectors, independent Borsh
  payload reconstruction, prefix bytes, nonce-base64 path parity, nonce-bytes
  path parity, and rejected decoded nonce lengths.

Remaining trust:

- HKDF, SHA-256, Ed25519 scalar reduction, curve basepoint multiplication,
  FROST key-package internals, Borsh serialization, and base64 decoding remain
  trusted primitive/library seams.
