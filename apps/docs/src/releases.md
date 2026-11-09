---
title: Release 0.63.0
description: A site or device with no NEAR custody cache reissues the current Client share, with no Router recovery and no new activation.
---

# Release 0.63.0

The browser SDK, server SDK, VoiceID plugin, and Speak-to-Sign plugin use **0.63.0**.

- A site or device with no NEAR custody cache now gets the current Client share through a Router reissue.
  - Passkey login, account sync and VoiceID unlock do this. Before, a passkey login ran a Router recovery, which moved the state epoch and made a new material activation. VoiceID unlock failed with "This site has no wallet keys on this device yet."
  - A reissue keeps the material activation and the state epoch. So the local authority and Wallet Session records do not change, and the caches on other sites stay current.
  - Any Ed25519 Wallet Session of the wallet admits a reissue, VoiceID's included. The SigningWorker opens the reissued shares and checks them against its active share before the Router releases the Client packages. It stores nothing.
  - Email OTP on a site with no cache still needs a recovery code. A later release removes this step.
- The Gateway serves two new routes: `/router-ab/ed25519/yao/reissue/admit` and `/router-ab/ed25519/yao/reissue/execute`. `@seams/wallet-server/cloud-host` exports `handleRouterAbEd25519YaoReissueRequestV1` for a Gateway that you assemble yourself.
- Router project policies must allow the `reissue` work kind. A policy without it refuses a reissue.
- The Wallet frame hides its scroll bar while a VoiceID card is open. Before, a scroll bar flashed on the card's right edge for about 150 ms when the card opened.
- The Speak-to-Sign host API stays at version **8**, and the VoiceID host API stays at version **10**. The Speak-to-Sign verifier stays at **0.5.2**, OutLayer version key `96b79b518613a50538b060da2279c91e12b0619499c532c2708f61ddb790d7e5`.
- Deploy the Gateway, Router, both Derivers, SigningWorker and Wallet host together, and update apps to 0.63.0. A 0.62.0 Router refuses the reissue operation. A 0.62.0 Wallet keeps working against a 0.63.0 server: it still runs a recovery on a site with no cache.
- Install all four packages at 0.63.0. Speak-to-Sign stays experimental and NEAR testnet only. Do not use it with real funds.

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds no database migrations.
