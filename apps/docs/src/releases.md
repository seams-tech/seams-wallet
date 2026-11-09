---
title: Release 0.57.0
description: A spoken payment can go to any named NEAR account; contacts are optional. Any NEAR account can own a vault, and the reverted result carries forward.
---

# Release 0.57.0

The browser SDK, server SDK, VoiceID plugin, and Speak-to-Sign plugin use **0.57.0**.

- **Experimental, NEAR testnet only:** a spoken payment can go to any named NEAR account that the owner can say, such as `bob.testnet`. The receiver no longer has to be a vault contact. The testnet vault accepts any such receiver, with the same per-transfer and daily limits. See [Experimental: Speak-to-Sign](/concepts/auth-methods/speak-to-sign).
  - `SpeakToSignRefusalReason` drops `receiver_not_contact`. It adds `receiver_not_speakable` for an implicit (64-hex) or `0x` receiver, and `receiver_missing` for a receiver account that does not exist.
  - Contacts are optional. The verifier checks the words against the saved contacts: if the owner says a contact's name but the request names another account, the word check fails.
  - Because any named account can receive, a voice check that accepts a clone or a replay can pay any named account. Only the limits bound the loss.
  - The second enrollment phrase is now "I send money only when I say so."
- The Speak-to-Sign host API is version **3**. The Wallet refuses a Speak-to-Sign host plugin of another version.
- 0.56.2 and 0.56.1 changes, kept in 0.57.0:
  - Any NEAR account can own a Speak-to-Sign vault, including an implicit 64-hex or `0x` account.
  - A NEAR transaction whose final outcome is a Failure is `{ success: false, kind: 'reverted', transactionId, error, result }`. `error` gives NEAR's reason. See [results and errors](/reference/results-and-errors).
  - When NEAR refuses a transaction before it runs, the result is `not_submitted` with the optional `rejection` field.
- Compatibility:
  - Replace any `case 'receiver_not_contact'` with `receiver_not_speakable` and `receiver_missing`. TypeScript reports the old reason.
  - A `switch` that handles every `ActionResult` kind must handle `reverted`, which 0.56.1 added.
- Install all four packages at 0.57.0. The VoiceID host API stays at version **9**. Speak-to-Sign stays experimental and NEAR testnet only. Do not use it with real funds.

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds no database migrations.
