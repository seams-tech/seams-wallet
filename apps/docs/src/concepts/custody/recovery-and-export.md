---
title: Recovery and export
description: Compare recovery, key export, and the fresh authorization each high-impact operation requires.
---

# Recovery and export

Recovery and export prove that the user can regain control or leave the system
while ordinary signing remains share-based.

The flows below concern a wallet user's access and keys. Managed tenant-root
restore, tenant-controlled root recovery, and planned deployment
migration operate at different boundaries. See
[recovery and portability](/deploy-and-operate/recovery-and-portability).

## Sealed refresh

Sealed refresh restores sealed signing material after accidental
iframe or page reload. It stores sealed session material in wallet-origin
IndexedDB and relies on live server participation plus valid server-side
session state.

Sealed refresh restores transaction signing capability only. Export, new device
enrollment, key rotation, and delegated-agent lane creation require fresh
operation authorization.

## Export

Export is a sensitive operation. It requires fresh operation-scoped
authorization, route policy approval, exact lane binding, audit capture, and
public-key parity checks. Export returns material only through the authorized
export path.

## Recovery

The hosted wallet menu accepts an unused wallet recovery code and lets the
owner choose a new Passkey or Google sign-in with Email OTP. Either target can
recover a Passkey-only, Email-only, or mixed-method wallet. The code authorizes
recovery; the new method must also complete its own factor verification.

Finalization verifies the stored key manifest, preserves the wallet’s public
keys and addresses, and atomically consumes one code while adding the new
method and device authority. Existing methods, linked devices, and Wallet
Sessions remain active. Recovery adds access; revoking compromised access is a
separate action.

Recovery completion then uses normal login through the new method to create a
fresh Wallet Session. Cancellation before finalization leaves the code usable
after its reservation expires. A consumed code cannot authorize another recovery.

## Account synchronization example

`syncAccount` synchronizes account state. The hosted menu owns the recovery-code
and new-factor ceremony described above. Read wallet and account identity only
from the synchronization result’s successful branch.

::: details Runnable TypeScript example

<<< ../../examples/recovery.ts

:::

## Export examples

Export resolves the exact Ed25519 or ECDSA lane before the wallet-origin viewer
discloses key material.

::: details Runnable TypeScript examples

<<< ../../examples/export-wallet.ts

:::
