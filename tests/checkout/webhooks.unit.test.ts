import { expect, test } from '@playwright/test';
import type { CheckoutErrorBody } from '../../packages/checkout/src/shared/api';
import { PROJECT, SECRET_KEY, openCheckout, type TestCheckout } from './harness';

let checkout: TestCheckout;

test.beforeEach(async () => {
  checkout = await openCheckout();
  await checkout.setUp();
});
test.afterEach(async () => {
  await checkout.close();
});

async function startedOrder() {
  const { body } = await checkout.createOrder();
  await checkout.start(body.clientToken);
  return { order: body, ref: checkout.provider.last.ref };
}

test.describe('rail webhooks', () => {
  test('a webhook with a bad signature changes nothing', async () => {
    const { order, ref } = await startedOrder();
    checkout.provider.pay(ref);
    const { body } = await checkout.provider.webhook(ref);
    const forged = await checkout.provider.webhook(ref, 'another-secret');
    for (const signature of [forged.signature, '', 'not-a-signature']) {
      const answer = await checkout.call<CheckoutErrorBody>('POST', `/checkout/webhooks/fake/${PROJECT}`, {
        raw: body,
        headers: { 'fake-signature': signature },
      });
      expect(answer.status).toBe(400);
      expect(answer.body.error.code).toBe('invalid_signature');
    }
    expect((await checkout.getOrder(order.id)).state).toBe('open');
    expect(checkout.eventTypes()).toEqual([]);
  });

  test('a duplicate webhook changes nothing more: one event for the merchant', async () => {
    const { order, ref } = await startedOrder();
    checkout.provider.pay(ref);
    await checkout.webhook(ref);
    await checkout.webhook(ref);
    await checkout.webhook(ref);
    expect((await checkout.getOrder(order.id)).state).toBe('paid');
    expect(checkout.eventTypes()).toEqual(['order.paid']);
    expect((await checkout.getOrder(order.id)).needsReview).toBe(false);
  });

  test('events in the wrong order converge: the Worker reads the payment, not the event', async () => {
    const { order, ref } = await startedOrder();
    // The provider sent "requires action" and then "paid". The first one arrives last.
    const stale = await checkout.provider.webhook(ref);
    checkout.provider.pay(ref);
    await checkout.webhook(ref);
    const late = await checkout.call('POST', `/checkout/webhooks/fake/${PROJECT}`, {
      raw: stale.body,
      headers: { 'fake-signature': stale.signature },
    });
    expect(late.status).toBe(200);
    const paid = await checkout.getOrder(order.id);
    expect(paid.state).toBe('paid');
    expect(paid.attempts[0]?.state).toBe('succeeded');
  });

  test('a replayed "paid" webhook cannot pay a payment that the provider does not show as paid', async () => {
    const { order, ref } = await startedOrder();
    checkout.provider.pay(ref);
    const paidEvent = await checkout.provider.webhook(ref);
    // The same signed body, but the provider's own record says that nothing was paid.
    checkout.provider.set(ref, 'created');
    checkout.provider.payments.get(ref)!.paidAmount = null;
    await checkout.call('POST', `/checkout/webhooks/fake/${PROJECT}`, {
      raw: paidEvent.body,
      headers: { 'fake-signature': paidEvent.signature },
    });
    expect((await checkout.getOrder(order.id)).state).toBe('open');
  });

  test('a webhook for a payment that the checkout did not make is accepted and ignored', async () => {
    await startedOrder();
    const body = JSON.stringify({ ref: 'fp_unknown', attempt: null });
    const { signature } = await checkout.provider.webhook('fp_unknown');
    const answer = await checkout.call('POST', `/checkout/webhooks/fake/${PROJECT}`, {
      raw: body,
      headers: { 'fake-signature': signature },
    });
    expect(answer.status).toBe(200);
  });

  test('a webhook of one project cannot act on the order of another project', async () => {
    const { order, ref } = await startedOrder();
    await checkout.operator('PUT', '/checkout/projects/project-2', { routing: { card: 'fake' }, eventUrl: null });
    await checkout.operator('PUT', '/checkout/projects/project-2/rails/fake', {});
    checkout.provider.pay(ref);
    const { body, signature } = await checkout.provider.webhook(ref);
    const answer = await checkout.call('POST', '/checkout/webhooks/fake/project-2', {
      raw: body,
      headers: { 'fake-signature': signature },
    });
    expect(answer.status).toBe(200);
    expect((await checkout.getOrder(order.id)).state).toBe('open');
  });

  test('a webhook for a rail or a project that does not exist is not found', async () => {
    for (const path of ['/checkout/webhooks/nope/project-1', '/checkout/webhooks/fake/project-9']) {
      expect((await checkout.call('POST', path, { raw: '{}' })).status).toBe(404);
    }
  });
});

test.describe('unexpected payments', () => {
  test('money for an attempt that the rail could not cancel is recorded and does not pay the order alone', async () => {
    const { body } = await checkout.createOrder();
    await checkout.start(body.clientToken);
    const first = checkout.provider.last.ref;
    // The rail cannot cancel the first payment, so it stays payable at the provider.
    checkout.provider.cancelAnswer = 'not_supported';
    await checkout.start(body.clientToken, { method: 'card', details: { email: 'other@example.com' } });
    const second = checkout.provider.last.ref;

    checkout.provider.pay(second);
    await checkout.webhook(second);
    expect((await checkout.getOrder(body.id)).state).toBe('paid');

    checkout.provider.pay(first);
    await checkout.webhook(first);
    await checkout.webhook(first);
    const order = await checkout.getOrder(body.id);
    expect(order.state).toBe('paid');
    expect(order.needsReview).toBe(true);
    expect(order.attempts.map((attempt) => attempt.state)).toEqual(['cancelled', 'succeeded']);
    expect(checkout.eventTypes()).toEqual(['order.paid', 'order.unexpected_payment']);
    expect(checkout.merchant.events[1]?.event).toMatchObject({
      type: 'order.unexpected_payment',
      payment: { rail: 'fake', amount: 4600, currency: 'JPY', reason: 'attempt_not_active' },
      order: { needsReview: true },
    });
  });

  test('money for an expired order is recorded, and the order stays expired', async () => {
    const { body } = await checkout.createOrder({ expiresInMinutes: 5 });
    await checkout.start(body.clientToken);
    const { ref } = checkout.provider.last;
    checkout.provider.cancelAnswer = 'not_supported';
    checkout.clock.nowMs += 21 * 60_000;
    await checkout.tick();
    expect((await checkout.getOrder(body.id)).state).toBe('expired');

    checkout.provider.pay(ref);
    await checkout.webhook(ref);
    const order = await checkout.getOrder(body.id);
    expect(order).toMatchObject({ state: 'expired', needsReview: true });
    expect(checkout.eventTypes()).toEqual(['order.expired', 'order.unexpected_payment']);
  });

  test('a payment of the wrong amount does not pay the order', async () => {
    const { body } = await checkout.createOrder();
    await checkout.start(body.clientToken);
    const { ref } = checkout.provider.last;
    checkout.provider.pay(ref, 4000);
    await checkout.webhook(ref);
    const order = await checkout.getOrder(body.id);
    expect(order).toMatchObject({ state: 'open', needsReview: true });
    expect(order.attempts[0]).toMatchObject({ state: 'failed', failure: { code: 'wrong_amount' } });
    expect(checkout.merchant.events[0]?.event).toMatchObject({
      type: 'order.unexpected_payment',
      payment: { amount: 4000, reason: 'wrong_amount' },
    });
  });
});

test.describe('project configuration', () => {
  test('only the operator sets the routing table and connects an account', async () => {
    for (const bearer of [SECRET_KEY, 'nobody']) {
      const answer = await checkout.call('PUT', `/checkout/projects/${PROJECT}`, {
        bearer,
        body: { routing: {}, eventUrl: null },
      });
      expect(answer.status).toBe(401);
    }
  });

  test('a route names a loaded rail that takes the method, and the event URL is https', async () => {
    const bad: unknown[] = [
      { routing: { card: 'unknown-rail' }, eventUrl: null },
      { routing: { cash: 'fake' }, eventUrl: null },
      { routing: {}, eventUrl: 'http://shop.example.test/events' },
      { routing: {}, eventUrl: 'ftp://shop.example.test' },
      { routing: {} },
    ];
    for (const body of bad) {
      expect((await checkout.operator('PUT', '/checkout/projects/p3', body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  test('the event secret is shown once, and the provider keys are encrypted in the database', async () => {
    const again = await checkout.operator<{ eventSecret: string | null }>('PUT', `/checkout/projects/${PROJECT}`, {
      routing: { card: 'fake' },
      eventUrl: null,
    });
    expect(again.body.eventSecret).toBeNull();
    const account = await checkout.db
      .prepare('SELECT public_json, secrets_sealed FROM checkout_rail_accounts WHERE project_id = ?')
      .bind(PROJECT)
      .first<{ public_json: string; secrets_sealed: string }>();
    expect(account?.public_json).toContain('fake_pk');
    expect(account?.secrets_sealed).toMatch(/^v1\./);
    expect(account?.secrets_sealed).not.toContain('fake-webhook-secret');
    const project = await checkout.db
      .prepare('SELECT event_secret_sealed FROM checkout_projects WHERE project_id = ?')
      .bind(PROJECT)
      .first<{ event_secret_sealed: string }>();
    expect(project?.event_secret_sealed).toMatch(/^v1\./);
  });
});
