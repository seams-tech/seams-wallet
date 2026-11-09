---
title: Release 0.62.0
description: A NEAR custody cache from an older state epoch re-binds locally, so VoiceID and Email OTP keep working after a login on another site.
---

# Release 0.62.0

The browser SDK, server SDK, VoiceID plugin, and Speak-to-Sign plugin use **0.62.0**.

- A NEAR custody cache from an older SigningWorker state epoch now re-binds on this device, with no Router round.
  - The Wallet frame's storage is separate for each site. So the first passkey login of a wallet on another site, or on another device, finds no cache and runs a Router recovery. The recovery moves the state epoch.
  - A recovery keeps the Client and SigningWorker shares. So the older cache on this site still holds the current share. The Wallet checks it against the server's current SigningWorker verifying share and the registered key, then seals it again under the current epoch.
  - Passkey login, account sync, VoiceID unlock, Email OTP unlock and Email OTP export do this. Before, a VoiceID unlock failed with "Something went wrong.", and a passkey login ran one more Router recovery.
  - A site with no cache still needs one passkey unlock before VoiceID or Email OTP. A later release removes this step.
- The active Ed25519 capability carries `signingWorkerVerifyingShare`. The passkey, Email OTP and VoiceID unlock responses return it.
- A passkey login that rejoins the key set now reports the recovery. So the local authority and Wallet Session record follow the new material activation. 0.61.0 left them on the old activation after a rejoin for an older cache.
- `@seams/speak-to-sign` 0.62.0 removes its empty `./react` entry.
- The Speak-to-Sign host API stays at version **8**, and the VoiceID host API stays at version **10**.
- Deploy the server and the Wallet host together, and update apps to 0.62.0. A 0.61.0 Wallet's Email OTP unlock refuses the new capability field, and a 0.62.0 Wallet needs it. Passkey and VoiceID unlock of a 0.61.0 Wallet keep working against a 0.62.0 server.
- Install all four packages at 0.62.0. Speak-to-Sign stays experimental and NEAR testnet only. Do not use it with real funds.

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds no database migrations.
