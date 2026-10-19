---
title: Add devices, export, and recover
description: Link another device, export a key, or restore a wallet account through fresh authorization.
---

# Add devices, export, and recover

Use these flows after your first wallet can sign. Each operation has its own
authorization and result. Handle each operation separately from normal signing.

## Link another device

Device 2 starts a link session and displays a QR code. Device 1 scans that code
and approves the new device.

<<< ../examples/device-linking.tsx

On Device 2, `ShowQRCode` starts the link session and displays the code. It cancels an
abandoned session when closed. On Device 1, `useDeviceLinking` reports progress through
`onEvent` and failures through `onError`. Request a fresh code for each attempt.

## Export a key

Call `exportKey` from a freshly authorized action. It selects the exact export lane
and opens the export viewer on the wallet origin.

<<< ../examples/export-wallet.ts

Ed25519 export uses the wallet's NEAR account. ECDSA export names a configured chain.
Both default to the signed-in wallet. Pass `walletSession`, `nearAccount`, or
`chainTarget` to select the exact wallet, account, or chain.

The SDK owns lane selection and passes the selected lane directly to the
wallet-origin viewer. If this device has no exact export lane or material,
`exportKey` rejects with an export-lane or material error.

Key material is displayed inside the wallet-origin viewer. The app receives an
outcome, such as `exported`, without the private key. Keep export content out of
logs, URLs, and analytics.

## Recover a wallet account

Synchronize the wallet record when your recovery flow needs to restore its
wallet-scoped account identity.

`syncAccount` synchronizes a known wallet's account state. Recovery-code entry and
new-factor verification belong to the hosted wallet menu. See [wallet-user
recovery](/concepts/custody/recovery-and-export#recovery).

<<< ../examples/recovery.ts

Check `success` before reading `walletId` or `nearAccountId`. The helper throws
for a failed synchronization so the caller can render a retry state.

## Delegation and rotation

Delegated agents, lane refresh, and key rotation add policy and deployment
choices that depend on your product. Start with [delegated agents](/guides/delegated-agents),
[linked devices](/guides/linked-devices), or [recovery, export, and rotation](/guides/recovery-export-and-rotation).

## Safe retries

- Ask for fresh authorization after cancellation or session expiry.
- Do not retry export or rotation with a stale session.
- Revoke a linked device or delegated lane when it should no longer sign.
