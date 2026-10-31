# Browser VoiceID implementation

Use the [public VoiceID guide](../../../apps/docs/src/concepts/auth-methods/voiceid.md)
for installation, host setup, enrollment, unlock, transfer approval, and storage behavior.
The [current-state review](../../../docs/voiceid-current-state.md) records source behavior,
model choices, evidence limits, and potential improvements.
[Intended Behaviours](../../../docs/intended-behaviours.md#browser-voiceid-prototype)
defines the Wallet flow. [Release notes](../../../apps/docs/src/releases.md) retain package history.

## Implementation boundaries

- [`descriptor.ts`](descriptor.ts) exposes the application descriptor without loading capture code or inference assets.
- [`host.ts`](host.ts) implements the trusted Wallet host plugin.
- [`browser/`](browser/) owns microphone capture, inference, phrase matching, enrollment, and device storage.
- [`activation/`](activation/) owns activation and owner-confirmed enrollment management.
- [`capture/`](capture/) owns the trusted prompt, transaction approval surface, and Wallet measurement bindings.
- [`session/`](session/) owns the device assertion exchange and Wallet session installation.

SDK core owns custody installation, quotas, and NEAR/ECDSA threshold signing.
Preserve `WalletAuthMethodHostPlugin`, the device assertion contract, and method-bound custody envelopes when changing this implementation.

## Enrollment storage and owner confirmation

[`activation/ownerConfirmation.ts`](activation/ownerConfirmation.ts) checks each management action's fresh passkey assertion.
It verifies the signature, challenge, origin, relying party ID, user presence, and user verification.
ES256 uses the existing public-key crypto worker for decoding and WebCrypto for signature verification.
RS256 uses WebCrypto and the existing CBOR decoder.
Confirmation requests no credential PRF output and consumes no signing quota.
The server must recognize the same owner session before confirmation and before saving.

[`browser/enrollmentStore.ts`](browser/enrollmentStore.ts) binds each record to its wallet, authority, method, and device key.
An atomic commit checks owner selection, lock generation, availability revision, and enrollment generation and revision.
Capture watches owner lifecycle changes and releases the microphone when the action becomes invalid.

The enrollment store owns baseline weighting and supplement bounds.
The public guide owns retention and management behavior.
A model mismatch prevents voice unlock until owner-confirmed re-enrollment.
Replacement commits only after all three samples pass. Cancellation preserves the prior record.

The persistence boundary alone reads old browser-wide records for explicit, passkey-confirmed import.
Import deletes the old record after all known active VoiceID methods have scoped records.
Core authentication uses scoped records.

## Model assets and evaluation

The build includes the pinned model and runtime assets from [`../assets/`](../assets/).
Speaker model metadata lives in [`browser/model.ts`](browser/model.ts).
Shared asset loading and integrity checks live in [`browser/inference.ts`](browser/inference.ts).
Use the export and evaluation instructions for provenance, licenses, and repeatable measurements:

- [Speaker-model evaluation](../../../tests/scripts/voiceid-model-evaluation/README.md)
- [Citrinet export and browser comparison](../../../tests/scripts/voiceid-citrinet/README.md)
- [Aurora export and screening](../../../tests/scripts/voiceid-aurora/README.md)
- [Speech detection and noise evaluation](../../../tests/scripts/voiceid-noise/README.md)

Historical browser and release evidence lives under [`docs/evidence/`](../../../docs/evidence/).
Those records describe their recorded source, assets, thresholds, and test conditions.
Use the public guide and current-state review when assessing current behavior.
