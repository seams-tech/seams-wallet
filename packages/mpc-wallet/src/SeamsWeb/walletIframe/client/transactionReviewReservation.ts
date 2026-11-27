import type { ConfirmationConfig } from '@/core/types/signer-worker';
import type { WalletIframeTransactionSurfaceLease } from './surface/transactionSurfaceQueue';
import type { WalletIframeConnectionId, RequestSurfaceIdentity } from './surface/domain';
import {
  assertTransactionReviewValid,
  TransactionReviewError,
  type TransactionReviewValidity,
  type TransactionReviewWire,
} from '../shared/transactionReview';
import {
  assertAnchoredPresentation,
  type AnchoredWalletPresentation,
  type WalletSurfacePresentation,
} from '../shared/walletStep';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';

export type TransactionDispatch = ReadonlyExclusiveUnion<
  | { readonly kind: 'ordinary' }
  | {
      readonly kind: 'reviewed';
      readonly reservation: TransactionReviewReservation;
    }
  | {
      readonly kind: 'anchored';
      readonly presentation: AnchoredWalletPresentation;
    }
>;

/** A call that asks for an anchored card replaces an ordinary dispatch for that call. */
export function dispatchWithPresentation(
  dispatch: TransactionDispatch,
  presentation: WalletSurfacePresentation | undefined,
): TransactionDispatch {
  if (presentation === undefined || presentation.kind === 'modal') return dispatch;
  if (dispatch.kind === 'reviewed') {
    throw new TransactionReviewError(
      'review_invalid_input',
      'A reviewed transaction shows in the Wallet modal and takes no anchored presentation',
    );
  }
  return { kind: 'anchored', presentation: assertAnchoredPresentation(presentation) };
}

export type TransactionReviewReservationState = ReadonlyExclusiveUnion<
  | { readonly kind: 'reviewing' }
  | { readonly kind: 'reviewing_again' }
  | { readonly kind: 'preparing'; readonly prepared: boolean }
  | { readonly kind: 'activating' }
  | { readonly kind: 'wallet_approval' }
  | { readonly kind: 'signing' }
  /** The Wallet signed, and the app's after step shows the result in the same modal. */
  | { readonly kind: 'after' }
  | { readonly kind: 'settled' }
>;

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
    /** The app has a step after the Wallet's: the modal stays open for it. */
    readonly afterStep: boolean,
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

  /** The signed request settled: the app's after step takes the modal, when the app has one. */
  showAfter(): boolean {
    if (
      !this.afterStep ||
      (this.currentState.kind !== 'signing' && this.currentState.kind !== 'wallet_approval')
    ) {
      return false;
    }
    this.transition({ kind: 'after' });
    return true;
  }

  cancel(error: Error): void {
    // Escape or a disposed owner ends the after step; the signed result already settled.
    if (this.currentState.kind === 'after') {
      this.finish();
      return;
    }
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
