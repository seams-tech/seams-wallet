import { secureRandomId } from '@shared/utils/secureRandomId';
import { isPlainObject, isString } from '@shared/utils/validation';
import { isPositiveAmount } from '../shared/money';
import type { CheckoutContext } from './context';
import {
  CheckoutError,
  eventOf,
  loadOrder,
  refundTotal,
  requireRail,
  settleOrder,
  type LoadedOrder,
} from './payments';
import { RailError } from './rails/rail';
import {
  endRefund,
  getRefund,
  insertEventStatement,
  insertRefund,
  markDisputed,
  type AttemptRow,
  type RefundRow,
} from './store';

function notPossible(message: string): CheckoutError {
  return new CheckoutError('refund_not_possible', message);
}

/**
 * Ends a pending refund with the result of the rail. A complete refund changes the order state
 * through `settleOrder` and sends `order.refunded` once.
 */
export async function completeRefund(
  context: CheckoutContext,
  refundId: string,
  state: 'succeeded' | 'failed',
): Promise<void> {
  const refund = await getRefund(context.db, refundId);
  if (!refund || !(await endRefund(context.db, refundId, state, context.now()))) return;
  const loaded = await settleOrder(context, refund.order_id);
  if (state !== 'succeeded') return;
  const view = { id: refundId, amount: refund.amount, state };
  await context.db.batch([
    insertEventStatement(context.db, eventOf(context, loaded, 'order.refunded', `refunded:${refundId}`, { refund: view })),
  ]);
}

/** The refund of a request: a new one, or the pending one that the merchant tries again. */
async function refundOf(context: CheckoutContext, loaded: LoadedOrder, input: unknown): Promise<RefundRow> {
  const { order, attempts, refunds } = loaded;
  const body = isPlainObject(input) ? input : {};
  if (isString(body.refundId)) {
    const pending = refunds.find((refund) => refund.refund_id === body.refundId && refund.state === 'pending');
    if (!pending) throw notPossible('No pending refund has this ID');
    return pending;
  }
  const paid = attempts.find((attempt) => attempt.state === 'succeeded');
  if (!paid || (order.state !== 'paid' && order.state !== 'partially_refunded')) {
    throw notPossible(`The order is ${order.state}`);
  }
  // A pending refund keeps its amount, so two refunds cannot send back more than was paid.
  const left = order.amount - refundTotal(refunds, ['succeeded', 'pending']);
  const amount = body.amount ?? left;
  if (!isPositiveAmount(amount) || amount > left) {
    throw notPossible(`The refund amount is a positive integer of at most ${left}`);
  }
  const refund: RefundRow = {
    refund_id: secureRandomId('ref', 16),
    order_id: order.order_id,
    attempt_id: paid.attempt_id,
    amount,
    state: 'pending',
  };
  // The refund is stored before the rail call, so a retry uses the same ID at the provider.
  await insertRefund(context.db, refund, context.now());
  return refund;
}

/**
 * Refunds a paid order through the rail of its payment: all of it, or `amount`. When the
 * provider gives no answer, the refund stays pending and the merchant sends its `refundId`
 * again.
 */
export async function refundOrder(
  context: CheckoutContext,
  orderId: string,
  input: unknown,
): Promise<LoadedOrder> {
  const loaded = await settleOrder(context, orderId);
  const refund = await refundOf(context, loaded, input);
  const attempt = loaded.attempts.find((candidate) => candidate.attempt_id === refund.attempt_id);
  if (!attempt?.rail_ref) throw notPossible('The payment has no provider reference');
  const rail = await requireRail(context, loaded.order.project_id, attempt.rail_id);
  try {
    const result = await rail.refund(attempt.rail_ref, refund.amount, refund.refund_id);
    if (result.kind === 'not_supported') {
      await completeRefund(context, refund.refund_id, 'failed');
      throw notPossible('The provider cannot refund this payment. Refund it at the provider');
    }
    if (result.state === 'succeeded') await completeRefund(context, refund.refund_id, 'succeeded');
  } catch (error) {
    if (error instanceof RailError && error.kind === 'refused') {
      await completeRefund(context, refund.refund_id, 'failed');
    }
    throw error;
  }
  return (await loadOrder(context, orderId)) ?? loaded;
}

/** Marks the order of a disputed payment and tells the merchant. */
export async function recordDispute(
  context: CheckoutContext,
  attempt: AttemptRow,
  disputeRef: string,
): Promise<void> {
  const loaded = await loadOrder(context, attempt.order_id);
  if (!loaded) return;
  const marked = { ...loaded, order: { ...loaded.order, disputed: 1 } };
  const dispute = { rail: attempt.rail_id, ref: disputeRef };
  await markDisputed(
    context.db,
    attempt.order_id,
    eventOf(context, marked, 'order.disputed', `disputed:${attempt.rail_id}:${disputeRef}`, { dispute }),
  );
}
