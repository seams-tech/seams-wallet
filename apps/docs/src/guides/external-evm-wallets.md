---
title: External EVM wallets
description: Connect MetaMask, Rabby, or Phantom EVM accounts without importing their key material.
---

# External EVM wallets

`@seams/wallet` can connect an existing MetaMask, Rabby, or Phantom EVM account without
importing its key material. The application chooses a discovered provider. The wallet
extension owns account permission and every approval prompt.

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

The controller discovers announced providers with EIP-6963. It also checks Phantom's
documented `window.phantom.ethereum` namespace because the extension may omit its
EIP-6963 announcement. It never selects the shared `window.ethereum` provider. Every
selected provider is called through EIP-1193. The controller handles account, chain, and
disconnect events. It returns typed, recoverable failures for rejected requests,
unsupported methods or networks, malformed provider responses, stale connections, and
unknown transaction outcomes.

The first release supports desktop EVM extensions, configured chain switching,
`personal_sign`, EIP-712 `eth_signTypedData_v4`, ordinary `eth_sendTransaction`, and
receipt observation through the configured RPC URL. Configure each chain with its
numeric EVM chain ID, display name, and an HTTPS or HTTP JSON-RPC endpoint. The
controller uses the RPC endpoint only to verify a submitted transaction. The wallet
provider handles signing and broadcast.

Use `connection` as the exact account and chain snapshot for an operation. If its
identity is stale after an account or chain event, the controller returns
`connection_changed`. Read the new snapshot. Ask the user to retry. A returned
transaction hash is evidence of submission. If the provider fails after dispatch, the
controller returns `submission_unknown` and does not resend automatically.

Disconnect clears this application's provider listeners and local state. It does not
revoke the site's permission in MetaMask, Rabby, or Phantom. The user manages that
permission in the external wallet.

## Wait for a receipt

After `sendTransaction` returns a successful submission, call
`await controller.waitForReceipt(submission, { timeoutMs: 90_000, signal })`.
The controller polls the configured RPC and verifies the receipt's chain,
transaction hash, account, status, and block number.

The result is `confirmed`, `reverted`, or `unresolved`. Confirmation means
inclusion in one block. Applications that need chain finality must track it
separately. Timeout, cancellation, RPC failure, or an unverified receipt returns
`unresolved`. Keep the submitted hash and let the user inspect it; do not resend
automatically. Cancellation can wait for an in-flight RPC request to finish.

## Extension smoke check

Before releasing an application that uses this connector, check the Console Lite
example:

1. Run it in a clean desktop browser profile with MetaMask, Rabby, and Phantom EVM enabled one at a time.
2. Repeat with all installed extensions enabled together.
3. Record the browser and extension versions.
4. For each wallet, check provider discovery, explicit wallet selection, account selection, and a configured network switch.
5. Check message signing, typed-data signing, and a testnet transaction.
6. Reject each approval once.
7. Disconnect locally.
8. Check that a later attempt starts a fresh request.
9. Disconnect the provider transport after a transaction request.
10. Check that the UI shows an unknown outcome and does not resend automatically.

External accounts are separate from Seams custody and authentication. Connecting
one does not sign a user into Seams, create a Wallet Session, or authorize a Seams
wallet. Mobile transports, WalletConnect, Solana, account linking, and custody
import are outside this connector's scope.

See [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963),
[EIP-1193](https://eips.ethereum.org/EIPS/eip-1193), and the
[Phantom EVM provider documentation](https://docs.phantom.com/ethereum-monad-testnet-base-and-polygon/getting-started).
