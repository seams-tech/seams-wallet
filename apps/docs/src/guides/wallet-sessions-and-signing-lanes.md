---
title: Wallet sessions and signing lanes
description: Unlock provisions a bounded signing session for low-friction signing; lanes identify the custody and policy path per operation family.
---

# Wallet sessions and signing lanes

Signing can proceed without a reusable Wallet Session: the user authorizes
the exact operation with the selected lane's auth method. `unlock` provisions
a **Wallet Session** with a use budget and expiry so subsequent requests can
reuse that authorization within its scope. Each operation still requires
server admission and validated signing material.

Locking clears reusable session access while preserving wallet identity.

## Unlock: provision a signing session

Call `unlock` with the `walletId` returned during registration. The result has
separate NEAR and EVM-family success branches; read `nearAccountId` only from
the NEAR branch.

<<< ../examples/unlock.ts

The returned wallet session backs subsequent signing calls until it expires or
runs out of uses. The next signing operation can request same-method step-up
for that exact operation. Explicitly unlock again when you want a fresh reusable
allowance. Size the session's lifetime and budget for the expected burst of
operations.

## Before you call a signing method

A signing lane identifies the custody and policy path for one operation
family. With a session provisioned:

1. Require a ready `WalletSession`.
2. Derive its exact reference from validated wallet identity.
3. Derive the NEAR account or EVM-family chain target from validated
   configuration.
4. Confirm that the requested lane is ready, then pass the same session
   reference through the complete operation.

Start with [Signing](/examples/signing) for a complete flow.

## Handle recoverable states

- An expired or depleted allowance can use same-method step-up for the exact
  signing operation. Step-up does not authorize a different lane or an export.
- A capability that is still provisioning must reach its ready state.
- A policy or nonce lane conflict requires reconciliation before replay.
- A cancelled user-presence prompt ends the current operation without changing
  wallet identity.

Progress events describe the flow. Use the result union for control decisions.

Read [wallet sessions](/concepts/sessions/wallet-sessions) and [signing
lanes](/concepts/sessions/signing-lanes).
