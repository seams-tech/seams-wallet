---
title: Release 0.52.0
description: An owner NEAR transaction that NEAR rejects at broadcast, such as for NotEnoughBalance, shows Rejected by NEAR in the receipt, with the reason stated once.
---

# Release 0.52.0

The browser SDK, server SDK, and VoiceID plugin use **0.52.0**.

- When NEAR rejects an owner transaction at broadcast for a reason that depends on account state, such as `NotEnoughBalance`, the receipt now shows **Rejected by NEAR**. It states the rejection once and says that the signed transaction can still run until it expires. Before, it showed **Confirmation unavailable** and repeated the rejection. The outcome is still `unresolved` with `rejection`; call `cancelTransaction()` to end it at once.
- A rejection of the signed bytes, which ends the operation as `not_submitted`, is also stated once in the receipt.
- 0.51.0 priced the owner NEAR cost check's gas at NEAR's minimum gas purchase price (`min_gas_purchase_price`). 0.52.0 keeps that fix.
- Install `@seams/voiceid` 0.52.0 with `@seams/wallet` 0.52.0. The VoiceID host API stays at version 8.

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds no database migrations.
