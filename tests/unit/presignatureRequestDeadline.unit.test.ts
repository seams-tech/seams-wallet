import { expect, test } from '@playwright/test';
import { routerAbEcdsaDerivationPresignaturePoolFillStep } from '@/core/signingEngine/routerAb/ecdsaDerivation/poolFillRoutes';

class StalledResponse {
  aborted = false;
  private releaseFetch: (response: Response) => void = () => {};
  private rejectFetch: (error: Error) => void = () => {};
  private body: ReadableStreamDefaultController<Uint8Array> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly phase: 'headers' | 'body') {}

  readonly fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal;
    if (!signal) throw new Error('Presign exchanges require abortable fetch');
    signal.addEventListener('abort', this.abort.bind(this), { once: true });
    this.timer = setTimeout(this.release.bind(this), 6_500);
    if (this.phase === 'body') {
      return new Response(new ReadableStream({ start: this.startBody.bind(this) }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return await new Promise<Response>(this.startFetch.bind(this));
  };

  private startFetch(resolve: (response: Response) => void, reject: (error: Error) => void): void {
    this.releaseFetch = resolve;
    this.rejectFetch = reject;
  }

  private startBody(controller: ReadableStreamDefaultController<Uint8Array>): void {
    this.body = controller;
  }

  private abort(): void {
    this.aborted = true;
    const error = new DOMException('Aborted', 'AbortError');
    if (this.phase === 'body') this.body?.error(error);
    else this.rejectFetch(error);
  }

  release(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.phase === 'body') {
      if (!this.aborted) this.body?.close();
    } else {
      this.releaseFetch(Response.json({ ok: false, code: 'test_deadline_exceeded' }));
    }
  }
}

function stepInput(ceremonyExpiresAtMs: number) {
  return {
    relayerUrl: 'https://router.example',
    presignSessionId: 'deadline-test-ceremony',
    ceremonyExpiresAtMs,
    materialExpiresAtMs: ceremonyExpiresAtMs,
    stage: 'triples' as const,
    outgoingMessagesB64u: ['AQ'],
    credential: { kind: 'wallet_session_opaque' as const, walletSessionToken: 'test-token' },
    authorization: { kind: 'reusable_wallet_session' as const, wallet_session_id: 'test-session' },
  };
}

test('a stalled presign exchange aborts within the five-second response budget', async () => {
  const originalFetch = globalThis.fetch;
  const stalled = new StalledResponse('headers');
  globalThis.fetch = stalled.fetch;
  try {
    const result = await routerAbEcdsaDerivationPresignaturePoolFillStep(stepInput(Date.now() + 30_000));
    expect(stalled.aborted).toBe(true);
    expect(result).toMatchObject({ ok: false, code: 'network_error' });
    expect(result.message).toContain('timed out after 5000ms');
  } finally {
    stalled.release();
    globalThis.fetch = originalFetch;
  }
});

test('presign timeout is capped by the remaining ceremony lifetime', async () => {
  const originalFetch = globalThis.fetch;
  const stalled = new StalledResponse('headers');
  globalThis.fetch = stalled.fetch;
  try {
    const startedAt = performance.now();
    const result = await routerAbEcdsaDerivationPresignaturePoolFillStep(stepInput(Date.now() + 100));
    expect(stalled.aborted).toBe(true);
    expect(result).toMatchObject({ ok: false, code: 'network_error' });
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  } finally {
    stalled.release();
    globalThis.fetch = originalFetch;
  }
});

test('a response body stalled after HTTP 200 retains timeout classification', async () => {
  const originalFetch = globalThis.fetch;
  const stalled = new StalledResponse('body');
  globalThis.fetch = stalled.fetch;
  try {
    const result = await routerAbEcdsaDerivationPresignaturePoolFillStep({
      ...stepInput(Date.now() + 30_000),
      requestTimeoutMs: 50,
    });
    expect(stalled.aborted).toBe(true);
    expect(result).toMatchObject({ ok: false, code: 'network_error' });
    expect(result.message).toContain('timed out after 50ms');
  } finally {
    stalled.release();
    globalThis.fetch = originalFetch;
  }
});
