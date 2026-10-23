import { isPlainObject } from '@shared/utils/validation';
import { WorkerDeferred } from '@/core/signingEngine/workerManager/workerDeferred';

const LOCAL_BRIDGE_URL = 'http://127.0.0.1:4318/voiceid';

export type VoiceBinding = Readonly<{
  attemptId: string;
  operationHash: string;
  expiresAtMs: number;
}>;

type VoiceOutcome = 'approved' | 'cancelled' | 'rejected' | 'failed';
type NativeReply =
  | { kind: 'status'; id: string; enrollment: 'ready' | 'empty' }
  | { kind: 'listening'; binding: VoiceBinding }
  | { kind: 'result'; binding: VoiceBinding; outcome: VoiceOutcome };

type ExchangeInput =
  | { kind: 'status'; id: string; onListening?: never; binding?: never }
  | { kind: 'listen'; binding: VoiceBinding; onListening: () => void; id?: never };

type ExchangeState =
  | { kind: 'status'; id: string }
  | { kind: 'starting'; binding: VoiceBinding; onListening: () => void }
  | { kind: 'listening'; binding: VoiceBinding }
  | { kind: 'settled' };

function parseNativeReply(value: unknown): NativeReply {
  if (!isPlainObject(value)) throw new Error('VoiceID returned an invalid message.');
  if (
    value.kind === 'status' &&
    typeof value.id === 'string' &&
    (value.enrollment === 'ready' || value.enrollment === 'empty')
  ) {
    return { kind: 'status', id: value.id, enrollment: value.enrollment };
  }
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

  constructor(input: ExchangeInput, timeoutMs: number, signal: AbortSignal) {
    if (input.kind === 'status') this.state = { kind: 'status', id: input.id };
    else this.state = { kind: 'starting', binding: input.binding, onListening: input.onListening };
    this.signal = signal;
    this.timer = setTimeout(this.expire, timeoutMs);
    signal.addEventListener('abort', this.aborted, { once: true });
    if (signal.aborted) this.aborted();
    else void this.exchange(input);
  }

  private async exchange(input: ExchangeInput): Promise<void> {
    try {
      const request = input.kind === 'status'
        ? { kind: 'status', id: input.id }
        : { kind: 'listen', binding: input.binding };
      const response = await fetch(LOCAL_BRIDGE_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-voiceid-protocol': 'v1',
        },
        body: JSON.stringify(request),
        cache: 'no-store',
        credentials: 'omit',
        signal: this.controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error('VoiceID local service rejected the Wallet request.');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      while (!this.isSettled()) {
        const chunk = await reader.read();
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true });
        if (pending.length > 2 * 4096 + 16) {
          throw new Error('VoiceID returned an invalid message.');
        }
        let newline = pending.indexOf('\n');
        while (newline >= 0) {
          this.receive(pending.slice(0, newline));
          pending = pending.slice(newline + 1);
          if (this.isSettled()) return;
          newline = pending.indexOf('\n');
        }
      }
      if (!this.isSettled()) {
        throw new Error('VoiceID local service closed before a result.');
      }
    } catch (error) {
      if (this.state.kind === 'settled') return;
      const message = error instanceof Error && error.message.startsWith('VoiceID ')
        ? error.message
        : 'Start the local VoiceID service on this device.';
      this.fail(new Error(message));
    }
  }

  private receive(line: string): void {
    if (this.state.kind === 'settled') return;
    try {
      const reply = parseNativeReply(JSON.parse(line));
      const state = this.state;
      if (reply.kind === 'listening') {
        if (state.kind !== 'starting' || !sameVoiceBinding(state.binding, reply.binding)) {
          throw new Error('Unexpected VoiceID capture state.');
        }
        this.state = { kind: 'listening', binding: state.binding };
        state.onListening();
        return;
      }
      if (reply.kind === 'status') {
        if (state.kind !== 'status' || state.id !== reply.id)
          throw new Error('Unexpected VoiceID status.');
      } else {
        if (
          state.kind !== 'listening' &&
          (state.kind !== 'starting' || reply.outcome !== 'failed')
        ) {
          throw new Error('VoiceID returned a result before capture.');
        }
        if (!sameVoiceBinding(state.binding, reply.binding))
          throw new Error('VoiceID returned a different operation.');
      }
      this.close();
      this.completion.resolve(reply);
    } catch {
      this.fail(new Error('VoiceID returned an invalid message.'));
    }
  }

  private isSettled(): boolean {
    return this.state.kind === 'settled';
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

export async function nativeEnrollmentStatus(signal: AbortSignal): Promise<'ready' | 'empty'> {
  const id = crypto.randomUUID();
  const exchange = new NativeExchange({ kind: 'status', id }, 60_000, signal);
  const reply = await exchange.reply;
  if (reply.kind !== 'status' || reply.id !== id) {
    throw new Error('VoiceID returned a different request.');
  }
  return reply.enrollment;
}

export async function listenForVoiceApproval(
  binding: VoiceBinding,
  timeoutMs: number,
  signal: AbortSignal,
  onListening: () => void,
): Promise<VoiceOutcome> {
  const exchange = new NativeExchange({ kind: 'listen', binding, onListening }, timeoutMs, signal);
  const reply = await exchange.reply;
  if (reply.kind !== 'result' || !sameVoiceBinding(binding, reply.binding)) {
    throw new Error('VoiceID returned a different operation.');
  }
  return reply.outcome;
}
