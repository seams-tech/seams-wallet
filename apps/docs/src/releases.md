---
title: Release 0.49.0
description: Wallet approval keeps a custom review's vertical centre, a custom review opens without a fresh session read, and the wallet card appears sooner after Continue.
---

# Release 0.49.0

The browser SDK, server SDK, and VoiceID plugin use **0.49.0**.

- After a custom transaction review, wallet approval keeps the review's width, left edge and vertical centre. Only the height changes, equally above and below. Before, the card kept the review's top edge, so a short centred review handed over to a card that sat low in the viewport.
- A custom review opens from the session and preferences that the SDK already holds, and the fresh session read runs at the same time. A changed session still cancels the review. Before, the review waited for two reads from the wallet iframe, one after the other.
- After **Continue to wallet**, an owner approval reads the application session once instead of twice. The wallet starts the NEAR cost check and the token metadata lookup with the connection check, so the confirm card appears sooner.
- The reviewed path records User Timing measures named `seams:review:<step>`: `review_open` and `continue_session_read` in the app page, and `owner_connection_check`, `owner_affordability` and `host_until_card_ready` in the wallet iframe. They record durations only.
- Install `@seams/voiceid` 0.49.0 with `@seams/wallet` 0.49.0. The VoiceID host API stays at version 8.

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds no database migrations.
