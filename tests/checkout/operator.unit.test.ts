import { expect, test } from '@playwright/test';
import type { CheckoutOrder } from '../../packages/checkout/src/shared/api';
import { PROJECT, SECRET_KEY, openCheckout, type TestCheckout } from './harness';

let checkout: TestCheckout;

test.beforeEach(async () => {
  checkout = await openCheckout();
  await checkout.setUp();
});
test.afterEach(async () => {
  await checkout.close();
});

const base = `/checkout/projects/${PROJECT}`;

test.describe('the operator routes', () => {
  test('the project view has the configuration and each webhook URL, and no provider key', async () => {
    const { status, body } = await checkout.operator<Record<string, unknown>>('GET', base);
    expect(status).toBe(200);
    expect(body).toEqual({
      projectId: PROJECT,
      config: { routing: { card: 'fake' }, eventUrl: 'https://shop.example.test/seams-events' },
      rails: [{ rail: 'fake', methods: ['card'] }],
      accounts: [
        {
          rail: 'fake',
          public: { publishableKey: 'fake_pk' },
          webhookUrl: `https://checkout.example.test/checkout/webhooks/fake/${PROJECT}`,
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain('fake-webhook-secret');
  });

  test('only the operator reads a project, and only its own orders', async () => {
    expect((await checkout.call('GET', base, { bearer: SECRET_KEY })).status).toBe(401);
    expect((await checkout.operator('GET', '/checkout/projects/unknown')).status).toBe(404);
    const { body: order } = await checkout.createOrder();
    await checkout.operator('PUT', '/checkout/projects/project-2', { routing: {}, eventUrl: null });
    expect((await checkout.operator('GET', `/checkout/projects/project-2/orders/${order.id}`)).status).toBe(404);
  });

  test('the order list is newest first, and can show only the orders to review', async () => {
    const first = (await checkout.createOrder({ reference: 'a' })).body;
    checkout.clock.nowMs += 1000;
    const second = (await checkout.createOrder({ reference: 'b' })).body;
    const all = await checkout.operator<{ orders: CheckoutOrder[] }>('GET', `${base}/orders`);
    expect(all.body.orders.map((order) => order.reference)).toEqual(['b', 'a']);
    const older = await checkout.operator<{ orders: CheckoutOrder[] }>('GET', `${base}/orders?before=${second.createdAtMs}`);
    expect(older.body.orders.map((order) => order.id)).toEqual([first.id]);
    const review = await checkout.operator<{ orders: CheckoutOrder[] }>('GET', `${base}/orders?needsReview=1`);
    expect(review.body.orders).toEqual([]);
  });

  test('the operator sees an unexpected payment, refunds the order and ends the review', async () => {
    const { body: order } = await checkout.createOrder();
    await checkout.start(order.clientToken);
    const { ref } = checkout.provider.last;
    checkout.provider.pay(ref, 5000);
    await checkout.webhook(ref);

    const review = await checkout.operator<{ orders: CheckoutOrder[] }>('GET', `${base}/orders?needsReview=1`);
    expect(review.body.orders.map((listed) => listed.id)).toEqual([order.id]);
    const detail = await checkout.operator<{ order: CheckoutOrder; unexpectedPayments: unknown[] }>('GET', `${base}/orders/${order.id}`);
    expect(detail.body.unexpectedPayments).toMatchObject([
      { rail_id: 'fake', rail_ref: ref, amount: 5000, currency: 'JPY', reason: 'wrong_amount' },
    ]);

    const reviewed = await checkout.operator<CheckoutOrder>('POST', `${base}/orders/${order.id}/review`, {});
    expect(reviewed.body.needsReview).toBe(false);
    // The record of the payment stays.
    const after = await checkout.operator<{ unexpectedPayments: unknown[] }>('GET', `${base}/orders/${order.id}`);
    expect(after.body.unexpectedPayments).toHaveLength(1);
  });

  test('the operator refunds a paid order through its rail', async () => {
    const { body: order } = await checkout.createOrder();
    await checkout.start(order.clientToken);
    checkout.provider.pay(checkout.provider.last.ref);
    await checkout.webhook(checkout.provider.last.ref);
    const refunded = await checkout.operator<CheckoutOrder>('POST', `${base}/orders/${order.id}/refunds`, { amount: 600 });
    expect(refunded.body).toMatchObject({ state: 'partially_refunded', refundedAmount: 600 });
  });
});
