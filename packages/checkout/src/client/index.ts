import {
  FrameConnectError,
  connectFrame,
  createFrame,
  createStageDialog,
  isCurrentStageMessage,
  isStageHost,
  type FrameConnection,
  type FrameSpec,
  type StageHost,
} from '../../../frame-kit/src/index';
import { secureRandomId } from '@shared/utils/secureRandomId';
import type { Variant } from '@shared/utils/variant';
import type { CheckoutLocale, CheckoutSession, MethodOption } from '../shared/api';
import type { CheckoutMethod, CustomerDetails, NextStep } from '../shared/methods';
import {
  CHECKOUT_FRAME_WIDTH_CSS_PX,
  CHECKOUT_PROTOCOL,
  parseFrameMessage,
  parseTheme,
  type CheckoutLayout,
  type CheckoutStatus,
  type CheckoutTheme,
  type FrameMessage,
  type OpenMessage,
  type PageCommand,
} from '../shared/protocol';

export type { CheckoutLocale, MethodOption } from '../shared/api';
export type { CheckoutMethod, CustomerDetails, NextStep } from '../shared/methods';
export type { CheckoutLayout, CheckoutTheme } from '../shared/protocol';
export type { StageHost } from '../../../frame-kit/src/index';

export type CheckoutConfig = {
  /** The origin that serves the checkout frame, for example `https://checkout.example.com`. */
  readonly checkoutOrigin: string;
  readonly publishableKey: string;
  /**
   * The dialog of the page, when another Seams package on the page already has one. Without it
   * the checkout makes its own dialog.
   */
  readonly stageHost?: StageHost;
};

export type CheckoutOptions = {
  /** The client token of the order, from `createOrder` on the merchant's server. */
  readonly clientToken: string;
  readonly layout?: CheckoutLayout;
  /** The order of the methods and a subset of the project's methods. */
  readonly methods?: readonly CheckoutMethod[];
  readonly theme?: CheckoutTheme;
  readonly locale?: CheckoutLocale;
};

/**
 * How a checkout ended in the browser. The merchant's server learns the final result from the
 * signed order event, not from this value.
 *
 * - `paid`: the payment is complete.
 * - `pending`: the payment waits for the customer or the provider.
 * - `cancelled`: the customer closed the checkout before a payment.
 * - `failed`: the order cannot be paid, for example because it expired.
 */
export type CheckoutResult = { readonly kind: 'paid' | 'pending' | 'cancelled' | 'failed' };

export type MountedCheckout = {
  /** Settles when the payment is complete or pending, or when the order cannot be paid. */
  readonly result: Promise<CheckoutResult>;
  /** Removes the checkout from the page. */
  unmount(): void;
};

type HeadlessMessage = Variant<FrameMessage, 'type', 'methods' | 'next_step' | 'error'>;

type HeadlessReady = {
  readonly order: CheckoutSession['order'];
  /** The methods that can pay this order, in the order of `options.methods` when it is given. */
  readonly methods: readonly MethodOption[];
};

/** What happens in a headless checkout. The page draws each one. */
export type HeadlessEvent =
  /** A voucher, bank details or a link to a wallet app. */
  | { readonly kind: 'next_step'; readonly method: CheckoutMethod; readonly step: NextStep }
  /** `pending`: the checkout waits for the provider or the customer. */
  | { readonly kind: 'status'; readonly status: 'open' | 'pending' | 'paid' | 'failed' }
  /**
   * The last command did not work. `code` is `declined`, `wallet_unavailable`, `no_method`,
   * or an error code of the checkout such as `details_required`. `message` is the provider's
   * text, when one exists.
   */
  | { readonly kind: 'error'; readonly code: string; readonly message: string | null };

/**
 * A checkout that the page draws. The frame in the page's element holds only the provider's
 * card fields or wallet button, so no provider script runs on the page.
 */
export type HeadlessCheckout = {
  readonly ready: Promise<HeadlessReady>;
  /**
   * Selects a method with the customer details that it needs. Card fields and a wallet button
   * appear in the frame at once. Another method starts at `pay`, because a start issues a
   * voucher.
   */
  select(method: CheckoutMethod, details?: CustomerDetails): void;
  /** Submits the card fields, or starts the selected method. */
  pay(): void;
  on(listener: (event: HeadlessEvent) => void): () => void;
  /** Settles when the order is paid, or when it cannot be paid. */
  readonly result: Promise<CheckoutResult>;
  unmount(): void;
};

export type Checkout = {
  /** Opens the checkout in a dialog. The promise settles when the dialog closes. */
  open(options: CheckoutOptions): Promise<CheckoutResult>;
  /** Puts the checkout into an element of the page. */
  mount(element: HTMLElement, options: CheckoutOptions): MountedCheckout;
  /** Puts only the provider's part into an element. The page draws the rest. */
  headless(element: HTMLElement, options: CheckoutOptions): HeadlessCheckout;
};

const RESULTS: Readonly<Record<CheckoutStatus, CheckoutResult['kind']>> = {
  open: 'cancelled',
  confirming: 'pending',
  pending: 'pending',
  paid: 'paid',
  failed: 'failed',
};

type Session = {
  readonly frame: HTMLIFrameElement;
  readonly stage: string;
  readonly presentation: OpenMessage['presentation'];
  readonly options: CheckoutOptions;
  /** A size from the frame, with the stage that the frame names. */
  onSize(stage: string, heightCssPx: number): void;
  /** The messages of a headless frame. */
  onHeadless?(message: HeadlessMessage): void;
  onStatus(status: CheckoutStatus): void;
  onClose(): void;
};

export function createCheckout(config: CheckoutConfig): Checkout {
  const checkoutOrigin = new URL(config.checkoutOrigin).origin;
  if (config.stageHost !== undefined && !isStageHost(config.stageHost)) {
    throw new Error('stageHost is not a stage host of this frame kit version');
  }
  let ownDialog: StageHost | null = null;
  const stageHost = (): StageHost => config.stageHost ?? (ownDialog ??= createStageDialog());
  const frameSpec = (locale: CheckoutLocale): FrameSpec => ({
    url: `${checkoutOrigin}/`,
    title: locale === 'ja' ? 'お支払い' : 'Checkout',
    // Apple Pay and Google Pay need the payment permission on each frame of the chain.
    permissions: ['payment'],
  });

  /**
   * Connects to the frame and gives it the checkout to show. The frame loads a new document
   * when a provider sends the customer back, so each new document gets the same message.
   * Returns a function that stops the session.
   */
  function run(session: Session): { stop(): void; post(command: PageCommand): void } {
    const abort = new AbortController();
    let connection: FrameConnection | null = null;
    /** Commands that wait for the connection. */
    const waiting: PageCommand[] = [];
    const { options } = session;
    const open: OpenMessage = {
      type: 'open',
      publishableKey: config.publishableKey,
      clientToken: options.clientToken,
      stage: session.stage,
      presentation: session.presentation,
      layout: options.layout ?? 'list',
      methods: options.methods ? [...options.methods] : null,
      theme: parseTheme(options.theme),
      locale: options.locale ?? 'en',
    };
    const connect = async (): Promise<void> => {
      while (!abort.signal.aborted) {
        try {
          connection = await connectFrame(session.frame, {
            protocol: CHECKOUT_PROTOCOL,
            signal: abort.signal,
          });
          break;
        } catch (error) {
          // After a timeout the page tries again. A frame of another version never answers.
          if (error instanceof FrameConnectError && error.code !== 'timeout') {
            if (error.code !== 'aborted') {
              session.onStatus('failed');
              session.onClose();
            }
            return;
          }
        }
      }
      if (!connection || abort.signal.aborted) return;
      connection.port.onmessage = (event: MessageEvent) => {
        const message = parseFrameMessage(event.data);
        if (!message) return;
        if (message.type === 'close') session.onClose();
        else if (message.type === 'status') session.onStatus(message.status);
        else if (message.type === 'size') session.onSize(message.stage, message.heightCssPx);
        else session.onHeadless?.(message);
      };
      connection.onClosed(() => void connect());
      connection.port.postMessage(open);
      for (const command of waiting.splice(0)) connection.port.postMessage(command);
    };
    void connect();
    return {
      stop() {
        abort.abort();
        connection?.close();
      },
      post(command) {
        if (connection) connection.port.postMessage(command);
        else waiting.push(command);
      },
    };
  }

  return {
    open(options) {
      const host = stageHost();
      const locale = options.locale ?? 'en';
      const spec = frameSpec(locale);
      const frame = host.createFrame(spec);
      return new Promise<CheckoutResult>((resolve) => {
        let status: CheckoutStatus = 'open';
        const finish = (): void => {
          stop();
          stage.close();
          frame.remove();
          resolve({ kind: RESULTS[status] });
        };
        const stage = host.show({
          content: { kind: 'frame', frame },
          title: spec.title,
          presentation: 'modal',
          onDismiss: finish,
        });
        const { stop } = run({
          frame,
          stage: stage.instance,
          presentation: 'modal',
          options,
          onSize(named, heightCssPx) {
            if (!isCurrentStageMessage(stage, named)) return;
            stage.resize({ widthCssPx: CHECKOUT_FRAME_WIDTH_CSS_PX, heightCssPx });
          },
          onStatus(next) {
            status = next;
          },
          onClose: finish,
        });
      });
    },

    headless(element, options) {
      const frame = createFrame(element, frameSpec(options.locale ?? 'en'));
      frame.style.cssText = 'display:block;width:100%;height:0;border:0;';
      const listeners = new Set<(event: HeadlessEvent) => void>();
      const emit = (event: HeadlessEvent): void => listeners.forEach((listener) => listener(event));
      let settle: (result: CheckoutResult) => void = () => {};
      const result = new Promise<CheckoutResult>((resolve) => {
        settle = resolve;
      });
      let ready: (value: HeadlessReady) => void = () => {};
      const readyPromise = new Promise<HeadlessReady>((resolve) => {
        ready = resolve;
      });
      const stage = secureRandomId('headless', 16);
      const session = run({
        frame,
        stage,
        presentation: 'headless',
        options,
        onSize(named, heightCssPx) {
          if (named === stage) frame.style.height = `${Math.ceil(heightCssPx)}px`;
        },
        onStatus(status) {
          emit({ kind: 'status', status: status === 'confirming' ? 'pending' : status });
          if (status === 'paid' || status === 'failed') settle({ kind: RESULTS[status] });
        },
        onClose() {},
        onHeadless(message) {
          if (message.type === 'methods') ready({ order: message.order, methods: message.methods });
          else if (message.type === 'next_step') emit({ kind: 'next_step', method: message.method, step: message.step });
          else emit({ kind: 'error', code: message.code, message: message.message });
        },
      });
      return {
        ready: readyPromise,
        result,
        select: (method, details = {}) => session.post({ type: 'select', method, details }),
        pay: () => session.post({ type: 'pay' }),
        on(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        unmount() {
          session.stop();
          frame.remove();
          settle({ kind: 'cancelled' });
        },
      };
    },

    mount(element, options) {
      const frame = createFrame(element, frameSpec(options.locale ?? 'en'));
      frame.style.cssText = 'display:block;width:100%;height:0;border:0;';
      let settle: (result: CheckoutResult) => void = () => {};
      const result = new Promise<CheckoutResult>((resolve) => {
        settle = resolve;
      });
      const stage = secureRandomId('inline', 16);
      const { stop } = run({
        frame,
        stage,
        presentation: 'inline',
        options,
        onSize(named, heightCssPx) {
          if (named === stage) frame.style.height = `${Math.ceil(heightCssPx)}px`;
        },
        onStatus(status) {
          if (status !== 'open' && status !== 'confirming') settle({ kind: RESULTS[status] });
        },
        onClose() {},
      });
      return {
        result,
        unmount() {
          stop();
          frame.remove();
          settle({ kind: 'cancelled' });
        },
      };
    },
  };
}
