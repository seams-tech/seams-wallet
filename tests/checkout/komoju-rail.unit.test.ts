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

  test('a signed payment event names its attempt', async () => {
    const body = event('payment.captured', payment('captured'));
    const signature = await hmacSha256Hex(KEYS.webhookSecret, body);
    expect(await verify(body, signature)).toEqual({ kind: 'payment', attemptId: 'att-1', ref: null });
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

test.describe('the KOMOJU rail: konbini, bank transfer and PayPay', () => {
  const konbini = (store: string, change: Record<string, unknown> = {}) => ({
    ...payment('authorized'),
    payment_deadline: '2026-12-01T14:59:59Z',
    payment_details: {
      type: 'konbini',
      store,
      receipt: '12345',
      confirmation_code: '6789',
      instructions_url: 'https://komoju.com/en/instructions/pay_1',
    },
    ...change,
  });
  const deadlineMs = Date.parse('2026-12-01T14:59:59Z');

  test('konbini: the server makes the payment, with no tax, and the voucher has the code', async () => {
    const { rail, sent } = fakeKomoju([{ body: konbini('lawson') }]);
    const started = await rail.start({ ...ATTEMPT, method: 'konbini', details: { konbini_store: 'lawson', email: 'buyer@example.com' } });
    expect(started).toEqual({
      ref: 'payment:pay_1',
      payment: { state: 'pending_offline', paid: null, failure: null },
      deadlineMs,
      start: {
        kind: 'voucher',
        deadlineMs,
        instructionsUrl: 'https://komoju.com/en/instructions/pay_1',
        codes: [{ stores: ['lawson'], paymentCode: '12345', confirmationCode: '6789' }],
      },
    });
    expect(sent[0]?.url).toBe('https://komoju.com/api/v1/payments');
    expect(sent[0]?.headers.get('x-komoju-idempotency')).toBe('att-1');
    expect(JSON.parse(sent[0]!.text)).toEqual({
      amount: 4600,
      tax: 0,
      currency: 'JPY',
      external_order_num: 'att-1',
      return_url: 'https://checkout.example.test/return',
      locale: 'ja',
      payment_details: { type: 'konbini', store: 'lawson', email: 'buyer@example.com', expiry_days: 3 },
    });
  });

  test('7-Eleven: the code is not shown, and the voucher is the page of KOMOJU', async () => {
    const { rail, sent } = fakeKomoju([{ body: konbini('seven-eleven') }]);
    const started = await rail.start({ ...ATTEMPT, method: 'konbini', details: { konbini_store: 'seven_eleven', email: 'b@example.com' } });
    expect(JSON.parse(sent[0]!.text).payment_details.store).toBe('seven-eleven');
    expect(started.start).toMatchObject({
      instructionsUrl: 'https://komoju.com/en/instructions/pay_1',
      codes: [{ stores: ['seven_eleven'], paymentCode: null, confirmationCode: null }],
    });
  });

  test('bank transfer: the names and the phone go to KOMOJU, and the account comes back as data', async () => {
    const bank = {
      ...payment('authorized'),
      payment_details: {
        type: 'bank_transfer',
        bank_name: '三井住友銀行',
        account_branch_name: '東京',
        account_type: '普通',
        account_number: '1234567',
        account_name: 'ｺﾓｼﾞｭ',
        instructions_url: 'https://komoju.com/en/instructions/pay_1',
        payment_deadline: '2026-12-01T14:59:59Z',
      },
    };
    const details = { family_name: '山田', given_name: '太郎', family_name_kana: 'ヤマダ', given_name_kana: 'タロウ', email: 'b@example.com', phone: '09012345678' };
    const { rail, sent } = fakeKomoju([{ body: bank }]);
    const started = await rail.start({ ...ATTEMPT, method: 'bank_transfer', details });
    expect(started.payment.state).toBe('pending_offline');
    expect(started.start).toMatchObject({ kind: 'bank_details', bankName: '三井住友銀行', accountHolder: 'ｺﾓｼﾞｭ', deadlineMs });
    expect(JSON.parse(sent[0]!.text).payment_details).toEqual({ type: 'bank_transfer', ...details, expiry_days: 3 });
  });

  test('PayPay: the payment waits for the wallet, at the URL that KOMOJU gives', async () => {
    const wallet = { ...payment('pending'), payment_details: { type: 'paypay', redirect_url: 'https://komoju.com/paypay/x' } };
    const { rail, sent } = fakeKomoju([{ body: wallet }]);
    const started = await rail.start({ ...ATTEMPT, method: 'paypay', details: {} });
    expect(started).toMatchObject({
      ref: 'payment:pay_1',
      payment: { state: 'requires_action' },
      start: { kind: 'redirect', url: 'https://komoju.com/paypay/x' },
    });
    expect(JSON.parse(sent[0]!.text).payment_details).toEqual({ type: 'paypay' });
  });

  test('a payment reference reads and cancels the payment, not a session', async () => {
    const read = fakeKomoju([{ body: { ...konbini('lawson'), status: 'captured' } }]);
    expect(await read.rail.read('payment:pay_1')).toEqual({
      state: 'succeeded',
      paid: { amount: 4600, currency: 'JPY' },
      failure: null,
    });
    expect(read.sent[0]?.url).toBe('https://komoju.com/api/v1/payments/pay_1');
    const cancel = fakeKomoju([{ body: { ...konbini('lawson'), status: 'cancelled' } }]);
    expect(await cancel.rail.cancel('payment:pay_1')).toEqual({ kind: 'cancelled' });
    expect(cancel.sent[0]?.url).toBe('https://komoju.com/api/v1/payments/pay_1/cancel');
  });

  test('each method but the card takes yen only, inside the limits of KOMOJU', () => {
    expect(komojuRail.accepts('card', 'USD', 100)).toBe(true);
    expect(komojuRail.accepts('konbini', 'USD', 1000)).toBe(false);
    expect(komojuRail.accepts('konbini', 'JPY', 300_001)).toBe(false);
    expect(komojuRail.accepts('paypay', 'JPY', 1_000_000)).toBe(true);
    expect(komojuRail.fields('bank_transfer')).toContain('family_name_kana');
  });
});

test.describe('the KOMOJU rail: the other Japanese methods', () => {
  test('each wallet is a redirect method that the server starts with only its type', async () => {
    const types = { rakuten_pay: 'rakutenpay', merpay: 'merpay', au_pay: 'aupay', d_barai: 'docomo' } as const;
    for (const [method, type] of Object.entries(types)) {
      const wallet = { ...payment('pending'), payment_details: { type, redirect_url: `https://komoju.com/${type}/x` } };
      const { rail, sent } = fakeKomoju([{ body: wallet }]);
      const started = await rail.start({ ...ATTEMPT, method: method as keyof typeof types, details: {} });
      expect(JSON.parse(sent[0]!.text).payment_details, method).toEqual({ type });
      expect(started.payment.state).toBe('requires_action');
      expect(started.start).toEqual({ kind: 'redirect', url: `https://komoju.com/${type}/x` });
      expect(komojuRail.fields(method as keyof typeof types)).toEqual([]);
    }
  });

  test('Paidy also needs the name of the customer', async () => {
    const paidy = { ...payment('pending'), payment_details: { type: 'paidy', redirect_url: 'https://komoju.com/paidy/x' } };
    const { rail, sent } = fakeKomoju([{ body: paidy }]);
    await rail.start({ ...ATTEMPT, method: 'paidy', details: { full_name: '山田 太郎', email: 'b@example.com' } });
    expect(JSON.parse(sent[0]!.text).payment_details).toEqual({ type: 'paidy', customer_name: '山田 太郎', email: 'b@example.com' });
    expect(komojuRail.fields('paidy')).toEqual(['full_name', 'email']);
  });

  test('Pay-easy waits as konbini does, and its voucher is the page of KOMOJU', async () => {
    const payEasy = {
      ...payment('authorized'),
      payment_deadline: '2026-12-01T14:59:59Z',
      payment_details: { type: 'pay_easy', instructions_url: 'https://komoju.com/en/instructions/pay_1' },
    };
    const { rail } = fakeKomoju([{ body: payEasy }]);
    const started = await rail.start({ ...ATTEMPT, method: 'pay_easy', details: {} });
    expect(started.payment.state).toBe('pending_offline');
    expect(started.start).toEqual({
      kind: 'voucher',
      deadlineMs: Date.parse('2026-12-01T14:59:59Z'),
      instructionsUrl: 'https://komoju.com/en/instructions/pay_1',
      codes: [],
    });
  });

  test('the limits of each method', () => {
    expect(komojuRail.accepts('rakuten_pay', 'JPY', 99)).toBe(false);
    expect(komojuRail.accepts('rakuten_pay', 'JPY', 100)).toBe(true);
    expect(komojuRail.accepts('pay_easy', 'JPY', 1_000_000)).toBe(false);
    expect(komojuRail.accepts('paidy', 'USD', 100)).toBe(false);
  });
});
