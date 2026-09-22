import type { ConfirmationConfig } from '../../core/types/signer-worker';
import type { SeamsWeb } from '../../SeamsWeb';
import {
  getTransactionReviewBridge,
  type TransactionReviewCapabilities,
} from '../../SeamsWeb/publicApi/transactionReview';
import type { TransactionReviewReservation } from '../../SeamsWeb/walletIframe/client/transactionReviewReservation';
import { assertTransactionReviewValid } from '../../SeamsWeb/walletIframe/shared/transactionReview';
import {
  TransactionReviewError,
  type TransactionReview,
  type TransactionReviewControls,
} from './contract';

export type ReviewCallState =
  | { readonly kind: 'queued'; readonly reservation?: never; readonly error?: never }
  | {
      readonly kind: 'reviewing';
      readonly reservation: TransactionReviewReservation;
      readonly error?: never;
    }
  | {
      readonly kind: 'review_failed';
      readonly reservation: TransactionReviewReservation;
      readonly error: TransactionReviewError;
    }
  | {
      readonly kind: 'preparing_approval';
      readonly reservation: TransactionReviewReservation;
      readonly error?: never;
    }
  | {
      readonly kind: 'wallet_approval';
      readonly reservation: TransactionReviewReservation;
      readonly error?: never;
    }
  | {
      readonly kind: 'signing';
      readonly reservation: TransactionReviewReservation;
      readonly error?: never;
    }
  | { readonly kind: 'settled'; readonly reservation?: never; readonly error?: never };

export interface ReviewCallView {
  readonly review: TransactionReview;
  readonly controls: TransactionReviewControls;
  readonly subscribe: (listener: () => void) => () => void;
  readonly snapshot: () => ReviewCallState;
  dispose(): void;
  loadingTimedOut(): void;
}

const hosts = new WeakMap<object, ReviewHostController>();

export class ReviewOwner {
  private generation = 0;
  private disposed = false;
  readonly calls = new Set<ReviewCallView>();

  retain(): () => void {
    this.disposed = false;
    const generation = ++this.generation;
    return this.release.bind(this, generation);
  }

  private release(generation: number): void {
    queueMicrotask(this.dispose.bind(this, generation));
  }

  private dispose(generation: number): void {
    if (generation !== this.generation) return;
    this.disposed = true;
    for (const call of this.calls) call.dispose();
  }

  assertLive(): void {
    if (this.disposed)
      throw new TransactionReviewError(
        'review_owner_disposed',
        'This useWallet instance has been disposed',
      );
  }
}

export class ReviewHostController {
  private live = false;
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  private readonly calls = new Set<ReviewCallView>();
  private view: ReviewCallView | null = null;

  constructor(readonly seams: SeamsWeb) {}

  retain(): () => void {
    const existing = hosts.get(this.seams.near);
    if (existing && existing !== this) {
      throw new TransactionReviewError(
        'review_host_unavailable',
        'Only one TransactionReviewHost may register per SeamsWeb instance',
      );
    }
    hosts.set(this.seams.near, this);
    this.live = true;
    return this.release.bind(this, ++this.generation);
  }

  private release(generation: number): void {
    queueMicrotask(this.dispose.bind(this, generation));
  }

  private dispose(generation: number): void {
    if (this.generation !== generation) return;
    this.live = false;
    if (hosts.get(this.seams.near) === this) hosts.delete(this.seams.near);
    for (const call of this.calls) call.dispose();
    this.view = null;
    this.emit();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return this.unsubscribe.bind(this, listener);
  };
  private unsubscribe(listener: () => void): void {
    this.listeners.delete(listener);
  }
  readonly snapshot = (): ReviewCallView | null => this.view;

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  show(call: ReviewCallView): void {
    this.view = call;
    this.emit();
  }
  hide(call: ReviewCallView): void {
    if (this.view === call) {
      this.view = null;
      this.emit();
    }
  }
  remove(call: ReviewCallView): void {
    this.calls.delete(call);
    this.hide(call);
  }

  async run<T>(
    owner: ReviewOwner,
    walletId: string,
    review: TransactionReview,
    confirmationConfig: Partial<ConfirmationConfig> | undefined,
    execute: (capabilities: TransactionReviewCapabilities) => Promise<T>,
  ): Promise<T> {
    owner.assertLive();
    if (!this.live)
      throw new TransactionReviewError(
        'review_host_unavailable',
        'Mount TransactionReviewHost inside SeamsWebProvider before reviewing a transaction',
      );
    const bridge = getTransactionReviewBridge(this.seams.near);
    if (!bridge || !bridge.getWalletIframe().shouldUseWalletIframe()) {
      throw new TransactionReviewError(
        'review_unsupported_mode',
        'Transaction review requires the hosted wallet iframe',
      );
    }
    const call = new ReviewCall(this, owner, walletId, review, confirmationConfig, execute);
    this.calls.add(call);
    owner.calls.add(call);
    void call.start();
    return call.result;
  }
}

export class ReviewCall<T> {
  private state: ReviewCallState = { kind: 'queued' };
  private readonly abort = new AbortController();
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private prepareTimer: ReturnType<typeof setTimeout> | null = null;
  private resolve!: (value: T) => void;
  private reject!: (error: unknown) => void;
  private readonly listeners = new Set<() => void>();
  readonly result: Promise<T>;
  readonly controls: TransactionReviewControls;

  constructor(
    private readonly host: ReviewHostController,
    private readonly owner: ReviewOwner,
    private readonly walletId: string,
    readonly review: TransactionReview,
    private readonly confirmationConfig: Partial<ConfirmationConfig> | undefined,
    private readonly execute: (capabilities: TransactionReviewCapabilities) => Promise<T>,
  ) {
    this.result = new Promise<T>(this.captureResult);
    this.controls = Object.freeze({
      continueToWallet: this.continueToWallet,
      cancel: this.cancel,
      fail: this.fail,
    });
  }

  private readonly captureResult = (
    resolve: (value: T) => void,
    reject: (error: unknown) => void,
  ): void => {
    this.resolve = resolve;
    this.reject = reject;
  };
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return this.unsubscribe.bind(this, listener);
  };
  private unsubscribe(listener: () => void): void {
    this.listeners.delete(listener);
  }
  readonly snapshot = (): ReviewCallState => this.state;
  private transition(state: ReviewCallState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  async start(): Promise<void> {
    try {
      document.addEventListener('visibilitychange', this.checkDeadline);
      this.scheduleDeadline();
      if (this.state.kind === 'settled') return;
      const bridge = getTransactionReviewBridge(this.host.seams.near);
      if (!bridge)
        throw new TransactionReviewError('review_host_unavailable', 'Review host is unavailable');
      const router = await bridge.getWalletIframe().requireTransportRouter();
      const reservation = await router.reserveTransactionReview({
        walletId: this.walletId,
        title: this.review.title,
        validity: this.review.validity,
        confirmationConfig: this.confirmationConfig,
        signal: this.abort.signal,
        onCancel: this.rejectBeforeDispatch,
      });
      if (this.state.kind !== 'queued') {
        reservation.finish();
        return;
      }
      this.owner.assertLive();
      this.transition({ kind: 'reviewing', reservation });
      reservation.subscribe(this.reservationChanged);
      this.host.show(this);
    } catch (error) {
      this.rejectBeforeDispatch(error);
    }
  }

  private readonly reservationChanged = (): void => {
    if (this.state.kind === 'queued' || this.state.kind === 'settled') return;
    const reservation = this.state.reservation;
    if (reservation.state.kind === 'wallet_approval' || reservation.state.kind === 'signing') {
      if (this.prepareTimer) clearTimeout(this.prepareTimer);
      this.prepareTimer = null;
      this.transition({
        kind: reservation.state.kind === 'signing' ? 'signing' : 'wallet_approval',
        reservation,
      });
      this.host.hide(this);
    }
  };

  readonly continueToWallet = (): void => {
    if (this.state.kind !== 'reviewing') return;
    try {
      this.owner.assertLive();
      assertTransactionReviewValid(this.review.validity);
      const reservation = this.state.reservation;
      this.transition({ kind: 'preparing_approval', reservation });
      this.prepareTimer = setTimeout(this.prepareTimedOut, 30_000);
      void this.dispatch(reservation);
    } catch (error) {
      this.rejectBeforeDispatch(error);
    }
  };

  private async dispatch(reservation: TransactionReviewReservation): Promise<void> {
    try {
      const bridge = getTransactionReviewBridge(this.host.seams.near);
      if (!bridge)
        throw new TransactionReviewError('review_host_unavailable', 'Review host is unavailable');
      const result = await this.execute(bridge.createCapabilities(reservation));
      this.resolve(result);
    } catch (error) {
      this.reject(error);
    } finally {
      this.finish();
    }
  }

  readonly cancel = (): void => {
    if (this.state.kind === 'review_failed') {
      this.rejectBeforeDispatch(this.state.error);
      return;
    }
    if (this.state.kind !== 'reviewing') return;
    this.rejectBeforeDispatch(
      new TransactionReviewError('cancelled', 'Transaction review cancelled'),
    );
  };

  readonly fail = (cause: unknown): void => {
    if (this.state.kind !== 'reviewing') return;
    const error = new TransactionReviewError(
      'review_render_failed',
      'The application review could not be displayed',
      { cause },
    );
    this.transition({ kind: 'review_failed', reservation: this.state.reservation, error });
  };

  dispose(): void {
    this.cancelOutstanding(
      new TransactionReviewError(
        'review_owner_disposed',
        'The transaction review owner was disposed',
      ),
    );
  }

  readonly loadingTimedOut = (): void => {
    if (this.state.kind !== 'reviewing') return;
    this.rejectBeforeDispatch(
      new TransactionReviewError(
        'review_prepare_timeout',
        'The application review did not finish loading',
      ),
    );
  };

  private readonly prepareTimedOut = (): void => {
    this.cancelOutstanding(
      new TransactionReviewError(
        'review_prepare_timeout',
        'Wallet approval could not be prepared in time',
      ),
    );
  };

  private readonly checkDeadline = (): void => {
    try {
      assertTransactionReviewValid(this.review.validity);
    } catch (error) {
      this.cancelOutstanding(error instanceof Error ? error : new Error(String(error)));
    }
  };

  private readonly scheduleDeadline = (): void => {
    if (this.review.validity.kind === 'unbounded' || this.state.kind === 'settled') return;
    const remaining = this.review.validity.atMs - Date.now();
    if (remaining <= 0) {
      this.checkDeadline();
      return;
    }
    this.deadline = setTimeout(this.scheduleDeadline, Math.min(remaining, 2_147_483_647));
  };

  private cancelOutstanding(error: Error): void {
    if (this.state.kind === 'settled' || this.state.kind === 'signing') return;
    if (
      this.state.kind === 'queued' ||
      this.state.kind === 'reviewing' ||
      this.state.kind === 'review_failed'
    ) {
      this.rejectBeforeDispatch(error);
    } else this.state.reservation.cancel(error);
  }

  private readonly rejectBeforeDispatch = (error: unknown): void => {
    if (this.state.kind === 'settled') return;
    this.abort.abort(error);
    this.reject(error);
    this.finish();
  };

  private finish(): void {
    if (this.state.kind === 'settled') return;
    const previous = this.state;
    this.transition({ kind: 'settled' });
    if (this.deadline) clearTimeout(this.deadline);
    if (this.prepareTimer) clearTimeout(this.prepareTimer);
    document.removeEventListener('visibilitychange', this.checkDeadline);
    this.owner.calls.delete(this);
    this.host.remove(this);
    if (previous.kind !== 'queued') previous.reservation.finish();
    this.listeners.clear();
  }
}
