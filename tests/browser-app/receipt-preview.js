import { mountConfirmationSurface } from '../../packages/wallet/dist/esm/core/signingEngine/uiConfirm/ui/preact/mountConfirmationSurface.js';
import { buildDisplayTreeFromModel } from '../../packages/wallet/dist/esm/core/signingEngine/uiConfirm/ui/transaction-display/tree.js';
import { enrichDisplayModelWithAbi } from '../../packages/wallet/dist/esm/core/signingEngine/uiConfirm/ui/transaction-display/abi/enrichDisplayModelWithAbi.js';

const parent = document.querySelector('main');
const status = document.querySelector('#status');
let handle;
let theme = 'light';
let state = { kind: 'signing' };
let view = 'expanded';
let example = 'transfer';

function displayModel() {
  const signer = `0x4201${'0'.repeat(32)}891c`;
  const recipient = `0x2F01${'0'.repeat(32)}4EC9`;
  if (example === 'near') {
    return {
      chain: 'near', signerAccount: 'alice.testnet', title: 'NEAR contract call',
      totals: { estimatedFee: '0.0003', feeSymbol: 'NEAR' },
      operations: [{
        id: 'near-transaction', kind: 'generic.contractCall', label: 'Transaction to token.example.testnet',
        to: 'token.example.testnet',
        children: [{
        id: 'near-call', kind: 'near.action', actionType: 'functionCall', label: 'Call ft_transfer',
        fields: [
          { label: 'Contract', value: 'token.example.testnet' },
          { label: 'Method', value: 'ft_transfer' },
          { label: 'Gas', value: '30 Tgas' },
          { label: 'Attached deposit', value: '1 yoctoNEAR' },
          { label: 'Arguments', value: JSON.stringify({ receiver_id: 'bob.testnet', amount: '125000000', memo: 'Invoice 1042' }, null, 2), renderAs: 'file-content' },
        ],
        }],
      }],
    };
  }
  if (example === 'evm') {
    const dataHex = `0xa9059cbb${recipient.slice(2).toLowerCase().padStart(64, '0')}${(125000000n).toString(16).padStart(64, '0')}`;
    return enrichDisplayModelWithAbi({
      chain: 'evm', chainId: 8453, signerAccount: signer, title: 'EVM contract call',
      totals: { estimatedFee: '0.000001', feeSymbol: 'ETH' },
      operations: [{
        id: 'evm-call', kind: 'generic.contractCall', label: 'Calling function 0xa9059cbb using 65,000 gas',
        to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        fields: [
          { label: 'Contract', value: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', copyValue: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
          { label: 'Data', value: dataHex, renderAs: 'file-content' },
        ],
        abiDecodeHint: { dataHex, abi: [{ type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }] },
      }],
    });
  }
  return {
    chain: 'evm', chainId: 8453, signerAccount: signer,
    operations: [{ id: 'transfer', kind: 'generic.contractCall', label: 'Transfer ETH', to: recipient }],
    totals: { nativeValue: '0.025', nativeSymbol: 'ETH', estimatedFee: '0.000001', feeSymbol: 'ETH' },
  };
}

function confirm() {
  showStage('signing');
}
function dismiss() {
  handle?.dispose();
  status.textContent = 'Closed — select Review to restart.';
}
function closed() {}
function changeView(next) {
  view = next;
  renderReceipt();
}
function explorerUrls() {
  if (example === 'near') {
    return { near: 'https://testnet.nearblocks.io' };
  }
  return { evm: 'https://basescan.org' };
}
function model() {
  const display = displayModel();
  return {
    appearance: {
      palette: 'default',
      theme: {
        id: 'default',
        mode: theme,
        shape: { card: '26px', box: '12px', control: '12px' },
        colors:
          theme === 'light'
            ? {
                colorBackground: '#ffffff',
                textPrimary: '#182820',
                textSecondary: '#707a74',
                borderPrimary: '#e8ece8',
                surface2: '#f5f7f4',
                surface3: '#e0e9dc',
                buttonBackground: '#235840',
                buttonHoverBackground: '#1a4732',
                textButton: '#ffffff',
              }
            : {
                colorBackground: '#171c20',
                textPrimary: '#edf4ef',
                textSecondary: '#9aa79f',
                borderPrimary: '#303a34',
                surface2: '#222b25',
                surface3: '#394a3a',
                buttonBackground: '#b8e8c9',
                buttonHoverBackground: '#a5d8b7',
                textButton: '#14291d',
              },
      },
    },
    content: {
      kind: 'transaction',
      review: { model: display, tree: buildDisplayTreeFromModel(display) },
      header: {
        heading: example === 'transfer' ? 'Review your transfer' : 'Review contract call',
        website: { kind: 'ready', text: 'preview.local' },
        chainDetails: { kind: 'ready', text: example === 'near' ? 'NEAR' : 'Base' },
      },
      body: { kind: 'empty' },
      prompt: { kind: 'passkey' },
      transaction: {
        tree: null,
        theme,
        explorers: explorerUrls(),
        decision: { kind: 'ready', onConfirm: confirm },
        confirmText: 'Confirm with passkey',
        cancelText: 'Cancel',
        onCancel: dismiss,
      },
    },
  };
}
function review() {
  handle?.dispose();
  view = 'expanded';
  handle = mountConfirmationSurface({
    parent,
    presentation: { variant: 'modal', context: 'wallet-iframe' },
    model: model(),
    onClosed: closed,
  });
  status.textContent = 'Review — simulated transfer';
}
function renderReceipt() {
  handle.showReceipt({ state, view, onView: changeView, onDismiss: dismiss });
}
function showStage(stage) {
  if (stage === 'review') {
    review();
    return;
  }
  if (!handle?.element.isConnected) review();
  if (stage === 'submitted' || stage === 'confirmed')
    state = {
      kind: stage,
      hash: '0x7a4b000000000000000000000000000000000000000000000000000000000091c2',
    };
  else if (stage === 'failed')
    state = {
      kind: 'failed',
      hash: null,
      message: 'Simulated broadcast failure. Nothing was sent.',
    };
  else state = { kind: stage };
  renderReceipt();
  status.textContent = `Simulated stage: ${stage}`;
}
function selectStage(event) {
  showStage(event.currentTarget.dataset.stage);
}
function selectExample(event) {
  example = event.currentTarget.dataset.example;
  review();
  const disclosure = parent.querySelector('summary');
  if (disclosure) disclosure.click();
  status.textContent = `Simulated ${example} example — no transaction is sent`;
}
function minimize() {
  if (!handle?.element.isConnected) review();
  changeView('toast');
}
function toggleTheme() {
  theme = theme === 'light' ? 'dark' : 'light';
  handle?.update(model());
}
for (const button of document.querySelectorAll('[data-stage]'))
  button.addEventListener('click', selectStage);
document.querySelector('#minimize').addEventListener('click', minimize);
document.querySelector('#theme').addEventListener('click', toggleTheme);
for (const button of document.querySelectorAll('[data-example]')) button.addEventListener('click', selectExample);
review();
