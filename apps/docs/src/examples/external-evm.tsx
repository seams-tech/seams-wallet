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
  await controller.signMessage(connection, new TextEncoder().encode('Approve this application'));
}

export function ExternalWalletSection() {
  const controller = useMemo(createExternalEvmController, []);
  const externalEvm = useExternalEvm(controller);
  const { connection } = externalEvm;

  return (
    <>
      <ExternalEvmWalletPicker controller={controller} snapshot={externalEvm} />
      {connection.kind === 'connected' ? (
        <button type="button" onClick={signExternalMessage.bind(null, controller, connection)}>
          Sign message
        </button>
      ) : null}
    </>
  );
}
