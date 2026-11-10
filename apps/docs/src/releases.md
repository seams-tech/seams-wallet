---
title: Release 0.64.0
description: Speak-to-Sign enrollment turns on VoiceID from the same three recordings, and VoiceID cards change state without jumps.
---

# Release 0.64.0

The browser SDK, server SDK, VoiceID plugin, and Speak-to-Sign plugin use **0.64.0**.

- `seams.speakToSign.enroll` turns on VoiceID for a wallet that does not have it yet. The three samples of that VoiceID enrollment are also the verifier's recordings, so the owner reads one set of phrases, not two.
  - The Wallet clears its copies of the samples after it sends them to the verifier. `activateAuthMethod` never returns audio to an app.
  - If the owner turned VoiceID off, `enroll` still returns `unavailable` with the reason `voiceid_unavailable`. Turn it on again with `setAuthMethodEnabled`.
  - An app that calls `activateAuthMethod` before `enroll` keeps working, but the owner records twice. Call only `enroll` to record once.
- During that enrollment, the Wallet confirm of the signed message no longer opens below the VoiceID card. Before, the owner had to scroll down to reach it.
- VoiceID cards change state without jumps:
  - The rows that change fade out together, and the new rows fade in one after another. Buttons and links fade in place.
  - The first enrollment card continues the activation card with the same phrase. Before, the card blinked and showed a different phrase.
  - The model download shows at the first downloaded byte. Its bar follows the downloaded bytes and stays full while VoiceID prepares. Before, the bar stopped near half while the text reached 99%, and it showed empty while VoiceID prepared.
  - In the Wallet frame, a card that gets shorter follows the frame's ease, so its edge does not jump. After a Wallet confirm, the card comes back without an entrance, and its rows fade in when the frame fits.
  - After VoiceID activation, the finished card stays until the Speak-to-Sign card takes its place, so the frame does not show empty while the Wallet loads the plugin.
  - The Speak-to-Sign card starts loading the speech detector when it opens. Before, the first recording on a page showed "Opening microphone…" for about 3 s.
- A hosted Wallet confirm card that is taller than its frame now opens and closes its transaction details in one motion, and keeps its scroll position while it resizes. Before, the toggle moved in two steps, and a card scrolled down to its Confirm button jumped back to its top.
- A Speak-to-Sign enrollment refusal that says a verifier service failed, such as `speaker_unavailable`, shows "The check is not available" on the card.
- The VoiceID host API is version **11**, and the Speak-to-Sign host API is version **9**. The Wallet refuses a host plugin of another version, so install `@seams/voiceid` and `@seams/speak-to-sign` 0.64.0 with `@seams/wallet` 0.64.0. The Speak-to-Sign verifier stays at **0.5.2**, OutLayer version key `96b79b518613a50538b060da2279c91e12b0619499c532c2708f61ddb790d7e5`.
- Deploy the Wallet host with both plugins, and update apps to 0.64.0. The server needs no change for this release.
- Install all four packages at 0.64.0. Speak-to-Sign stays experimental and NEAR testnet only. Do not use it with real funds.

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds no database migrations.
