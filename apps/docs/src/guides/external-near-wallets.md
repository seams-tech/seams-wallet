---
title: External NEAR wallets
description: Connect Meteor, HOT Wallet, or Intear Wallet to a Seams application.
---

# External NEAR wallets

Import `ExternalNearController` from `@seams/wallet/external-near`. Construct it
with `mainnet` or `testnet` and the matching trusted RPC URL. Call `connect(wallet)`
from a user action. Choose `meteor`, `hot`, or `intear`. The first request loads only that adapter.

React applications can import `ExternalNearWalletPicker` and `useExternalNear`
from `@seams/wallet/react/external-near`. Keep the controller stable for the
component lifetime. Dispose the owning view by calling `disconnect()`.

Use the current connected snapshot with `sendTransaction(connection, input)`.
Inputs use the existing Seams NEAR transaction format. This release supports
transfers and function calls. The selected wallet approves transactions. No Seams login or
Wallet Session is required. Connecting does not authenticate a Console user.

Keep a successful submission and call `checkOutcome(submission)`. An unresolved
result permits another status check. It never authorizes resending. A
`submission_unknown` failure requires checking wallet activity before retrying.

| Wallet | Transport | Networks |
| --- | --- | --- |
| Meteor Wallet | Installed browser extension | Mainnet and testnet |
| HOT Wallet | Installed browser extension | Mainnet only |
| Intear Wallet | Popup at wallet.intear.tech | Mainnet and testnet |

HOT testnet support is not qualified. The picker disables that choice on testnet.
Intear uses an ephemeral request-authentication key and never requests an on-chain
access key. Popup responses require the expected wallet origin and popup window.
Neither connection nor the protocol session authenticates a Console user.

Disconnect clears local authority. Manage site permissions in the selected wallet.
Mobile bridge connections, hardware wallets, and new wallet-registry announcements
are outside this connector's scope.

Adapter references:

- [Meteor SDK](https://github.com/Meteor-Wallet/meteor_wallet_sdk), pinned to 3.24.0.
- [HOT extension API](https://github.com/hot-dao/hot-sdk-js/blob/main/src/hot.ts).
- [HOT NEAR adapter](https://github.com/hot-dao/hot-sdk-js/blob/main/src/adapter/near.ts).
- [Intear popup protocol](https://github.com/INTEARnear/wallet/blob/main/POSTMESSAGE_PROTOCOL.md).

Real wallet qualification remains pending. Browser tests use controlled providers
and do not establish real-wallet compatibility.
