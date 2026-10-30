---
title: Start here
description: Install Seams, create a wallet, and sign your first operation.
---

# Start here

For a Seams threshold wallet, create a wallet and sign a transaction before adding
recovery, linked devices, or delegated authority. This quickstart needs a React app
and a Seams project with a wallet origin, relayer URL, and managed-registration credentials.

## Choose your wallet path

If your app already uses Google SSO, [reuse that login for wallet settings](/guides/google-sso).
SDK 0.33.0 supports direct Google ID tokens and backend handoffs for associated wallets.
Signing and security changes retain their owner authentication requirements.

The steps below create a Seams threshold wallet. To let users bring Meteor,
HOT Wallet, or Intear Wallet, use the [external NEAR connector](/guides/external-near-wallets).
That path needs no Seams provider or login. It is a development preview.

## 1. Install the SDK

```sh
pnpm add @seams/wallet@0.33.0
```

## 2. Mount the provider

Configure the isolated wallet origin once near the root of your app.
`seamsTestnetConfig` requires the wallet origin, relayer URL, and managed-registration
credentials. It uses SDK defaults for the remaining settings. The example reads these
values from `import.meta.env`. Use the same environment variable names or your own
configuration loader. Pass `chains` to configure different networks. Use
`defineSeamsConfig` for networks other than testnet.

These docs target `@seams/wallet` **0.33.0**. Keep the wallet-origin assets and
`@seams/wallet-server` on the matching release. See
[the deployment requirements](/deploy-and-operate/hosted-integration)
before updating an existing integration.

[VoiceID](/concepts/auth-methods/voiceid) is an optional package for voice enrollment,
unlock, and reviewed transfer approval. Its engine and models load only when VoiceID is used.

The wallet iframe protocol is **21.0.0**. The recovery CLI uses **0.29.0**.
See [Release 0.33.0](/releases) for integration and deployment requirements.

<<< ./examples/setup.tsx

Render your wallet UI inside `SeamsWebProvider`. Keep the wallet service and SDK
assets on the configured wallet origin.

For the complete registration UI, use `HostedRegistration` from the
[hosted-menu example](/examples/wallet-setup-and-authentication#hosted-registration-and-sign-in-intent).
The menu prepares setup while its registration view is open. The custom button
below starts setup within its registration call.

## 3. Create a wallet

Render the button from the registration example inside the provider. When the user
clicks it, the SDK opens the passkey prompt. The example logs progress and the result
for that registration outcome.

<<< ./examples/registration.tsx

Read [Create a wallet](/getting-started/create-wallet) for the result branches
and retry guidance.

## 4. Sign a transaction

After the requested signer is ready, `useSeams().wallet` provides signing methods for the
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

Give `transfer` an amount with its unit: `transfer('1 NEAR')` sends 1 NEAR, and
`transfer('1000 yoctoNEAR')` sends 1000 yoctoNEAR. A string without a unit does not
compile. For an amount computed at run time, use `parseNear(amount)` for a decimal
NEAR string or `yoctoNear(amount)` for an amount already in yoctoNEAR.

An EVM `value` is a `bigint` in wei. Write it with `parseEther('0.5')`, which takes a
decimal amount of the chain's 18-decimal native coin (ETH, POL and so on). For a
token with other decimals, such as an ERC-20, use `parseUnits('1.5', 6)`. All of
these helpers throw `AmountError` for a negative, non-numeric or over-precise
amount.

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
