---
title: Release 0.50.0
description: After Continue, an owner approval no longer waits for the parent's session read or for the cost check before the wallet card shows.
---

# Release 0.50.0

The browser SDK, server SDK, and VoiceID plugin use **0.50.0**.

- After **Continue to wallet**, an owner approval reaches the wallet at once. The wallet compares the approval's application session with its own fresh read, and it checks the cost at the same time. A changed session still stops the approval before signing. Before, the approval waited for the app page's session read first. Other reviewed requests still wait for that read.
- The wallet card no longer waits for the NEAR cost check (`view_account` and `gas_price`). The card shows the transaction while the check runs, and **Confirm** becomes available only after the check. If the account cannot pay, the card closes before the passkey prompt, and the operation ends as `not_submitted` with `shortfall`. Nothing is signed.
- A custom review hands over to the wallet card when the card's content is final, even if **Confirm** is still preparing.
- Install `@seams/voiceid` 0.50.0 with `@seams/wallet` 0.50.0. The VoiceID host API stays at version 8.

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds no database migrations.
