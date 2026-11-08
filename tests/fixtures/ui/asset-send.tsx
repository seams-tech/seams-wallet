import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { AssetBalance } from '../../../packages/wallet/src/core/assets/readAssetBalances';
import type { ReadySend } from '../../../packages/wallet/src/react/components/AccountMenuButton/assets/SendPanel';

// The Send screen with the built SDK: the real panel, the real checks against a fake NEAR
// node, and the real wallet review card for the prepared transaction. Nothing is signed.
const SDK = '/_test-sdk/esm';
async function load<T>(path: string): Promise<T> {
  return (await import(/* @vite-ignore */ `${SDK}/${path}`)) as T;
}

const { SendPanel } = await load<
  typeof import('../../../packages/wallet/src/react/components/AccountMenuButton/assets/SendPanel')
>('react/components/AccountMenuButton/assets/SendPanel.js');
const { prepareSend } =
  await load<typeof import('../../../packages/wallet/src/core/assets/send')>('core/assets/send.js');
const { assetsForChain } = await load<
  typeof import('../../../packages/wallet/src/core/assets/assetList')
>('core/assets/assetList.js');
const { toActionArgsWasm } = await load<
  typeof import('../../../packages/shared-ts/src/near/actions')
>('shared-ts/src/near/actions.js');
const { immediateNearTokenMetadata } = await load<
  typeof import('../../../packages/wallet/src/core/signingEngine/chains/near/tokenTransfers')
>('core/signingEngine/chains/near/tokenTransfers.js');
const { buildNearPreparationDisplayModel } = await load<
  typeof import('../../../packages/wallet/src/core/signingEngine/chains/near/display')
>('core/signingEngine/chains/near/display.js');
const { awaitConfirmUIDecision } =
  await load<
    typeof import('../../../packages/wallet/src/core/signingEngine/uiConfirm/ui/confirm-ui')
  >('sdk/tx-confirm-ui.js');

const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet';
stylesheet.href = `${SDK}/react/styles/styles.css`;
document.head.append(stylesheet);

const SENDER = 'alice.testnet';
const NEAR = 10n ** 24n;
const assets = assetsForChain({ network: 'near-testnet' });
const near = assets.find((asset) => asset.kind === 'near_native');
const usdc = assets.find((asset) => asset.symbol === 'USDC');
if (!near || !usdc) throw new Error('The testnet asset list lacks NEAR or USDC');

const balances: AssetBalance[] = [
  { kind: 'read', asset: near, available: (5n * NEAR).toString(), reserved: '0' },
  { kind: 'read', asset: usdc, available: '25000000' },
];

// The recipient bob.testnet exists and holds no USDC storage yet.
function viewResult(account: string, method: string): unknown {
  if (method === 'storage_balance_of') return null;
  if (method === 'storage_balance_bounds') {
    return { min: '1250000000000000000000', max: '1250000000000000000000' };
  }
  throw new Error(`Unexpected view ${account}.${method}`);
}

const nearClient = {
  async view(params: {
    account: string;
    method: string;
    decodeResult: (value: unknown) => unknown;
  }): Promise<unknown> {
    return params.decodeResult(viewResult(params.account, params.method));
  },
} as unknown as Parameters<typeof prepareSend>[0]['nearClient'];

const log = {
  prepared: [] as unknown[],
  reviews: [] as { confirmed: boolean }[],
  receive: [] as string[],
};
Reflect.set(window, 'assetSendLog', log);

async function review(prepared: ReadySend) {
  if (prepared.kind !== 'near') throw new Error('This fixture sends NEAR assets only');
  log.prepared.push({
    receiverId: prepared.receiverId,
    actions: prepared.actions,
    storageDepositYocto: prepared.storageDepositYocto,
  });
  const txSigningRequests = [
    { receiverId: prepared.receiverId, actions: prepared.actions.map(toActionArgsWasm) },
  ];
  const decision = await awaitConfirmUIDecision({
    ctx: { surfaceMeasurementBinding: { kind: 'disabled' } },
    surface: { kind: 'mount_new' },
    summary: { title: 'Send' },
    txSigningRequests,
    model: buildNearPreparationDisplayModel({
      txSigningRequests,
      tokenMetadata: immediateNearTokenMetadata({ network: 'testnet', txSigningRequests }),
      signerAccount: SENDER,
    }),
    theme: 'light',
    uiMode: 'modal',
  });
  log.reviews.push({ confirmed: decision.confirmed });
  decision.handle.close(decision.confirmed);
  return decision.confirmed
    ? ({ kind: 'sent', transactionId: 'fixture-transaction' } as const)
    : ({ kind: 'not_sent', message: 'You cancelled the transaction.' } as const);
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
        prepare={(request) =>
          prepareSend(
            {
              nearClient,
              accountExists: async (accountId) => accountId === 'bob.testnet',
              evmClientFor: () => null,
            },
            request,
          )
        }
        send={review}
        onReceive={(assetId) => log.receive.push(assetId)}
      />
    </main>
  </StrictMode>,
);
