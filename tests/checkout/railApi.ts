import type { RailAttempt, RailContext } from '../../packages/checkout/src/worker/rails/rail';

export const NOW_MS = Date.UTC(2026, 10, 28);

/** One card attempt of a ¥4,600 order, as each rail gets it. */
export const CARD_ATTEMPT: RailAttempt = {
  id: 'att-1',
  orderReference: 'order-1042',
  method: 'card',
  amount: 4600,
  currency: 'JPY',
  details: { email: 'buyer@example.com' },
  locale: 'ja',
  returnUrl: 'https://checkout.example.test/return',
  createdAtMs: NOW_MS,
};

type Sent = { url: string; method: string; headers: Headers; text: string };

/** A provider API that records each request and answers from `answers`, in order. */
export function fakeProviderApi(
  answers: readonly { status?: number; body: unknown }[],
  nowMs = NOW_MS,
): { context: RailContext; sent: Sent[] } {
  const sent: Sent[] = [];
  const queue = [...answers];
  const fetcher = async (url: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    sent.push({
      url: String(url),
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      text: String(init.body ?? ''),
    });
    const answer = queue.shift();
    if (!answer) throw new Error('offline');
    return Response.json(answer.body, { status: answer.status ?? 200 });
  };
  return { context: { fetch: fetcher as typeof fetch, now: () => nowMs }, sent };
}
