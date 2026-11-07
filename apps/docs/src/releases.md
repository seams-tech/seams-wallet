---
title: Release 0.53.0
description: Wallet settings show balances with Deposit and Withdraw, and seams.assets reads the wallet's listed assets.
---

# Release 0.53.0

The browser SDK, server SDK, and VoiceID plugin use **0.53.0**.

- Wallet settings start with a balance card: the leading balances, **All assets**, **Deposit**, and **Withdraw**. On NEAR mainnet the listed assets are NEAR, stNEAR, USDC, USDt, ETH, BTC, SOL, and ZEC. BTC, SOL, and ZEC are NEAR Intents tokens on NEAR. NEAR testnet lists NEAR, stNEAR, and USDC.
- **Deposit** shows the wallet's address for one asset, a QR code, and the network the asset must arrive on. **Withdraw** checks the amount and the recipient, then opens the wallet's confirm card. A token recipient without token storage gets a `storage_deposit` in the same transaction.
- `seams.assets` reads the same balances without UI. A failed read is `unavailable`, never zero. `prepareWithdrawal()` builds the unsigned transaction. `WalletBalances` renders the balance card in your own panel. See [UI components](/guides/ui-components#balances-deposit-and-withdraw).
- The transfer review and wallet settings use one asset list and the same token artwork. The review shows tokens as before.
- 0.52.0 showed an owner NEAR transaction that NEAR rejects at broadcast, such as for `NotEnoughBalance`, as **Rejected by NEAR**, with the reason stated once. 0.53.0 keeps that fix.
- Install `@seams/voiceid` 0.53.0 with `@seams/wallet` 0.53.0. The VoiceID host API stays at version 8.

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds no database migrations.
