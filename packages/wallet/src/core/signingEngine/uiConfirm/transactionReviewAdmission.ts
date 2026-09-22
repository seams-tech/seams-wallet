import {
  assertTransactionReviewValid,
  sameTransactionReviewIdentity,
  TransactionReviewError,
  type TransactionReviewWire,
  type TransactionReviewStateMessage,
} from '@/SeamsWeb/walletIframe/shared/transactionReview';
import type { UiConfirmSurfaceMeasurementBinding } from './uiConfirm.types';
import { WalletIframeDomEvents } from '@/core/browser/walletIframe/events';

type AdmissionState =
  | { readonly kind: 'preparing' }
  | { readonly kind: 'prepared' }
  | { readonly kind: 'active' }
  | { readonly kind: 'signing' }
  | { readonly kind: 'cancelled'; readonly error: Error }
  | { readonly kind: 'settled' };

// The host registers before loading a runtime. Each flow captures its own entry.
const admissions = new Map<string, TransactionReviewAdmission>();

export class TransactionReviewAdmission {
  readonly abortController = new AbortController();
  private state: AdmissionState = { kind: 'preparing' };
  private element: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly metadata: TransactionReviewWire,
    private readonly signatureBoundary: 'mpc' | 'credential',
    private readonly post: (state: TransactionReviewStateMessage) => void,
    private readonly reject: (error: Error) => void,
  ) {
    assertTransactionReviewValid(metadata.validity);
    if (admissions.has(metadata.requestId)) {
      throw new TransactionReviewError('review_invalid_input', 'Duplicate reviewed request');
    }
    admissions.set(metadata.requestId, this);
    this.scheduleExpiry();
  }

  private notify(phase: TransactionReviewStateMessage['phase']): void {
    const identity = this.metadata;
    this.post({
      connectionId: identity.connectionId,
      requestId: identity.requestId,
      surfaceId: identity.surfaceId,
      generation: identity.generation,
      phase,
    });
  }

  private scheduleExpiry = (): void => {
    if (
      this.metadata.validity.kind === 'unbounded' ||
      this.state.kind === 'settled' ||
      this.state.kind === 'cancelled' ||
      this.state.kind === 'signing'
    )
      return;
    const remaining = this.metadata.validity.atMs - Date.now();
    if (remaining <= 0) {
      this.cancel(new TransactionReviewError('review_expired', 'This review has expired.'));
      return;
    }
    this.timer = setTimeout(this.scheduleExpiry, Math.min(remaining, 2_147_483_647));
  };

  attach(element: HTMLElement): void {
    if (this.element === element) return;
    this.observer?.disconnect();
    this.element = element;
    this.observer = new MutationObserver(this.prepared);
    this.observer.observe(element, { subtree: true, childList: true, attributes: true });
    element.inert = this.state.kind !== 'active' && this.state.kind !== 'signing';
    element.setAttribute('aria-hidden', String(element.inert));
    if (this.state.kind === 'cancelled' || this.state.kind === 'settled') {
      this.closeSurface();
      return;
    }
    if (this.state.kind === 'preparing') requestAnimationFrame(this.prepared);
  }

  private prepared = (): void => {
    if (
      this.state.kind !== 'preparing' ||
      !this.element?.isConnected ||
      this.element.dataset.seamsConfirmReady !== 'true'
    )
      return;
    this.observer?.disconnect();
    this.state = { kind: 'prepared' };
    this.notify('prepared');
  };

  activate(identity: TransactionReviewStateMessage): void {
    if (
      identity.phase !== 'activated' ||
      !sameTransactionReviewIdentity(this.metadata, identity) ||
      this.state.kind !== 'prepared'
    )
      return;
    try {
      assertTransactionReviewValid(this.metadata.validity);
    } catch (error) {
      this.cancel(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    this.state = { kind: 'active' };
    if (this.element) {
      this.element.inert = false;
      this.element.removeAttribute('aria-hidden');
      const focusTarget = this.element.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex="0"]',
      );
      focusTarget?.focus({ preventScroll: true });
    }
    this.notify('activated');
  }

  assertPending(): void {
    if (this.state.kind === 'cancelled') throw this.state.error;
    if (this.state.kind === 'settled')
      throw new TransactionReviewError('cancelled', 'The reviewed request has already settled');
  }

  assertActive(): void {
    if (this.state.kind === 'cancelled') throw this.state.error;
    if (this.state.kind !== 'active' && this.state.kind !== 'signing') {
      throw new TransactionReviewError('cancelled', 'Wallet approval is not active');
    }
    assertTransactionReviewValid(this.metadata.validity);
  }

  allowInteraction(): boolean {
    if (this.state.kind !== 'active' && this.state.kind !== 'signing') return false;
    try {
      this.assertActive();
      return true;
    } catch (error) {
      this.cancel(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  beforeCredential = (): void => {
    if (this.signatureBoundary === 'credential') this.beforeSigning();
    else this.assertActive();
  };

  afterCredential(): void {
    if (this.state.kind !== 'signing') this.assertActive();
  }

  beforeSigning = (): void => {
    this.assertActive();
    this.state = { kind: 'signing' };
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.notify('signing');
  };

  cancel(error: Error): boolean {
    if (this.state.kind === 'signing') {
      this.notify('signing');
      return false;
    }
    if (this.state.kind === 'settled' || this.state.kind === 'cancelled') return false;
    this.state = { kind: 'cancelled', error };
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.abortController.abort(error);
    this.closeSurface();
    this.notify('cancelled');
    return true;
  }

  private closeSurface(): void {
    if (!this.element) return;
    this.element.inert = true;
    this.element.dispatchEvent(new Event('cancel', { cancelable: true }));
    this.element.dispatchEvent(
      new CustomEvent(WalletIframeDomEvents.TX_CONFIRMER_CANCEL, { bubbles: true, composed: true }),
    );
  }

  get cancelled(): boolean {
    return this.state.kind === 'cancelled';
  }

  finish(): void {
    // Keep the lease until the cancelled operation has unwound its request context.
    if (this.state.kind === 'cancelled') this.reject(this.state.error);
    this.observer?.disconnect();
    this.observer = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.state = { kind: 'settled' };
    this.element = null;
    if (admissions.get(this.metadata.requestId) === this)
      admissions.delete(this.metadata.requestId);
  }
}

export function transactionReviewAdmission(
  requestId: string,
): TransactionReviewAdmission | undefined {
  return admissions.get(requestId);
}

export function reviewAdmissionForBinding(
  binding: UiConfirmSurfaceMeasurementBinding | undefined,
): TransactionReviewAdmission | undefined {
  return binding?.kind === 'wallet_iframe' ? binding.transactionReview : undefined;
}

export function cancelTransactionReviews(error: Error): void {
  for (const admission of admissions.values()) admission.cancel(error);
}
