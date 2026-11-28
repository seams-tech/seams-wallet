import { expect, test } from '@playwright/test';
import type { CheckoutErrorBody } from '../../packages/checkout/src/shared/api';
import { verifyOrderEvent } from '../../packages/checkout/src/server/index';
import {
  EVENT_URL,
  ORDER,
  PROJECT,
  PUBLISHABLE_KEY,
  SECRET_KEY,
  SHOP_ORIGIN,
  openCheckout,
  type TestCheckout,
} from './harness';

const MINUTE = 60_000;
let checkout: TestCheckout;
let eventSecret: string;

test.beforeEach(async () => {
  checkout = await openCheckout();
  eventSecret = await checkout.setUp();
});
test.afterEach(async () => {
  await checkout.close();
});

function errorCode(body: unknown): string {
  return (body as CheckoutErrorBody).error.code;
}

test.describe('orders', () => {
  test('the server computes the amount from the lines and the shipping', async () => {
    const { status, body } = await checkout.createOrder();
    expect(status).toBe(201);
    expect(body).toMatchObject({
      reference: 'order-1042',
      state: 'open',
      currency: 'JPY',
      amount: 4600,
      shippingAmount: 600,
      customerEmail: 'buyer@example.com',
      attempts: [],
    });
    expect(body.clientToken).toContain(body.id);
  });

  test('a repeat with the same reference returns the same order and client token', async () => {
    const first = await checkout.createOrder();
    const again = await checkout.createOrder();
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.clientToken).toBe(first.body.clientToken);
  });

  test('a reference cannot name a second order with another content', async () => {
    await checkout.createOrder();
    const other = await checkout.createOrder({ shipping: { amount: 700 } });
    expect(other.status).toBe(409);
    expect(errorCode(other.body)).toBe('reference_reused');
  });

  test('an order needs a known currency and whole positive amounts', async () => {
    const bad: unknown[] = [
      { currency: 'EUR' },
      { lines: [] },
      { lines: [{ name: 'Cake', unitAmount: 10.5, quantity: 1 }] },
      { lines: [{ name: 'Cake', unitAmount: 100, quantity: 0 }] },
      { lines: [{ name: '', unitAmount: 100, quantity: 1 }] },
      { shipping: { amount: -1 } },
      { reference: '  ' },
      { customerEmail: 'not-an-address' },
      { expiresInMinutes: 0 },
    ];
    for (const change of bad) {
      const answer = await checkout.createOrder(change as object);
      expect(answer.status, JSON.stringify(change)).toBe(400);
    }
  });

  test('only the secret key of the project makes or reads an order', async () => {
    const wrong = await checkout.call('POST', '/checkout/orders', { bearer: 'sk_other', body: ORDER });
    expect(wrong.status).toBe(401);
    const { body } = await checkout.createOrder();
    // A publishable key and a client token are not a secret key.
    for (const bearer of [PUBLISHABLE_KEY, body.clientToken]) {
      expect((await checkout.call('GET', `/checkout/orders/${body.id}`, { bearer })).status).toBe(401);
    }
  });
});

test.describe('the session of the checkout frame', () => {
  test('a client token reads its order and the methods that the routing table enables', async () => {
    const { body } = await checkout.createOrder();
    const session = await checkout.session(body.clientToken);
    expect(session.status).toBe(200);
    expect(session.body.order).toMatchObject({ id: body.id, amount: 4600, currency: 'JPY', state: 'open' });
    expect(session.body.methods).toEqual([{ method: 'card', fields: [] }]);
    expect(session.body.attempt).toBeNull();
  });

  test('a method with no connected account does not appear', async () => {
    const empty = await openCheckout();
    try {
      await empty.operator('PUT', `/checkout/projects/${PROJECT}`, { routing: { card: 'fake' }, eventUrl: null });
      const { body } = await empty.createOrder();
      expect((await empty.session(body.clientToken)).body.methods).toEqual([]);
      const start = await empty.start(body.clientToken);
      expect(errorCode(start.body)).toBe('method_not_available');
    } finally {
      await empty.close();
    }
  });

  test('a changed client token, another origin or another key reads nothing', async () => {
    const { body } = await checkout.createOrder();
    const headers = { 'seams-publishable-key': PUBLISHABLE_KEY, 'seams-parent-origin': SHOP_ORIGIN };
    const forged = `${body.clientToken.slice(0, -1)}${body.clientToken.endsWith('0') ? '1' : '0'}`;
    const tries = [
      { bearer: forged, headers },
      { bearer: body.clientToken, headers: { ...headers, 'seams-parent-origin': 'https://evil.example' } },
      { bearer: body.clientToken, headers: { ...headers, 'seams-publishable-key': 'pk_other' } },
      { bearer: body.clientToken },
    ];
    for (const attempt of tries) {
      expect((await checkout.call('GET', '/checkout/session', attempt)).status).toBe(401);
    }
  });
});

test.describe('a card payment', () => {
  test('the rail gets the amount and currency of the order, not of the browser', async () => {
    const { body } = await checkout.createOrder();
    const started = await checkout.start(body.clientToken, { method: 'card', amount: 1, currency: 'USD' });
    expect(started.status).toBe(201);
    expect(checkout.provider.last.attempt).toMatchObject({
      amount: 4600,
      currency: 'JPY',
      orderReference: 'order-1042',
      details: { email: 'buyer@example.com' },
    });
    expect(started.body).toMatchObject({
      method: 'card',
      rail: 'fake',
      state: 'created',
      start: { kind: 'card_form', publishableKey: 'fake_pk' },
    });
  });

  test('success: the verified webhook moves the attempt and the order, and the merchant gets order.paid', async () => {
    const { body } = await checkout.createOrder();
    await checkout.start(body.clientToken);
    const { ref } = checkout.provider.last;
    checkout.provider.pay(ref);
    // The browser saw the success, but only the rail event counts.
    expect((await checkout.getOrder(body.id)).state).toBe('open');

    expect((await checkout.webhook(ref)).status).toBe(200);
    const order = await checkout.getOrder(body.id);
    expect(order.state).toBe('paid');
    expect(order.attempts.map((attempt) => attempt.state)).toEqual(['succeeded']);
    expect(checkout.eventTypes()).toEqual(['order.paid']);

    const [delivered] = checkout.merchant.events;
    const event = await verifyOrderEvent({
      body: delivered!.body,
      signature: delivered!.signature,
      secret: eventSecret,
      nowMs: checkout.clock.nowMs,
    });
    expect(event?.order).toMatchObject({ id: body.id, state: 'paid', amount: 4600 });
    const forged = await verifyOrderEvent({
      body: delivered!.body.replace('4600', '1'),
      signature: delivered!.signature,
      secret: eventSecret,
      nowMs: checkout.clock.nowMs,
    });
    expect(forged).toBeNull();
    const old = await verifyOrderEvent({
      body: delivered!.body,
      signature: delivered!.signature,
      secret: eventSecret,
      nowMs: checkout.clock.nowMs + 6 * MINUTE,
    });
    expect(old).toBeNull();
  });

  test('decline: the attempt stays open with the refusal, and a second card can pay it', async () => {
    const { body } = await checkout.createOrder();
    await checkout.start(body.clientToken);
    const { ref } = checkout.provider.last;
    checkout.provider.decline(ref);
    await checkout.webhook(ref);
    let order = await checkout.getOrder(body.id);
    expect(order.state).toBe('open');
    expect(order.attempts[0]).toMatchObject({ state: 'created', failure: { code: 'card_declined' } });
    expect(checkout.eventTypes()).toEqual([]);

    checkout.provider.pay(ref);
    await checkout.webhook(ref);
    order = await checkout.getOrder(body.id);
    expect(order.state).toBe('paid');
    expect(order.attempts).toHaveLength(1);
  });

  test('3-D Secure: the attempt waits in requires_action and then succeeds', async () => {
    const { body } = await checkout.createOrder();
    await checkout.start(body.clientToken);
    const { ref } = checkout.provider.last;
    checkout.provider.set(ref, 'requires_action');
    await checkout.webhook(ref);
    expect((await checkout.session(body.clientToken)).body.attempt?.state).toBe('requires_action');
    checkout.provider.pay(ref);
    await checkout.webhook(ref);
    expect((await checkout.getOrder(body.id)).state).toBe('paid');
  });

  test('a repeat of the same start returns the same attempt, and the rail is called once', async () => {
    const { body } = await checkout.createOrder();
    const first = await checkout.start(body.clientToken);
    const again = await checkout.start(body.clientToken);
    expect(again.body?.id).toBe(first.body?.id);
    expect(checkout.provider.calls).toEqual(['start:card']);
    // The frame gets the same next step after a reload.
    expect((await checkout.session(body.clientToken)).body.attempt).toEqual(first.body);
  });

  test('a start with other details cancels the old attempt first: one active attempt', async () => {
    const { body } = await checkout.createOrder();
    const first = await checkout.start(body.clientToken);
    const second = await checkout.start(body.clientToken, { method: 'card', details: { email: 'other@example.com' } });
    expect(second.body?.id).not.toBe(first.body?.id);
    const order = await checkout.getOrder(body.id);
    expect(order.attempts.map((attempt) => attempt.state)).toEqual(['cancelled', 'created']);
    expect(checkout.provider.calls).toEqual(['start:card', 'cancel:fp_1', 'start:card']);
  });

  test('a payment in its last step is not replaced by a new attempt', async () => {
    const { body } = await checkout.createOrder();
    await checkout.start(body.clientToken);
    checkout.provider.cancelAnswer = 'too_late';
    const second = await checkout.start(body.clientToken, { method: 'card', details: { email: 'other@example.com' } });
    expect(second.status).toBe(409);
    expect(errorCode(second.body)).toBe('order_not_open');
    expect((await checkout.getOrder(body.id)).attempts.map((attempt) => attempt.state)).toEqual(['created']);
  });

  test('a provider that refuses or gives no answer fails the attempt, and the order stays open', async () => {
    const { body } = await checkout.createOrder();
    checkout.provider.startAnswer = 'no_answer';
    const down = await checkout.start(body.clientToken);
    expect(down.status).toBe(503);
    expect(errorCode(down.body)).toBe('rail_unavailable');
    checkout.provider.startAnswer = 'refused';
    expect(errorCode((await checkout.start(body.clientToken)).body)).toBe('rail_refused');
    checkout.provider.startAnswer = 'ok';
    expect((await checkout.start(body.clientToken)).status).toBe(201);
    const order = await checkout.getOrder(body.id);
    expect(order.state).toBe('open');
    expect(order.attempts.map((attempt) => attempt.state)).toEqual(['failed', 'failed', 'created']);
  });

  test('an unknown method and a method with no route are refused', async () => {
    const { body } = await checkout.createOrder();
    expect((await checkout.start(body.clientToken, { method: 'cash' })).status).toBe(400);
    expect((await checkout.start(body.clientToken, {})).status).toBe(400);
  });
});

test.describe('expiry and cancel', () => {
  test('an order with no payment expires, and the merchant gets order.expired once', async () => {
    const { body } = await checkout.createOrder({ expiresInMinutes: 30 });
    checkout.clock.nowMs += 29 * MINUTE;
    await checkout.tick();
    expect((await checkout.getOrder(body.id)).state).toBe('open');
    checkout.clock.nowMs += MINUTE;
    await checkout.tick();
    await checkout.tick();
    expect((await checkout.getOrder(body.id)).state).toBe('expired');
    expect(checkout.eventTypes()).toEqual(['order.expired']);
    expect(errorCode((await checkout.start(body.clientToken)).body)).toBe('order_not_open');
    expect((await checkout.session(body.clientToken)).body.methods).toEqual([]);
  });

  test('a payment in flight keeps the order open past its expiry, until the attempt deadline', async () => {
    const { body } = await checkout.createOrder({ expiresInMinutes: 30 });
    await checkout.start(body.clientToken);
    const { ref } = checkout.provider.last;
    checkout.provider.set(ref, 'requires_action');
    await checkout.webhook(ref);

    checkout.clock.nowMs += 31 * MINUTE;
    await checkout.tick();
    expect((await checkout.getOrder(body.id)).state).toBe('open');
    // No new payment starts after the expiry.
    const late = await checkout.start(body.clientToken, { method: 'card', details: { email: 'x@example.com' } });
    expect(errorCode(late.body)).toBe('order_not_open');

    checkout.clock.nowMs += 15 * MINUTE;
    await checkout.tick();
    const order = await checkout.getOrder(body.id);
    expect(order.state).toBe('expired');
    expect(order.attempts[0]?.state).toBe('expired');
    expect(checkout.provider.calls).toContain(`cancel:${ref}`);
  });

  test('a challenge that completes after the expiry still pays the order', async () => {
    const { body } = await checkout.createOrder({ expiresInMinutes: 30 });
    await checkout.start(body.clientToken);
    const { ref } = checkout.provider.last;
    checkout.clock.nowMs += 35 * MINUTE;
    checkout.provider.pay(ref);
    await checkout.webhook(ref);
    expect((await checkout.getOrder(body.id)).state).toBe('paid');
  });

  test('the merchant cancels an open order, and its provider payment', async () => {
    const { body } = await checkout.createOrder();
    await checkout.start(body.clientToken);
    const cancelled = await checkout.call('POST', `/checkout/orders/${body.id}/cancel`, { bearer: SECRET_KEY });
    expect(cancelled.body).toMatchObject({ state: 'cancelled', attempts: [{ state: 'cancelled' }] });
    expect(checkout.eventTypes()).toEqual(['order.cancelled']);
    const again = await checkout.call('POST', `/checkout/orders/${body.id}/cancel`, { bearer: SECRET_KEY });
    expect(again.status).toBe(409);
  });
});

test.describe('events for the merchant', () => {
  test('an event stays due until the merchant answers 2xx', async () => {
    checkout.merchant.status = 500;
    const { body } = await checkout.createOrder();
    await checkout.start(body.clientToken);
    checkout.provider.pay(checkout.provider.last.ref);
    await checkout.webhook(checkout.provider.last.ref);
    expect(checkout.eventTypes()).toEqual([]);

    // Too early for the second try.
    checkout.merchant.status = 200;
    await checkout.tick();
    expect(checkout.eventTypes()).toEqual([]);
    checkout.clock.nowMs += MINUTE;
    await checkout.tick();
    await checkout.tick();
    expect(checkout.eventTypes()).toEqual(['order.paid']);
  });

  test('a project with no event URL keeps its events', async () => {
    const quiet = await openCheckout();
    try {
      await quiet.setUp({ card: 'fake' }, null);
      const { body } = await quiet.createOrder();
      await quiet.call('POST', `/checkout/orders/${body.id}/cancel`, { bearer: SECRET_KEY });
      await quiet.operator('PUT', `/checkout/projects/${PROJECT}`, { routing: { card: 'fake' }, eventUrl: EVENT_URL });
      quiet.clock.nowMs += MINUTE;
      await quiet.tick();
      expect(quiet.eventTypes()).toEqual(['order.cancelled']);
    } finally {
      await quiet.close();
    }
  });
});
