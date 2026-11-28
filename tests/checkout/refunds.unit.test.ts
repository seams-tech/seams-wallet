import { expect, test } from '@playwright/test';
import type { CheckoutErrorBody, CheckoutOrder } from '../../packages/checkout/src/shared/api';
import { SECRET_KEY, openCheckout, type TestCheckout } from './harness';

let checkout: TestCheckout;
let orderId: string;
let ref: string;

test.beforeEach(async () => {
  checkout = await openCheckout();
  await checkout.setUp();
  const { body } = await checkout.createOrder();
  orderId = body.id;
  await checkout.start(body.clientToken);
  ref = checkout.provider.last.ref;
});
test.afterEach(async () => {
  await checkout.close();
});

async function pay(): Promise<void> {
  checkout.provider.pay(ref);
  await checkout.webhook(ref);
}

const refund = (body: unknown = {}) =>
  checkout.call<CheckoutOrder>('POST', `/checkout/orders/${orderId}/refunds`, { bearer: SECRET_KEY, body });
const errorCode = (body: unknown): string => (body as CheckoutErrorBody).error.code;

test.describe('refunds', () => {
  test('a full refund goes through the rail of the payment, and the order is refunded', async () => {
    await pay();
    const answer = await refund();
    expect(answer.status).toBe(201);
    expect(answer.body).toMatchObject({ state: 'refunded', refundedAmount: 4600, refunds: [{ amount: 4600, state: 'succeeded' }] });
    expect(checkout.provider.calls.at(-1)).toMatch(new RegExp(`^refund:${ref}:4600:ref-`));
    expect(checkout.eventTypes()).toEqual(['order.paid', 'order.refunded']);
    expect(checkout.merchant.events[1]?.event).toMatchObject({
      refund: { amount: 4600, state: 'succeeded' },
      order: { state: 'refunded', refundedAmount: 4600 },
    });
  });

  test('partial refunds add up, and no refund sends back more than was paid', async () => {
    await pay();
    expect((await refund({ amount: 600 })).body).toMatchObject({ state: 'partially_refunded', refundedAmount: 600 });
    const tooMuch = await refund({ amount: 4001 });
    expect(tooMuch.status).toBe(409);
    expect(errorCode(tooMuch.body)).toBe('refund_not_possible');
    expect((await refund({ amount: 4000 })).body).toMatchObject({ state: 'refunded', refundedAmount: 4600 });
    expect(errorCode((await refund()).body)).toBe('refund_not_possible');
    expect(checkout.eventTypes()).toEqual(['order.paid', 'order.refunded', 'order.refunded']);
    for (const amount of [0, -5, 1.5, '600']) {
      expect((await refund({ amount })).status, String(amount)).toBe(409);
    }
  });

  test('an order that is not paid has nothing to refund', async () => {
    expect(errorCode((await refund()).body)).toBe('refund_not_possible');
    expect(checkout.provider.calls).not.toContain('refund');
  });

  test('a refund that waits at the provider keeps its amount, and the rail event completes it', async () => {
    await pay();
    checkout.provider.refundAnswer = 'pending';
    const waiting = await refund({ amount: 4000 });
    expect(waiting.body).toMatchObject({ state: 'paid', refundedAmount: 0, refunds: [{ amount: 4000, state: 'pending' }] });
    // The pending refund holds its amount.
    expect((await refund({ amount: 601 })).status).toBe(409);
    const refundId = waiting.body.refunds[0]!.id;
    await checkout.providerEvent({ refund: { refundId, state: 'succeeded' } });
    await checkout.providerEvent({ refund: { refundId, state: 'succeeded' } });
    expect(await checkout.getOrder(orderId)).toMatchObject({ state: 'partially_refunded', refundedAmount: 4000 });
    expect(checkout.eventTypes()).toEqual(['order.paid', 'order.refunded']);
  });

  test('a refund that fails at the provider frees its amount, with no event', async () => {
    await pay();
    checkout.provider.refundAnswer = 'pending';
    const refundId = (await refund()).body.refunds[0]!.id;
    await checkout.providerEvent({ refund: { refundId, state: 'failed' } });
    expect(await checkout.getOrder(orderId)).toMatchObject({ state: 'paid', refunds: [{ state: 'failed' }] });
    checkout.provider.refundAnswer = 'succeeded';
    expect((await refund()).body.state).toBe('refunded');
    expect(checkout.eventTypes()).toEqual(['order.paid', 'order.refunded']);
  });

  test('no answer: the refund stays pending, and a retry with its ID uses the same ID at the provider', async () => {
    await pay();
    checkout.provider.refundAnswer = 'no_answer';
    expect((await refund({ amount: 1000 })).status).toBe(503);
    const [pending] = (await checkout.getOrder(orderId)).refunds;
    expect(pending).toMatchObject({ amount: 1000, state: 'pending' });
    checkout.provider.refundAnswer = 'succeeded';
    const again = await refund({ refundId: pending!.id });
    expect(again.body).toMatchObject({ state: 'partially_refunded', refundedAmount: 1000 });
    const calls = checkout.provider.calls.filter((call) => call.startsWith('refund:'));
    expect(calls).toEqual([`refund:${ref}:1000:${pending!.id}`, `refund:${ref}:1000:${pending!.id}`]);
    expect((await refund({ refundId: pending!.id })).status).toBe(409);
  });

  test('a rail that cannot refund, or that refuses, says so, and the order stays paid', async () => {
    await pay();
    for (const answer of ['not_supported', 'refused'] as const) {
      checkout.provider.refundAnswer = answer;
      const refused = await refund();
      expect(errorCode(refused.body)).toBe(answer === 'refused' ? 'rail_refused' : 'refund_not_possible');
    }
    expect(await checkout.getOrder(orderId)).toMatchObject({ state: 'paid', refundedAmount: 0 });
    expect(checkout.eventTypes()).toEqual(['order.paid']);
  });
});

test.describe('disputes', () => {
  test('a dispute marks the order and sends order.disputed once', async () => {
    await pay();
    await checkout.providerEvent({ dispute: { ref, disputeRef: 'dp_1' } });
    await checkout.providerEvent({ dispute: { ref, disputeRef: 'dp_1' } });
    expect(await checkout.getOrder(orderId)).toMatchObject({ state: 'paid', disputed: true });
    expect(checkout.eventTypes()).toEqual(['order.paid', 'order.disputed']);
    expect(checkout.merchant.events[1]?.event).toMatchObject({
      dispute: { rail: 'fake', ref: 'dp_1' },
      order: { disputed: true },
    });
  });

  test('a dispute of a payment that the checkout did not make is ignored', async () => {
    const answer = await checkout.providerEvent({ dispute: { ref: 'fp_unknown', disputeRef: 'dp_2' } });
    expect(answer.status).toBe(200);
    expect(checkout.eventTypes()).toEqual([]);
  });
});
