---
title: Release 0.56.0
description: seams.speakToSign.enroll() enrolls the owner's voice for Speak-to-Sign, and 0.55.0's Receive and Send, openScreen, and wallet and server fixes carry forward.
---

# Release 0.56.0

The browser SDK, server SDK, VoiceID plugin, and Speak-to-Sign plugin use **0.56.0**.

- **Experimental, NEAR testnet only:** `seams.speakToSign.enroll({ walletId })` enrolls the owner's voice with the Speak-to-Sign verifier. The owner reads three short phrases on the VoiceID surface, then approves one `authorize_enrollment` call that authorizes exactly these recordings for 10 minutes. The verifier stores the voice template only for audio that the vault authorized. A new enrollment replaces the template. The result is `enrolled`, `refused` (with the reason, such as `speaker` or `quality`), `cancelled`, or `unavailable`. The new types are `SpeakToSignEnrollmentRequest` and `SpeakToSignEnrollmentResult`. See [Experimental: Speak-to-Sign](/concepts/auth-methods/speak-to-sign).
  - Before the first spoken payment, the owner turns VoiceID on, creates a vault with at least one contact, and calls `enroll`. On testnet the owner account needs about 0.3 NEAR.
  - The Seams verify route `POST /speak-to-sign/v1/verify` accepts the enrollment request (three recordings, up to 1,100 KB).
- 0.55.0 changes, kept in 0.56.0:
  - **Breaking:** the wallet settings balance actions are **Receive** and **Send** (they were **Deposit** and **Withdraw** in 0.53.0 and 0.54.0). `seams.assets.prepareWithdrawal()` is `seams.assets.prepareSend()`, with the types `SendRequest`, `SendRejection`, and `PreparedSend`. `WalletBalances` takes `onReceive` and `onSend`.
  - `seams.assets.openScreen({ screen, assetId })` opens **Assets**, **Receive**, or **Send** in the mounted settings panel. **Send** offers **Receive** for the same asset when the amount is more than the balance. See [core reference](/reference/core#asset-balances).
  - `ExternalEvmController.switchChain()` keeps the connection when the wallet stays on another network after the switch, returns `unsupported_chain`, and sets `network.kind: 'unsupported'`. See [External EVM wallets](/guides/external-evm-wallets).
  - Wallet fixes: worker resets, warm session material of every signing lane, the ECDSA presignature pool after a clear, ECDSA registration ceremonies, Email OTP sealed records per chain, passkey warm sessions and export-root setup, the **Send** form during the **Max** fee probe, and the hosted auth menu's Google code submit.
  - `@seams/wallet-server` fixes: registration cancel, the sessionless linked-device acknowledgement, and the Speak-to-Sign verify route, which answers `401 unauthorized` or `503 session_unavailable` instead of `500` and spends no session quota.
- Install all four packages at 0.56.0. The VoiceID host API stays at version **9**. Speak-to-Sign stays experimental and NEAR testnet only. Do not use it with real funds.

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds no database migrations.
