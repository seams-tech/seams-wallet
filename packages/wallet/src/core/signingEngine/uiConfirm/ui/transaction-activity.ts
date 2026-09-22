import { isWalletFlowEvent } from '@/core/types/sdkSentEvents';
import type { ChildToParentEnvelope, ParentToChildEnvelope } from '@/SeamsWeb/walletIframe/shared/messages';
import type { TransactionReceiptModel, TransactionReceiptState, TransactionReceiptView } from './transaction-receipt';

type ReceiptSurface = {
  readonly element: HTMLElement;
  showReceipt(model: TransactionReceiptModel): void;
  dispose(): void;
};

type Activity = {
  requestId: string;
  post: (message: ChildToParentEnvelope) => void;
  surface: ReceiptSurface | null;
  state: TransactionReceiptState;
  view: TransactionReceiptView;
  retained: boolean;
  signingHash: string | null;
};

// The hosted wallet has one foreground surface. A newer request replaces its receipt.
let activity: Activity | null = null;

export function beginTransactionActivity(request: ParentToChildEnvelope, post: Activity['post']): void {
  if (!request.requestId) return;
  switch (request.type) {
    case 'PM_SIGN_TX_WITH_ACTIONS': case 'PM_SIGN_AND_SEND_TX': case 'PM_EXECUTE_ACTION':
    case 'PM_SIGN_DELEGATE_ACTION': case 'PM_SIGN_NEP413': case 'PM_SIGN_TEMPO':
      activity?.surface?.dispose();
      activity = { requestId: request.requestId, post, surface: null, state: { kind: 'signing' }, view: 'expanded', retained: false, signingHash: null };
      return;
    default: return;
  }
}

export function retainTransactionActivity(requestId: string, surface: ReceiptSurface): boolean {
  if (!activity || activity.requestId !== requestId) return false;
  activity.surface = surface;
  activity.retained = true;
  publishActivity();
  return true;
}

function publishActivity(): void {
  if (!activity?.retained || !activity.surface) return;
  if (!activity.surface.element.isConnected) {
    activity = null;
    return;
  }
  activity.surface.showReceipt({ state: activity.state, view: activity.view, onView: changeView, onDismiss: dismissActivity });
  activity.post({ type: 'TRANSACTION_ACTIVITY', requestId: activity.requestId, payload: activity.view });
}

function changeView(view: TransactionReceiptView): void {
  if (!activity) return;
  activity.view = view;
  publishActivity();
}

function dismissActivity(): void {
  const current = activity;
  activity = null;
  current?.surface?.dispose();
  if (current?.retained) current.post({ type: 'TRANSACTION_ACTIVITY', requestId: current.requestId, payload: 'closed' });
}

export function setTransactionActivityView(requestId: string, view: 'toast' | 'closed'): void {
  if (activity?.requestId !== requestId) return;
  if (view === 'closed') dismissActivity();
  else changeView('toast');
}

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') return null;
  const field: unknown = Reflect.get(value, key);
  return typeof field === 'string' && field.length > 0 ? field : null;
}

export function observeTransactionActivity(message: ChildToParentEnvelope): void {
  if (!activity || message.requestId !== activity.requestId) return;
  if (message.type === 'PM_RESULT') {
    const result: unknown = message.payload?.result;
    activity.signingHash = stringField(result, 'rawTxHex');
    if (activity.state.kind === 'signing') activity.state = { kind: 'signed' };
    if (result && typeof result === 'object' && Reflect.get(result, 'success') === false) {
      activity.state = { kind: 'failed', hash: null, message: stringField(result, 'error') ?? 'The operation did not complete.' };
    }
    const nearReceipt = nearResultReceipt(result);
    if (nearReceipt) activity.state = nearReceipt;
  } else if (message.type === 'PROGRESS' && isWalletFlowEvent(message.payload) && message.payload.flow === 'signing') {
    const event = message.payload;
    const hash = stringField(event.data, 'txHash') ?? stringField(event.data, 'txId');
    if (activity.state.kind === 'confirmed' || activity.state.kind === 'reverted') return;
    switch (event.phase) {
      case 'signing.transaction.signed': activity.state = { kind: 'signed' }; break;
      case 'signing.broadcast.started': activity.state = { kind: 'broadcasting' }; break;
      case 'signing.broadcast.accepted': activity.state = { kind: 'submitted', hash }; break;
      case 'signing.receipt.finalized': activity.state = { kind: 'confirmed', hash }; break;
      case 'signing.receipt.reverted': activity.state = { kind: 'reverted', hash, message: 'The network reverted this transaction. Network fees may still apply.' }; break;
      case 'signing.failed': case 'signing.broadcast.rejected':
        activity.state = { kind: 'failed', hash, message: event.message }; break;
      default: return;
    }
  } else return;
  publishActivity();
}

export function failTransactionActivity(requestId: string | undefined, error: unknown): void {
  if (!activity || activity.requestId !== requestId) return;
  activity.state = { kind: 'failed', hash: null, message: error instanceof Error ? error.message : 'The operation did not complete.' };
  publishActivity();
}

export function transactionBroadcastStarted(signedTransaction: string): void {
  if (!activity || activity.signingHash !== signedTransaction || activity.state.kind !== 'signed') return;
  activity.state = { kind: 'broadcasting' };
  publishActivity();
}

function nearResultReceipt(value: unknown): TransactionReceiptState | null {
  if (!value || typeof value !== 'object') return null;
  const hash = stringField(value, 'transactionId');
  if (!hash) return null;
  const outcome: unknown = Reflect.get(value, 'result');
  const status: unknown = outcome && typeof outcome === 'object' ? Reflect.get(outcome, 'status') : null;
  if (status && typeof status === 'object') {
    if (Object.hasOwn(status, 'SuccessValue')) return { kind: 'confirmed', hash };
    if (Object.hasOwn(status, 'Failure')) return { kind: 'reverted', hash, message: 'The network could not execute this transaction. Network fees may still apply.' };
  }
  return { kind: 'unknown', hash, message: 'Submitted to the network. The response did not include a final execution outcome.' };
}

export function observeTransactionLifecycleReport(request: ParentToChildEnvelope): void {
  if (!activity?.signingHash) return;
  switch (request.type) {
    case 'PM_REPORT_TEMPO_BROADCAST_ACCEPTED':
    case 'PM_REPORT_TEMPO_BROADCAST_REJECTED':
    case 'PM_REPORT_TEMPO_FINALIZED':
    case 'PM_REPORT_TEMPO_DROPPED_OR_REPLACED': {
      const payload = request.payload;
      if (!payload || payload.signedResult.rawTxHex !== activity.signingHash) return;
      if (activity.state.kind === 'confirmed' || activity.state.kind === 'reverted') return;
      if (request.type === 'PM_REPORT_TEMPO_BROADCAST_ACCEPTED') activity.state = { kind: 'submitted', hash: request.payload?.txHash ?? null };
      else if (request.type === 'PM_REPORT_TEMPO_FINALIZED') {
        activity.state = request.payload?.receiptStatus === 'reverted'
          ? { kind: 'reverted', hash: request.payload.txHash ?? null, message: 'The network reverted this transaction. Network fees may still apply.' }
          : request.payload?.receiptStatus === 'success'
            ? { kind: 'confirmed', hash: request.payload.txHash ?? null }
            : { kind: 'unknown', hash: request.payload?.txHash ?? null, message: 'The network response did not include an execution status.' };
      } else activity.state = { kind: 'unknown', hash: null, message: 'The transaction did not complete as expected. Check its network status before retrying.' };
      publishActivity();
      return;
    }
    default: return;
  }
}
