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
  metadata: { seams_attempt: 'att-1', seams_method: 'card' },
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
      'metadata[seams_method]': 'card',
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

test.describe('the Stripe rail: konbini, bank transfer and PayPay', () => {
  const body = (sent: { text: string }) => Object.fromEntries(new URLSearchParams(sent.text));
  const konbiniIntent = intent({
    status: 'requires_action',
    metadata: { seams_attempt: 'att-1', seams_method: 'konbini' },
    next_action: {
      type: 'konbini_display_details',
      konbini_display_details: {
        expires_at: 1_800_000_000,
        hosted_voucher_url: 'https://payments.stripe.com/konbini/voucher/x',
        stores: {
          familymart: { payment_code: '123456', confirmation_number: '11111111110' },
          lawson: { payment_code: '654321' },
          ministop: null,
        },
      },
    },
  });

  test('konbini: the server confirms, and the voucher has a code for each store', async () => {
    const { rail, sent } = fakeStripe([{ body: konbiniIntent }]);
    const started = await rail.start({ ...ATTEMPT, method: 'konbini', details: { full_name: '山田 太郎', email: 'buyer@example.com' } });
    expect(started).toMatchObject({
      ref: 'pi_1',
      payment: { state: 'pending_offline' },
      deadlineMs: 1_800_000_000_000,
      start: {
        kind: 'voucher',
        deadlineMs: 1_800_000_000_000,
        instructionsUrl: 'https://payments.stripe.com/konbini/voucher/x',
        codes: [
          { stores: ['family_mart'], paymentCode: '123456', confirmationCode: '11111111110' },
          { stores: ['lawson'], paymentCode: '654321', confirmationCode: null },
        ],
      },
    });
    expect(body(sent[0]!)).toMatchObject({
      'allowed_payment_method_types[0]': 'konbini',
      confirm: 'true',
      'payment_method_data[type]': 'konbini',
      'payment_method_data[billing_details][name]': '山田 太郎',
      'payment_method_data[billing_details][email]': 'buyer@example.com',
      'payment_method_options[konbini][expires_after_days]': '3',
    });
  });

  test('a voucher that expired is expired, and a refused wallet payment is failed', async () => {
    const error = (code: string) => ({ status: 'requires_payment_method', last_payment_error: { code, message: 'No' } });
    const konbini = { seams_attempt: 'att-1', seams_method: 'konbini' };
    const cases = [
      [{ ...error('payment_intent_payment_attempt_expired'), metadata: konbini }, 'expired'],
      [{ ...error('payment_intent_authentication_failure'), metadata: { ...konbini, seams_method: 'paypay' } }, 'failed'],
      // A declined card can be tried again in the same PaymentIntent.
      [error('card_declined'), 'created'],
    ] as const;
    for (const [change, state] of cases) {
      expect((await fakeStripe([{ body: intent(change) }]).rail.read('pi_1')).state).toBe(state);
    }
  });

  test('bank transfer: one customer for the attempt, and the bank details as data', async () => {
    const bankIntent = intent({
      status: 'requires_action',
      next_action: {
        type: 'display_bank_transfer_instructions',
        display_bank_transfer_instructions: {
          amount_remaining: 4600,
          hosted_instructions_url: 'https://payments.stripe.com/bank/x',
          financial_addresses: [
            { type: 'zengin', zengin: { bank_name: 'みずほ銀行', branch_name: '東京', account_type: 'futsu', account_number: '1234567', account_holder_name: 'ｾ-ﾑｽﾞ' } },
          ],
        },
      },
    });
    const { rail, sent } = fakeStripe([{ body: { id: 'cus_1' } }, { body: bankIntent }]);
    const started = await rail.start({ ...ATTEMPT, method: 'bank_transfer', details: { full_name: '山田 太郎', email: 'buyer@example.com' } });
    expect(started.payment.state).toBe('pending_offline');
    expect(started.deadlineMs).toBeUndefined();
    expect(started.start).toEqual({
      kind: 'bank_details',
      deadlineMs: null,
      instructionsUrl: 'https://payments.stripe.com/bank/x',
      bankName: 'みずほ銀行',
      branchName: '東京',
      accountType: 'futsu',
      accountNumber: '1234567',
      accountHolder: 'ｾ-ﾑｽﾞ',
    });
    expect(sent[0]?.url).toBe('https://api.stripe.com/v1/customers');
    expect(sent[0]?.headers.get('idempotency-key')).toBe('att-1-customer');
    expect(body(sent[0]!)).toMatchObject({ 'metadata[seams_attempt]': 'att-1', email: 'buyer@example.com' });
    expect(body(sent[1]!)).toMatchObject({
      customer: 'cus_1',
      'allowed_payment_method_types[0]': 'customer_balance',
      'payment_method_data[type]': 'customer_balance',
      'payment_method_options[customer_balance][funding_type]': 'bank_transfer',
      'payment_method_options[customer_balance][bank_transfer][type]': 'jp_bank_transfer',
    });
  });

  test('PayPay: the customer goes to the URL that Stripe gives', async () => {
    const paypay = intent({
      status: 'requires_action',
      next_action: { type: 'redirect_to_url', redirect_to_url: { url: 'https://hooks.stripe.com/redirect/x' } },
    });
    const { rail, sent } = fakeStripe([{ body: paypay }]);
    const started = await rail.start({ ...ATTEMPT, method: 'paypay', details: {} });
    expect(started.payment.state).toBe('requires_action');
    expect(started.start).toEqual({ kind: 'redirect', url: 'https://hooks.stripe.com/redirect/x' });
    expect(body(sent[0]!)).toMatchObject({
      'payment_method_data[type]': 'paypay',
      return_url: 'https://checkout.example.test/return',
    });
  });

  test('money in a cash balance that paid no payment is reported for its attempt', async () => {
    const { rail, sent } = fakeStripe([{ body: { id: 'cus_1', metadata: { seams_attempt: 'att-1' } } }, { body: { id: 'cus_2', metadata: {} } }]);
    const event = (customer: string) =>
      JSON.stringify({ id: 'evt_9', type: 'cash_balance.funds_available', data: { object: { object: 'cash_balance', customer, available: { jpy: 4000 } } } });
    const verify = async (text: string) =>
      rail.events.verify({
        body: text,
        header: () => null,
        nowMs: NOW_MS,
      });
    expect(await verify(event('cus_1'))).toBeNull();
    const signed = async (text: string) => {
      const signature = await signTimestamped(KEYS.webhookSecret, text, NOW_MS);
      return rail.events.verify({ body: text, header: () => signature, nowMs: NOW_MS });
    };
    expect(await signed(event('cus_1'))).toEqual({
      kind: 'unmatched_funds',
      attemptId: 'att-1',
      ref: 'cus_1:evt_9',
      amount: 4000,
      currency: 'JPY',
    });
    expect(sent[0]?.url).toBe('https://api.stripe.com/v1/customers/cus_1');
    // A customer that the checkout did not make.
    expect(await signed(event('cus_2'))).toEqual({ kind: 'ignored' });
  });

  test('each method but the card takes yen only, inside the limits of Stripe', () => {
    expect(stripeRail.accepts('card', 'USD', 100)).toBe(true);
    expect(stripeRail.accepts('konbini', 'USD', 1000)).toBe(false);
    expect(stripeRail.accepts('konbini', 'JPY', 119)).toBe(false);
    expect(stripeRail.accepts('konbini', 'JPY', 300_000)).toBe(true);
    expect(stripeRail.accepts('konbini', 'JPY', 300_001)).toBe(false);
    expect(stripeRail.accepts('paypay', 'JPY', 49)).toBe(false);
    expect(stripeRail.fields('konbini')).toEqual(['full_name', 'email']);
  });
});
