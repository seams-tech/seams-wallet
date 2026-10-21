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
| `authMenu`     | Prepare code, open, cancel, and supply external authentication for hosted auth UI. |
| `config`       | Update appearance and select configured chain targets.                       |
| `registration` | Register a wallet, add a signer, await NEAR provisioning.                    |
| `auth`         | Unlock, lock, restore, and inspect wallet sessions.                          |
| `near`         | Sign and send NEAR transactions, delegate actions, and NEP-413 messages.     |
| `evm`          | Sign and execute EIP-1559 transactions on configured EVM chains.             |
| `tempo`        | Sign and execute EIP-2718 Tempo transactions, and manage the fee token.      |
| `recovery`     | Configure recovery, synchronize account state, and rotate recovery material. |
| `devices`      | Start, approve, and inspect linked-device flows.                             |
| `keys`         | Run freshly authorized export flows.                                         |
| `placement`    | Read the wallet region and move the wallet to a region the owner selects.    |

`evm` and `tempo` both provide `signTransaction`, `signAndSendTransaction`, and an
`advanced` group for reporting after broadcast. Their transaction formats differ. Tempo
uses EIP-2718 and returns `senderHashHex` in its signed result. EVM uses EIP-1559 and
returns `txHashHex`.

Configuration calls share one namespace:

```ts [Partial example]
seams.config.setTheme('dark');
seams.config.setAppearance({ theme: { id: 'brand', mode: 'light' } });
const target = seams.config.chainTarget('tempo-testnet');
const targets = seams.config.configuredChainTargets();
```

Connection state is independent of authentication. Subscribe before connecting:

```ts [Partial example]
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
- amounts — `transfer` takes a `NearAmount`: `'1 NEAR'`, `'1000 yoctoNEAR'`, or a
  `YoctoNear` from `parseNear('1')` or `yoctoNear('…')`. `parseEther('0.5')` returns wei for an EVM `value`, and
  `parseUnits(amount, decimals)` covers other token decimals. All throw
  `AmountError`.
- `logWalletEvents`, a ready-made `onEvent` handler.
- registration intent and signer-selection types.
- `RegistrationResult`, `LoginResult`, `LoginAndCreateSessionResult`,
  `WalletSession`, and `ActionResult`.
- account and action types, including `toAccountId` and `ActionType`.
- wallet-flow event constructors, phases, and event unions.
- Google email-OTP wallet-auth flow types.
- device-linking and NEP-413 result types.
- wallet region types (`WalletPlacementCapability`, `WalletRegion`, `WalletMoveRequest`,
  `WalletPlacement`, `WalletPlacementResult`, `WalletMoveStatus`,
  `WalletMoveStatusResult`, `WalletMoveId`) and `parseWalletMoveId`.
- hosted auth-menu request builders and boundary-safe message types.

## Session calls

```ts [Partial example]
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

## Wallet region

In a regional deployment, each wallet has one home region. `seams.placement` reads
that region and moves the wallet to a region that its owner selects. Only the owner
starts a move, and the deployment must provide the destination region.

| Call                           | Purpose                                                 |
| ------------------------------ | ------------------------------------------------------- |
| `get(walletId)`                | Read the current region, or the move in progress.       |
| `move(request)`                | Start a move, or resume the same move.                  |
| `getMove(walletId, moveId)`    | Read the progress of one exact move.                    |
| `getLastMoveRequest(walletId)` | Read the last move request that this browser submitted. |

```ts [Partial example]
import { parseWalletMoveId, toWalletId } from '@seams/wallet';
import { base64UrlEncode } from '@seams/wallet/advanced';

const id = toWalletId(walletId);
const current = await seams.placement.get(id);
if (!current.ok || current.placement.state !== 'settled') return;

const random = crypto.getRandomValues(new Uint8Array(32));
const moved = await seams.placement.move({
  walletId: id,
  moveId: parseWalletMoveId(`wmove_${base64UrlEncode(random)}`),
  destinationRegion: 'WEUR',
  expectedGeneration: current.placement.generation,
});
if (moved.ok && moved.status.state === 'moving') {
  const progress = await seams.placement.getMove(id, moved.status.move.moveId);
}
```

### Read placement

`get` and `getMove` need the unlocked wallet. A locked wallet sends no request.
`get` returns a `WalletPlacementResult`. With `ok: true`, read `placement.state`:

- `settled` carries `region`, `generation`, and `nextMoveAtMs`. `WalletRegion` is
  `'US'`, `'WEUR'`, `'APAC'`, or `'OC'`.
- `moving` carries `move`: the `moveId`, both regions, both generations,
  `admittedAtMs`, `nextMoveAtMs`, and `progress`.
- `unavailable` carries the code `not_found` or `wallet_not_established`.

With `ok: false`, read `code`. `move` and `getMove` return the same codes:

| Code                     | Meaning                                                              |
| ------------------------ | -------------------------------------------------------------------- |
| `wallet_unlock_required` | This wallet is not unlocked, or its session changed during the call. |
| `unauthorized`           | The service refused the credential of this session.                  |
| `transport_unavailable`  | The request failed, or the service has no result for this request.   |
| `invalid_response`       | The response did not match the request or the expected shape.        |

### Move the wallet

`move` takes a `WalletMoveRequest`:

- `moveId` is `wmove_` followed by 43 base64url characters, which encode 32 random
  bytes. Create one ID for each new move. `parseWalletMoveId` throws on an invalid ID.
- `destinationRegion` must be different from the current region.
- `expectedGeneration` is the `generation` of the `settled` placement.

Call `move` from a direct user action. For a new move, the wallet frame collects a
fresh passkey or email-code approval from the owner. The application does not
receive this proof. `settled.nextMoveAtMs` is the earliest time for a new move.

`move` and `getMove` return a `WalletMoveStatusResult`. With `ok: true`, read
`status.state`:

- `moving` has the same shape as the `moving` placement.
- `completed` carries the `moveId`, both regions, both generations, `admittedAtMs`,
  and `completedAtMs`.

In a `moving` result, `progress` reports the stage and the wallet availability:

| `progress.state`                                | `availability` | Wallet writes                 |
| ----------------------------------------------- | -------------- | ----------------------------- |
| `freezing`, `copying`, `verified`, `activating` | `paused`       | Blocked on every device.      |
| `cleanup`                                       | `active`       | Available after a new unlock. |

`progress.execution.state` is `ready`, `running`, `retry_wait`, or `blocked`.
`retry_wait` carries `retryAtMs`, and the service retries the stage itself. `blocked`
means that the move needs service recovery. The wallet data stays preserved.

An accepted move cannot be cancelled. If the user locks the wallet or closes the
page, the move continues on the service. `move` can also reject its promise, for
example when the owner cancels the approval. A failure code or a rejected promise
does not show that the service refused the move. Send the same request again, or
read it with `getMove`. An accepted request returns its progress without a second
approval. Do not create a new `moveId` for an outcome that is not known.

`getLastMoveRequest` returns the stored `WalletMoveRequest`, or `null`. It needs no
unlock and does not contact the service, so it works after a lock or a reload. It
does not show that the service accepted the move.

### During and after a move

While `availability` is `paused`, signing, export, recovery, authentication-method
changes, and device changes fail for this wallet on every device. Disable those
controls and show the stage. Poll `getMove` for progress. Lock stays available.

A move ends the signing sessions of the wallet on all devices. After a move:

1. Expect `wallet_unlock_required`. The wallet frame locks the old session when
   it sees that the destination region is active.
2. Unlock the wallet again with `seams.auth.unlock(walletId)` from a user action.
   Each device must do this before it signs.
3. Read `getMove` or `get` again. `cleanup` with `active` availability permits
   signing. A new move must wait until `get` returns `settled`.

The move does not change the wallet ID, the signing keys, the authentication
methods, the linked devices, or the recovery configuration. In React,
`WalletSettingsPage` provides this flow as its
[wallet region setting](/reference/react#components).

## Connection and preparation

The React provider connects the wallet frame on mount. Applications that manage
clients directly can call `await seams.connection.connect()` before an operation.
When the wallet origin stores no wallet, connection reads use boot code without
loading the wallet runtime or creating its database. An operation loads the
resources it needs. `authMenu.prepare()` starts the sign-in download earlier and
never throws. Call it on pointer, focus, or touch intent when the menu mounts
only after a click. A mounted hosted menu starts the download itself.

Code preparation does not reserve a wallet or create a passkey challenge.
The hosted registration view performs registration setup while open. There is
no separate public registration-preparation handle or provider `eager` flag.

## Lifecycle rule

Keep the `walletId` from a successful registration or login result. It is the stable
identifier for later operations. Signing calls resolve the authenticated wallet
automatically. Name the wallet explicitly when your application manages several wallets.
Check the discriminator in each public result, such as `kind` or `success`. Handle every
result branch.

Continue with [results and recoverable errors](/reference/results-and-errors) or
follow the [first-signing guide](/getting-started/sign-with-policy).
