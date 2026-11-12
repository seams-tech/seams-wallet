---
title: Release 0.69.0
description: The Seams server writes the spoken summary of a note, the verifier checks that it fits the note, and a Wallet card can be minimized.
---

# Release 0.69.0

The browser SDK, server SDK and VoiceID plugin use **0.69.0**. This release has breaking changes for an app that signs community notes with Speak-to-Sign.

- `spoken.note` takes no `summary`. The app gives only the note. The Seams server writes the summary that the author reads aloud, so an app cannot put other words in the author's mouth.
  - New route `POST /speak-to-sign/v1/summary` on the Seams server. It reads the Wallet Session as the verify route does, takes `{ text }` (1 to 280 characters), and asks `Qwen/Qwen3.8-27B` on NEAR AI for one plain sentence. It checks the reply with the spoken rules and asks once more if a rule breaks. Failures are `summary_unreachable`, `summary_failed` and `summary_not_speakable`.
  - The route exists only when the server has `SPEAK_TO_SIGN_NEAR_AI_API_KEY`. `SPEAK_TO_SIGN_SUMMARY_MODEL` is optional.
  - Without a summary, the result is unavailable with `summary_unavailable`, and no card opens.
  - The voice card shows the note above the summary.
- The verifier is **0.13.0** (`1b7771544f3bcf5b3ba9e9bf3ac611f6abad21e7538f67b2666fd8aafc8cf930`). The Wallet sends `note_text` in place of `note_sha256_hex`. The verifier hashes the note and checks that the summary gives the main point of the note. A summary that does not fit is refused with `summary_mismatch`, and no answer with `summary_check_unavailable`. Set the 0.13.0 version key on the server before this Wallet ships.
- `add_note` and `rate_note` carry their verdict (`verdict_json`, `signature_b64`) to the notes contract, as a bet carries it in its `msg`. The co-signer refuses a call that carries another verdict. A note call without the two arguments, from an older Wallet, is still admitted.
- Wallet steps: an app can ask for Minimize on an anchored card (`minimize: true` on the presentation, or the `minimize` prop of `WalletStep`). The card draws Minimize beside Close, also during the check.
  - A press hides the card and keeps its request. The SDK runs `onMinimize(restore)`. `restore()` shows the card again, and the card also shows again when it needs the person. Both run `onRestore`.
  - The card reports its stage (`recording`, `checking` with done and total, `result`) with `onProgress`. It carries no approval data.
  - A Wallet host before 0.69.0 refuses `minimize`. Deploy the hosted Wallet before an app sends it.
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` are **0.69.0**. The voice card:
  - shows a context (the note) above its sentence, and a form card shows Record in place of the voice line until it records;
  - takes a `colors` prop, and the voice line can draw pixels in place of sine waves;
  - shows a result as one group: the seal, the headline, the details and the button. The seal takes `voiceSeal`, else `voiceLine`, of `appearance.theme.colors`;
  - places its grid rows by name. A host that sets its own rows must use the names.
- The Wallet iframe protocol is **25.0.0**: the note message has no summary. An app at 0.68.1 does not work with a Wallet host at 0.69.0, or the reverse.
- Deploy in this order: verifier 0.13.0 on OutLayer, then the server with its version key and the NEAR AI key, then the SDK and the hosted Wallet together.
- Install all three packages at 0.69.0. Speak-to-Sign stays experimental and NEAR testnet only. Do not use it with real funds. No database migrations.
