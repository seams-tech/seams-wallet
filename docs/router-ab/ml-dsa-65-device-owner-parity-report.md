# ML-DSA device-owner parity

Status: implementation and local browser verification passed.

## Behavior

Each ML-DSA key has an explicit activation in the existing wallet authority.
Its identity contains the wallet, key slot, public key, and custody manifest.
Participant material epochs remain outside this stable device permission.
A linked device needs this activation to sign. Ed25519 activation grants no ML-DSA permission.

A full-owner link preserves the approved source signer set.
The model supports Ed25519, ECDSA, and up to 64 distinct ML-DSA keys.
The target stores one encrypted ML-DSA owner root for each ML-DSA activation.
It receives neither the wallet custody seed nor the A/B signing shares.
An ML-DSA-only target needs no fabricated client signing share.

The original owner and linked owners can export the same canonical FIPS seed.
Passkey export requires fresh WebAuthn approval and the selected passkey factor.
Email OTP export uses the existing export challenge and protected factor-release service.
The export worker checks current signer publication before opening the envelope.
Email OTP export also checks publication after factor release.
Only the Wallet-origin export viewer receives the authorized seed.

Linked owners can transfer the same key roots to another approved full owner.
Recovery retains ML-DSA activations when it replaces Ed25519 participant material.
Participant restoration continues to use the wallet custody seed.

## Security and persistence boundaries

- Root transfer uses the existing HPKE suite: X25519, HKDF-SHA256, and AES-256-GCM.
- The transfer binds the wallet, exact key, public key, manifest, target factor, method, enrollment, device, recipient, and target authority epoch.
- Each recipient is consumed on success or failure. The target verifies the public key and immediately seals the root under its factor inside Wasm.
- The target authority starts at epoch 0. This is separate from the source epoch. A transaction guard checks the source authority digest, current epoch, and active method during durable installation.
- Missing, extra, duplicate, or mismatched roots prevent installation. The existing per-key root store persists the complete collection with the installation receipt.
- Publication commits the key, owner activation, and server session projections atomically. Local adoption also updates the authority and selected session together. Credentials, quota, and expiry remain unchanged.
- One expiring capability holds the complete local root collection. Lock and session cleanup clear it.
- Optional ML-DSA Wasm remains lazy. Each module instance opens its own envelope. Wasm handles never cross module instances.

The passive server-blind model, wallet-seed derivation, FIPS export format, two-at-once consumption, and pool capacity remain unchanged.

## Verification

The executable [root-transfer E2E](../../tests/e2e/ml-dsa-device-root.e2e.mjs) passes.
It uses the existing native fixture and production Wasm for two independent key slots.
It transfers each root from the original owner to a Passkey owner and then to an Email OTP owner.
Node imports each exported FIPS seed and independently verifies an ordinary ML-DSA signature.
Wrong factors, wrong key identities, ciphertext tampering, and recipient reuse are refused.
The [public evidence](../evidence/ml-dsa-device-root-20261025.json) contains no export secret.

Repeat:

```sh
node tests/e2e/ml-dsa-device-root.e2e.mjs /private/tmp/ml-dsa-device-root-e2e.json
```

SDK, server, intended-browser test types, and domain type fixtures pass.
The SDK build passes.

The browser contract passed in 2.3 minutes. It covers interrupted publication, QR linking, reload, onward linking, original-owner Email OTP export, recovery, and revocation.
The onward-linked owner retained export access after its source device was revoked.
See the [browser evidence](../evidence/ml-dsa-device-owner-parity-20261025.json).
It uses isolated local Cloudflare Workers and controlled NEAR RPC.
It makes no hosted latency or live-chain claim.

```sh
node tests/scripts/run-wallet-intended-isolated.mjs --require-google-token -- \
  e2e/intended-behaviours/ml-dsa.lifecycle.contract.test.ts \
  --grep 'device owner export parity'
```

The bloat check reports the inherited Rust duplication excess: 13,972 lines against a 13,754-line baseline.
The baseline was not changed. The TypeScript duplication count decreased.

## Integration failures resolved by the browser contract

| Observation | Cause | Correction |
| --- | --- | --- |
| Session status failed after publication. | Separate server and local persistence decoders assumed only Ed25519 and ECDSA subjects. | Both use the shared discriminated subject decoder. |
| A projected session contained an invalid ML-DSA material field. | Two untyped projections added `materialActivation` to every signer. | Registration, status, and device activation use one typed projection. |
| Local authority adoption rolled back. | The local session decoder rejected the new ML-DSA subject. | The shared decoder accepts the exact ML-DSA branch. Strict authority identity checks remain. |
| Ed25519 source contribution failed in a mixed link. | A guard treated every tagged preparation as Ed25519. | The guard selects the exact Ed25519 discriminant. |
| Installation reported a duplicate ECDSA key. | A two-family mapper mapped ML-DSA to ECDSA. | Installation uses the shared exact signer-manifest builder. |

The first browser launch hit an occupied local port. The successful run used a separate local port range.
The controlled NEAR fixture gained its missing protocol configuration response.
The revocation fixture now identifies its exact child device and checks that other devices remain unchanged.
These fixture changes make no live-network claim.
