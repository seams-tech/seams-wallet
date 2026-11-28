import { expect, test } from '@playwright/test';
import { hmacSha256Hex } from '../../packages/checkout/src/shared/signature';
import { komojuRail } from '../../packages/checkout/src/worker/rails/komoju';
import { CARD_ATTEMPT as ATTEMPT, NOW_MS, fakeProviderApi } from './railApi';

const KEYS = { publishableKey: 'pk_test_abc', secretKey: 'sk_test_def', webhookSecret: 'hook-token' };
const DAY_MS = 24 * 60 * 60_000;

function fakeKomoju(answers: Parameters<typeof fakeProviderApi>[0], nowMs = NOW_MS) {
  const { context, sent } = fakeProviderApi(answers, nowMs);
  return { rail: komojuRail.connect(komojuRail.parseAccount(KEYS), context), sent };
}

const session = (change: Record<string, unknown> = {}) => ({
  id: 'ses_1',
  status: 'pending',
  expired: false,
  payment: null,
  ...change,
});
const payment = (status: string) => ({
  id: 'pay_1',
  status,
  amount: 4600,
  tax: 0,
  total: 4600,
  currency: 'JPY',
  session: 'ses_1',
  external_order_num: 'att-1',
});

test.describe('the KOMOJU account of a merchant', () => {
  test('the account has three values, in the right fields and of one mode', () => {
    expect(komojuRail.parseAccount(KEYS)).toEqual({
      public: { publishableKey: 'pk_test_abc' },
      secrets: { secretKey: 'sk_test_def', webhookSecret: 'hook-token' },
    });
    expect(() => komojuRail.parseAccount({ ...KEYS, publishableKey: 'sk_test_def' })).toThrow(/wrong fields/);
    expect(() => komojuRail.parseAccount({ ...KEYS, secretKey: 'sk_live_def' })).toThrow(/same mode/);
    expect(() => komojuRail.parseAccount({ ...KEYS, webhookSecret: '' })).toThrow();
    expect(() => komojuRail.parseAccount({ ...KEYS, extra: 1 })).toThrow();
  });
});

test.describe('the KOMOJU rail', () => {
  test('a card start makes a card-only session that names the attempt', async () => {
    const { rail, sent } = fakeKomoju([{ body: session() }]);
    expect(await rail.start(ATTEMPT)).toEqual({
      ref: 'ses_1',
      payment: { state: 'created', paid: null, failure: null },
      start: { kind: 'card_form', fields: 'komoju', publishableKey: 'pk_test_abc', sessionId: 'ses_1' },
    });
    const [request] = sent;
    expect(request?.url).toBe('https://komoju.com/api/v1/sessions');
    expect(request?.headers.get('authorization')).toBe(`Basic ${btoa('sk_test_def:')}`);
    expect(request?.headers.get('x-komoju-idempotency')).toBe('att-1');
    expect(request?.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(request!.text)).toEqual({
      amount: 4600,
      currency: 'JPY',
      return_url: 'https://checkout.example.test/return',
      default_locale: 'ja',
      payment_types: ['credit_card'],
      payment_data: { external_order_num: 'att-1', capture: 'auto' },
      email: 'buyer@example.com',
    });
  });

  test('after 24 hours a retry looks the payment up by the attempt, not by the idempotency key', async () => {
    const found = fakeKomoju([{ body: { data: [payment('captured')] } }, { body: session({ status: 'completed', payment: payment('captured') }) }], NOW_MS + DAY_MS + 1);
    const started = await found.rail.start(ATTEMPT);
    expect(started.ref).toBe('ses_1');
    expect(started.payment.state).toBe('succeeded');
    expect(found.sent.map((request) => `${request.method} ${request.url}`)).toEqual([
      'GET https://komoju.com/api/v1/payments?external_order_num=att-1',
      'GET https://komoju.com/api/v1/sessions/ses_1',
    ]);
    const none = fakeKomoju([{ body: { data: [] } }, { body: session() }], NOW_MS + DAY_MS + 1);
    await none.rail.start(ATTEMPT);
    expect(none.sent[1]?.method).toBe('POST');
  });

  test('each session and payment status maps to one attempt state', async () => {
    const paid = { amount: 4600, currency: 'JPY' };
    const cases = [
      [session(), { state: 'created', paid: null, failure: null }],
      [session({ status: 'cancelled' }), { state: 'cancelled', paid: null, failure: null }],
      [session({ expired: true }), { state: 'expired', paid: null, failure: null }],
      [session({ payment: payment('pending') }), { state: 'requires_action', paid: null, failure: null }],
      [session({ payment: payment('captured') }), { state: 'succeeded', paid, failure: null }],
      [session({ payment: payment('refunded') }), { state: 'succeeded', paid, failure: null }],
      [session({ payment: payment('expired') }), { state: 'expired', paid: null, failure: null }],
      [session({ payment: payment('cancelled') }), { state: 'cancelled', paid: null, failure: null }],
      [
        session({ payment: payment('failed') }),
        { state: 'created', paid: null, failure: { code: 'payment_failed', message: 'The payment failed' } },
      ],
    ] as const;
    for (const [body, expected] of cases) {
      expect(await fakeKomoju([{ body }]).rail.read('ses_1')).toEqual(expected);
    }
  });

  test('a cancel of a completed session comes too late', async () => {
    const ok = fakeKomoju([{ body: session({ status: 'cancelled' }) }]);
    expect(await ok.rail.cancel('ses_1')).toEqual({ kind: 'cancelled' });
    expect(ok.sent[0]?.url).toBe('https://komoju.com/api/v1/sessions/ses_1/cancel');
    const refusal = { status: 422, body: { error: { code: 'unprocessable_entity', message: 'Completed', param: null } } };
    const late = fakeKomoju([refusal, { body: session({ status: 'completed', payment: payment('captured') }) }]);
    expect(await late.rail.cancel('ses_1')).toEqual({ kind: 'too_late' });
  });
});

test.describe('the KOMOJU webhook', () => {
  const { rail } = fakeKomoju([]);
  const event = (type: string, data: unknown) => JSON.stringify({ id: 'evt_1', type, resource: 'event', data });
  const verify = (body: string, signature: string | null) =>
    rail.events.verify({ body, header: (name) => (name === 'x-komoju-signature' ? signature : null), nowMs: NOW_MS });

  test('a signed payment event names its attempt and its session', async () => {
    const body = event('payment.captured', payment('captured'));
    const signature = await hmacSha256Hex(KEYS.webhookSecret, body);
    expect(await verify(body, signature)).toEqual({ kind: 'payment', attemptId: 'att-1', ref: 'ses_1' });
  });

  test('a wrong token, a changed body and a missing header are refused', async () => {
    const body = event('payment.captured', payment('captured'));
    expect(await verify(body, await hmacSha256Hex('other-token', body))).toBeNull();
    expect(await verify(body.replace('4600', '1'), await hmacSha256Hex(KEYS.webhookSecret, body))).toBeNull();
    expect(await verify(body, null)).toBeNull();
  });

  test('a ping and a payment of another integration are ignored', async () => {
    const bodies = [event('ping', {}), event('payment.captured', { ...payment('captured'), external_order_num: null })];
    for (const body of bodies) {
      expect(await verify(body, await hmacSha256Hex(KEYS.webhookSecret, body))).toEqual({ kind: 'ignored' });
    }
  });
});
