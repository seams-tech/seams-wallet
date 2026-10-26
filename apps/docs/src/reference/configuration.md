---
title: Configuration
description: Configure hosted wallet isolation, registration, relaying, chains, and appearance with precise Seams SDK branches.
---

# Configuration

Build the configuration at the application boundary with `defineSeamsConfig`, or
`seamsTestnetConfig` for the NEAR and Tempo testnets. Both require the values needed to
start a wallet. They provide defaults for the remaining settings. Their types require
you to supply those essential values:

```ts [Partial example]
import { seamsTestnetConfig } from '@seams/wallet/react';

const config = seamsTestnetConfig({
  walletOrigin: import.meta.env.VITE_WALLET_ORIGIN,
  relayerUrl: import.meta.env.VITE_RELAYER_URL,
  publishableKey: import.meta.env.VITE_SEAMS_PUBLISHABLE_KEY,
});
```

`SeamsConfigsInput` is available for an object you construct yourself. Every field is
optional. Prefer the helpers unless you need partial configuration for a custom runtime.

## External NEAR wallet selection

The development-preview NEAR connector uses its own `ExternalNearConfig`.
Pass `network`, `rpcUrl`, and `wallets` directly to `ExternalNearController`.
No Seams provider configuration is required. These exports are absent from the
published `0.22.0` package.

| Configuration                          | Behavior                                                        |
| -------------------------------------- | --------------------------------------------------------------- |
| `wallets: ['meteor']`                  | Enable Meteor only. This is the demo and example configuration. |
| `wallets: ['meteor', 'hot']`           | Show Meteor and HOT in that order. HOT still requires mainnet.  |
| `wallets: ['meteor', 'hot', 'intear']` | Explicitly enable all three.                                    |
| `wallets: []`                          | Disable all external NEAR wallets.                              |

`wallets` is required. Omitting it does not enable a default set.
Use `controller.setWallets(...)` for runtime changes. The picker follows the same
list. Disabling a connected or connecting wallet disconnects it locally.
A connection request for a disabled wallet returns `unavailable` without loading
its adapter.

See the [short examples and retry rules](/guides/external-near-wallets#choose-supported-wallets).

## Hosted wallet branch

Use `iframeWallet` for the isolated wallet origin. Set the HTTPS `walletOrigin`. Set
`walletServicePath` and `sdkBasePath` to match the assets deployed at that origin.
`rpIdOverride` changes credential scope and needs an explicit security review.

## Registration branch

Managed registration requires the `publishableKey` issued for the current origin. The
key's record identifies its environment. The Router API builds the runtime policy scope
from the authenticated key.

`projectEnvironmentId` is an optional cross-check. Supply it when configuration can
point the same build at staging or production. The Router then rejects keys that belong
to a different environment.

Keep environment identities public and keep server or custody secrets outside
browser configuration.

## Network branch

Each chain record selects one supported network. `rpcUrl` and `explorerUrl` are
optional. SDK defaults provide testnet endpoints and RPC failover for NEAR. EVM-family
chains also need their numeric chain identity.

Signing names a chain from this configuration by network slug. The RPC endpoint
used at execution time is resolved from the configured chain, never from the
signing call.

## Relayer branch

Configure the relayer only when the chosen registration or relay flow uses it. The app
URL identifies the service. Request authentication and custody secrets stay at the
server boundary.

Leave `relayerAccount` unset so the SDK reads it from the relayer's `/healthz` response.
This keeps it matched to the server. The value identifies the NEAR parent account used
to create named subaccounts. For example, `alice` becomes `alice.<relayerAccount>`. The
account-name input displays this suffix. It is not a delegated-signing credential.

If you set `relayerAccount`, the SDK skips discovery. Your value must match the server.

## Appearance branch

SDK 0.18.0 adds `appearance.locale: 'en' | 'ja'`. English is the default.
Use `normalizeWalletLocale` from `@seams/wallet` to normalize raw language tags before configuration.
For example, `ja-JP` selects `ja`. Unsupported tags select `en`.
The locale reaches SDK-owned React controls and the hosted wallet iframe through appearance configuration.
Locale has no effect on signing or authentication state.

Initial appearance belongs in configuration. Use `seams.config.setAppearance` for runtime
theme changes. Keep the app-owned React theme and wallet-owned iframe appearance
on the same semantic palette.

See [environment variables](/deploy-and-operate/environment) for the browser and
server ownership split.
