---
title: Sign with policy
description: Sign NEAR, NEP-413, or EVM-family requests with exact references and per-transaction approval.
---

# Sign with policy

Every request names the subject that authorizes it and the chain it targets. Omit the
subject to resolve the signed-in wallet. EVM-family calls require a `chainTarget` naming
a configured chain. Name the wallet explicitly when your product manages more than one
wallet at a time. No unlock step is required. Every request opens the wallet
confirmation. The user approves that transaction with the wallet's authentication
method. The examples below use `useWallet` for buttons and the `SeamsWeb` client for
standalone signing calls.

## NEAR transaction

This example sends a `set_greeting` function call to a NEAR testnet account.
Replace the receiver, action, and execution status with values from your app.

<<< ../examples/near-signing.tsx

`near` from `useWallet()` is `null` until the wallet has a NEAR account. The check next
to the sign button prevents requests before that account exists. For an exact subject,
call `seams.near.signAndSendTransaction` with `walletSession` and `nearAccount` built
from `walletSessionRefFromSession` and `nearAccountRefFromAccountId`.

## EVM-family transaction

`seams.evm` signs EIP-1559 transactions. `seams.tempo` signs Tempo's EIP-2718 typed
transactions. Both provide `signTransaction`, `executeTransaction`, and an `advanced`
group. Their transaction formats and signed results differ. `seams.evm` returns
`txHashHex`. `seams.tempo` returns `senderHashHex`.

Build the transaction with your EVM utilities. Select the chain with a configured
network slug, such as `'ethereum-sepolia'`. The selector must match exactly one chain.
If it matches two chains, the SDK throws an error that names both. Call
`seams.chainTarget(selector)` to resolve the target before signing. You can also pass an
exact chain target.

<<< ../examples/evm-signing.ts

The example targets Ethereum Sepolia and uses placeholder transaction values. Add it to
your configured chains before calling this helper. See the [chain configuration
example](/examples/signing#execute-an-evm-family-transaction). Replace the chain,
recipient, fees, and data before sending a real transaction. The SDK sets `tx.chainId`
from the chain target. It uses the RPC endpoint from your chain configuration. You do
not repeat either value on the call. A successful call returns the transaction hash.

Use `signTransaction` when your application broadcasts the payload itself. Report the
broadcast through `seams.evm.advanced` and `seams.tempo.advanced`.

## Sign with less friction

Use per-transaction approval while you integrate. To allow several signatures without a
prompt for each one, create a signing session with `unlock`. Read [wallet sessions and
signing lanes](/guides/wallet-sessions-and-signing-lanes).

## Handle cancellation and retries

- Treat a cancelled confirmation or policy denial as the result of the current
  request and show a clear retry action.
- If broadcast status is uncertain, reconcile the transaction or nonce before
  submitting another request.
- Keep the `onEvent` callback attached while you build progress UI or audit
  logs. Each canonical example shows the same event shape.

## Continue

[Link a device, export a key, or recover a wallet account](/getting-started/delegate-or-rotate).
