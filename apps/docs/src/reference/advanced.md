---
title: Advanced helpers
description: Low-level identity builders, RPC clients, encoding helpers, and Tempo utilities exported from @seams/wallet/advanced.
---

# Advanced helpers

`@seams/wallet/advanced` provides low-level tools for integrations that manage their own
lifecycle and security boundaries.

```ts [Import example]
import { createEvmClient, MinimalNearClient } from '@seams/wallet/advanced';
```

## Identity builders moved

The boundary reference builders are exported from
[`@seams/wallet`](/reference/core) and `@seams/wallet/react` as well as here. A
first signing call needs no import from this entrypoint.

- `toWalletId`.
- `walletSessionRefFromSession`.
- `nearAccountRefFromAccountId`.
- `thresholdEcdsaChainTargetFromConfig`.
- `walletIdFromWalletProfile`.

They still preserve the relationship between wallet, session, account, and chain.
Construct the reference once. Pass it through the operation that requires it. Prefer
`seams.config.chainTarget(selector)` for chain targets. It can select only a chain configured
in your client.

## Other exports

The entrypoint also includes minimal NEAR and EVM RPC clients, transaction
encoding, base64url and hashing helpers, WebAuthn RP ID parsing, intent IDs,
threshold-session limits, and Tempo fee-token helpers.

These primitives expose more protocol detail and fewer product defaults. The
main SDK remains the preferred surface for registration, auth, signing,
recovery, and device flows.
