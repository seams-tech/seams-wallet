import { requireRecord } from '@shared/utils/validation';

type Mode = 'approved' | 'cancelled' | 'rejected' | 'different_operation' | 'held';
let mode: Mode = 'approved';
const connections: ProbePort[] = [];

class MessageListeners {
  private readonly listeners = new Set<(message: unknown) => void>();
  addListener(listener: (message: unknown) => void): void {
    this.listeners.add(listener);
  }
  send(message: unknown): void {
    for (const listener of this.listeners) listener(message);
  }
}
class DisconnectListeners {
  private readonly listeners = new Set<() => void>();
  addListener(listener: () => void): void {
    this.listeners.add(listener);
  }
  send(): void {
    for (const listener of this.listeners) listener();
  }
}
class ProbePort {
  readonly onMessage = new MessageListeners();
  readonly onDisconnect = new DisconnectListeners();
  private request: Record<string, unknown> | null = null;

  postMessage(message: unknown): void {
    this.request = requireRecord(message, 'native request');
    queueMicrotask(this.started);
  }
  disconnect(): void {
    this.onDisconnect.send();
  }
  private readonly started = (): void => {
    if (!this.request) throw new Error('The bridge has no request');
    if (this.request.kind === 'listen') {
      this.onMessage.send({ kind: 'listening', binding: this.request.binding });
    }
    if (mode !== 'held') this.reply();
  };
  readonly reply = (): void => {
    if (!this.request) throw new Error('The bridge has no request');
    if (this.request.kind === 'status') {
      this.onMessage.send({ kind: 'status', id: this.request.id, enrollment: 'ready' });
      return;
    }
    const binding = requireRecord(this.request.binding, 'voice binding');
    this.onMessage.send({
      kind: 'result',
      binding: {
        attemptId: binding.attemptId,
        operationHash: mode === 'different_operation' ? 'f'.repeat(64) : binding.operationHash,
        expiresAtMs: binding.expiresAtMs,
      },
      outcome: mode === 'cancelled' || mode === 'rejected' ? mode : 'approved',
    });
  };
}

function connect(): ProbePort {
  const port = new ProbePort();
  connections.push(port);
  return port;
}
function setMode(next: Mode): void {
  mode = next;
}
function releasePrevious(): void {
  const port = connections.at(-1);
  if (!port) throw new Error('The bridge has no connection');
  port.reply();
}

declare global {
  interface Window {
    voiceBridgeProbe: { setMode: typeof setMode; releasePrevious: typeof releasePrevious };
  }
}
Reflect.set(window, 'chrome', { runtime: { connect } });
window.voiceBridgeProbe = { setMode, releasePrevious };
