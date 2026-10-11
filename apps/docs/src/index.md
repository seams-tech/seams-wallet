---
title: Start here
description: Install Seams, create a wallet, and sign your first operation.
---

# Start here

Create a wallet and sign a transaction before you add recovery, linked devices, or
delegated authority. You need a React app and a Seams project with a wallet origin,
relayer URL, and managed-registration credentials.

## 1. Install the SDK

```sh
pnpm add @seams/wallet@0.9.0
```

## 2. Mount the provider

Configure the isolated wallet origin once near the root of your app.
`seamsTestnetConfig` requires the wallet origin, relayer URL, and managed-registration
credentials. It uses SDK defaults for the remaining settings. The example reads these
values from `import.meta.env`. Use the same environment variable names or your own
configuration loader. Pass `chains` to configure different networks. Use
`defineSeamsConfig` for networks other than testnet.

These docs target `@seams/wallet` **0.9.0**. Keep the wallet-origin assets and
`@seams/wallet-server` on the matching release. See
[upgrading to 0.9.0](/deploy-and-operate/hosted-integration#upgrading-to-0-9-0)
before updating an existing integration.

<<< ./examples/setup.tsx

Render your wallet UI inside `SeamsWebProvider`. Keep the wallet service and SDK
assets on the configured wallet origin.

## 3. Create a wallet

Render the button from the registration example inside the provider. When the user
clicks it, the SDK opens the passkey prompt. The example logs progress and the result
for that registration outcome.

<<< ./examples/registration.tsx

Read [Create a wallet](/getting-started/create-wallet) for the result branches
and retry guidance.

## 4. Sign a transaction

After the requested signer is ready, `useWallet()` provides signing methods for the
signed-in wallet. Pass only the transaction to these methods. Each request opens the
wallet confirmation. The user approves that transaction with the wallet's authentication
method.

To target a wallet other than the signed-in one, use `useSeams().seams` and
pass an exact `walletSession` on the call.

- [Sign a NEAR transaction](/getting-started/sign-with-policy#near-transaction)
- [Execute an EVM-family transaction](/getting-started/sign-with-policy#evm-family-transaction)

Build actions with helpers such as `functionCall` and `transfer`. Avoid constructing raw
objects such as `{ type: ActionType.FunctionCall, … }`. Pass `logWalletEvents()` to
`onEvent` to log progress in the console.

`seams.evm` and `seams.tempo` both provide `signTransaction`, `signAndSendTransaction`, and
`advanced`. They use separate transaction formats: EIP-1559 for EVM and EIP-2718 for
Tempo.

These requests need no unlock step. To allow repeated signatures without a prompt for
each one, create a signing session. Read [wallet sessions and signing
lanes](/guides/wallet-sessions-and-signing-lanes).

## Add advanced capabilities

Once the first signing path works, continue with [linked devices, key export,
and recovery](/getting-started/delegate-or-rotate). For authentication choices,
policies, and deployment boundaries, use the [guides](/guides/).
