---
title: Core browser SDK
description: Public classes, capabilities, builders, and result types exported from the main @seams/wallet entrypoint.
---

# Core browser SDK

Import the framework-neutral browser API from `@seams/wallet`.

```ts [Import example]
import { SeamsWeb, type SeamsConfigsInput } from '@seams/wallet';
```

## Primary surface

`SeamsWeb` is the browser client. Its methods are organized by capability:

| Capability     | Responsibility                                                               |
| -------------- | ---------------------------------------------------------------------------- |
| `connection`   | Connect, observe readiness, and dispose the client.                          |
| `events`       | Subscribe to SDK lifecycle events.                                          |
| `authMenu`     | Open, cancel, and supply external authentication for hosted auth UI.         |
| `config`       | Update appearance and select configured chain targets.                       |
| `registration` | Register a wallet, add a signer, await NEAR provisioning.                    |
| `auth`         | Unlock, lock, restore, and inspect wallet sessions.                          |
| `near`         | Sign and send NEAR transactions, delegate actions, and NEP-413 messages.     |
| `evm`          | Sign and execute EIP-1559 transactions on configured EVM chains.             |
| `tempo`        | Sign and execute EIP-2718 Tempo transactions, and manage the fee token.      |
| `recovery`     | Configure recovery, synchronize account state, and rotate recovery material. |
| `devices`      | Start, approve, and inspect linked-device flows.                             |
| `keys`         | Run freshly authorized export flows.                                         |

`evm` and `tempo` both provide `signTransaction`, `executeTransaction`, and an
`advanced` group for reporting after broadcast. Their transaction formats differ. Tempo
uses EIP-2718 and returns `senderHashHex` in its signed result. EVM uses EIP-1559 and
returns `txHashHex`.

Configuration calls share one namespace:

```ts
seams.config.setTheme('dark');
seams.config.setAppearance({ theme: { id: 'brand', mode: 'light' } });
const target = seams.config.chainTarget('tempo-testnet');
const targets = seams.config.configuredChainTargets();
```

Connection state is independent of authentication. Subscribe before connecting:

```ts
const stop = seams.connection.onChange((state) => {
  if (state.kind === 'failed') console.error(state.error);
});
await seams.connection.connect();
const ready = seams.connection.getState().kind === 'ready';
// When the client owner releases this instance:
stop();
seams.connection.dispose();
```

`onChange` immediately delivers the current snapshot. States are `idle`,
`connecting`, `ready`, `failed`, and `disposed`. Readiness includes initial session
and preference reconciliation. Concurrent calls share one attempt. Call `connect`
to retry a failed attempt. Disposal is terminal and releases client resources;
it does not lock the wallet or delete durable presignatures.

## Naming the subject and the chain

Every operation names the wallet it authorizes and, for EVM-family calls, the
chain it targets:

- Omit `walletSession` and the call resolves the **authenticated** wallet.
  Supply a `WalletSessionRef` — or just a wallet id — to name an exact one,
  which is what an application managing several wallets should do.
- Omit `nearAccount` and NEAR calls resolve the authenticated wallet's account.
  A bare account id is accepted.
- `chainTarget` accepts a configured network slug such as `'tempo-testnet'`.
  It is required for EVM-family signing and export. Resolution requires exactly one configured match. An ambiguous selector throws an error naming the matches.

The exact-reference builders (`walletSessionRefFromSession`,
`nearAccountRefFromAccountId`, `thresholdEcdsaChainTargetFromConfig`) are
exported from this entrypoint and from `@seams/wallet/react`.

## Public values and types

The main entrypoint includes:

- `SeamsWeb`, `PASSKEY_MANAGER_DEFAULT_CONFIGS`, and `buildConfigsFromEnv`.
- `defineSeamsConfig` and `seamsTestnetConfig`, which take the values an
  application must supply and default the rest.
- the boundary reference builders and their types (`WalletSessionRef`,
  `NearAccountRef`, `ThresholdEcdsaChainTarget`, `WalletId`).
- action builders — `functionCall`, `transfer`, `stake`, `addKey`,
  `deleteKey`, `deleteAccount`, `createAccount`, `deployContract`.
- `logWalletEvents`, a ready-made `onEvent` handler.
- registration intent and signer-selection types.
- `RegistrationResult`, `LoginResult`, `LoginAndCreateSessionResult`,
  `WalletSession`, and `ActionResult`.
- account and action types, including `toAccountId` and `ActionType`.
- wallet-flow event constructors, phases, and event unions.
- Google email-OTP wallet-auth flow types.
- device-linking and NEP-413 result types.
- hosted auth-menu request builders and boundary-safe message types.

## Session calls

```ts
await seams.auth.unlock(walletId);
const session = await seams.auth.getSession();
const hasPasskey = await seams.auth.hasPasskey(walletId);
const recent = await seams.auth.getRecentUnlocks();
const unsubscribe = seams.auth.onSessionChange(renderSession);
await seams.auth.lock();
```

Lock retires signing authority and clears volatile material. It retains valid
stored presignatures for a later authorized unlock. React's `useWalletAuth()`
and context also expose `getSession`.

`onSessionChange` receives a complete `WalletSession`, including authentication,
identity, and capability state. Subscribe before or after `connection.connect()`.
The listener receives the current reconciled state once connected and receives
later observations. Observations can repeat the same state. Subscribing does not
open a connection. Subscriptions survive reconnects; unsubscribe or dispose the
client to stop delivery. Use `connection.onChange` for connection failures.

## Connection and preparation

The React provider connects the wallet frame on mount. Applications that manage
clients directly can call `await seams.connection.connect()` before an operation.
Registration, authentication, and signing prepare their required resources inside
the wallet host. No application prewarm call or provider `eager` flag is needed.

## Lifecycle rule

Keep the `walletId` from a successful registration or login result. It is the stable
identifier for later operations. Signing calls resolve the authenticated wallet
automatically. Name the wallet explicitly when your application manages several wallets.
Check the discriminator in each public result, such as `kind` or `success`. Handle every
result branch.

Continue with [results and recoverable errors](/reference/results-and-errors) or
follow the [first-signing guide](/getting-started/sign-with-policy).
