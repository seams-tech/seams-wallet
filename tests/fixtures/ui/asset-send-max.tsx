import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SendPanel } from '../../../packages/wallet/src/react/components/AccountMenuButton/assets/SendPanel';
import { assetsForChain } from '../../../packages/wallet/src/core/assets/assetList';
import type { AssetBalance } from '../../../packages/wallet/src/core/assets/readAssetBalances';
import type { PreparedSend } from '../../../packages/wallet/src/core/assets/send';

// The Send panel from source with an EVM native balance. The Max fee probe waits until the
// page calls releaseMaxProbe(), so a test can act while the probe is in flight.
const SENDER = '0x1111111111111111111111111111111111111111';
const ETH = 10n ** 18n;
const eth = assetsForChain({ network: 'ethereum-sepolia', chainId: 11_155_111 }).find(
  (asset) => asset.kind === 'evm_native',
);
if (!eth || eth.kind !== 'evm_native') throw new Error('The Sepolia asset list lacks ETH');

const balances: AssetBalance[] = [
  { kind: 'read', asset: eth, available: (2n * ETH).toString(), reserved: '0' },
];

const log = { prepared: [] as string[], sent: 0 };
let releaseProbe: () => void = () => undefined;
const probeGate = new Promise<void>((resolve) => {
  releaseProbe = resolve;
});
Reflect.set(window, 'assetSendMaxLog', log);
Reflect.set(window, 'releaseMaxProbe', () => releaseProbe());

async function prepare(request: {
  readonly amount: { toString(): string };
}): Promise<PreparedSend> {
  log.prepared.push(String(request.amount));
  await probeGate;
  return {
    kind: 'evm',
    asset: eth,
    baseUnits: 1n,
    tx: {} as Extract<PreparedSend, { kind: 'evm' }>['tx'],
    maxFeeNative: ETH / 1000n,
  } as PreparedSend;
}

const root = document.createElement('div');
root.className = 'seams-account-menu';
document.body.append(root);
createRoot(root).render(
  <StrictMode>
    <main style={{ maxWidth: 380, padding: 16 }}>
      <SendPanel
        balances={balances}
        fromFor={() => SENDER}
        prepare={prepare}
        send={async () => {
          log.sent += 1;
          return { kind: 'not_sent', message: 'This fixture never sends.' };
        }}
      />
    </main>
  </StrictMode>,
);
