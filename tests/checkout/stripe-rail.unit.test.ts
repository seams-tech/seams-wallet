import { expect, test } from '@playwright/test';
import { signTimestamped } from '../../packages/checkout/src/shared/signature';
import { RailError } from '../../packages/checkout/src/worker/rails/rail';
import { stripeRail } from '../../packages/checkout/src/worker/rails/stripe';
import { CARD_ATTEMPT as ATTEMPT, NOW_MS, fakeProviderApi } from './railApi';

const KEYS = {
  publishableKey: 'pk_test_123',
  restrictedKey: 'rk_test_456',
  webhookSecret: 'whsec_789',
};
function fakeStripe(answers: Parameters<typeof fakeProviderApi>[0]) {
  const { context, sent } = fakeProviderApi(answers);
  return { rail: stripeRail.connect(stripeRail.parseAccount(KEYS), context), sent };
}

const intent = (change: Record<string, unknown> = {}) => ({
  id: 'pi_1',
  client_secret: 'pi_1_secret_abc',
  status: 'requires_payment_method',
  amount: 4600,
  amount_received: 0,
  currency: 'jpy',
  last_payment_error: null,
  metadata: { seams_attempt: 'att-1' },
  ...change,
});

test.describe('the Stripe account of a merchant', () => {
  test('the checkout accepts a restricted key and refuses a secret key', () => {
    expect(stripeRail.parseAccount(KEYS)).toEqual({
      public: { publishableKey: 'pk_test_123' },
      secrets: { restrictedKey: 'rk_test_456', webhookSecret: 'whsec_789' },
    });
    expect(() => stripeRail.parseAccount({ ...KEYS, restrictedKey: 'sk_test_456' })).toThrow(/restricted key/);
    expect(() => stripeRail.parseAccount({ ...KEYS, restrictedKey: 'sk_live_456' })).toThrow(/restricted key/);
  });

  test('the keys have the same mode, and each has its own form', () => {
    expect(() => stripeRail.parseAccount({ ...KEYS, restrictedKey: 'rk_live_456' })).toThrow(/same mode/);
    expect(() => stripeRail.parseAccount({ ...KEYS, publishableKey: 'rk_test_1' })).toThrow(/pk_test_/);
    expect(() => stripeRail.parseAccount({ ...KEYS, webhookSecret: 'secret' })).toThrow(/whsec_/);
    expect(() => stripeRail.parseAccount({ ...KEYS, extra: 'x' })).toThrow();
    expect(() => stripeRail.parseAccount({ publishableKey: 'pk_test_123' })).toThrow();
  });
});

test.describe('the Stripe rail', () => {
  test('a card start makes a card-only PaymentIntent with the attempt as the idempotency key', async () => {
    const { rail, sent } = fakeStripe([{ body: intent() }]);
    const started = await rail.start(ATTEMPT);
    expect(started).toEqual({
      ref: 'pi_1',
      payment: { state: 'created', paid: null, failure: null },
      start: {
        kind: 'card_form',
        fields: 'stripe',
        publishableKey: 'pk_test_123',
        clientSecret: 'pi_1_secret_abc',
      },
    });
    const [request] = sent;
    expect(request?.url).toBe('https://api.stripe.com/v1/payment_intents');
    expect(request?.method).toBe('POST');
    expect(request?.headers.get('authorization')).toBe('Bearer rk_test_456');
    expect(request?.headers.get('idempotency-key')).toBe('att-1');
    expect(request?.headers.get('stripe-version')).toBeTruthy();
    expect(Object.fromEntries(new URLSearchParams(request!.text))).toEqual({
      amount: '4600',
      currency: 'jpy',
      'allowed_payment_method_types[0]': 'card',
      'metadata[seams_attempt]': 'att-1',
      'metadata[seams_order]': 'order-1042',
      receipt_email: 'buyer@example.com',
    });
  });

  test('each PaymentIntent status maps to one attempt state', async () => {
    const cases = [
      [intent(), { state: 'created', paid: null, failure: null }],
      [intent({ status: 'requires_action' }), { state: 'requires_action', paid: null, failure: null }],
      [intent({ status: 'processing' }), { state: 'requires_action', paid: null, failure: null }],
      [intent({ status: 'canceled' }), { state: 'cancelled', paid: null, failure: null }],
      [
        intent({ status: 'succeeded', amount_received: 4600 }),
        { state: 'succeeded', paid: { amount: 4600, currency: 'JPY' }, failure: null },
      ],
      [
        intent({ last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds', message: 'No funds.' } }),
        { state: 'created', paid: null, failure: { code: 'insufficient_funds', message: 'No funds.' } },
      ],
    ] as const;
    for (const [body, expected] of cases) {
      const { rail, sent } = fakeStripe([{ body }]);
      expect(await rail.read('pi_1')).toEqual(expected);
      expect(sent[0]?.url).toBe('https://api.stripe.com/v1/payment_intents/pi_1');
    }
  });

  test('a refusal and a missing answer are different errors, and neither holds the key', async () => {
    const refused = fakeStripe([{ status: 400, body: { error: { code: 'parameter_invalid_integer', message: 'Invalid integer' } } }]);
    const refusal = await refused.rail.start(ATTEMPT).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(RailError);
    expect(refusal).toMatchObject({ kind: 'refused', code: 'parameter_invalid_integer' });

    for (const status of [409, 429, 500]) {
      const busy = fakeStripe([{ status, body: { error: { code: 'lock_timeout', message: 'Busy' } } }]);
      expect(await busy.rail.start(ATTEMPT).catch((error: unknown) => error)).toMatchObject({ kind: 'unavailable' });
    }
    const offline = await fakeStripe([]).rail.start(ATTEMPT).catch((error: unknown) => error);
    expect(offline).toMatchObject({ kind: 'unavailable', code: 'no_answer' });
    expect(String((offline as Error).message)).not.toContain('rk_test_456');
  });

  test('a cancel that comes too late says so', async () => {
    const ok = fakeStripe([{ body: intent({ status: 'canceled' }) }]);
    expect(await ok.rail.cancel('pi_1')).toEqual({ kind: 'cancelled' });
    expect(ok.sent[0]?.url).toBe('https://api.stripe.com/v1/payment_intents/pi_1/cancel');

    const unexpectedState = { status: 400, body: { error: { code: 'payment_intent_unexpected_state', message: 'No' } } };
    const paid = fakeStripe([unexpectedState, { body: intent({ status: 'succeeded', amount_received: 4600 }) }]);
    expect(await paid.rail.cancel('pi_1')).toEqual({ kind: 'too_late' });
    const already = fakeStripe([unexpectedState, { body: intent({ status: 'canceled' }) }]);
    expect(await already.rail.cancel('pi_1')).toEqual({ kind: 'cancelled' });
  });
});

test.describe('the Stripe webhook', () => {
  const { rail } = fakeStripe([]);
  const event = (type: string, object: unknown) => JSON.stringify({ id: 'evt_1', type, data: { object } });
  const verify = (body: string, signature: string | null, nowMs = NOW_MS) =>
    rail.events.verify({ body, header: (name) => (name === 'stripe-signature' ? signature : null), nowMs });

  test('a signed PaymentIntent event names its attempt', async () => {
    const body = event('payment_intent.succeeded', intent({ status: 'succeeded' }));
    const signature = await signTimestamped(KEYS.webhookSecret, body, NOW_MS);
    expect(await verify(body, signature)).toEqual({ kind: 'payment', attemptId: 'att-1', ref: 'pi_1' });
  });

  test('a wrong secret, a changed body, an old timestamp and a missing header are refused', async () => {
    const body = event('payment_intent.succeeded', intent());
    const good = await signTimestamped(KEYS.webhookSecret, body, NOW_MS);
    expect(await verify(body, await signTimestamped('whsec_other', body, NOW_MS))).toBeNull();
    expect(await verify(body.replace('pi_1', 'pi_2'), good)).toBeNull();
    expect(await verify(body, good, NOW_MS + 301_000)).toBeNull();
    expect(await verify(body, null)).toBeNull();
    expect(await verify(body, 't=abc,v1=00')).toBeNull();
  });

  test('a second signature of a rolled secret is accepted', async () => {
    const body = event('payment_intent.succeeded', intent());
    const good = await signTimestamped(KEYS.webhookSecret, body, NOW_MS);
    const [timestamp, signature] = good.split(',');
    expect(await verify(body, `${timestamp},v1=${'0'.repeat(64)},${signature}`)).not.toBeNull();
  });

  test('an event of a payment that the checkout did not make is ignored', async () => {
    const foreign = event('payment_intent.succeeded', intent({ metadata: {} }));
    const other = event('customer.created', { id: 'cus_1', metadata: { seams_attempt: 'att-1' } });
    for (const body of [foreign, other]) {
      expect(await verify(body, await signTimestamped(KEYS.webhookSecret, body, NOW_MS))).toEqual({ kind: 'ignored' });
    }
  });
});
