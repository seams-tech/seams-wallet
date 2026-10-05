export type WorkerRetryResult =
  | { ok: true; hex: string }
  | { ok: true; ready: true }
  | { ok: false; error: string };

type ProbeInput = {
  workerUrl: string;
  operation: string;
  payload: Record<string, unknown>;
};

class WorkerRetryProbe {
  readonly ready: Promise<void>;
  private resolveReady: (() => void) | null = null;
  private readonly worker: Worker;
  private readonly pending = new Map<string, (value: WorkerRetryResult) => void>();
  private sequence = 0;

  constructor(private readonly input: ProbeInput) {
    this.ready = new Promise(this.registerReady.bind(this));
    this.worker = new Worker(input.workerUrl, { type: 'module' });
    this.worker.addEventListener('message', this.receive.bind(this));
  }

  private registerReady(resolve: () => void): void {
    this.resolveReady = resolve;
  }

  request(): Promise<WorkerRetryResult> {
    return new Promise(this.send.bind(this, String(++this.sequence)));
  }

  private send(id: string, resolve: (value: WorkerRetryResult) => void): void {
    this.pending.set(id, resolve);
    this.worker.postMessage({ id, type: this.input.operation, payload: this.input.payload });
  }

  private receive(event: MessageEvent<unknown>): void {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if ('ready' in data && data.ready === true) {
      this.resolveReady?.();
      return;
    }
    if (!('id' in data) || typeof data.id !== 'string' || !('ok' in data)) return;
    const resolve = this.pending.get(data.id);
    if (!resolve) return;
    if (data.ok === true && 'result' in data && data.result instanceof ArrayBuffer) {
      resolve({ ok: true, hex: Array.from(new Uint8Array(data.result), byteHex).join('') });
    } else if (
      data.ok === true &&
      'result' in data &&
      data.result !== null &&
      typeof data.result === 'object' &&
      'ready' in data.result &&
      data.result.ready === true
    ) {
      resolve({ ok: true, ready: true });
    } else if (data.ok === false && 'error' in data && typeof data.error === 'string') {
      resolve({ ok: false, error: data.error });
    } else {
      resolve({ ok: false, error: 'Unexpected worker result' });
    }
    this.pending.delete(data.id);
  }

  stop(): void {
    this.worker.terminate();
  }
}

function byteHex(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

let probe: WorkerRetryProbe | null = null;

async function startWorkerRetryProbe(input: ProbeInput): Promise<void> {
  if (
    input.operation === 'validateSecp256k1PublicKey33' &&
    Array.isArray(input.payload.publicKey33)
  ) {
    input.payload.publicKey33 = new Uint8Array(input.payload.publicKey33);
  }
  probe = new WorkerRetryProbe(input);
  await probe.ready;
}

async function runWorkerRetryProbe(count: number): Promise<WorkerRetryResult[]> {
  if (!probe) throw new Error('Worker probe has not started');
  const calls: Promise<WorkerRetryResult>[] = [];
  for (let index = 0; index < count; index += 1) calls.push(probe.request());
  return await Promise.all(calls);
}

function stopWorkerRetryProbe(): void {
  probe?.stop();
  probe = null;
}

Reflect.set(globalThis, 'startWorkerRetryProbe', startWorkerRetryProbe);
Reflect.set(globalThis, 'runWorkerRetryProbe', runWorkerRetryProbe);
Reflect.set(globalThis, 'stopWorkerRetryProbe', stopWorkerRetryProbe);
