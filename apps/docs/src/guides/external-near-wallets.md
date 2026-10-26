---
title: External NEAR wallets
description: Let users choose Meteor, HOT Wallet, or Intear Wallet instead of creating a Seams threshold wallet.
---

# External NEAR wallets

Offer two wallet choices in your application:

- **Use a Seams wallet:** create or unlock a threshold wallet through the existing Seams authentication flow.
- **Connect an existing wallet:** select Meteor, HOT Wallet, or Intear Wallet and approve requests in that wallet.

::: warning Availability: development preview
The NEAR connector is implemented on `dev`. It is **not included in the published
`@seams/wallet@0.22.0` package**. npm was checked on 2026-10-26.
The examples below compile against the development SDK. Use an exact release
containing these exports after publication. See [release status](/releases#prepared-near-connector).
:::

## Wallets and networks

| Wallet ID | Wallet        | Approval surface              | Configured networks | Real-wallet verification                                                        |
| --------- | ------------- | ----------------------------- | ------------------- | ------------------------------------------------------------------------------- |
| `meteor`  | Meteor Wallet | Browser extension             | Mainnet and testnet | Testnet connection, final transaction execution, and contract readback verified |
| `hot`     | HOT Wallet    | Browser extension             | Mainnet only        | Pending                                                                         |
| `intear`  | Intear Wallet | Popup at `wallet.intear.tech` | Mainnet and testnet | Pending                                                                         |

A configured network is an implemented adapter path, not a claim of real-wallet
verification. HOT has no qualified testnet path. The picker disables HOT on testnet.
Intear uses a popup even when the other choices use extensions.

## Integration boundary

The external connector runs in the application document. It needs no
`SeamsWebProvider`, Seams login, Wallet Session, wallet iframe, or threshold backend.
It requires a browser, an available external wallet, and a trusted NEAR RPC URL
for the selected network. Keep the RPC URL and network consistent.

Connecting exposes an external account to the application. It does not authenticate
a Console user, create Seams custody, or authorize Seams signing policies.
Keep the selected wallet source explicit when your app also supports Seams wallets.
Route each operation through that source's signing API.

The wallet retains its signing keys and approval UI. The connector requests no
on-chain function-call key. Intear creates an in-memory key to authenticate popup
requests; this key never becomes an on-chain signing key.

## React example

This example offers a wallet picker and one testnet greeting transaction. Use a
funded testnet account and replace the receiver with your contract. The selected
wallet pays the network fee. The function call attaches no deposit.

<<< ../examples/external-near.tsx

`ExternalNearWalletPicker` handles connection and disconnect controls. It disconnects
its controller when the picker unmounts. `useExternalNear` only subscribes to
snapshots. A custom picker must call `disconnect()` when its owning view closes.
Keep one controller instance per owning view. Do not recreate it on each render.

The example retains the original submission for status checks. After
`submission_unknown`, it disables further sends and asks the user to inspect wallet
activity. It never retries a transaction automatically.

## Controller API

For a custom UI or a framework-independent application, import
`ExternalNearController` from `@seams/wallet/external-near`. React bindings live at
`@seams/wallet/react/external-near`; they are separate from `@seams/wallet/react`.

| API                                           | Behavior                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `new ExternalNearController(network, rpcUrl)` | Configure `mainnet` or `testnet` and its HTTP(S) RPC URL. Invalid URL configuration throws.                                           |
| `connect(wallet)`                             | Request a connection to `meteor`, `hot`, or `intear`. Return an `ExternalNearResult<ExternalNearConnection>`.                         |
| `getSnapshot()`                               | Read `connection` and `busy`. Connection is `disconnected`, `connecting`, or `connected`.                                             |
| `subscribe(listener)`                         | Observe snapshot changes. Return an unsubscribe function.                                                                             |
| `sendTransaction(connection, input)`          | Submit transfers or function calls with the exact current connected snapshot. Return an `ExternalNearResult<ExternalNearSubmission>`. |
| `checkOutcome(submission)`                    | Check the captured hash, account, and network through RPC. Return `confirmed`, `failed`, or `unresolved`.                             |
| `disconnect()`                                | Clear local authority, dispose the adapter, and invalidate pending work.                                                              |

Choose the account in the wallet's connection prompt. Connected state contains
`wallet`, `accountId`, `network`, and `generation`. The generation identifies the
connection instance. Pass the snapshot itself to signing; do not construct or copy
one. Reconnection or disconnect invalidates an earlier snapshot.

Transfers and function calls use the existing NEAR action helpers, such as
`transfer` and `functionCall`. The current connector does not expose message
signing, batch submission, delegate actions, hardware wallets, or mobile transports.
The [NEP-413 example](/examples/signing#sign-a-nep-413-message) applies to a Seams wallet.

## Outcomes and retry rules

A successful `sendTransaction` result contains a submission hash. This does not
prove final execution. Keep the submission until status reconciliation completes.

| Outcome or failure code | Application action                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `confirmed`             | Show success. RPC matched the transaction identity and reported final execution without a failed receipt. |
| `failed`                | Show the final on-chain failure and retain the hash.                                                      |
| `unresolved`            | Keep the hash. Offer another `checkOutcome` call; do not resend.                                          |
| `unavailable`           | Check wallet readiness, network support, and popup permissions before a fresh connection attempt.         |
| `invalid_input`         | Correct the receiver, action, amount, or gas before requesting approval.                                  |
| `connection_changed`    | Read the new snapshot and ask the user to review the selected wallet/account again.                       |
| `pending_request`       | Finish or cancel the current wallet request.                                                              |
| `submission_unknown`    | Check wallet activity and chain history before preparing another transaction.                             |

The connector currently reports a declined connection as `unavailable`. After a
signing request is dispatched, rejection, transport loss, or an invalid result can
be reported conservatively as `submission_unknown`. It does not expose a separate
user-rejection result. Closing an approval window does not prove that submission
was canceled.

Disconnect clears local state. It does not revoke existing site permissions in
the wallet. An extension can retain its own approval window after local disconnect.

## Troubleshooting

An installed Meteor extension can inject its page interface after the page loads.
Retry connection after initialization. A cached “not detected” label can be stale.
Open the app in the profile that contains the extension and check its site access.

Allow Intear's popup for the application origin. The adapter accepts replies only
from its fixed wallet origin and the popup opened for that request. It rejects
redirected wallet origins and native bridge sessions.

If imports cannot be resolved from version `0.22.0`, check the availability notice
above. See [external NEAR troubleshooting](/deploy-and-operate/troubleshooting#external-near-wallets)
for the same boundaries in the operational guide.
