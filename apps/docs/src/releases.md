---
title: Release 0.70.4
description: The Wallet ends a summary request for a note text that changed. A page can prepare a spoken request, so the Wallet card shows sooner.
---

# Release 0.70.4

The browser SDK, server SDK and VoiceID plugin use **0.70.4**. It has no breaking change since 0.70.2. No Wallet package has the version 0.70.3; the voice libraries have it.

Since 0.70.2:

- When the owner edits a note, the Wallet ends the summary request of the older text, if only `prepare` asked for it. The summary route then ends its request to the model. Before, each pause in the typing left one model call.
- The Wallet does not keep a summary that breaks a rule of `summaryRefusal`. Before, such a summary stayed for 5 minutes. When the server's model gives no summary that a person can say, the result of `spoken.note` is now the refusal `summary_not_speakable`. Before, it was `unavailable` with `summary_unavailable`.
- The second request of the summary writer asks the model to leave out a number that is inside a name, such as "3D". Before, it asked for the number as words. Speech-to-text writes a said "three D" as "3D" again, and the verifier reads such a word digit by digit, so the words did not match.
- A sent or signed result of a spoken request has `attestationUrl`: the OutLayer record of the verifier call, with its TDX quote, or null when the Wallet got none. An app can show the proof with its own result.
- The last repair of the summary writer keeps a quantity. A word that starts with a digit or a currency sign ("10km", "$40m", "2nd") is not cut to its letters: the result is `summary_not_speakable`.
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` are **0.70.4**. `writeSummary` takes `{ signal }`, and `createSummarySource` has the two changes above. The docs of `writeSummary` say that a summary is a draft: only a community note has the verifier's check that the summary fits the text.
- The Wallet iframe protocol stays **25.0.0**. Upgrade the app before the Wallet host: an app at 0.70.2 or older reads a result with exact keys, so it refuses the success result of a spoken request from a Wallet host at 0.70.4, which has `attestationUrl` ("Speak-to-Sign … result is invalid", after the transaction was sent). An app at 0.70.4 reads the result of an older Wallet host too.
- Install all three packages at 0.70.4. No new server setting, and no database migrations.

## Release 0.70.2

The browser SDK, server SDK and VoiceID plugin use **0.70.2**. It has no breaking change since 0.70.1.

Since 0.70.1:

- New call `seams.near.spoken.prepare({ note? })`. Call it when your form is on the screen. The Wallet loads its Speak-to-Sign code, and with `note` it asks the Seams server for the summary of that text. The `spoken.note` call that follows shows its card sooner: before, the card waited 2.5 to 3 s for these steps. The call shows no card and signs nothing. See [Prepare a spoken request](/concepts/auth-methods/speak-to-sign#prepare-a-spoken-request).
- The Wallet keeps one summary for each note text for 5 minutes. A second try of a note shows the same sentence. Before, each try asked the model again, and the sentence could change.
- A note request asks for its summary while the Speak-to-Sign code loads. Before, it asked after the load.
- The summary route writes a name with a number in it with one request to the model: "COP31" becomes "COP". Since 0.70.1 such a name got a second request, which added about 0.5 s. A number that stands alone still gets the second request.
- The summary code is now a general part of the voice libraries, and the Wallet uses it:
  - `@seams/voice-verdict` **0.70.2** has `summaryRefusal`, the rules of a spoken summary.
  - `@seams/voice-sign/server` **0.70.2** has `writeSummary`. The Seams summary route calls it.
  - `@seams/voice-sign/summary` is a new entry with `createSummarySource`. The Wallet keeps its summaries with it. `@seams/wallet` now depends on `@seams/voice-sign`.
  - `@seams/voice-capture` **0.70.2** has no change.
- The Wallet iframe protocol stays **25.0.0**. The new message `PM_SPEAK_TO_SIGN_PREPARE` is optional: an app at 0.70.1 works with a Wallet host at 0.70.2. An app at 0.70.2 that calls `prepare` needs a Wallet host at 0.70.2.
- Install all three packages at 0.70.2. No new server setting, and no database migrations.

## Release 0.70.1

The browser SDK, server SDK and VoiceID plugin use **0.70.1**. It has no breaking change since 0.70.0.

Since 0.70.0:

- The result card of a transfer, a transaction or a message names a long receiver in its short form: an implicit account of 64 characters shows as "To 3e2210…7e55". A named account stays in full. The request that the person approves still names the full account. A request with no receiver shows its own text; before, the caption said "To null".
- The summary route of a note no longer fails for a name with a number in it, such as "COP31". The second request to the model names the word and says to write its number as words or to leave it out. If both replies still have such a word, the route keeps the letters of each word ("COP31" becomes "COP"). A number that stands alone still gives `summary_not_speakable`. The verifier still checks that the summary fits the note.
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` are **0.70.1**. In `@seams/voice-capture`, a word that is longer than the line breaks inside the card. Before, such a word made the receipt and the button wider than the card.
- The Wallet iframe protocol stays **25.0.0**. An app at 0.70.0 works with a Wallet host at 0.70.1.
- Install all three packages at 0.70.1. No database migrations.

## Release 0.70.0

The browser SDK, server SDK and VoiceID plugin use **0.70.0**. An app has no breaking change since 0.69.2. A server operator must read the first item.

Since 0.69.2:

- The Speak-to-Sign verify route checks the TDX quote of each verifier call before it sends a verdict. The verdict key is bound to the OutLayer project, so every version of the project signs with it. The quote names the WASM that ran.
  - The quote must bind the output to the WASM hash `SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY` and to the project. Intel must sign the quote, and `worker.outlayer.testnet` must approve its five measurements.
  - The route reads the record of the call from OutLayer. It tries once each second for up to 15 s.
  - If a check fails, or the record does not come in time, the route sends `failed` with `attestation_<code>`, for example `attestation_wasm_not_accepted` or `attestation_unavailable`.
  - A `verdict` has `attestationUrl`, the URL of the OutLayer record. Its `timing` has `attestationMs`.
  - Set `SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY` to the WASM hash of the verifier version that the server calls. The route refuses a quote of another WASM. See [Experimental: Speak-to-Sign](/concepts/auth-methods/speak-to-sign).
- Optional `SPEAK_TO_SIGN_OUTLAYER_VENICE_VERSION_KEY`: the WASM hash of the `venice` build of the verifier (0.14.0 and later), which sends the clip to Venice AI. With it and `SPEAK_TO_SIGN_NEAR_AI_API_KEY`, the server checks NEAR AI once a minute. Venice serves a call only while NEAR AI or its Whisper is down. Only the server chooses; the page cannot.
  - Venice AI runs in no TEE, so it can hear the recordings that it gets. The receipt of such a call shows "Speech to text: Venice AI, outside a TEE".
  - The quote check accepts only the WASM hash of the build that the route called. The verdict event has `transcriber` (`nearai` or `venice`).
  - The Wallet card reads a verifier version with a build name, such as `0.14.0+venice`.
- New refusal `transcriber_not_attested` (verifier 0.14.0 and later): the verifier could not check the TEE of NEAR AI's gateway, or Whisper's reply did not open with the checked key. No audio went out after a failed check. Before, the Wallet read this refusal as `verdict_mismatch`. The card says that the recording is not the cause, and offers Try again. An app before 0.70.0 cannot read this reason.
- The verify route gives each verifier run 40 s (was 15 s) and waits 60 s for the answer (was 30 s). The verifier waits up to 30 s for each model. A slow NEAR AI Whisper now gives a signed refusal (`transcriber_unavailable`), not a run that OutLayer stopped.
- The paid and signed Speak-to-Sign cards show a TEE receipt: "TEE receipt · Intel TDX · OutLayer", the voice of the account, the words, the summary check of a note, the verifier version of the verdict, and "View TDX quote". If the server sends no `attestationUrl`, the receipt has no link.
- VoiceID activation goes to the first recording as soon as VoiceID has loaded. Before, the person pressed "Activate VoiceID" and then "Record sample 1".
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` are **0.70.0**. A result card of `@seams/voice-capture` takes `receipt` (`PhraseReceipt`): a title, a source, checked rows and a link, between the caption and the detail line. In `@seams/voice-sign`, the default run limit is 40 s (was 15 s) and the default `timeoutMs` is 60,000 (was 20,000).
- The Wallet iframe protocol stays **25.0.0**. An app at 0.69.x works with a Wallet host at 0.70.0. This release needs no new verifier version.
- Deploy the server and the hosted Wallet together. Install all three packages at 0.70.0. No database migrations.

## Release 0.69.2

The browser SDK, server SDK and VoiceID plugin use **0.69.2**. It has no breaking change since 0.69.0.

Since 0.69.0:

- The Speak-to-Sign card's check reads "Checking what you said". With the verifier step after it, the line now fits the card.
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` are **0.69.2**. In a form card (a card with a context, such as a note), the check's line slides into the microphone's circle, and the microphone turns into a tick. A card with no context keeps the ring and the seal.
- The Wallet iframe protocol stays **25.0.0**. The server and the verifier (0.13.0) do not change. An app at 0.69.0 works with a Wallet host at 0.69.2.
- Install all three packages at 0.69.2. No database migrations.

## Release 0.69.0

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
- `@seams/voice-verdict`, `@seams/voice-capture` and `@seams/voice-sign` are **0.69.1**. The voice card:
  - shows a context (the note) above its sentence, and a form card shows Record in place of the voice line until it records;
  - takes a `colors` prop (with `surface3`, the colour of the check segments that have not run yet), and the voice line can draw pixels in place of sine waves;
  - turns the Beam off with `voiceBeam: 'none'`, and takes the theme's Beam from the first frame. Before, it showed the default Beam until recording started;
  - shows a result as one group: the seal, the headline, the details and the button. The seal takes `voiceSeal`, else `voiceLine`, of `appearance.theme.colors`;
  - places its grid rows by name. A host that sets its own rows must use the names.
- The Wallet iframe protocol is **25.0.0**: the note message has no summary. An app at 0.68.1 does not work with a Wallet host at 0.69.0, or the reverse.
- Deploy in this order: verifier 0.13.0 on OutLayer, then the server with its version key and the NEAR AI key, then the SDK and the hosted Wallet together.
- Install all three packages at 0.69.0. Speak-to-Sign stays experimental and NEAR testnet only. Do not use it with real funds. No database migrations.
