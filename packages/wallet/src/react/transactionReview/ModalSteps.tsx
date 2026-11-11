import {
  Component,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  registerWalletModalStepsPresenter,
  type WalletModalStepsCall,
  type WalletModalStepsPresenter,
} from '../../SeamsWeb/publicApi/walletModalSteps';
import {
  WALLET_STEPS_MODAL_CLASS,
  clearTransactionReviewAppearance,
  prepareWalletStepsModal,
} from '../../SeamsWeb/walletIframe/client/overlay/overlay-styles';
import type { WalletStepExit } from '../../SeamsWeb/walletIframe/shared/walletStep';
import { SentWalletStep, type WalletStepOutcome } from '../components/WalletStep';
import { TransactionReviewError } from './contract';

type Stage =
  | Readonly<{ kind: 'before' }>
  | Readonly<{ kind: 'wallet'; attempt: number; heldHeight: number; ready: boolean }>
  | Readonly<{ kind: 'after'; outcome: unknown }>
  | Readonly<{ kind: 'closed' }>;

type Settle = Readonly<{ resolve: (value: unknown) => void; reject: (error: unknown) => void }>;

// A card that ended without its exit event (it failed before it was placed) closes the modal.
const EXIT_LIMIT_MS = 1_500;

/**
 * One flow in the SDK's modal: the app's steps around one Wallet card. The call's promise settles
 * once: with the card's result, or with the call's cancelled result when the person leaves first.
 */
class ModalStepsFlow {
  private current: Stage;
  private attempt = 0;
  private settled = false;
  private dismissed: 'back' | 'closed' | null = null;
  private exitTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();
  /** The modal's height now, which the Wallet step keeps until its card has a size. */
  measure: () => number = () => 0;
  /** Moves focus to the modal's heading. */
  focus: () => void = () => {};

  constructor(
    readonly call: WalletModalStepsCall<unknown>,
    private readonly promise: Settle,
    private readonly ended: (flow: ModalStepsFlow) => void,
  ) {
    this.current = call.steps.before ? { kind: 'before' } : this.walletStage(0);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = (): Stage => this.current;

  /** Back returns to the app's step before the card. Close ends the modal. */
  get chrome(): 'back_and_close' | 'close' {
    return this.call.steps.before ? 'back_and_close' : 'close';
  }

  readonly beforeControls = Object.freeze({
    continueToWallet: () => {
      if (this.current.kind !== 'before') return;
      this.dismissed = null;
      this.set(this.walletStage(this.measure()));
    },
    cancel: () => this.cancel(),
  });

  readonly afterControls = Object.freeze({ close: () => this.close() });

  /** Escape, the before step's Cancel, a render failure or the host's unmount. */
  cancel(): void {
    if (this.current.kind === 'after') {
      this.close();
      return;
    }
    this.settle({ kind: 'result', result: this.call.cancelled });
    this.close();
  }

  fail(error: unknown): void {
    this.settle({
      kind: 'error',
      error: new TransactionReviewError('review_render_failed', String(error)),
    });
    this.close();
  }

  cardReady(attempt: number): void {
    if (this.current.kind === 'wallet' && this.current.attempt === attempt) {
      this.set({ ...this.current, ready: true });
    }
  }

  /** The app's step shows again under the fading card, with its state kept. */
  cardBack(attempt: number): void {
    if (attempt !== this.attempt || this.current.kind !== 'wallet') return;
    this.dismissed = 'back';
    this.set({ kind: 'before' });
  }

  cardClosed(attempt: number): void {
    if (attempt === this.attempt) this.dismissed = 'closed';
  }

  cardOutcome(attempt: number, outcome: WalletStepOutcome<unknown>): void {
    if (attempt !== this.attempt || this.dismissed === 'back' || this.current.kind !== 'wallet') {
      return;
    }
    this.settle(outcome);
    if (this.dismissed === 'closed') {
      this.close();
      return;
    }
    // The modal's own surface shows again while the card fades out.
    this.set({ ...this.current, ready: false });
    this.exitTimer = setTimeout(
      this.cardExit.bind(this, attempt, { kind: 'failed' }),
      EXIT_LIMIT_MS,
    );
  }

  cardExit(attempt: number, exit: WalletStepExit): void {
    if (attempt !== this.attempt) return;
    if (exit.kind === 'back') {
      if (this.current.kind === 'before') this.focus();
      return;
    }
    if (!this.settled || this.current.kind !== 'wallet') return;
    this.clearExitTimer();
    const { after } = this.call.steps;
    if (exit.kind === 'completed' && after && this.result?.kind === 'result') {
      this.set({ kind: 'after', outcome: this.result.result });
      return;
    }
    this.close();
  }

  close(): void {
    if (this.current.kind === 'closed') return;
    this.clearExitTimer();
    this.settle({ kind: 'result', result: this.call.cancelled });
    this.set({ kind: 'closed' });
    this.listeners.clear();
    this.ended(this);
  }

  private result: WalletStepOutcome<unknown> | null = null;

  private settle(outcome: WalletStepOutcome<unknown>): void {
    if (this.settled) return;
    this.settled = true;
    this.result = outcome;
    if (outcome.kind === 'error') this.promise.reject(outcome.error);
    else this.promise.resolve(outcome.kind === 'result' ? outcome.result : outcome.outcome);
  }

  private walletStage(heldHeight: number): Stage {
    this.attempt += 1;
    return { kind: 'wallet', attempt: this.attempt, heldHeight, ready: false };
  }

  private set(stage: Stage): void {
    this.current = stage;
    for (const listener of this.listeners) listener();
  }

  private clearExitTimer(): void {
    if (this.exitTimer) clearTimeout(this.exitTimer);
    this.exitTimer = null;
  }
}

/** Shows the modal steps of one SeamsWeb instance, one flow at a time. */
export class ModalStepsController implements WalletModalStepsPresenter {
  private flow: ModalStepsFlow | null = null;
  private readonly listeners = new Set<() => void>();

  run<T>(call: WalletModalStepsCall<T>): Promise<T> {
    if (this.flow) {
      return Promise.reject(
        new TransactionReviewError('review_host_unavailable', 'The Wallet modal shows other steps'),
      );
    }
    return new Promise<T>((resolve, reject) => {
      this.flow = new ModalStepsFlow(
        call as WalletModalStepsCall<unknown>,
        { resolve: resolve as (value: unknown) => void, reject },
        this.ended,
      );
      this.notify();
    });
  }

  /** Registers this controller for the SeamsWeb instance's key until the returned function runs. */
  attach(key: object): () => void {
    const unregister = registerWalletModalStepsPresenter(key, this);
    return () => {
      unregister();
      this.flow?.cancel();
    };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = (): ModalStepsFlow | null => this.flow;

  private readonly ended = (flow: ModalStepsFlow): void => {
    if (this.flow !== flow) return;
    this.flow = null;
    this.notify();
  };

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export function ModalStepsPortal({ controller }: { controller: ModalStepsController }): ReactNode {
  const flow = useSyncExternalStore(controller.subscribe, controller.snapshot, () => null);
  return flow ? createPortal(<ModalStepsDialog flow={flow} />, document.body) : null;
}

function ModalStepsDialog({ flow }: { flow: ModalStepsFlow }): ReactNode {
  const stage = useSyncExternalStore(flow.subscribe, flow.snapshot, flow.snapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const { steps } = flow.call;

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return undefined;
    flow.measure = () => body.current?.offsetHeight ?? 0;
    flow.focus = () => heading.current?.focus({ preventScroll: true });
    prepareWalletStepsModal(element, flow.call.appearance);
    if (!element.open) element.showModal();
    return () => {
      element.close();
      clearTransactionReviewAppearance(element);
    };
  }, [flow]);

  useLayoutEffect(() => {
    if (stage.kind === 'before' || stage.kind === 'after') flow.focus();
  }, [flow, stage.kind]);

  const onCancel = (event: SyntheticEvent<HTMLDialogElement>): void => {
    event.preventDefault();
    flow.cancel();
  };

  const wallet = stage.kind === 'wallet' ? stage : null;
  return (
    <dialog
      ref={dialog}
      className={`${WALLET_STEPS_MODAL_CLASS} ${steps.className ?? ''}`}
      data-seams-root=""
      aria-label={steps.title}
      data-wallet-card-ready={wallet?.ready ? '' : undefined}
      onCancel={onCancel}
    >
      <div ref={body}>
        <section className="seams-transaction-review-content" hidden={wallet !== null}>
          <h2 className="seams-transaction-review-title" tabIndex={-1} ref={heading}>
            {steps.title}
          </h2>
          {steps.before ? (
            <div hidden={stage.kind !== 'before'}>
              <StepBoundary flow={flow}>
                {steps.before(flow.beforeControls) as ReactNode}
              </StepBoundary>
            </div>
          ) : null}
          {stage.kind === 'after' && steps.after ? (
            <StepBoundary flow={flow}>
              {steps.after(stage.outcome, flow.afterControls) as ReactNode}
            </StepBoundary>
          ) : null}
        </section>
        {wallet ? (
          <SentWalletStep
            key={wallet.attempt}
            kind={flow.call.kind}
            send={flow.call.send}
            chrome={flow.chrome}
            initialHeight={wallet.heldHeight}
            onReady={() => flow.cardReady(wallet.attempt)}
            onBack={() => flow.cardBack(wallet.attempt)}
            onClose={() => flow.cardClosed(wallet.attempt)}
            onExit={(exit) => flow.cardExit(wallet.attempt, exit)}
            onOutcome={(outcome) => flow.cardOutcome(wallet.attempt, outcome)}
          />
        ) : null}
      </div>
    </dialog>
  );
}

class StepBoundary extends Component<
  { flow: ModalStepsFlow; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.props.flow.fail(error);
  }
  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
