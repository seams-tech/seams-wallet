export type TransactionReceiptState =
  | { kind: 'signing'; hash?: never; message?: never }
  | { kind: 'signed'; hash?: never; message?: never }
  | { kind: 'broadcasting'; hash?: never; message?: never }
  | { kind: 'submitted' | 'confirmed'; hash: string | null; message?: never }
  | { kind: 'failed' | 'reverted' | 'unknown'; hash: string | null; message: string };

export type TransactionReceiptView = 'expanded' | 'toast';

export type TransactionReceiptModel = {
  state: TransactionReceiptState;
  view: TransactionReceiptView;
  onView: (view: TransactionReceiptView) => void;
  onDismiss: () => void;
};

export function receiptIsPending(state: TransactionReceiptState): boolean {
  return state.kind === 'signing' || state.kind === 'broadcasting' || state.kind === 'submitted';
}

export function receiptCompletedStages(state: TransactionReceiptState): 0 | 1 | 2 | 3 {
  switch (state.kind) {
    case 'signing': return 0;
    case 'signed': case 'broadcasting': return 1;
    case 'submitted': case 'reverted': return 2;
    case 'confirmed': return 3;
    case 'failed': case 'unknown': return state.hash ? 2 : 0;
    default: return assertNever(state);
  }
}

export function receiptHeading(state: TransactionReceiptState): string {
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

export function receiptDescription(state: TransactionReceiptState): string {
  switch (state.kind) {
    case 'signing': return 'Preparing your signed transaction.';
    case 'signed': return 'Signature created. No network receipt has been received.';
    case 'broadcasting': return 'Submitting your signed transaction to the network.';
    case 'submitted': return 'Submitted to the network. Waiting for the receipt.';
    case 'confirmed': return 'The network confirmed your transaction.';
    case 'failed': case 'reverted': case 'unknown': return state.message;
    default: return assertNever(state);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected transaction receipt state: ${String(value)}`);
}
