---
title: Release 0.59.0
description: Speak-to-Sign signs spoken community notes and note ratings.
---

# Release 0.59.0

The browser SDK, server SDK, VoiceID plugin, and Speak-to-Sign plugin use **0.59.0**.

- **Experimental, NEAR testnet only:** Speak-to-Sign signs a community note or a note rating by voice. See [Spoken community notes](/concepts/auth-methods/speak-to-sign#spoken-community-notes).
  - `seams.speakToSign.requestNote({ walletId, contract, postId, text, summary })`: the author types the note and reads aloud a summary of 1 to 12 plain words. The verdict binds the full note by its SHA-256.
  - `seams.speakToSign.requestRating({ walletId, contract, noteId, rating })`: the owner says "this note is helpful", "this note is somewhat helpful" or "this note is not helpful".
  - On an approved verdict, Wallet core builds one call from the owner's account: `add_note` or `rate_note` on the notes contract, with no deposit and no confirm. Both calls return the result kinds of `requestTransfer`, with the new refusals `summary_not_speakable` and `note_not_valid`.
  - `summaryRefusal(text)` and `MAX_SUMMARY_WORDS` from `@seams/wallet` check a summary before the Wallet opens.
- Verifier 0.4.0 (`8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef`) adds the `community_note` and `note_rating` requests. Transfers are unchanged. A summary of 4 or more words also passes with one word heard differently or dropped, but never with an added or dropped "not".
- The Speak-to-Sign host API is version **6**, and the VoiceID host API stays at version **10**. The Wallet refuses host plugins of other versions.
- 0.58.1 changes, kept in 0.59.0:
  - Speak-to-Sign shows the recording, the check and the result in one VoiceID card, with up to five recordings and at most one payment in each flow.
  - The verifier accepts sound-alikes of the words that hold no value, such as "year" for "NEAR".
- Install all four packages at 0.59.0. Speak-to-Sign stays experimental and NEAR testnet only. Do not use it with real funds.

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds no database migrations.
