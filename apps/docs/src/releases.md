---
title: Release 0.58.0
description: Speak-to-Sign pays from the owner's own account with no vault and no passkey; a policy rule can ask for the confirm again.
---

# Release 0.58.0

The browser SDK, server SDK, VoiceID plugin, and Speak-to-Sign plugin use **0.58.0**.

- **Experimental, NEAR testnet only:** Speak-to-Sign pays from the owner's own account. There is no vault contract. The verifier signs a verdict; Wallet core checks it against the verifier key that the Wallet pins, and sends the transfer through the owner's Wallet Session. See [Experimental: Speak-to-Sign](/concepts/auth-methods/speak-to-sign).
  - An accepted spoken payment shows no confirm and no passkey. A spoken payment needs a warm Wallet Session; a locked or expired session asks for an unlock first.
  - A policy rule in the verifier can ask for the confirm again. Today one stub rule asks for it above 10 NEAR. A `sent` result has `approval`: `voice` or `voice_and_passkey`.
  - A verdict expires 120 s after the verifier signs it. The Wallet pays each verdict at most once, and only for a recording of the same flow.
  - Enrollment signs one NEP-413 message for exactly the three recordings, in place of the vault authorization. Each owner enrolls again once.
- The Speak-to-Sign host API is version **4**. The Wallet refuses a Speak-to-Sign host plugin of another version. The verifier is version 0.3.0 (`09f4ce1be348cc874ded71687c9de96b05fbfb452f94bc801c6752b4e39ea294`).
- Compatibility:
  - Replace `speakToSign({ vault, network })` with `speakToSign({ network })`. `seams.speakToSign` has no `vault` field.
  - Replace `case 'vault_rejected'` with `transaction_failed`, and drop `vault_missing`. TypeScript reports the old reasons.
  - An `enrolled` result has no `transactionHash`, and a `sent` result has no `checkMs` time.
- Install all four packages at 0.58.0. The VoiceID host API stays at version **9**. Speak-to-Sign stays experimental and NEAR testnet only. Do not use it with real funds.

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds no database migrations.
