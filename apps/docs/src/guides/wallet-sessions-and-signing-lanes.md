---
title: Wallet sessions and signing lanes
description: Unlock creates a signing session with a use limit and expiry. Lanes identify the custody and policy path for each operation family.
---

# Wallet sessions and signing lanes

Signing can proceed without a reusable Wallet Session: the user authorizes
the exact operation with the selected lane's auth method. `unlock` provisions
a **Wallet Session** with a use budget and expiry so subsequent requests can
reuse that authorization within its scope. Each operation still requires
server admission and validated signing material.

Locking clears reusable session access while preserving wallet identity.

## Unlock: provision a signing session

Call `unlock` with the `walletId` returned during registration. The result has separate
NEAR and EVM-family success branches. Read `nearAccountId` only from the NEAR branch.

<<< ../examples/unlock.ts

The returned wallet session backs subsequent signing calls until it expires or runs out
of uses. The next signing operation can request fresh authentication with the same
method for that exact operation. Unlock again when you want a fresh reusable allowance.
Size the session's lifetime and budget for the expected burst of operations.

## Set the session budget

The app asks for the budget. The server decides it.

- Set `signingSessionDefaults: { ttlMs, remainingUses }` in the provider config. It
  applies to unlock, to the session that registration gives and to the session that
  a passkey account sync gives.
- To ask for a different budget for one login, pass `signingSession: { ttlMs,
  remainingUses }` in the login options.
- With no setting, a session gives 5 signatures and lasts 24 hours.
- Each value is a non-negative integer. Another value fails the config.
- `0` in either value skips the warm session of a passkey unlock. An Email OTP or
  VoiceID unlock always opens a session, so with `0` it asks for the default budget.

The server grants the request up to the maximum of the project environment. A tenant
sets that maximum in the Seams Console. When the tenant sets none, the maximum is 100
signatures and 30 days. The highest maximum that a tenant can set is 1,000,000
signatures and 30 days.

The granted values can be lower than the request. Read them from the unlock result
(`signingSession.remainingUses` and `signingSession.expiresAtMs`), not from your
config. A linked device always gets its own short session (100 signatures, 15
minutes), also capped by the tenant's maximum.

## Before you call a signing method

A signing lane identifies the custody and policy path for one operation
family. With a session provisioned:

1. Require a ready `WalletSession`.
2. Derive its exact reference from validated wallet identity.
3. Derive the NEAR account or EVM-family chain target from validated
   configuration.
4. Confirm that the requested lane is ready.
5. Pass the same session reference through the complete operation.

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
