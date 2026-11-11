---
title: Release 0.67.0
description: Wallet core seals each Speak-to-Sign recording to the verifier, and VoiceID records with @seams/voice-capture.
---

# Release 0.67.0

The browser SDK, server SDK, VoiceID plugin, and Speak-to-Sign plugin use **0.67.0**.

- Wallet core seals each Speak-to-Sign recording before it leaves the device. The Seams server and OutLayer carry only ciphertext, and the verifier opens the recording inside its TEE.
  - The Wallet pins the verifier's audio key (X25519) beside the verdict key in its own code. It never takes the key from the app.
  - The seal is HPKE base mode with X25519, HKDF-SHA256 and ChaCha20-Poly1305. It binds the operation and the owner. The code is `sealAudio` of `@seams/voice-verdict`.
  - Core seals the recordings of a spoken request and of an enrollment. A recording that core cannot seal does not leave the device. The call then ends as `unavailable` with the reason `verifier_unavailable` and the detail `recording_not_sealed`.
  - The plugin gets no key, and the request and result fields do not change.
- The Speak-to-Sign verifier is **0.12.0**, OutLayer version key `bfe81633b9ed596df239201f153a84c860d71ddd8edf713c1c785ef2b7c1c946`. The Seams server must name verifier 0.12.0 or later in `SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY`, and its secrets profile must hold the secret `PROTECTED_AUDIO_KEY`. An older verifier refuses each spoken request with `unsupported`. Verifier 0.12.0 also takes plain recordings, so it works with a 0.66.0 Wallet.
- Wallet core and the co-signer check a verdict with `checkVerdict` of `@seams/voice-verdict`. Before, each had its own copy of the rules. `@seams/voice-verdict` **0.67.1** is a new dependency of `@seams/wallet` and `@seams/wallet-server`.
  - The rules do not change: the pinned key, the signature, the request, the spoken sentence, the renderer and the time limit. The check of the key and the signature now comes first.
  - A verdict with an extra field, a `step_up` verdict with no rule and an empty verdict are refused with the detail `verdict fields are invalid`.
- VoiceID records with `@seams/voice-capture` **0.67.1**, a new dependency of `@seams/voiceid`. The microphone, speech detection, the quality gate, asset loading, the model engine, the prompt and the phrase card come from that package. `onnxruntime-web` is not a direct dependency of `@seams/voiceid` now.
  - The texts and the cards do not change. The VoiceID build copies the same model files to `/sdk/voiceid/`.
  - Fix: the Record button stays in view after the microphone check. Before, the check could end during the fade of "Listening" and hide the button.
- The transaction confirmer card has a 1px border in the new color token `transactionCardBorder` (`--seams-colors-transactionCardBorder`). It is transparent by default. Set it with `appearance.theme.colors.transactionCardBorder`.
- The seams wordmark in the "Secured by seams" footers links to https://wallet.seams.sh and opens it in a new tab.
- Fixes:
  - The Receive screen of Wallet settings shows the QR code in every app. `qrcode` is now a dependency of `@seams/wallet`, not an optional peer dependency, so apps do not install it. Before, an app without `qrcode` showed an empty box. If the Wallet cannot make the code, the screen says so.
  - A transaction card keeps one corner radius while it opens, shows its details or closes them. Before, an app with `shape.card` `2rem` saw 32px corners at rest and 26px corners while the card moved.
  - The Add and Remove buttons of Authentication methods have room for their labels. Before, the label ran out of the button.
  - The "Secured by seams" footers center the wordmark on the line. Before, the wordmark sat higher than the text.
- The Speak-to-Sign host API stays at version **10**, and the VoiceID host API stays at version **11**. Install `@seams/voiceid` 0.67.0 and `@seams/wallet-voice-sign` 0.67.0 with `@seams/wallet` 0.67.0.
- The Speak-to-Sign plugin has a new package name: `@seams/wallet-voice-sign`. Until 0.66.0 it was `@seams/speak-to-sign`. Change the dependency and the import. The command `seams-speak-to-sign-host` keeps its name.
- Deploy in this order. First set the server's verifier to 0.12.0. Then ship the SDK, the hosted Wallet and the server together. A 0.67.0 Wallet with an older verifier cannot sign by voice.
- Install all four packages at 0.67.0. Speak-to-Sign stays experimental and NEAR testnet only. Do not use it with real funds.
- For tests of VoiceID in WebKit, use Playwright 1.64.1 or later (WebKit 27.2). WebKit 26.0 of Playwright 1.56.1 corrupts ONNX Runtime at random, and the VoiceID models then fail to load. The Wallet's own tests use 1.64.1 now.

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds no database migrations.
