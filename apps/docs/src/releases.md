---
title: Release 0.65.0
description: A Wallet card can show as a step of an app's own dialog, and app steps can show inside the Wallet modal.
---

# Release 0.65.0

The browser SDK, server SDK, VoiceID plugin, and Speak-to-Sign plugin use **0.65.0**.

- A Wallet card can show as a step of an app's own dialog, in place of a second dialog on top. App content never renders inside the Wallet iframe, and the owner still approves in the Wallet's own card.
  - `HostedSeamsAuthMenu` and `seams.authMenu.open(request, anchor, step)` take the events `onEnter` (the card's size while it is still hidden), `onReady`, `onResize`, `onExit`, `onBack` and `onClose`. `chrome: 'back' | 'close'` draws Back or Close in the card's origin line. `layer: 'top'` paints the card above all app content.
  - Pass `presentation: { kind: 'anchored', anchor, chrome, ... }` to the NEAR, EVM and Tempo sign methods and to the `seams.speakToSign` requests. The transaction confirm or the VoiceID card then shows in the app's dialog. An anchored transaction needs a click to approve and shows no receipt, so the app shows its own result. Without `presentation`, the card shows in the Wallet modal as before.
  - `WalletStep` from `@seams/wallet/react`, and `seams.surfaces.mount(anchor, options)` without React, show the sign-in menu, a transaction confirm or a Speak-to-Sign request as one step.
  - A card in the top layer takes clicks only while it is whole in view and nothing covers it, also a popover or a dialog that opened later. In Chromium, the card also checks this itself, with a browser report that the page cannot change.
  - A transaction or VoiceID card in an app's dialog eases to a new size over 180 ms. With reduced motion, it takes the new size at once.
  - With `chrome: 'back'`, the VoiceID card shows Back in place of Cancel.
- App steps can show inside the Wallet modal, before and after the Wallet's card. They render React content, so they need `TransactionReviewHost` from `@seams/wallet/react`.
  - Reviewed transactions take `steps: { title, validity, before, after }`. `review` stays as another name for it, and `review.render` is `steps.before`.
  - `seams.authMenu.open(request, undefined, { steps })` and the `seams.speakToSign` requests take `steps: { title, before, after }`. Back in the card returns to `before` with its state kept. A completed call settles before `after` shows. A person who leaves before the Wallet's card ends gets the call's cancelled result.
- In login mode, the sign-in menu shows "Unlock with email code" only where the email code can unlock: on a device with no saved wallet, or for a selected wallet that has the email code method on this device. Before, it also showed for passkey and VoiceID wallets without the email code. Create mode does not change.
- The SDK and the hosted Wallet must ship together. The auth-menu request has a new field `chrome`, requests have a new field `presentation`, and the page sends a new message `PM_SURFACE_VIEW`. An older Wallet host rejects an auth-menu request that has `chrome`.
- The VoiceID host API stays at version **11**, and the Speak-to-Sign host API stays at version **9**. `@seams/voiceid` 0.65.0 reads the card's Back control from the 0.65.0 Wallet host, so install it with `@seams/wallet` 0.65.0. The Speak-to-Sign verifier stays at **0.5.2**, OutLayer version key `96b79b518613a50538b060da2279c91e12b0619499c532c2708f61ddb790d7e5`.
- Deploy the Wallet host with both plugins, and update apps to 0.65.0. The server needs no change for this release.
- Install all four packages at 0.65.0. Speak-to-Sign stays experimental and NEAR testnet only. Do not use it with real funds.

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds no database migrations.
