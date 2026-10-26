import { isPlainObject } from '@shared/utils/validation';

export const INTEAR_ORIGIN = 'https://wallet.intear.tech';

/** One popup per request; origin and WindowProxy together bind every response. */
export class IntearPopup {
  private popup: Window | null;
  private sent = false;
  private settled = false;
  private ready = false;
  private payload: object | null = null;
  private resolveResult: (value: unknown) => void = ignoreResult;
  private rejectResult: (error: Error) => void = ignoreError;
  private interval: ReturnType<typeof setInterval>;
  private timeout: ReturnType<typeof setTimeout>;
  readonly result: Promise<unknown>;

  constructor(
    path: '/connect' | '/send-transactions',
    private readonly successType: 'connected' | 'sent',
  ) {
    this.popup = window.open(`${INTEAR_ORIGIN}${path}`, '_blank', 'popup,width=420,height=720');
    this.result = new Promise(this.captureResolvers);
    window.addEventListener('message', this.receive);
    this.interval = setInterval(this.checkClosed, 250);
    this.timeout = setTimeout(this.expire, 120000);
    if (!this.popup) this.fail(new Error('Allow popups to connect Intear Wallet.'));
  }
  private captureResolvers = (
    resolve: (value: unknown) => void,
    reject: (error: Error) => void,
  ): void => {
    this.resolveResult = resolve;
    this.rejectResult = reject;
  };
  send(payload: object): void {
    this.payload = payload;
    this.dispatch();
  }
  private dispatch(): void {
    if (!this.settled && this.ready && !this.sent && this.payload && this.popup) {
      this.sent = true;
      this.popup.postMessage(this.payload, INTEAR_ORIGIN);
    }
  }
  private receive = (event: MessageEvent<unknown>): void => {
    if (
      this.settled ||
      event.origin !== INTEAR_ORIGIN ||
      event.source !== this.popup ||
      !isPlainObject(event.data)
    )
      return;
    if (event.data.type === 'ready') {
      this.ready = true;
      this.dispatch();
      return;
    }
    if (!this.sent) return;
    if (event.data.type === 'error') {
      this.fail(new Error('Intear declined the request.'));
      return;
    }
    if (event.data.type === this.successType) {
      this.cleanup();
      this.resolveResult(event.data);
    }
  };
  private checkClosed = (): void => {
    if (this.popup?.closed) this.fail(new Error('Intear popup closed.'));
  };
  private expire = (): void => {
    this.fail(new Error('Intear request timed out.'));
  };
  fail(error: Error): void {
    if (!this.settled) {
      this.cleanup();
      this.rejectResult(error);
    }
  }
  private cleanup(): void {
    this.settled = true;
    clearInterval(this.interval);
    clearTimeout(this.timeout);
    window.removeEventListener('message', this.receive);
    this.popup?.close();
    this.popup = null;
    this.payload = null;
  }
}
function ignoreResult(_value: unknown): void {}
function ignoreError(_error: Error): void {}
