---
title: External NEAR wallets
description: Connect the Meteor browser extension to a Seams application.
---

# External NEAR wallets

Import `ExternalNearController` from `@seams/wallet/external-near`. Construct it
with `mainnet` or `testnet` and the matching trusted RPC URL. Call `connect()`
from a user action. The first request loads the Meteor adapter.

React applications can import `ExternalNearWalletPicker` and `useExternalNear`
from `@seams/wallet/react/external-near`. Keep the controller stable for the
component lifetime. Dispose the owning view by calling `disconnect()`.

Use the current connected snapshot with `sendTransaction(connection, input)`.
Inputs use the existing Seams NEAR transaction format. This release supports
transfers and function calls. Meteor approves transactions. No Seams login or
Wallet Session is required. Connecting does not authenticate a Console user.

Keep a successful submission and call `checkOutcome(submission)`. An unresolved
result permits another status check. It never authorizes resending. A
`submission_unknown` failure requires checking wallet activity before retrying.

The adapter requires Meteor's extension transport. It does not request access
keys, enable mobile signing, or restore stored Seams authority. Disconnect clears
local authority. Manage persistent site permissions separately in Meteor.

The SDK dependency is pinned to `@meteorwallet/sdk` 3.24.0. Its action API supports
explicit extension execution. See the [Meteor SDK](https://github.com/Meteor-Wallet/meteor_wallet_sdk).
Real extension qualification remains pending. The current browser evidence uses
a controlled provider and does not establish Meteor compatibility.
