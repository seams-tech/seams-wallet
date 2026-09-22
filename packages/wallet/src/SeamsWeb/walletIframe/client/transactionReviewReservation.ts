import type { ConfirmationConfig } from '@/core/types/signer-worker';
import type { WalletIframeTransactionSurfaceLease } from './surface/transactionSurfaceQueue';
import type { WalletIframeConnectionId, RequestSurfaceIdentity } from './surface/domain';
import {
  assertTransactionReviewValid,
  TransactionReviewError,
  type TransactionReviewValidity,
  type TransactionReviewWire,
} from '../shared/transactionReview';

export type TransactionDispatch =
  | { readonly kind: 'ordinary'; readonly reservation?: never }
  | { readonly kind: 'reviewed'; readonly reservation: TransactionReviewReservation };

export type TransactionReviewReservationState =
  | { readonly kind: 'reviewing'; readonly prepared?: never }
  | { readonly kind: 'reviewing_again'; readonly prepared?: never }
  | { readonly kind: 'preparing'; readonly prepared: boolean }
  | { readonly kind: 'activating'; readonly prepared?: never }
  | { readonly kind: 'wallet_approval'; readonly prepared?: never }
  | { readonly kind: 'signing'; readonly prepared?: never }
  | { readonly kind: 'settled'; readonly prepared?: never };

export class TransactionReviewReservation {
  private currentState: TransactionReviewReservationState = { kind: 'reviewing' };
  private readonly listeners = new Set<() => void>();
  readonly metadata: TransactionReviewWire;

  constructor(
    readonly connectionId: WalletIframeConnectionId,
    readonly identity: RequestSurfaceIdentity,
    readonly slot: HTMLElement,
    readonly title: string,
    validity: TransactionReviewValidity,
    readonly confirmationConfig: ConfirmationConfig,
    generation: number,
    private readonly lease: WalletIframeTransactionSurfaceLease,
    private readonly assertCurrent: () => void,
    private readonly cancelRequest: (error: Error) => void,
    private readonly finishRequest: () => void,
    private readonly resumeRequest: () => void,
  ) {
    this.metadata = Object.freeze({
      kind: 'transaction_review_v1',
      connectionId,
      requestId: identity.requestId,
      surfaceId: identity.surfaceId,
      generation,
      validity,
    });
  }

  get state(): TransactionReviewReservationState {
    return this.currentState;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return this.removeListener.bind(this, listener);
  }

  private removeListener(listener: () => void): void {
    this.listeners.delete(listener);
  }

  private transition(state: TransactionReviewReservationState): void {
    this.currentState = state;
    for (const listener of this.listeners) listener();
  }

  beginDispatch(): void {
    if (this.currentState.kind !== 'reviewing') {
      throw new TransactionReviewError(
        'review_owner_disposed',
        'This review is no longer available',
      );
    }
    this.assertCurrent();
    assertTransactionReviewValid(this.metadata.validity);
    this.transition({ kind: 'preparing', prepared: false });
  }

  prepared(): void {
    if (this.currentState.kind === 'preparing')
      this.transition({ kind: 'preparing', prepared: true });
  }

  activate(): boolean {
    if (this.currentState.kind !== 'preparing' || !this.currentState.prepared) return false;
    this.transition({ kind: 'activating' });
    return true;
  }

  activated(): void {
    if (this.currentState.kind === 'activating') this.transition({ kind: 'wallet_approval' });
  }

  returnToReview(): boolean {
    if (this.currentState.kind !== 'wallet_approval') return false;
    this.transition({ kind: 'reviewing_again' });
    return true;
  }

  resume(): void {
    if (this.currentState.kind !== 'reviewing_again') return;
    this.assertCurrent();
    assertTransactionReviewValid(this.metadata.validity);
    this.transition({ kind: 'preparing', prepared: true });
    this.resumeRequest();
  }

  signing(): void {
    if (this.currentState.kind === 'wallet_approval') this.transition({ kind: 'signing' });
  }

  cancel(error: Error): void {
    if (this.currentState.kind === 'settled' || this.currentState.kind === 'signing') return;
    this.cancelRequest(error);
  }

  finish(): void {
    if (this.currentState.kind === 'settled') return;
    this.transition({ kind: 'settled' });
    this.finishRequest();
    this.lease.release();
    this.listeners.clear();
  }
}
