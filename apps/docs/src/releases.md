---
title: Release 0.54.0
description: Experimental, testnet-only Speak-to-Sign spoken payments in the new @seams/speak-to-sign package, and VoiceID host API version 9.
---

# Release 0.54.0

The browser SDK, server SDK, VoiceID plugin, and Speak-to-Sign plugin use **0.54.0**.

- **Experimental, NEAR testnet only:** the new optional package `@seams/speak-to-sign` adds spoken payments. The owner says a payment such as "Send 2 NEAR to alice dot testnet", and a vault contract pays only after an attested verifier checks the voice and the words. See [Experimental: Speak-to-Sign](/concepts/auth-methods/speak-to-sign). Do not use it with real funds.
- Add `speakToSign({ vault, network: 'testnet' })` to `transactionFeatures`. Then `seams.speakToSign.requestTransfer({ walletId, receiver, amount })` returns `sent`, `refused`, `cancelled`, or `unavailable`. An app without the descriptor downloads no Speak-to-Sign code or assets.
- Speak-to-Sign needs VoiceID. Install `@seams/wallet`, `@seams/voiceid`, and `@seams/speak-to-sign` at 0.54.0, and compose the Wallet host with `npx --no-install seams-speak-to-sign-host <dir>`.
- `@seams/wallet-server` adds the Seams verify route `POST /speak-to-sign/v1/verify`. The route is off unless all six `SPEAK_TO_SIGN_OUTLAYER_*` variables are set. It requires an active Wallet Session.
- The VoiceID host API moves to version **9**: the VoiceID host plugin adds `recordPhrase`. Install `@seams/voiceid` 0.54.0 with `@seams/wallet` 0.54.0. The Wallet refuses a VoiceID host plugin of another version.
- 0.53.0 added the balance card, **Deposit**, and **Withdraw** in wallet settings, and `seams.assets`. 0.54.0 keeps them unchanged.

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds no database migrations.
