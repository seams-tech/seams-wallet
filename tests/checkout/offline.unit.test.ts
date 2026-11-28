import { expect, test } from '@playwright/test';
import type { CheckoutErrorBody } from '../../packages/checkout/src/shared/api';
import { FakeProvider, fakeRail } from './fakeRail';
import { PROJECT, openCheckout, type TestCheckout } from './harness';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const KONBINI = { method: 'konbini', details: { konbini_store: 'lawson' } };

let checkout: TestCheckout;
/** The provider of the second rail, which takes the Japanese methods. */
let japan: FakeProvider;
/** The provider of the first rail, which takes cards. */
let cards: FakeProvider;

test.beforeEach(async () => {
  japan = new FakeProvider();
  cards = new FakeProvider();
  checkout = await openCheckout({
    rails: [
      fakeRail(cards, 'fake', ['card', 'paypay']),
      fakeRail(japan, 'fake2', ['konbini', 'bank_transfer', 'paypay']),
    ],
  });
});
test.afterEach(async () => {
  await checkout.close();
});

/** Cards on the first rail, the Japanese methods on the second: two providers in one page. */
async function mixedProject(extra: Record<string, unknown> = {}) {
  await checkout.setUp({ card: 'fake', konbini: 'fake2', bank_transfer: 'fake2', paypay: 'fake2' }, undefined, extra);
  return (await checkout.createOrder({ expiresInMinutes: 30 })).body;
}

const errorCode = (body: unknown): string => (body as CheckoutErrorBody).error.code;

test.describe('konbini', () => {
  test('issued, then paid: the order waits in pending and the store payment pays it', async () => {
    const order = await mixedProject();
    const session = await checkout.session(order.clientToken);
    expect(session.body.methods).toEqual([
      { method: 'card', fields: [] },
      { method: 'konbini', fields: ['konbini_store'] },
      { method: 'bank_transfer', fields: [] },
      { method: 'paypay', fields: [] },
    ]);
    const started = await checkout.start(order.clientToken, KONBINI);
    expect(started.body).toMatchObject({
      method: 'konbini',
      rail: 'fake2',
      state: 'pending_offline',
      start: { kind: 'voucher', codes: [{ paymentCode: '123456' }] },
    });
    expect(japan.last.attempt).toMatchObject({ amount: 4600, offlineDays: 3, details: { konbini_store: 'lawson' } });
    expect(checkout.eventTypes()).toEqual(['order.pending']);
    // The voucher comes back when the customer opens the checkout again.
    expect((await checkout.session(order.clientToken)).body.attempt?.start).toEqual(started.body?.start);

    checkout.clock.nowMs += DAY;
    japan.pay(japan.last.ref);
    await checkout.webhook(japan.last.ref, 'fake2', japan);
    expect((await checkout.getOrder(order.id)).state).toBe('paid');
    expect(checkout.eventTypes()).toEqual(['order.pending', 'order.paid']);
  });

  test('a voucher keeps its order open past the order expiry, until its own deadline', async () => {
    const order = await mixedProject({ voucherDays: 2 });
    await checkout.start(order.clientToken, KONBINI);
    expect(japan.last.attempt.offlineDays).toBe(2);
    checkout.clock.nowMs += DAY;
    await checkout.tick();
    expect((await checkout.getOrder(order.id)).state).toBe('open');
    // The stock stays reserved until `order.expired`.
    expect(checkout.eventTypes()).toEqual(['order.pending']);
  });

  test('expired: after the deadline the voucher is cancelled, and the merchant gets order.expired', async () => {
    const order = await mixedProject();
    await checkout.start(order.clientToken, KONBINI);
    const { ref } = japan.last;
    // A store can still take the voucher for a short time after the deadline.
    checkout.clock.nowMs += 3 * DAY + 60 * MINUTE;
    await checkout.tick();
    expect((await checkout.getOrder(order.id)).state).toBe('open');
    checkout.clock.nowMs += 61 * MINUTE;
    await checkout.tick();
    const expired = await checkout.getOrder(order.id);
    expect(expired.state).toBe('expired');
    expect(expired.attempts[0]?.state).toBe('expired');
    expect(japan.calls).toContain(`cancel:${ref}`);
    expect(checkout.eventTypes()).toEqual(['order.pending', 'order.expired']);
  });

  test('the provider reports the expiry first: the same result', async () => {
    const order = await mixedProject();
    await checkout.start(order.clientToken, KONBINI);
    checkout.clock.nowMs += 3 * DAY + MINUTE;
    japan.set(japan.last.ref, 'expired');
    await checkout.webhook(japan.last.ref, 'fake2', japan);
    expect((await checkout.getOrder(order.id)).state).toBe('expired');
    expect(checkout.eventTypes()).toEqual(['order.pending', 'order.expired']);
  });

  test('a method needs its details before it starts', async () => {
    const order = await mixedProject();
    const started = await checkout.start(order.clientToken, { method: 'konbini' });
    expect(started.status).toBe(422);
    expect(errorCode(started.body)).toBe('details_required');
    expect(japan.calls).toEqual([]);
  });
});

test.describe('a change of method', () => {
  test('the voucher is cancelled at the provider, and the card pays the order', async () => {
    const order = await mixedProject();
    await checkout.start(order.clientToken, KONBINI);
    const voucher = japan.last.ref;
    await checkout.start(order.clientToken, { method: 'card' });
    expect(japan.calls).toEqual(['start:konbini', `cancel:${voucher}`]);
    const card = cards.last.ref;
    cards.pay(card);
    await checkout.webhook(card, 'fake', cards);
    const paid = await checkout.getOrder(order.id);
    expect(paid.state).toBe('paid');
    expect(paid.attempts.map((attempt) => [attempt.method, attempt.rail, attempt.state])).toEqual([
      ['konbini', 'fake2', 'cancelled'],
      ['card', 'fake', 'succeeded'],
    ]);
    expect(paid.needsReview).toBe(false);
  });

  test('a voucher that the rail cannot cancel, paid after the card payment, is an unexpected payment', async () => {
    const order = await mixedProject();
    await checkout.start(order.clientToken, KONBINI);
    const voucher = japan.last.ref;
    japan.cancelAnswer = 'not_supported';
    await checkout.start(order.clientToken, { method: 'card' });
    cards.pay(cards.last.ref);
    await checkout.webhook(cards.last.ref, 'fake', cards);

    japan.pay(voucher);
    await checkout.webhook(voucher, 'fake2', japan);
    const order2 = await checkout.getOrder(order.id);
    expect(order2).toMatchObject({ state: 'paid', needsReview: true });
    expect(checkout.eventTypes()).toEqual(['order.pending', 'order.paid', 'order.unexpected_payment']);
    expect(checkout.merchant.events[2]?.event).toMatchObject({ payment: { rail: 'fake2', reason: 'attempt_not_active' } });
  });
});

test.describe('bank transfer', () => {
  test('the details are issued, and the transfer pays the order', async () => {
    const order = await mixedProject();
    const started = await checkout.start(order.clientToken, { method: 'bank_transfer' });
    expect(started.body).toMatchObject({
      state: 'pending_offline',
      start: { kind: 'bank_details', bankName: 'Seams Bank', accountNumber: '1234567' },
    });
    japan.pay(japan.last.ref);
    await checkout.webhook(japan.last.ref, 'fake2', japan);
    expect((await checkout.getOrder(order.id)).state).toBe('paid');
  });

  test('a transfer of the wrong amount is recorded and does not pay the order', async () => {
    const order = await mixedProject();
    await checkout.start(order.clientToken, { method: 'bank_transfer' });
    // The provider keeps the payment open and reports the money that it could not apply.
    await checkout.webhook(japan.last.ref, 'fake2', japan, 4000);
    await checkout.webhook(japan.last.ref, 'fake2', japan, 4000);
    const review = await checkout.getOrder(order.id);
    expect(review).toMatchObject({ state: 'open', needsReview: true });
    expect(review.attempts[0]?.state).toBe('pending_offline');
    expect(checkout.eventTypes()).toEqual(['order.pending', 'order.unexpected_payment']);
    expect(checkout.merchant.events[1]?.event).toMatchObject({ payment: { amount: 4000, reason: 'wrong_amount' } });
  });

  test('a transfer that arrives after the cancel is recorded for the cancelled attempt', async () => {
    const order = await mixedProject();
    await checkout.start(order.clientToken, { method: 'bank_transfer' });
    const transfer = japan.last.ref;
    await checkout.start(order.clientToken, { method: 'card' });
    await checkout.webhook(transfer, 'fake2', japan, 4600);
    expect(await checkout.getOrder(order.id)).toMatchObject({ state: 'open', needsReview: true });
    expect(checkout.merchant.events.at(-1)?.event).toMatchObject({ payment: { reason: 'attempt_not_active' } });
  });
});

test.describe('PayPay', () => {
  test('approve: the customer goes to the wallet, and the rail event pays the order', async () => {
    const order = await mixedProject();
    const started = await checkout.start(order.clientToken, { method: 'paypay' });
    expect(started.body).toMatchObject({
      rail: 'fake2',
      state: 'requires_action',
      start: { kind: 'redirect', url: 'https://provider.example.test/paypay/fp_1' },
    });
    expect(japan.last.attempt.returnUrl).toBe('https://checkout.example.test/return');
    expect(checkout.eventTypes()).toEqual([]);
    japan.pay(japan.last.ref);
    await checkout.webhook(japan.last.ref, 'fake2', japan);
    expect((await checkout.getOrder(order.id)).state).toBe('paid');
  });

  test('cancel: the attempt fails, the order stays open, and another method can pay', async () => {
    const order = await mixedProject();
    await checkout.start(order.clientToken, { method: 'paypay' });
    japan.set(japan.last.ref, 'failed');
    await checkout.webhook(japan.last.ref, 'fake2', japan);
    const open = await checkout.getOrder(order.id);
    expect(open.state).toBe('open');
    expect(open.attempts[0]?.state).toBe('failed');
    expect((await checkout.session(order.clientToken)).body.attempt).toBeNull();
    expect((await checkout.start(order.clientToken, { method: 'card' })).status).toBe(201);
  });

  test('a merchant can route PayPay to the other rail', async () => {
    await checkout.setUp({ card: 'fake', paypay: 'fake' });
    const { body: order } = await checkout.createOrder();
    const started = await checkout.start(order.clientToken, { method: 'paypay' });
    expect(started.body).toMatchObject({ rail: 'fake', start: { kind: 'redirect' } });
    expect(japan.calls).toEqual([]);
  });
});

test.describe('methods and currencies', () => {
  test('a USD order shows only the methods that take USD', async () => {
    await checkout.setUp({ card: 'fake', konbini: 'fake2', paypay: 'fake2' });
    const { body: order } = await checkout.createOrder({ currency: 'USD' });
    expect((await checkout.session(order.clientToken)).body.methods).toEqual([{ method: 'card', fields: [] }]);
    const refused = await checkout.start(order.clientToken, KONBINI);
    expect(errorCode(refused.body)).toBe('method_not_available');
  });

  test('voucherDays is a whole number from 1 to 60', async () => {
    for (const voucherDays of [0, 61, 1.5, 'three']) {
      const answer = await checkout.operator('PUT', `/checkout/projects/${PROJECT}`, {
        routing: {},
        eventUrl: null,
        voucherDays,
      });
      expect(answer.status, String(voucherDays)).toBe(400);
    }
  });
});
