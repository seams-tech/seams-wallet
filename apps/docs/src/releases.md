---
title: Release 0.61.0
description: Speak-to-Sign approves pull request merges by voice and shows a spoken payment as sent about a second sooner.
---

# Release 0.61.0

The browser SDK, server SDK, VoiceID plugin, and Speak-to-Sign plugin use **0.61.0**.

- **Experimental, NEAR testnet only:** Speak-to-Sign approves a pull request merge by voice.
  - `seams.speakToSign.requestMergeApproval({ walletId, contract, repo, pullRequest, base, headCommit })`: the owner says "merge pull request 42 into main". The verdict also binds the SHA-256 of the repository and the 20-byte head commit, which the owner does not say.
  - On an approved verdict, Wallet core signs one `approve_merge` call on the contract, with no deposit and no confirm. The Seams co-signer admits only that call, for that repository, pull request, base and commit.
  - Input that the contract would refuse gives `merge_not_valid` before the recording.
  - It needs verifier 0.5.0 or later.
- A spoken payment shows as sent sooner:
  - A voice-approved plain transfer shows "Sent" when a block holds it. The result still waits for the outcome, about two blocks later. A note, a rating or a merge approval still shows its outcome, because a contract call can fail in the contract.
  - When the owner reads a known sentence, the recording ends after 0.8 s of silence instead of 1.5 s, once the voiced time covers the whole sentence. A pause inside the sentence still gets 1.5 s. The VoiceID unlock and enrollment keep 1.5 s.
  - The times of a `sent` result now start at the owner's last spoken word, not at the end of the recording. So `endOfSpeechToReceiptMs` now includes the end pause.
- Verifier 0.5.1 (`cdb46fea7fab5afbb855e373674c80a9cd77170beb594579da28d754009e7258`) writes the used-audio mark while the speaker and transcription requests run, so each verification is about 0.2 s shorter. A recording that the verifier refuses, or that meets a service outage, is now used up; the card records again for each try. It includes the merge approvals of 0.5.0.
- The co-signer deletes a wallet's verdict records that are older than 24 hours, and it logs each refusal of a voice verdict with its reason.
- The Wallet host loads the VoiceID and Speak-to-Sign plugins with the host API version and the Wallet asset version in the URL. So after a deploy, a browser does not keep an older plugin from its cache.
- A passkey unlock on a site whose NEAR custody cache is older than the server's keys now refreshes the cache. A VoiceID unlock that finds an older cache asks for one passkey unlock. A user who moves between two apps on different sites can pay one Router recovery at each move; a later release removes this cost.
- The Receive and Send panels choose the asset from a styled list with keyboard support.
- The Speak-to-Sign host API is version **8**, and the VoiceID host API stays at version **10**. The Wallet refuses host plugins of other versions.
- `@seams/speak-to-sign` now releases from the `seams-tech/speak-to-sign` repository.
- Install all four packages at 0.61.0. Speak-to-Sign stays experimental and NEAR testnet only. Do not use it with real funds.

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds no database migrations.
