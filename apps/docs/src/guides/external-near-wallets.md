---
title: External NEAR wallets
description: Let users choose Meteor, HOT Wallet, or Intear Wallet instead of creating a Seams threshold wallet.
---

# External NEAR wallets

Offer two wallet choices in your application:

- **Use a Seams wallet:** create or unlock a threshold wallet through the existing Seams authentication flow.
- **Connect an existing wallet:** choose from the wallets your app enables and approve requests in that wallet.

::: warning Message-signing availability
`@seams/wallet@0.25.0` includes external NEAR connections and transactions.
Meteor's `signMessage` API is implemented on `dev` for the next release.
Use an exact release containing this API after publication.
:::

## Wallets and networks

| Wallet ID | Wallet        | Approval surface              | Configured networks | Real-wallet verification                                                                    |
| --------- | ------------- | ----------------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| `meteor`  | Meteor Wallet | Browser extension             | Mainnet and testnet | Testnet connection, final transaction execution, and contract readback verified             |
| `hot`     | HOT Wallet    | Browser extension             | Mainnet only        | Mainnet connection and retry after popup cancellation verified; transaction signing pending |
| `intear`  | Intear Wallet | Popup at `wallet.intear.tech` | Mainnet and testnet | Pending                                                                                     |

A configured network is an implemented adapter path, not a claim of real-wallet
verification. HOT has no qualified testnet path. The picker disables HOT on testnet.
Intear uses a popup even when the other choices use extensions.

Meteor is the first rollout target; HOT follows. HOT transaction signing and
Intear real-wallet checks remain pending.

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

## Choose supported wallets

Every wallet is opt-in. Configure the controller's `wallets` list:

- `['meteor']` enables Meteor only.
- `['meteor', 'hot']` enables Meteor and HOT, in that order.
- `['meteor', 'hot', 'intear']` enables all three.
- `[]` disables all external NEAR wallets.

Only configured wallets appear in the picker. Calling `connect` for a disabled
wallet returns `unavailable` without loading its adapter or changing the active
connection. HOT still requires mainnet even when enabled.

To change the selection at runtime, call `controller.setWallets(['meteor', 'hot'])`.
The picker updates automatically. Removing an active or connecting wallet disconnects
it locally and invalidates prepared operations. This does not undo a submitted
transaction or revoke permissions in the external wallet.

The controller copies the list, removes duplicate IDs, and preserves its order.
Use `setWallets` to change it; mutating your original array has no effect.

## React example

Start with the built-in wallet picker. It handles wallet selection, connection,
and disconnect. Keep its controller stable across renders.

<<< ../examples/external-near.tsx

The picker disconnects when it unmounts. For a custom picker, use `useExternalNear`
to subscribe to the controller and call `disconnect()` when the owning view closes.
No Seams provider is required.

### Send a transaction

Call this function from your application's send action, using the **same controller**
as the picker. Use a funded testnet account and replace the receiver with your
contract. This call attaches no deposit; the wallet pays the network fee.

<<< ../examples/external-near-transaction.ts

Replace the console messages with your application's status display. Keep the
returned submission if the outcome is `unresolved`, then call
`controller.checkOutcome(submission)` again to check its status.

This example shows the basic flow. In a production UI, disable duplicate sends
while a request is pending. If submission is unknown, check wallet activity before
preparing another transaction. See [outcomes and retry rules](#outcomes-and-retry-rules).

### Sign an ownership message

Meteor supports NEP-413, the NEAR standard for message signatures.
Pass the application's challenge message, recipient, and 32-byte nonce unchanged.
For an ownership check, the server must issue the nonce and reject reused challenges.

<<< ../examples/external-near-message.ts

The result contains `accountId`, `publicKey`, and a base64 `signature`.
The request also accepts an optional `callbackUrl` and `state`.
The connector verifies the signature over the exact NEP-413 payload before returning it.
It retains the request's state through Meteor's correlated response.
Message signing submits no transaction and requires no balance.

The application must still check that the key belongs to the claimed account on
the selected network. It must verify its challenge and recipient on the server.
HOT and Intear return `unavailable` for message signing in this connector.

## Controller API

For a custom UI or a framework-independent application, import
`ExternalNearController` from `@seams/wallet/external-near`. React bindings live at
`@seams/wallet/react/external-near`; they are separate from `@seams/wallet/react`.

| API                                                        | Behavior                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `new ExternalNearController({ network, rpcUrl, wallets })` | Require a network, its HTTP(S) RPC URL, and an explicit wallet list. Invalid configuration throws.                                    |
| `connect(wallet)`                                          | Request a connection to `meteor`, `hot`, or `intear`. Return an `ExternalNearResult<ExternalNearConnection>`.                         |
| `setWallets(wallets)`                                      | Update the allowed wallets and disconnect a removed active wallet.                                                                    |
| `getSnapshot()`                                            | Read `wallets`, `connection`, and `busy`. Connection is `disconnected`, `connecting`, or `connected`.                                 |
| `subscribe(listener)`                                      | Observe snapshot changes. Return an unsubscribe function.                                                                             |
| `sendTransaction(connection, input)`                       | Submit transfers or function calls with the exact current connected snapshot. Return an `ExternalNearResult<ExternalNearSubmission>`. |
| `signMessage(connection, params)`                          | Request a Meteor NEP-413 signature. Return an `ExternalNearResult<ExternalNearSignedMessage>` after payload verification. |
| `checkOutcome(submission)`                                 | Check the captured hash, account, and network through RPC. Return `confirmed`, `failed`, or `unresolved`.                             |
| `disconnect()`                                             | Clear local authority, dispose the adapter, and invalidate pending work.                                                              |

Choose the account in the wallet's connection prompt. Connected state contains
`wallet`, `accountId`, `network`, and `generation`. The generation identifies the
connection instance. Pass the snapshot itself to signing; do not construct or copy
one. Reconnection or disconnect invalidates an earlier snapshot.

Transfers and function calls use the existing NEAR action helpers, such as
`transfer` and `functionCall`. The current connector does not expose batch
submission, delegate actions, hardware wallets, or mobile transports.

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
transaction request is dispatched, rejection, transport loss, or an invalid result can
be reported conservatively as `submission_unknown`. It does not expose a separate
user-rejection result. Closing an approval window does not prove that submission
was canceled.

For `signMessage`, a decline, transport failure, or invalid signature returns
`unavailable`. A changed connection returns `connection_changed`, including changes
during approval or verification. Concurrent signing requests return `pending_request`.

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
