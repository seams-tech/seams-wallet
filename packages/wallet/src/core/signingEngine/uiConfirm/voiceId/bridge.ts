import { isPlainObject } from '@shared/utils/validation';
import { WorkerDeferred } from '@/core/signingEngine/workerManager/workerDeferred';
import { streamVoiceIdNative } from './nativeTransport';


export type VoiceBinding = Readonly<{
  attemptId: string;
  operationHash: string;
  expiresAtMs: number;
}>;

type VoiceOutcome = 'approved' | 'cancelled' | 'rejected' | 'failed';
type NativeReply =
  | { kind: 'listening'; binding: VoiceBinding }
  | { kind: 'result'; binding: VoiceBinding; outcome: VoiceOutcome };

type ExchangeState =
  | { kind: 'starting'; binding: VoiceBinding; onListening: () => void }
  | { kind: 'listening'; binding: VoiceBinding }
  | { kind: 'settled' };

function parseNativeReply(value: unknown): NativeReply {
  if (!isPlainObject(value)) throw new Error('VoiceID returned an invalid message.');
  const binding = value.binding;
  if (
    (value.kind === 'result' || value.kind === 'listening') &&
    isPlainObject(binding) &&
    typeof binding.attemptId === 'string' &&
    /^[0-9a-f-]{36}$/.test(binding.attemptId) &&
    typeof binding.operationHash === 'string' &&
    /^[0-9a-f]{64}$/.test(binding.operationHash) &&
    typeof binding.expiresAtMs === 'number' &&
    Number.isSafeInteger(binding.expiresAtMs)
  ) {
    const parsed = Object.freeze({
      attemptId: binding.attemptId,
      operationHash: binding.operationHash,
      expiresAtMs: binding.expiresAtMs,
    });
    if (value.kind === 'listening') return { kind: 'listening', binding: parsed };
    if (
      value.outcome === 'approved' ||
      value.outcome === 'cancelled' ||
      value.outcome === 'rejected' ||
      value.outcome === 'failed'
    ) {
      return { kind: 'result', binding: parsed, outcome: value.outcome };
    }
  }
  throw new Error('VoiceID returned an invalid message.');
}

export function sameVoiceBinding(left: VoiceBinding, right: VoiceBinding): boolean {
  return (
    left.attemptId === right.attemptId &&
    left.operationHash === right.operationHash &&
    left.expiresAtMs === right.expiresAtMs
  );
}

// Each request admits one operation. Aborting it cancels the native capture.
class NativeExchange {
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly signal: AbortSignal;
  private readonly completion = new WorkerDeferred<NativeReply>();
  private state: ExchangeState;
  readonly reply = this.completion.promise;

  constructor(
    binding: VoiceBinding,
    onListening: () => void,
    timeoutMs: number,
    signal: AbortSignal,
  ) {
    this.state = { kind: 'starting', binding, onListening };
    this.signal = signal;
    this.timer = setTimeout(this.expire, timeoutMs);
    signal.addEventListener('abort', this.aborted, { once: true });
    if (signal.aborted) this.aborted();
    else void this.exchange(binding);
  }

  private async exchange(binding: VoiceBinding): Promise<void> {
    try {
      await streamVoiceIdNative(
        { kind: 'listen', binding },
        this.controller.signal,
        this.receive.bind(this),
      );
    } catch (error) {
      if (this.state.kind === 'settled') return;
      const message = error instanceof Error && error.message.startsWith('VoiceID ')
        ? error.message
        : 'Start the local VoiceID service on this device.';
      this.fail(new Error(message));
    }
  }

  private receive(value: unknown): boolean {
    if (this.state.kind === 'settled') return true;
    try {
      const reply = parseNativeReply(value);
      const state = this.state;
      if (reply.kind === 'listening') {
        if (state.kind !== 'starting' || !sameVoiceBinding(state.binding, reply.binding)) {
          throw new Error('Unexpected VoiceID capture state.');
        }
        this.state = { kind: 'listening', binding: state.binding };
        state.onListening();
        return false;
      }
      if (
        state.kind !== 'listening' &&
        (state.kind !== 'starting' || reply.outcome !== 'failed')
      ) {
        throw new Error('VoiceID returned a result before capture.');
      }
      if (!sameVoiceBinding(state.binding, reply.binding)) {
        throw new Error('VoiceID returned a different operation.');
      }
      this.close();
      this.completion.resolve(reply);
      return true;
    } catch {
      this.fail(new Error('VoiceID returned an invalid message.'));
      return true;
    }
  }

  private readonly aborted = (): void => {
    this.fail(new Error('Voice approval was cancelled.'));
  };

  private readonly expire = (): void => {
    this.fail(new Error('Voice approval expired. Start a new review.'));
  };

  private fail(error: Error): void {
    if (this.state.kind === 'settled') return;
    this.close();
    this.completion.reject(error);
  }

  private close(): void {
    this.state = { kind: 'settled' };
    clearTimeout(this.timer);
    this.signal.removeEventListener('abort', this.aborted);
    this.controller.abort();
  }
}

export async function listenForVoiceApproval(
  binding: VoiceBinding,
  timeoutMs: number,
  signal: AbortSignal,
  onListening: () => void,
): Promise<VoiceOutcome> {
  const exchange = new NativeExchange(binding, onListening, timeoutMs, signal);
  const reply = await exchange.reply;
  if (reply.kind !== 'result' || !sameVoiceBinding(binding, reply.binding)) {
    throw new Error('VoiceID returned a different operation.');
  }
  return reply.outcome;
}
