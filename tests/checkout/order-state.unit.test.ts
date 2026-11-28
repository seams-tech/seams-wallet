import { expect, test } from '@playwright/test';
import {
  ATTEMPT_STATES,
  canMoveAttempt,
  computeOrderState,
  isActiveAttempt,
  type AttemptState,
  type OrderFacts,
} from '../../packages/checkout/src/shared/orderState';

const EXPIRY = 1_000;
const facts = (change: Partial<OrderFacts> = {}): OrderFacts => ({
  amount: 4600,
  expiresAtMs: EXPIRY,
  cancelledAtMs: null,
  attemptStates: [],
  refundedAmount: 0,
  ...change,
});

test.describe('the order state function', () => {
  test('an order with no attempt is open until its expiry', () => {
    expect(computeOrderState(facts(), EXPIRY - 1)).toBe('open');
    expect(computeOrderState(facts(), EXPIRY)).toBe('expired');
  });

  test('one succeeded attempt makes the order paid, also after the expiry or a cancel', () => {
    const paid = facts({ attemptStates: ['failed', 'cancelled', 'succeeded'] });
    expect(computeOrderState(paid, EXPIRY - 1)).toBe('paid');
    expect(computeOrderState(paid, EXPIRY + 1)).toBe('paid');
    expect(computeOrderState({ ...paid, cancelledAtMs: 5 }, EXPIRY + 1)).toBe('paid');
  });

  test('an active attempt keeps the order open after the expiry', () => {
    for (const state of ['created', 'requires_action', 'pending_offline', 'awaiting_chain'] as const) {
      expect(computeOrderState(facts({ attemptStates: [state] }), EXPIRY + 1)).toBe('open');
    }
    for (const state of ['failed', 'cancelled', 'expired'] as const) {
      expect(computeOrderState(facts({ attemptStates: [state] }), EXPIRY + 1)).toBe('expired');
    }
  });

  test('a cancel closes an order that is not paid', () => {
    expect(computeOrderState(facts({ cancelledAtMs: 5 }), EXPIRY - 1)).toBe('cancelled');
    expect(computeOrderState(facts({ cancelledAtMs: 5 }), EXPIRY + 1)).toBe('cancelled');
  });

  test('refunds move a paid order to partially refunded and then to refunded', () => {
    const paid = facts({ attemptStates: ['succeeded'] });
    expect(computeOrderState({ ...paid, refundedAmount: 600 }, 0)).toBe('partially_refunded');
    expect(computeOrderState({ ...paid, refundedAmount: 4600 }, 0)).toBe('refunded');
    expect(computeOrderState(facts({ refundedAmount: 600 }), 0)).toBe('open');
  });
});

test.describe('the attempt states', () => {
  const FINAL: readonly AttemptState[] = ['succeeded', 'failed', 'cancelled', 'expired'];

  test('an attempt never leaves a final state', () => {
    for (const from of FINAL) {
      expect(isActiveAttempt(from)).toBe(false);
      for (const to of ATTEMPT_STATES) expect(canMoveAttempt(from, to)).toBe(false);
    }
  });

  test('each active state can reach succeeded, and none goes back to created', () => {
    for (const from of ATTEMPT_STATES.filter((state) => !FINAL.includes(state))) {
      expect(isActiveAttempt(from)).toBe(true);
      expect(canMoveAttempt(from, 'succeeded')).toBe(true);
      expect(canMoveAttempt(from, 'created')).toBe(false);
    }
  });

  test('a voucher or a quote does not fail: it is paid, cancelled or expired', () => {
    expect(canMoveAttempt('pending_offline', 'failed')).toBe(false);
    expect(canMoveAttempt('awaiting_chain', 'failed')).toBe(false);
    expect(canMoveAttempt('pending_offline', 'expired')).toBe(true);
  });
});
