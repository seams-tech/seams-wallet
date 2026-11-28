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
import type { CheckoutLocale } from '../shared/api';
import type { CheckoutMethod } from '../shared/methods';
import {
  CHECKOUT_FRAME_WIDTH_CSS_PX,
  CHECKOUT_PROTOCOL,
  parseFrameMessage,
  parseTheme,
  type CheckoutLayout,
  type CheckoutStatus,
  type CheckoutTheme,
  type OpenMessage,
} from '../shared/protocol';

export type { CheckoutLocale } from '../shared/api';
export type { CheckoutMethod } from '../shared/methods';
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

export type Checkout = {
  /** Opens the checkout in a dialog. The promise settles when the dialog closes. */
  open(options: CheckoutOptions): Promise<CheckoutResult>;
  /** Puts the checkout into an element of the page. */
  mount(element: HTMLElement, options: CheckoutOptions): MountedCheckout;
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
    permissions: [],
  });

  /**
   * Connects to the frame and gives it the checkout to show. The frame loads a new document
   * when a provider sends the customer back, so each new document gets the same message.
   * Returns a function that stops the session.
   */
  function run(session: Session): () => void {
    const abort = new AbortController();
    let connection: FrameConnection | null = null;
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
        else session.onSize(message.stage, message.heightCssPx);
      };
      connection.onClosed(() => void connect());
      connection.port.postMessage(open);
    };
    void connect();
    return () => {
      abort.abort();
      connection?.close();
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
        const stop = run({
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

    mount(element, options) {
      const frame = createFrame(element, frameSpec(options.locale ?? 'en'));
      frame.style.cssText = 'display:block;width:100%;height:0;border:0;';
      let settle: (result: CheckoutResult) => void = () => {};
      const result = new Promise<CheckoutResult>((resolve) => {
        settle = resolve;
      });
      const stage = secureRandomId('inline', 16);
      const stop = run({
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
