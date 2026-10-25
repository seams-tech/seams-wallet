export type TransactionReceiptState =
  | { kind: 'signing'; hash?: never; message?: never }
  | { kind: 'signed'; hash?: never; message?: never }
  | { kind: 'broadcasting'; hash?: never; message?: never }
  | { kind: 'submitted' | 'confirmed'; hash: string | null; message?: never }
  | { kind: 'failed' | 'reverted' | 'unknown'; hash: string | null; message: string };

// A message signature (NEP-413) is the result itself: nothing is broadcast, so
// its receipt has no network stages to reach.
export type MessageReceiptState =
  | { kind: 'signing'; message?: never }
  | { kind: 'signed'; message?: never }
  | { kind: 'failed'; message: string };

export type ReceiptProgress =
  | { readonly subject: 'transaction'; readonly state: TransactionReceiptState }
  | { readonly subject: 'message'; readonly state: MessageReceiptState };

export type TransactionReceiptView = 'expanded' | 'toast';

export type TransactionReceiptModel = ReceiptProgress & {
  view: TransactionReceiptView;
  onView: (view: TransactionReceiptView) => void;
  onDismiss: () => void;
};

export function receiptIsPending(receipt: ReceiptProgress): boolean {
  const { kind } = receipt.state;
  return kind === 'signing' || kind === 'broadcasting' || kind === 'submitted';
}

export function receiptIsComplete(receipt: ReceiptProgress): boolean {
  return receipt.state.kind === 'confirmed' || receipt.state.kind === 'signed';
}

/** A message signature has one stage, so its toast fills at once when signed. */
export function receiptCompletedStages(receipt: ReceiptProgress): 0 | 1 | 2 | 3 {
  if (receipt.subject === 'message') return receipt.state.kind === 'signed' ? 3 : 0;
  const { state } = receipt;
  switch (state.kind) {
    case 'signing': return 0;
    case 'signed': case 'broadcasting': return 1;
    case 'submitted': case 'reverted': return 2;
    case 'confirmed': return 3;
    case 'failed': case 'unknown': return state.hash ? 2 : 0;
    default: return assertNever(state);
  }
}

export function receiptTitle(receipt: ReceiptProgress): string {
  return receipt.subject === 'message' ? 'Message signature' : 'Transaction receipt';
}

export function receiptHeading(receipt: ReceiptProgress): string {
  if (receipt.subject === 'message') return messageHeading(receipt.state);
  const { state } = receipt;
  switch (state.kind) {
    case 'signing': return 'Signing transaction';
    case 'signed': return 'Signature ready';
    case 'broadcasting': return 'Broadcasting transaction';
    case 'submitted': return 'Waiting for confirmation';
    case 'confirmed': return 'Transaction complete';
    case 'failed': return 'Transaction failed';
    case 'reverted': return 'Transaction reverted';
    case 'unknown': return 'Confirmation unavailable';
    default: return assertNever(state);
  }
}

export function receiptDescription(receipt: ReceiptProgress): string {
  if (receipt.subject === 'message') return messageDescription(receipt.state);
  const { state } = receipt;
  switch (state.kind) {
    case 'signing': return 'Preparing your signed transaction.';
    case 'signed': return 'Signature created, ready to broadcast.';
    case 'broadcasting': return 'Submitting your signed transaction to the network.';
    case 'submitted': return 'Submitted to the network. Waiting for the receipt.';
    case 'confirmed': return 'The network confirmed your transaction.';
    case 'failed': case 'reverted': case 'unknown': return state.message;
    default: return assertNever(state);
  }
}

function messageHeading(state: MessageReceiptState): string {
  switch (state.kind) {
    case 'signing': return 'Signing message';
    case 'signed': return 'Message signed';
    case 'failed': return 'Signature failed';
    default: return assertNever(state);
  }
}

function messageDescription(state: MessageReceiptState): string {
  switch (state.kind) {
    case 'signing': return 'Preparing your message signature.';
    case 'signed': return 'Signed off-chain. Nothing was sent to the network.';
    case 'failed': return state.message;
    default: return assertNever(state);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected transaction receipt state: ${String(value)}`);
}
