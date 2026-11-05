---
title: Release 0.48.0
description: Owner NEAR approvals and cancels end in the transaction receipt, VoiceID enrollment downloads inside its card, and wallet approval keeps a custom review's box.
---

# Release 0.48.0

The browser SDK, server SDK, and VoiceID plugin use **0.48.0**.

- After the owner confirms a `prepareOwnerTransaction` approval or a `cancelTransaction()`, the wallet card turns into the transaction receipt, as for an app-session send: Signing, Submitted, then the final state, with minimise to a toast and dismiss. Before, the card closed.
- When an owner send does not reach NEAR, the receipt shows why: an `unresolved` or `not_submitted` outcome shows its message, including NEAR's rejection such as `NotEnoughBalance`.
- VoiceID enrollment opens its recording card at once and downloads VoiceID inside it. A rounded bar takes the place of the answer line, the download size takes the place of the status line, and **Record sample 1** turns on when VoiceID is ready. Before, a plain progress bar showed under the card.
- If the download fails, the error shows in the card, and **Retry loading** takes the place of the record button. Unlock and the other VoiceID captures use the same layout.
- After a custom transaction review, wallet approval keeps the review's box: the same width and top-left corner, with the card laid out at that width. Only the height changes, so the handoff no longer looks like a second modal.
- When expanded transaction details make the confirm card taller than its frame, the **Secured by seams** footer stays in view, and the details scroll under it.
- Install `@seams/voiceid` 0.48.0 with `@seams/wallet` 0.48.0. The VoiceID host API stays at version 8.

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds no database migrations.
