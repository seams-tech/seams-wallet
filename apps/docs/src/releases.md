---
title: Release 0.55.0
description: Wallet balances say Receive and Send, seams.assets.openScreen opens the settings asset screens, and wallet session and registration fixes.
---

# Release 0.55.0

The browser SDK, server SDK, VoiceID plugin, and Speak-to-Sign plugin use **0.55.0**.

- **Breaking:** the wallet settings balance actions are now **Receive** and **Send**. They were **Deposit** and **Withdraw** in 0.53.0 and 0.54.0. An application can use "Deposit" and "Withdraw" for its own accounts without a second meaning in the wallet.
  - `seams.assets.prepareWithdrawal()` is now `seams.assets.prepareSend()`. Its types are `SendRequest`, `SendRejection`, and `PreparedSend`.
  - `WalletBalances` takes `onReceive` and `onSend` in place of `onDeposit` and `onWithdraw`. Without handlers, its buttons now open the matching screen of the mounted settings panel.
- `seams.assets.openScreen({ screen, assetId })` opens **Assets**, **Receive**, or **Send** in the mounted settings panel, with `assetId` chosen first. It returns `false` when no settings panel is mounted. When an owner operation ends as `not_submitted` with `shortfall`, use it to offer "Receive NEAR". See [core reference](/reference/core#asset-balances).
- **Send** offers **Receive** for the same asset when the amount is more than the balance.
- The wallet keeps BTC, SOL, and ZEC as NEAR tokens. It does not show prices or an application's own account balance.
- Wallet fixes: a reset worker prepares its session again; clearing a wallet session removes the warm material of every signing lane; the ECDSA presignature pool fills again after a clear; an ECDSA registration ceremony closes whatever the activation save returns; an Email OTP unlock reads the sealed ECDSA record for the requested chain; and passkey warm sessions and export-root setup do not use stale state after a reset or a destroy.
- `@seams/wallet-server` fixes: a registration cancel retires the wallet in one batch, and a linked-device acknowledgement without a session cleans up in one guarded batch.
- Install all four packages at 0.55.0. The VoiceID host API stays at version **9**. Speak-to-Sign stays experimental and NEAR testnet only. See [Experimental: Speak-to-Sign](/concepts/auth-methods/speak-to-sign).

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds no database migrations.
