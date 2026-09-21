---
title: External EVM wallets
description: Connect MetaMask, Rabby, or Phantom EVM accounts without importing their key material.
---

# External EVM wallets

`@seams/wallet` can connect an existing MetaMask, Rabby, or Phantom EVM account
without importing its key material. The application chooses a discovered
provider; the wallet extension owns account permission and every approval prompt.

The connector is host-side and does not require a Seams Wallet Session. For
framework-independent use, import `ExternalEvmController` from
`@seams/wallet/external-evm`. React applications can use the picker and hook
shown below.

Outside React, call `controller.start(window)` when the host UI mounts and
`controller.dispose()` when it unmounts.

```tsx [Import example]
import { useMemo } from 'react';
import {
  ExternalEvmController,
  ExternalEvmWalletPicker,
  useExternalEvm,
  type ExternalEvmConnection,
} from '@seams/wallet/react';

function createExternalEvmController(): ExternalEvmController {
  return new ExternalEvmController([
    {
      chainId: 11_155_111,
      name: 'Sepolia testnet',
      rpcUrl: 'https://rpc.sepolia.org',
    },
  ]);
}

async function signExternalMessage(
  controller: ExternalEvmController,
  connection: ExternalEvmConnection,
): Promise<void> {
  await controller.signMessage(
    connection,
    new TextEncoder().encode('Approve this application'),
  );
}

export function ExternalWalletSection() {
  const controller = useMemo(createExternalEvmController, []);
  const externalEvm = useExternalEvm(controller);
  const { connection } = externalEvm;

  return (
    <>
      <ExternalEvmWalletPicker controller={controller} snapshot={externalEvm} />
      {connection.kind === 'connected' ? (
        <button
          type="button"
          onClick={signExternalMessage.bind(null, controller, connection)}
        >
          Sign message
        </button>
      ) : null}
    </>
  );
}
```

The controller discovers announced providers with EIP-6963. It also checks
Phantom's documented `window.phantom.ethereum` namespace because the extension
may omit its EIP-6963 announcement. It never selects the shared
`window.ethereum` provider. Every selected provider is called through EIP-1193.
The controller handles account, chain, and disconnect events and returns typed
recoverable failures for rejection, unsupported methods or networks, malformed
provider responses, stale connections, and unknown transaction outcome.

The first release supports desktop EVM extensions, configured chain switching,
`personal_sign`, EIP-712 `eth_signTypedData_v4`, ordinary
`eth_sendTransaction`, and receipt observation through the configured RPC URL.
Configure each chain with its numeric EVM chain ID, display name, and an HTTPS
or HTTP JSON-RPC endpoint. The RPC endpoint is used only to verify a submitted
transaction; the wallet provider remains responsible for signing and broadcast.

Use `connection` as the exact account and chain snapshot for an operation. If its
identity is stale after an account or chain event, the controller returns
`connection_changed`; read the new snapshot and ask the user to retry. A returned
transaction hash is submitted evidence. If the provider fails after dispatch,
the controller returns `submission_unknown` and does not resend automatically.

Disconnect clears this application's provider listeners and local state. It does
not revoke the site's permission in MetaMask, Rabby, or Phantom; the user manages
that permission in the external wallet.

## Extension smoke check

Before releasing a host that depends on this connector, run the Console Lite
example in a clean desktop browser profile with MetaMask, Rabby, and Phantom EVM
enabled one at a time, then repeat with the installed extensions together. Record
the browser and extension versions. For each wallet, verify provider discovery,
explicit wallet selection, account selection, a configured network switch,
message signing, typed-data signing, and a testnet transaction. Reject each
approval once, disconnect locally, and confirm that a later attempt starts a
fresh request. When a provider loses transport after a transaction request,
confirm the UI shows an unknown outcome and does not resend automatically.

External accounts are separate from Seams custody and authentication. Connecting
one does not sign a user into Seams, create a Wallet Session, or authorize a Seams
wallet. Mobile transports, WalletConnect, Solana, account linking, and custody
import are outside this connector's scope.

See [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963),
[EIP-1193](https://eips.ethereum.org/EIPS/eip-1193), and the
[Phantom EVM provider documentation](https://docs.phantom.com/ethereum-monad-testnet-base-and-polygon/getting-started).
