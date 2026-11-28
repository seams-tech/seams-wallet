import type { MinorUnits } from './money';

export const ATTEMPT_STATES = [
  'created',
  'requires_action',
  'pending_offline',
  'awaiting_chain',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
] as const;

export type AttemptState = (typeof ATTEMPT_STATES)[number];

/** The states in which an attempt can still bring money. An order has at most one such attempt. */
export const ACTIVE_ATTEMPT_STATES = [
  'created',
  'requires_action',
  'pending_offline',
  'awaiting_chain',
] as const satisfies readonly AttemptState[];

const ATTEMPT_MOVES: Readonly<Record<AttemptState, readonly AttemptState[]>> = {
  created: [
    'requires_action',
    'pending_offline',
    'awaiting_chain',
    'succeeded',
    'failed',
    'cancelled',
    'expired',
  ],
  requires_action: ['succeeded', 'failed', 'cancelled', 'expired'],
  pending_offline: ['succeeded', 'cancelled', 'expired'],
  awaiting_chain: ['succeeded', 'cancelled', 'expired'],
  succeeded: [],
  failed: [],
  cancelled: [],
  expired: [],
};

export function isActiveAttempt(state: AttemptState): boolean {
  return ATTEMPT_MOVES[state].length > 0;
}

/** An attempt never leaves a final state, so a late or repeated rail event changes nothing. */
export function canMoveAttempt(from: AttemptState, to: AttemptState): boolean {
  return ATTEMPT_MOVES[from].includes(to);
}

export type OrderState =
  | 'open'
  | 'paid'
  | 'expired'
  | 'cancelled'
  | 'partially_refunded'
  | 'refunded';

export type OrderFacts = {
  readonly amount: MinorUnits;
  readonly expiresAtMs: number;
  readonly cancelledAtMs: number | null;
  readonly attemptStates: readonly AttemptState[];
  /** The sum of the refunds that the rail completed. */
  readonly refundedAmount: MinorUnits;
};

/**
 * The state of an order. This is the only place that decides it: every reader and every writer
 * of an order state calls this function with the order's attempts and refunds.
 *
 * An active attempt keeps an order open after its expiry, because a voucher, a 3-D Secure
 * challenge or a transfer can still bring the money. The attempt ends at its own deadline.
 */
export function computeOrderState(facts: OrderFacts, nowMs: number): OrderState {
  if (facts.attemptStates.includes('succeeded')) {
    if (facts.refundedAmount >= facts.amount) return 'refunded';
    return facts.refundedAmount > 0 ? 'partially_refunded' : 'paid';
  }
  if (facts.cancelledAtMs !== null) return 'cancelled';
  if (nowMs >= facts.expiresAtMs && !facts.attemptStates.some(isActiveAttempt)) return 'expired';
  return 'open';
}
