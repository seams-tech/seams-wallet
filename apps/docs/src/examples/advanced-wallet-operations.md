---
title: Advanced wallet operations
description: Link another device, synchronize wallet recovery, and export Ed25519 or ECDSA key material through explicit user flows.
---

# Advanced wallet operations

These operations change access or disclose key material. Start each one from a fresh
user action. Keep progress visible. Retain the returned identity or receipt for your
audit trail.

## Prerequisites

Complete [wallet setup and authentication](/examples/wallet-setup-and-authentication)
and obtain an active wallet session. Device linking also needs a camera or a
way to deliver the QR payload between devices.

## Link another device

Device 2 starts a short-lived session and displays its QR code. Device 1 scans
that code and approves the request with fresh authentication.

<<< ./device-linking.tsx

On Device 2, `ShowQRCode` starts the session and displays the code. It cancels an
abandoned session when closed. Expire abandoned QR sessions. After success, show the
device name so the user can recognize and revoke it later.

## Recover a wallet account

Call recovery synchronization with the wallet id from the account record.

This synchronizes account state for a known wallet. The hosted wallet menu handles
recovery-code entry and verification of the new authentication method. See [wallet-user
recovery](/concepts/custody/recovery-and-export#recovery).

<<< ./recovery.ts

The successful result exposes the restored wallet id and NEAR account id. Use
the returned values to refresh app state before rendering signing controls.

## Export an Ed25519 or ECDSA key

`exportKey` resolves the exact export lane and opens the wallet-origin
export viewer in one call.

<<< ./export-wallet.ts

`exportNearKey` exports the Ed25519 lane for the wallet's NEAR account. `exportEvmKey`
exports the ECDSA lane for a configured chain. Both default to the authenticated wallet
and receive progress through `KeyExportFlowEvent`.

The SDK owns lane selection and passes the selected lane directly to the
wallet-origin viewer. If this device has no exact export lane or material,
`exportKey` rejects with an export-lane or material error.

## Expected result

- Device linking creates a separate device credential and lane.
- Recovery synchronization returns the restored wallet and NEAR identity.
- Export opens a protected viewer after the exact lane is authorized.

## Recoverable failures

- A cancelled or expired QR session must be started again. Do not approve an
  old QR payload.
- Recovery can return a failure result. Keep the existing account state until
  synchronization succeeds.
- Export rejects when this device has no exact export lane or material. Show
  the error. The SDK never selects another lane.
- Export authorization and viewer errors should end the current disclosure
  attempt. Ask for fresh authentication before another export.

Read next: [linked devices](/guides/linked-devices), [recovery, export, and rotation](/guides/recovery-export-and-rotation), or [results and errors](/reference/results-and-errors).
