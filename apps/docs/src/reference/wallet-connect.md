---
title: Wallet Connect
description: The @seams/wallet-connect controllers and React pickers that connect existing EVM and NEAR browser wallets, with no Seams account or custody.
---

# Wallet Connect

`@seams/wallet-connect` connects wallets that your users already have: MetaMask, Rabby and
other EIP-6963 extensions, Phantom, and the NEAR wallets Meteor, HOT and Intear. The wallet
keeps its keys and shows every approval. The package creates no Seams session and no custody
record, and it does not import the MPC wallet or Seams authentication.

```sh
pnpm add @seams/wallet-connect@0.77.0
```

## Import paths

| Import path | Exports |
| --- | --- |
| `@seams/wallet-connect/client` | `ExternalEvmController`, `ExternalNearController`, `nearWalletName`, and their connection, snapshot, result and transaction types |
| `@seams/wallet-connect/react` | `ExternalEvmWalletPicker`, `useExternalEvm`, `ExternalNearWalletPicker` (development preview), `useExternalNear` |

The controllers work without React. The React bindings need React 19 and no provider.

```ts [Import example]
import { ExternalEvmController, ExternalNearController } from '@seams/wallet-connect/client';
import { ExternalEvmWalletPicker, useExternalEvm } from '@seams/wallet-connect/react';
```

## With the MPC wallet

`HostedSeamsAuthMenu` from `@seams/mpc-wallet/react` can offer these controllers as wallet
alternatives beside Seams sign-in. `@seams/mpc-wallet` names `@seams/wallet-connect` as a peer
dependency, so install both at the same version. See
[wallet alternatives](/reference/react#wallet-alternatives).

## Styling

Each picker draws its own theme boundary (`data-seams-root` and the `seams-theme-provider`
class), and its styles start with that boundary. The pickers do not read the `Theme` tokens of
`@seams/mpc-wallet/react`. Change their colours with the CSS variables
`--seams-wallet-picker-text`, `--seams-wallet-picker-background`, `--seams-wallet-picker-card`,
`--seams-wallet-picker-border` and `--seams-wallet-picker-hover`.

See [external EVM wallets](/guides/external-evm-wallets) and
[external NEAR wallets](/guides/external-near-wallets) for the controller calls, the results
and the wallet limits.
