import React from 'react';
import { useSeams, type BoundWallet, type TransactionReviewControls } from '@seams/wallet/react';

type Seams = ReturnType<typeof useSeams>['seams'];
type TransferState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'submitted'; transactionId: string; account: string; rawTxHex: string }
  | { kind: 'failed'; message: string };

export function ReviewedArcTransfer({ walletId }: { walletId: string | null }): React.ReactNode {
  const { wallet, seams } = useSeams();
  const [state, setState] = React.useState<TransferState>({ kind: 'idle' });
  const selected = wallet?.walletId === walletId ? wallet : null;
  return (
    <section aria-label="Arc transfer">
      <p>
        Send one smallest native unit to this wallet’s own Arc testnet address. The address needs
        testnet funds for fees.
      </p>
      <button
        disabled={!selected || state.kind === 'pending'}
        onClick={selected ? transfer.bind(null, seams, selected, setState) : undefined}
      >
        Review Arc testnet transfer
      </button>
      <output data-testid="reviewed-arc-result" data-state={state.kind} role="status">
        {state.kind === 'idle' ? '' : JSON.stringify(state)}
      </output>
    </section>
  );
}

function renderReview(controls: TransactionReviewControls): React.ReactNode {
  return (
    <>
      <p>Approve a self-transfer on Arc testnet.</p>
      <button onClick={controls.continueToWallet}>Continue to wallet</button>
      <button onClick={controls.cancel}>Cancel review</button>
    </>
  );
}

function requireAddress(value: string | null): `0x${string}` {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value) || !value.startsWith('0x')) {
    throw new Error(
      'This wallet has no EVM account. Open Accounts in wallet settings, then select Add EVM account.',
    );
  }
  return `0x${value.slice(2)}`;
}

async function readGasPrice(rpcUrl: string): Promise<bigint> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }),
  });
  if (!response.ok) throw new Error('Arc fee estimate is unavailable.');
  const body: unknown = await response.json();
  if (
    !body ||
    typeof body !== 'object' ||
    !('result' in body) ||
    typeof body.result !== 'string' ||
    !/^0x[0-9a-fA-F]+$/.test(body.result)
  ) {
    throw new Error('Arc returned an invalid fee estimate.');
  }
  return BigInt(body.result);
}

async function transfer(
  seams: Seams,
  wallet: BoundWallet,
  setState: React.Dispatch<React.SetStateAction<TransferState>>,
): Promise<void> {
  setState({ kind: 'pending' });
  try {
    const chain = seams.configs.network.chains.find(isArcTestnet);
    if (!chain?.rpcUrl) throw new Error('Arc testnet is not configured.');
    const session = await seams.auth.getSession(wallet.walletId);
    if (session.appIdentity.kind !== 'resolved') throw new Error('Wallet identity is unavailable.');
    const account = requireAddress(session.appIdentity.thresholdEcdsaEthereumAddress);
    const gasPrice = await readGasPrice(chain.rpcUrl);
    const result = await wallet.evm.signAndSendTransaction({
      chainTarget: 'arc-testnet',
      request: {
        chain: 'evm',
        kind: 'eip1559',
        senderSignatureAlgorithm: 'secp256k1',
        tx: {
          to: account,
          value: 1n,
          data: '0x',
          accessList: [],
          maxPriorityFeePerGas: 0n,
          maxFeePerGas: gasPrice * 2n,
          gasLimit: 21_000n,
        },
      },
      options: { confirmationConfig: { uiMode: 'modal', behavior: 'requireClick' } },
      review: {
        title: 'Review Arc testnet transfer',
        validity: { kind: 'expires_at', atMs: Date.now() + 120_000 },
        render: renderReview,
      },
    });
    setState({
      kind: 'submitted',
      transactionId: result.txHash,
      account,
      rawTxHex: result.signedResult.rawTxHex,
    });
  } catch (error) {
    setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
}

function isArcTestnet(chain: Seams['configs']['network']['chains'][number]): boolean {
  return chain.network === 'arc-testnet' && chain.chainId === 5_042_002;
}
