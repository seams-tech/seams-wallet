import { isPlainObject } from '../../../packages/shared-ts/src/utils/validation';

const BrowserWorker = Worker;

class PreparationObservedWorker extends BrowserWorker {
  private readonly preparations = new Set<string>();

  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    if (new URL(String(url), location.href).pathname.endsWith('/email-otp.worker.js')) {
      this.addEventListener('message', this.observePreparation.bind(this));
    }
  }

  override postMessage(
    message: unknown,
    transfer: Transferable[] | StructuredSerializeOptions = [],
  ): void {
    if (
      isPlainObject(message) &&
      message.type === 'prewarmEmailOtpRegistrationCrypto' &&
      typeof message.id === 'string'
    ) {
      this.preparations.add(message.id);
    }
    if (Array.isArray(transfer)) super.postMessage(message, transfer);
    else super.postMessage(message, transfer);
  }

  private observePreparation(event: MessageEvent<unknown>): void {
    const reply = event.data;
    if (
      !isPlainObject(reply) ||
      typeof reply.id !== 'string' ||
      !this.preparations.has(reply.id) ||
      reply.ok !== true ||
      !isPlainObject(reply.result)
    ) {
      return;
    }
    const kind = reply.result.kind;
    if (kind !== 'failed' && kind !== 'succeeded') return;
    this.preparations.delete(reply.id);
    const notify = Reflect.get(globalThis, 'observeEmailOtpPreparation');
    if (typeof notify !== 'function') throw new Error('Preparation observer is unavailable');
    // Only the preparation outcome crosses this test binding. No worker payload is recorded.
    void notify(kind);
  }
}

Reflect.set(globalThis, 'Worker', PreparationObservedWorker);
