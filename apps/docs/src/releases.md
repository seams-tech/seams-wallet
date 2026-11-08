---
title: Release 0.56.2
description: Any NEAR account can own a Speak-to-Sign vault, implicit accounts too; 0.56.1's reverted result and VoiceID height fix carry forward.
---

# Release 0.56.2

The browser SDK, server SDK, VoiceID plugin, and Speak-to-Sign plugin use **0.56.2**.

- **Experimental, NEAR testnet only:** any NEAR account can own a Speak-to-Sign vault, including an implicit 64-hex or `0x` account. The owner says only the amount and the contact, such as "Send 0.5 NEAR to alice dot testnet". The vault and the verifier on testnet accept any owner.
  - 0.56.1 returned `{ kind: 'unavailable', reason: 'owner_not_speakable' }` for an implicit or `0x` owner. 0.56.2 removes the check and the reason from `SpeakToSignUnavailableReason`.
- 0.56.1 changes, kept in 0.56.2:
  - A NEAR transaction whose final outcome is a Failure is `{ success: false, kind: 'reverted', transactionId, error, result }`. `error` gives NEAR's reason, such as "The contract refused the call: Smart contract panicked: receiver is not a contact". See [results and errors](/reference/results-and-errors).
  - When NEAR refuses a transaction before it runs, the result is `not_submitted` with the optional `rejection` field. For `NotEnoughBalance`, the reason gives the balance and the cost in NEAR.
  - The receipt card shows the reason for a revert or a rejection. It shows "Confirmation unavailable" only when the outcome is truly unknown.
  - The VoiceID prompt keeps its height while the model downloads.
- 0.56.0 changes, kept in 0.56.2:
  - **Experimental, NEAR testnet only:** `seams.speakToSign.enroll({ walletId })` enrolls the owner's voice with the Speak-to-Sign verifier. The owner reads three short phrases, then approves one `authorize_enrollment` call. The result is `enrolled`, `refused`, `cancelled`, or `unavailable`. See [Experimental: Speak-to-Sign](/concepts/auth-methods/speak-to-sign).
  - From 0.55.0: the wallet settings balance actions are **Receive** and **Send**, `seams.assets.prepareWithdrawal()` is `seams.assets.prepareSend()`, and `seams.assets.openScreen({ screen, assetId })` opens **Assets**, **Receive**, or **Send** in the mounted settings panel. See [core reference](/reference/core#asset-balances).
- Compatibility:
  - Remove any `case 'owner_not_speakable'` that you added for 0.56.1. TypeScript reports it, because the reason no longer exists.
  - A `switch` that handles every `ActionResult` kind must handle `reverted`, which 0.56.1 added.
- Install all four packages at 0.56.2. The VoiceID host API stays at version **9**. Speak-to-Sign stays experimental and NEAR testnet only. Do not use it with real funds.

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds no database migrations.
