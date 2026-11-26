import { isPlainObject, isFunction } from '@shared/utils/validation';
import type { ExternalNearNetwork } from './types';

type MeteorTransport = { sendMessageDataAndRespond(request: object): Promise<unknown> };

export class MeteorTransportUnavailableError extends Error {
  constructor() {
    super('Open the Meteor extension and allow access to this site, then try again.');
    this.name = 'MeteorTransportUnavailableError';
  }
}

export function meteorTransportFromWindow(): MeteorTransport {
  const raw: unknown = Reflect.get(window, 'meteorComV2');
  if (!isPlainObject(raw) || !isFunction(raw.sendMessageDataAndRespond))
    throw new MeteorTransportUnavailableError();
  const method = raw.sendMessageDataAndRespond;
  return { sendMessageDataAndRespond: callMeteor.bind(null, raw, method) };
}
async function callMeteor(
  provider: object,
  method: (...args: unknown[]) => unknown,
  request: object,
): Promise<unknown> {
  if (
    Reflect.get(window, 'meteorComV2') !== provider ||
    Reflect.get(provider, 'sendMessageDataAndRespond') !== method
  )
    throw new Error('Meteor transport changed.');
  return Reflect.apply(method, provider, [request]);
}

/** Heartbeats carry one request ID; they never create a second signing request. */
export class MeteorRequest {
  private readonly uid = crypto.randomUUID();
  private state: 'initializing' | 'connected' | 'settled' = 'initializing';
  private resolve: (value: unknown) => void = ignoreResult;
  private reject: (error: Error) => void = ignoreError;
  private timer: ReturnType<typeof setInterval>;
  private deadline: ReturnType<typeof setTimeout>;
  readonly result: Promise<unknown>;
  constructor(
    private readonly transport: MeteorTransport,
    private readonly network: ExternalNearNetwork,
    private readonly actionType: 'login' | 'sign' | 'sign_message',
    private readonly inputs: object,
  ) {
    this.result = new Promise(this.capture);
    this.timer = setInterval(this.poll, 500);
    this.deadline = setTimeout(this.expire, 120000);
    void this.poll();
  }
  private capture = (resolve: (value: unknown) => void, reject: (error: Error) => void): void => {
    this.resolve = resolve;
    this.reject = reject;
  };
  private poll = async (): Promise<void> => {
    if (this.state === 'settled') return;
    const envelope = {
      uid: this.uid,
      network: this.network,
      actionType: this.actionType,
      status: this.state,
      endTags: [],
    };
    const request =
      this.state === 'initializing'
        ? {
            uid: this.uid,
            network: this.network,
            actionType: this.actionType,
            status: this.state,
            endTags: [],
            inputs: this.inputs,
          }
        : envelope;
    try {
      const response = await this.transport.sendMessageDataAndRespond(request);
      this.receive(response);
    } catch {
      this.cancel();
    }
  };
  private receive(response: unknown): void {
    if (this.state === 'settled' || response == null) return;
    if (!isPlainObject(response) || response.uid !== this.uid) return;
    switch (response.status) {
      case 'attempting_reconnect': {
        const needsInputs = this.state !== 'initializing';
        this.state = 'initializing';
        if (needsInputs) void this.poll();
        return;
      }
      case 'connected':
        this.state = 'connected';
        return;
      case 'initializing':
        return;
      case 'closed_success':
        this.finish();
        void this.acknowledge('closed_success');
        this.resolve(response.payload);
        return;
      case 'closed_fail':
      case 'closed_window':
        this.cancel();
        return;
      default:
        this.cancel();
    }
  }
  private async acknowledge(status: 'closed_success' | 'disconnected'): Promise<void> {
    try {
      await this.transport.sendMessageDataAndRespond({
        uid: this.uid,
        network: this.network,
        actionType: this.actionType,
        status,
        endTags: [],
      });
    } catch {
      /* Acknowledgement cannot change a known outcome. */
    }
  }
  private expire = (): void => {
    this.cancel();
  };
  cancel(): void {
    if (this.state === 'settled') return;
    this.finish();
    void this.acknowledge('disconnected');
    this.reject(new Error('Meteor request ended without a verified outcome.'));
  }
  private finish(): void {
    this.state = 'settled';
    clearInterval(this.timer);
    clearTimeout(this.deadline);
  }
}
function ignoreResult(_value: unknown): void {}
function ignoreError(_error: Error): void {}
