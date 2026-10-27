---
title: Glossary
description: Define the wallet, custody, policy, session, signing, and Router A/B terms used throughout Seams documentation.
---

# Glossary

Passkeys and Email OTP are released owner authentication methods.
SDK 0.24.0 adds optional [VoiceID](/concepts/auth-methods/voiceid).
Delegated-agent issuance and broader payment adapters describe proposed capabilities.
See [release status](/releases) before treating a concept as an available API.

| Term                  | Meaning                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth plane            | A boundary for one kind of authority, such as app login, Wallet Session, capability grant, delegation grant, or API credential.                       |
| Credential            | A proof input used by policy, such as passkey, Email OTP, VoiceID, device proof, org role proof, wallet proof, or configured external credential.     |
| Deriver A / Deriver B | Split server roles used during derivation-time operations such as registration, export, refresh, recovery, and activation.                            |
| Delegated-agent lane  | A distinct signing lane issued to an agent or service under policy.                                                                                   |
| Holder share          | The user, device, agent, or auth-method side of a threshold key.                                                                                      |
| Linked-device lane    | A distinct signing lane issued to another user-controlled device.                                                                                     |
| Mandate               | A scoped, signed authority object that defines what a subject may do under policy.                                                                    |
| Policy epoch          | Versioned policy state used for revocation-sensitive decisions.                                                                                       |
| Router                | The public service boundary for auth, policy, replay, quota, budget, and request routing.                                                             |
| Server share          | The hosted or self-hosted server side of a threshold key.                                                                                             |
| Tenant derivation root | Independently randomized server-side derivation origin for one tenant, held as separate A/B operational shares. |
| Wallet custody seed | The random secret for one wallet. Owner signing roots derive from it independently. |
| Owner signing root | The seed-derived Ed25519 Yao Client root or ECDSA client root share. Neither derives from the other. |
| Lane holder share | Per-lane material provisioned by its signing protocol. It is independent of seed derivation and absent from recovery sets. |
| `signingRootId` / `signingRootVersion` | Persisted identifiers about a signing root. These values contain no key material. |
| Custody ceremony | Registration or recovery that derives owner roots and verifies the wallet key manifest. Adding a factor and unlocking preserve envelope authentication. |
| Tenant-root operational share | One Deriver's secret share of the tenant root. Refresh changes the pair while preserving the effective root. |
| Share epoch | Metadata that identifies a generation of operational shares. It contains no key material. |
| Custody lineage | The identity of one tenant-root custody lifecycle, used to isolate commands and replay state across restored destinations. |
| Managed tenant-root backup | A service-held encrypted role-share backup used by the authorized managed restore path. |
| Tenant recovery set | Tenant-held A/B recovery packages and a public manifest for exact-root restoration, separate from wallet portability. |
| SigningWorker         | The hot normal-signing server role that uses activated server signing material.                                                                       |
| Wallet Session quota  | A reusable signing allowance with an expiry and a limit on remaining uses.                                                                                 |
| Capability grant      | One-operation authority bound to an exact capability and intent.                                                                                      |
| Signing lane          | The exact signing capability selected for one operation.                                                                                              |
| Signed mandate        | A user, org, wallet, device, or agent authority object bound to policy.                                                                               |
| Streaming Yao         | The fixed-circuit two-party computation used by Deriver A and Deriver B for Ed25519 lifecycle ceremonies. Garbled tables stream directly from A to B. |
| Threshold session     | Protocol identity and signing material for a specific curve and session. Signing also requires operation authorization. |
| Wallet home | The fixed region assigned to one wallet. All its devices and later operations use that home. |
| Typed intent digest   | Canonical digest of the exact action being approved or executed.                                                                                      |
| Wallet Session        | A wallet-user operation authority used by signing and budget routes.                                                                                  |
