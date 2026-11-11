---
title: Release 0.68.0
description: Speak-to-Sign is a part of @seams/wallet, and the normal NEAR sign calls take approval by voice.
---

# Release 0.68.0

The browser SDK, server SDK and VoiceID plugin use **0.68.0**. This release has breaking changes for an app or a Wallet host that uses Speak-to-Sign. It has no alias for the old names.

- Speak-to-Sign is a part of `@seams/wallet`. Its flow loads on the first spoken request, and a Wallet that does not use it never loads it.
  - Remove the package `@seams/wallet-voice-sign` from the app and from the Wallet host. Its last version is 0.67.0.
  - The Wallet host has no Speak-to-Sign step. Remove `seams-speak-to-sign-host`. The host composes VoiceID as before (`seams-voiceid-host`), because the owner records on the VoiceID surface.
  - The host file `/sdk/speak-to-sign/host.js`, the entry `@seams/wallet/speak-to-sign-host` and the Speak-to-Sign host API version are gone. The VoiceID host API stays at version **11**.
- The configuration names approval by voice in `approvals`: `approvals: [spoken({ network: 'testnet' })]`. Import `spoken` from `@seams/wallet`. `transactionFeatures` and `speakToSign()` are removed.
- The normal NEAR sign calls take `approval: { kind: 'spoken', summary }`: `near.signAndSendTransaction`, `near.signTransaction`, `near.signDelegateAction` and `near.signMessage`.
  - `summary` is the sentence that the owner reads aloud. `approval` also takes `onProgress`.
  - With `approval`, a call returns a result with a `kind`: `approved`, `refused`, `cancelled` or `unavailable`. It does not throw for a refusal. An `approved` result holds what the call without `approval` returns.
  - Without `approval`, each call is as before.
  - A call with `approval` throws when `approvals` does not hold the descriptor.
- `seams.near.spoken` has the typed requests, whose sentence comes from the request fields: `transfer`, `note`, `rating`, `mergeApproval` and `bet`. It also has `enroll` and `network`. It replaces `seams.near.speakToSign` and its `typed` object.
  - A call names its wallet with `walletSession`, as the normal calls do, or leaves it out for the authenticated wallet. The field `walletId` of these requests is removed.
- Changes inside the Wallet, with no effect on the results:
  - Wallet core has one sign path for every spoken request. Core and the Seams co-signer read one table of typed kinds, so they cannot differ. The co-signer builds a typed request only from the bytes that it signs.
  - Core holds the limits of each kind. A transfer that the sentence cannot say (an implicit receiver, or an amount that is not 0.01 to 1,000,000 NEAR in whole hundredths) is refused before the card opens.
  - The flow on the card holds no recording. Core records, seals and sends the audio, and clears it after use.
  - The co-signer refuses a bet whose `msg` carries another verdict than the verdict of the request.
- The Seams server calls the verifier with `relayToVerifier` of `@seams/voice-sign/server` **0.68.0**, a new dependency of `@seams/wallet-server`. The request to OutLayer, the events and the failure codes of `POST /speak-to-sign/v1/verify` do not change, with two exceptions:
  - The route serves only the verifier's `verify` and `enroll` operations. Another operation gets 400 `unsupported_operation`. Before, the route ran any operation.
  - An error output of the verifier gives the event `failed` with `verifier_failed`. Before, the route sent it on as a `verdict` event, and the Wallet then called it an invalid output.
- `@seams/voice-verdict` and `@seams/voice-capture` are **0.68.0**. The voice card's main button takes the theme's button colours (`buttonBackground` and `textButton` of `appearance.theme.colors`). With the default theme, Record goes from dark grey to near black on the light theme.
- When OutLayer does not run the verifier in time (`verifier_timeout`), the payment card and the enrollment card say "OutLayer timed out", that the recording is not the cause, and to try again in a minute. Before, they showed the general text. The Seams verify route waits 30 s for OutLayer, not 20 s.
- `autoStart` sets if the card records when it opens, with no press on Record. Put it in `approval` of a normal call, in the request of a `spoken` call, or in `spoken.enroll`. The default is `true` for a spoken request and `false` for an enrollment. If the browser does not start audio without a press, the card keeps its Record button. The VoiceID setup in `enroll` still waits for a press on each sample.
- Wallet steps:
  - A card in an app's dialog takes `transition`: the wait before the fade-in (`enterDelayMs`), the fade-in and the fade-out, each from 0 to 1000 ms. `WalletStep`, `HostedSeamsAuthMenu`, `surfaces.mount`, the step of `authMenu.open` and an anchored presentation take it.
  - `chrome: 'back_and_close'` draws Back and Close together in a card. Back calls `onBack` and Close calls `onClose`. The VoiceID card draws them too.
- The Wallet iframe protocol is **24.0.0**: the configuration that the app sends to the Wallet has `approvals`. An app at 0.67.0 does not work with a Wallet host at 0.68.0, or the reverse.
- Deploy in this order: the server, then the SDK and the hosted Wallet together. The verifier stays at 0.12.0.
- Install all three packages at 0.68.0. Speak-to-Sign stays experimental and NEAR testnet only. Do not use it with real funds.

The wallet-management protocol remains **5**. The signed recovery CLI remains **0.29.0**. This release adds no database migrations.
