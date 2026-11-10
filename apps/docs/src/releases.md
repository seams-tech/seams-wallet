---
title: Release 0.66.0
description: Speak-to-Sign is the NEAR signer by voice, with a voice call for each signing call of seams.near.
---

# Release 0.66.0

The browser SDK, server SDK, VoiceID plugin, and Speak-to-Sign plugin use **0.66.0**.

- Speak-to-Sign is the NEAR signer by voice. Each signing call of `seams.near` has a voice call with the same name in `seams.near.speakToSign`.
  - `signAndSendTransaction`, `signTransaction` and `signDelegateAction` sign any NEAR transaction or delegate action, with any receiver and any actions. The owner says a summary of 1 to 12 plain words. The verdict binds the receiver and the SHA-256 of the action bytes that the Wallet signs, and the co-signer builds the request again from the bytes that it signs.
  - `signMessage` signs a NEP-413 message. The verdict binds the SHA-256 of the NEP-413 bytes. The Wallet draws the nonce before the owner speaks.
  - The calls whose sentence comes from the request fields are in `typed`: `transfer`, `note`, `rating`, `mergeApproval` and the new `bet`. `typed.bet` signs the token's `ft_transfer_call` to a prediction market, with the checked verdict in `msg`, so that the market contract can check it too. Only the pinned USDC contract of the network is a bet token (testnet: Circle USDC).
  - The app writes the summary of a general request, and the card shows only the summary. The voice proves who approves and what the owner said. It does not prove that the summary describes the transaction.
  - One verdict signs once. A `step_up` verdict signs no delegate action and no message.
  - The requests still take `presentation` and `steps`.
- Breaking changes:
  - `seams.speakToSign` is gone, and the old names have no aliases. Use `seams.near.speakToSign`:

    | 0.65.0 | 0.66.0 |
    | --- | --- |
    | `seams.speakToSign.requestTransfer` | `seams.near.speakToSign.typed.transfer` |
    | `seams.speakToSign.requestNote` | `seams.near.speakToSign.typed.note` |
    | `seams.speakToSign.requestRating` | `seams.near.speakToSign.typed.rating` |
    | `seams.speakToSign.requestMergeApproval` | `seams.near.speakToSign.typed.mergeApproval` |
    | `seams.speakToSign.enroll` | `seams.near.speakToSign.enroll` |

  - Every signing call returns `{ kind: 'approved', result, approval, times }` when it succeeds, or `refused`, `cancelled` or `unavailable`. The kind `sent` is gone. `result` is `{ transactionHash }` for a sent transaction and for each `typed` call, the normal result of `signTransaction` or `signDelegateAction`, or `{ accountId, publicKey, signature, nonce, state? }` for a message. The request fields do not change.
  - The co-signer has no fixed voice limits (10 NEAR for one payment, 20 NEAR in 24 hours). The result reason `voice_limit` and the refusals `over_payment_limit` and `over_daily_limit` are gone. A limit is a rule of the Wallet policy engine.
- The Speak-to-Sign host API is version **10**. The host plugin has the new method `requestMessage`. Install `@seams/speak-to-sign` 0.66.0 with `@seams/wallet` 0.66.0: the Wallet refuses a host plugin of another version. The VoiceID host API stays at version **11**.
- The Speak-to-Sign verifier is **0.9.0**, OutLayer version key `6725917bd01355f08bb402271dff6265c0d03650c1b1acf8d0992b2537d65ef1`. `signAndSendTransaction`, `signTransaction`, `signDelegateAction` and `signMessage` need 0.9.0. `typed.bet` needs 0.8.0 or later. `typed.transfer`, `typed.note`, `typed.rating` and `typed.mergeApproval` also work with 0.5.2.
- Fixes:
  - In the Wallet modal, Transaction details open in one motion when the open card is taller than its frame. Before, the card opened in two steps and pushed Confirm out of view.
  - The VoiceID and Speak-to-Sign plugins load the Wallet bridge (`/sdk/voiceid-host.js`, `/sdk/speak-to-sign-host.js`) with `?v=` and the pinned Wallet version. Before, a browser could run new plugin files against a cached bridge of the release before, and the plugin failed to load.
- The SDK, the hosted Wallet and the server must ship together. The co-signer in `@seams/wallet-server` 0.66.0 checks the new request kinds, and an older Wallet host rejects them.
- Install all four packages at 0.66.0. Speak-to-Sign stays experimental and NEAR testnet only. Do not use it with real funds.

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds no database migrations. The table
`speak_to_sign_voice_verdicts` keeps its amount column, set to 0.
