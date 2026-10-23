import { requireRecord } from '@shared/utils/validation';

type Mode = 'approved' | 'cancelled' | 'rejected' | 'different_operation' | 'held';
const BRIDGE_URL = 'http://127.0.0.1:4318/voiceid';
const originalFetch = window.fetch.bind(window);
const encoder = new TextEncoder();
const connections: VoiceResponse[] = [];
let mode: Mode = 'approved';

class VoiceResponse {
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  constructor(
    private readonly binding: Record<string, unknown>,
    private readonly signal: AbortSignal | null | undefined,
  ) {
    this.signal?.addEventListener('abort', this.abort, { once: true });
  }

  readonly start = (controller: ReadableStreamDefaultController<Uint8Array>): void => {
    this.controller = controller;
    if (this.signal?.aborted) {
      this.abort();
      return;
    }
    this.send({ kind: 'listening', binding: this.binding });
    if (mode !== 'held') this.reply();
  };

  readonly abort = (): void => {
    if (!this.controller) return;
    this.controller.error(new DOMException('VoiceID request aborted', 'AbortError'));
    this.controller = null;
  };

  reply(): void {
    if (!this.controller || this.signal?.aborted) return;
    const binding = {
      attemptId: this.binding.attemptId,
      operationHash: mode === 'different_operation' ? 'f'.repeat(64) : this.binding.operationHash,
      expiresAtMs: this.binding.expiresAtMs,
    };
    this.send({
      kind: 'result',
      binding,
      outcome: mode === 'cancelled' || mode === 'rejected' ? mode : 'approved',
    });
    this.controller.close();
    this.controller = null;
    this.signal?.removeEventListener('abort', this.abort);
  }

  private send(message: unknown): void {
    this.controller?.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
  }
}

async function bridgeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (requestUrl(input) !== BRIDGE_URL) return originalFetch(input, init);
  if (typeof init?.body !== 'string') throw new Error('The bridge request is missing a body.');
  const request = requireRecord(JSON.parse(init.body), 'VoiceID bridge request');
  if (request.kind !== 'listen') throw new Error('Unknown VoiceID bridge request.');
  const connection = new VoiceResponse(
    requireRecord(request.binding, 'VoiceID binding'),
    init.signal,
  );
  connections.push(connection);
  return new Response(new ReadableStream({ start: connection.start }), {
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function setMode(next: Mode): void {
  mode = next;
}

function releasePrevious(): void {
  const response = connections.at(-1);
  if (!response) throw new Error('The bridge has no request');
  response.reply();
}

declare global {
  interface Window {
    voiceBridgeProbe: { setMode: typeof setMode; releasePrevious: typeof releasePrevious };
  }
}
window.fetch = bridgeFetch;
window.voiceBridgeProbe = { setMode, releasePrevious };
