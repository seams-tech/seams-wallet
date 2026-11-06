---
title: Release 0.51.0
description: The owner NEAR cost check prices gas at NEAR's minimum gas purchase price, so it no longer lets through a call that NEAR refuses with NotEnoughBalance.
---

# Release 0.51.0

The browser SDK, server SDK, and VoiceID plugin use **0.51.0**.

- The owner NEAR cost check now prices gas the way NEAR charges it: at the block gas price, but no less than the runtime's `min_gas_purchase_price`. On testnet and mainnet (protocol 88) that floor is 10 times the `gas_price` RPC value, so a call with 100 Tgas needs about 0.1 NEAR on hand, though NEAR refunds most of it. Before, the check used the `gas_price` value alone, so it let such a call through, and NEAR then refused it with `NotEnoughBalance`. Now the card closes before the passkey prompt, and the operation ends as `not_submitted` with `shortfall`.
- The cost check makes one more RPC call (`EXPERIMENTAL_protocol_config`), at the same time as the others. The card does not wait for it.
- Install `@seams/voiceid` 0.51.0 with `@seams/wallet` 0.51.0. The VoiceID host API stays at version 8.

The Wallet iframe protocol remains **23.0.0**, and the wallet-management protocol remains **5**.
The signed recovery CLI remains **0.29.0**. This release adds no database migrations.
