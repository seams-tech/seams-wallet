---
title: Release 0.58.1
description: Speak-to-Sign shows the recording, the check and the result in one VoiceID card.
---

# Release 0.58.1

The browser SDK, server SDK, VoiceID plugin, and Speak-to-Sign plugin use **0.58.1**.

- **Experimental, NEAR testnet only:** Speak-to-Sign shows one VoiceID card for the whole spoken payment. See [Experimental: Speak-to-Sign](/concepts/auth-methods/speak-to-sign).
  - After the recording, the card stays open. A line of six segments shows the recording, the speaker check, the word check, the policy, the signed verdict and the payment. While the verifier works, the caption names where each check runs.
  - A paid transfer ends with a check mark, the time from the end of speech, a link to the transaction and "Done".
  - A refusal shows the reason in the card, such as the words that the verifier heard differently. "Try again" records the sentence again on the same card.
  - A step-up asks in the card. "Confirm with passkey" then asks only for the fresh approval with the session's own method.
  - `requestTransfer` returns when the owner closes the card. The result is the last attempt's.
- The VoiceID host API is version **10**, and the Speak-to-Sign host API is version **5**. The Wallet refuses host plugins of other versions.
- 0.58.0 changes, kept in 0.58.1:
  - Speak-to-Sign pays from the owner's own account with no vault. An accepted spoken payment shows no confirm and no passkey. A policy rule can ask for the confirm again; today one stub rule asks for it above 10 NEAR.
  - `speakToSign({ network })` replaces `speakToSign({ vault, network })`. A `sent` result has `approval` (`voice` or `voice_and_passkey`).
- Install all four packages at 0.58.1. Speak-to-Sign stays experimental and NEAR testnet only. Do not use it with real funds.

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds no database migrations.
