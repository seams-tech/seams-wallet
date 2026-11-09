---
title: Release 0.60.0
description: The Seams co-signer checks each Speak-to-Sign verdict, with voice limits, and spoken requests report their progress.
---

# Release 0.60.0

The browser SDK, server SDK, VoiceID plugin, and Speak-to-Sign plugin use **0.60.0**.

- **Experimental, NEAR testnet only:** the Seams co-signer checks the Speak-to-Sign verdict again before it adds its part of a voice-approved signature. See the [trust model](/concepts/auth-methods/speak-to-sign#trust-model).
  - The signing request of a voice-approved transaction carries the verdict. The co-signer checks the signature against the pinned verifier key, the expiry, that the unsigned transaction carries out the spoken request, and that the session's NEAR account signs it.
  - Each verdict approves one signing request. The co-signer records it in the new table `speak_to_sign_voice_verdicts`.
  - Voice limits for each wallet: at most 10 NEAR in one voice-only payment and 20 NEAR in any 24 hours.
  - A `step_up` verdict needs a fresh approval: a passkey or Email OTP step-up of the same operation, or a new VoiceID unlock after the verdict. On a VoiceID session, the new unlock now meets the fresh-approval request in the same signing call.
  - A refusal of the co-signer is `refused` with `voice_limit` or `cosigner_refused`. `detail` names its reason, such as `over_daily_limit` or `reused`. Nothing was signed.
- `requestTransfer`, `requestNote` and `requestRating` take an optional `onProgress`. It gets `recording_sent`, `verifier_running`, `verdict`, `step_up`, `transaction_sent` and `settled`. See [Experimental: Speak-to-Sign](/concepts/auth-methods/speak-to-sign#install).
- The verify route answers with `text/event-stream` after its checks: `verifier_running`, then one `verdict` or `failed` event. While the verifier works, the Wallet prefetches the access-key nonce and a recent block hash for the payment.
- Without `rpIdOverride`, passkeys are scoped to the host of `walletOrigin`. Before, every wallet origin kept the local default `example.localhost`.
- Without a `routerAb` setting, the Seams-hosted wallet origins (`staging.sign.seams.sh`, `test.sign.seams.sh`, `sign.seams.sh`) enable Router A/B normal signing with their own SigningWorker. So `seamsTestnetConfig` with `walletOrigin`, `relayerUrl` and `publishableKey` can sign NEAR. Before, NEAR signing stayed off until the app set `routerAb`. See [the hosted wallet branch](/reference/configuration#hosted-wallet-branch).
- The Speak-to-Sign host API is version **7**, and the VoiceID host API stays at version **10**. The Wallet refuses host plugins of other versions.
- Deploy in this order: apply the D1 migration, deploy the server, then the Wallet host. Speak-to-Sign needs the server and the Wallet host both at 0.60.0, because the verify answer is now a stream; other signing works between the two deploys. An app on 0.59.0 ignores the progress messages, but it cannot read the two new refusal reasons, so update the app too.
- 0.59.0 changes, kept in 0.60.0:
  - Speak-to-Sign signs spoken community notes (`requestNote`) and note ratings (`requestRating`).
  - Verifier 0.4.0 (`8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef`) adds the note requests. Transfers are unchanged.
- Install all four packages at 0.60.0. Speak-to-Sign stays experimental and NEAR testnet only. Do not use it with real funds.

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds one D1 migration, `0089_speak_to_sign_voice_verdicts.sql`.
