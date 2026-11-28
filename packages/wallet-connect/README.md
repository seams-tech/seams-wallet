# Seams Wallet Connect

`@seams/wallet-connect` **0.77.0** connects wallets that your users already have: MetaMask,
Rabby and other EIP-6963 extensions, Phantom, and the NEAR wallets Meteor, HOT and Intear. The
wallet keeps its keys and shows every approval. The package creates no Seams session and no
custody record, and it imports no Seams authentication or MPC wallet code. It replaces
`@seams/wallet/external-evm` and `@seams/wallet/external-near`.

```sh
pnpm add @seams/wallet-connect@0.77.0
```

| Import path | Exports |
| --- | --- |
| `@seams/wallet-connect/client` | `ExternalEvmController`, `ExternalNearController`, `nearWalletName` and their types |
| `@seams/wallet-connect/react` | `ExternalEvmWalletPicker`, `useExternalEvm`, `ExternalNearWalletPicker`, `useExternalNear` |

```ts
import { ExternalEvmController } from '@seams/wallet-connect/client';
import { ExternalEvmWalletPicker, useExternalEvm } from '@seams/wallet-connect/react';
```

React is an optional peer (`>=19.0.0`). The pickers need no provider. Each picker draws its
own theme boundary and reads only its `--seams-wallet-picker-*` CSS variables.

The build fails if a module of this package is outside `src/`, a third-party package, or one
of the generic shared helpers that `rolldown.config.ts` lists.

See the [Wallet Connect reference](https://docs.wallet.seams.sh/reference/wallet-connect), the
[external EVM guide](https://docs.wallet.seams.sh/guides/external-evm-wallets) and the
[external NEAR guide](https://docs.wallet.seams.sh/guides/external-near-wallets).
