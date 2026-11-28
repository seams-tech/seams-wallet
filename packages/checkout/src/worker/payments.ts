import { secureRandomId } from '@shared/utils/secureRandomId';
import type {
  AttemptFailure,
  AttemptView,
  CheckoutErrorCode,
  CheckoutOrder,
  CheckoutSession,
  StartAttemptInput,
} from '../shared/api';
import type { OrderEvent } from '../shared/events';
import type { CustomerDetails, RailStart } from '../shared/methods';
import {
  canMoveAttempt,
  computeOrderState,
  isActiveAttempt,
  type OrderState,
} from '../shared/orderState';
import { connectRail, projectConfig, railModule, type CheckoutContext } from './context';
import { isUniqueConflict } from './d1';
import { RailError, type PaymentRail, type RailAttempt, type RailPaymentState } from './rails/rail';
import {
  changeAttempt,
  changeOrderState,
  insertEventStatement,
  getOrder,
  getProject,
  insertAttempt,
  listAttempts,
  listRailAccountIds,
  recordUnexpectedPayment,
  type AttemptRow,
  type OrderRow,
} from './store';

/** A challenge or a redirect in flight gets this long after the order's expiry. */
const IN_FLIGHT_GRACE_MS = 15 * 60_000;
/** A store can take a voucher for a short time after its deadline. */
const OFFLINE_GRACE_MS = 2 * 60 * 60_000;
const DEFAULT_VOUCHER_DAYS = 3;

/** A request that the checkout refuses, with the code that the caller gets. */
export class CheckoutError extends Error {
  readonly code: CheckoutErrorCode;

  constructor(code: CheckoutErrorCode, message: string) {
    super(message);
    this.name = 'CheckoutError';
    this.code = code;
  }
}

export type LoadedOrder = { readonly order: OrderRow; readonly attempts: readonly AttemptRow[] };

type OrderEventType = OrderEvent['type'];

const STATE_EVENTS: Readonly<Partial<Record<OrderState, OrderEventType>>> = {
  paid: 'order.paid',
  expired: 'order.expired',
  cancelled: 'order.cancelled',
};

function attemptView(attempt: AttemptRow): AttemptView {
  return {
    id: attempt.attempt_id,
    method: attempt.method,
    rail: attempt.rail_id,
    state: attempt.state,
    failure: attempt.failure_json ? (JSON.parse(attempt.failure_json) as AttemptFailure) : null,
  };
}

export function orderView({ order, attempts }: LoadedOrder): CheckoutOrder {
  return {
    id: order.order_id,
    reference: order.reference,
    state: order.state,
    currency: order.currency,
    amount: order.amount,
    lines: JSON.parse(order.lines_json),
    shippingAmount: order.shipping_amount,
    customerEmail: order.customer_email,
    needsReview: order.needs_review === 1,
    disputed: order.disputed === 1,
    expiresAtMs: order.expires_at_ms,
    createdAtMs: order.created_at_ms,
    attempts: attempts.map(attemptView),
  };
}

function eventOf(
  context: CheckoutContext,
  loaded: LoadedOrder,
  type: OrderEventType,
  cause: string,
  extra: Record<string, unknown> = {},
) {
  const eventId = secureRandomId('evt', 16);
  const nowMs = context.now();
  const payload = { id: eventId, type, createdAtMs: nowMs, order: orderView(loaded), ...extra };
  return { eventId, order: loaded.order, type, cause, payloadJson: JSON.stringify(payload), nowMs };
}

async function loadOrder(context: CheckoutContext, orderId: string): Promise<LoadedOrder | null> {
  const order = await getOrder(context.db, orderId);
  return order ? { order, attempts: await listAttempts(context.db, orderId) } : null;
}

async function requireRail(
  context: CheckoutContext,
  projectId: string,
  railId: string,
): Promise<PaymentRail> {
  const rail = await connectRail(context, projectId, railId);
  if (!rail) throw new CheckoutError('method_not_available', `No ${railId} account is connected`);
  return rail;
}

/**
 * Ends an active attempt: cancels the provider payment, then stores the final state. Returns
 * false when the provider says that the cancel is too late, because the payment is paid or in
 * its last step. The attempt then stays active, and the rail's event decides it.
 */
export async function endAttempt(
  context: CheckoutContext,
  order: OrderRow,
  attempt: AttemptRow,
  state: 'cancelled' | 'expired',
): Promise<boolean> {
  if (attempt.rail_ref) {
    const rail = await requireRail(context, order.project_id, attempt.rail_id);
    // `not_supported`: the attempt ends here, and money that still arrives is recorded as an
    // unexpected payment.
    if ((await rail.cancel(attempt.rail_ref)).kind === 'too_late') return false;
  }
  await changeAttempt(context.db, attempt.attempt_id, attempt.state, { state }, context.now());
  return true;
}

/**
 * Brings an order up to date: ends each attempt that is past its deadline, computes the order
 * state and stores it with its event when it changed. Each reader and writer calls this first.
 */
export async function settleOrder(context: CheckoutContext, orderId: string): Promise<LoadedOrder> {
  let loaded = await loadOrder(context, orderId);
  if (!loaded) throw new CheckoutError('not_found', 'No such order');
  const nowMs = context.now();
  const overdue = loaded.attempts.filter(
    (attempt) => isActiveAttempt(attempt.state) && attempt.deadline_ms <= nowMs,
  );
  for (const attempt of overdue) {
    try {
      await endAttempt(context, loaded.order, attempt, 'expired');
    } catch (error) {
      // The provider gave no answer. The next settle tries again.
      if (!(error instanceof RailError)) throw error;
    }
  }
  if (overdue.length > 0) loaded = (await loadOrder(context, orderId)) ?? loaded;

  const { order, attempts } = loaded;
  const state = computeOrderState(
    {
      amount: order.amount,
      expiresAtMs: order.expires_at_ms,
      cancelledAtMs: order.cancelled_at_ms,
      attemptStates: attempts.map((attempt) => attempt.state),
      refundedAmount: 0,
    },
    nowMs,
  );
  if (state === order.state) return loaded;
  const settled = { order: { ...order, state }, attempts };
  const type = STATE_EVENTS[state];
  await changeOrderState(context.db, order, state, type ? eventOf(context, settled, type, state) : null);
  return settled;
}

type Money = { readonly amount: number; readonly currency: string };

/** Records money that the order did not wait for. It never changes the order state alone. */
async function recordUnexpected(
  context: CheckoutContext,
  loaded: LoadedOrder,
  attempt: AttemptRow,
  railRef: string,
  money: Money,
  reason: 'attempt_not_active' | 'wrong_amount',
): Promise<void> {
  const marked = { order: { ...loaded.order, needs_review: 1 }, attempts: loaded.attempts };
  const payment = { rail: attempt.rail_id, ...money, reason };
  await recordUnexpectedPayment(
    context.db,
    { paymentId: secureRandomId('pay', 16), attempt, railRef, ...money, reason },
    eventOf(context, marked, 'order.unexpected_payment', `unexpected:${attempt.rail_id}:${railRef}`, { payment }),
  );
}

/**
 * Records money at the provider that paid no payment, for example a bank transfer that came
 * after its attempt was cancelled, or the rest of a transfer that was too large.
 */
export async function recordUnmatchedFunds(
  context: CheckoutContext,
  attempt: AttemptRow,
  railRef: string,
  money: Money,
): Promise<void> {
  const loaded = await loadOrder(context, attempt.order_id);
  if (!loaded) return;
  const reason = attempt.state === 'succeeded' || isActiveAttempt(attempt.state) ? 'wrong_amount' : 'attempt_not_active';
  await recordUnexpected(context, loaded, attempt, railRef, money, reason);
}

/** Tells the merchant that the order waits for a store payment or a bank transfer. */
async function addPendingEvent(context: CheckoutContext, orderId: string, attemptId: string): Promise<void> {
  const loaded = await loadOrder(context, orderId);
  if (!loaded) return;
  await context.db.batch([
    insertEventStatement(context.db, eventOf(context, loaded, 'order.pending', `pending:${attemptId}`)),
  ]);
}

/**
 * Applies the state that a rail reports for the payment of an attempt. Only this function moves
 * an attempt to `succeeded`, and its callers give it only a state from a rail event.
 */
export async function applyRailPayment(
  context: CheckoutContext,
  attempt: AttemptRow,
  railRef: string,
  payment: RailPaymentState,
): Promise<void> {
  const loaded = await loadOrder(context, attempt.order_id);
  if (!loaded) return;
  const { order } = loaded;
  const { db } = context;
  const nowMs = context.now();
  const failureJson = payment.failure ? JSON.stringify(payment.failure) : null;

  if (payment.state === 'succeeded' && payment.paid) {
    if (attempt.state === 'succeeded') return;
    const { paid } = payment;
    const exact = paid.amount === order.amount && paid.currency === order.currency;
    if (!exact || !isActiveAttempt(attempt.state)) {
      await recordUnexpected(context, loaded, attempt, railRef, paid, exact ? 'attempt_not_active' : 'wrong_amount');
      if (isActiveAttempt(attempt.state)) {
        const wrongAmount = JSON.stringify({ code: 'wrong_amount', message: 'The amount paid is not the order amount' });
        await changeAttempt(db, attempt.attempt_id, attempt.state, { state: 'failed', failureJson: wrongAmount }, nowMs);
      }
      await settleOrder(context, order.order_id);
      return;
    }
  }

  if (canMoveAttempt(attempt.state, payment.state)) {
    await changeAttempt(db, attempt.attempt_id, attempt.state, { state: payment.state, failureJson }, nowMs);
    if (payment.state === 'pending_offline') await addPendingEvent(context, order.order_id, attempt.attempt_id);
  } else if (attempt.state === payment.state && failureJson !== attempt.failure_json) {
    await changeAttempt(db, attempt.attempt_id, attempt.state, { state: attempt.state, failureJson }, nowMs);
  }
  await settleOrder(context, order.order_id);
}

function requiredDetails(
  context: CheckoutContext,
  order: OrderRow,
  railId: string,
  input: StartAttemptInput,
): CustomerDetails {
  const details: CustomerDetails = {
    ...(order.customer_email ? { email: order.customer_email } : {}),
    ...input.details,
  };
  const missing = railModule(context, railId)
    .fields(input.method)
    .filter((field) => !details[field]?.trim());
  if (missing.length > 0) {
    throw new CheckoutError('details_required', `The method needs: ${missing.join(', ')}`);
  }
  return details;
}

type StartedAttempt = AttemptView & { readonly start: RailStart | null };

function startedView(attempt: AttemptRow): StartedAttempt {
  return {
    ...attemptView(attempt),
    start: attempt.start_json ? (JSON.parse(attempt.start_json) as RailStart) : null,
  };
}

/**
 * Starts a payment with one method. The amount, the currency and the rail come from the order
 * and the project's routing table, never from the browser. An active attempt of another method
 * is cancelled first, so an order has one active attempt.
 */
export async function startAttempt(
  context: CheckoutContext,
  orderId: string,
  input: StartAttemptInput,
): Promise<StartedAttempt> {
  const { order, attempts } = await settleOrder(context, orderId);
  const nowMs = context.now();
  if (order.state !== 'open' || nowMs >= order.expires_at_ms) {
    throw new CheckoutError('order_not_open', `The order is ${order.state}`);
  }
  const project = await getProject(context.db, order.project_id);
  const config = project ? projectConfig(project) : null;
  const railId = config?.routing[input.method];
  if (!railId || !context.rails.get(railId)?.accepts(input.method, order.currency, order.amount)) {
    throw new CheckoutError('method_not_available', `The method ${input.method} has no rail`);
  }
  const rail = await requireRail(context, order.project_id, railId);
  const details = requiredDetails(context, order, railId, input);
  const inputJson = JSON.stringify({ details, locale: input.locale ?? 'en' });

  const active = attempts.find((attempt) => isActiveAttempt(attempt.state));
  if (active) {
    // A repeat of the same request gets the same attempt, for example after a reload.
    if (active.method === input.method && active.input_json === inputJson && active.start_json) {
      return startedView(active);
    }
    if (!(await endAttempt(context, order, active, 'cancelled'))) {
      throw new CheckoutError('order_not_open', 'A payment of this order is in its last step');
    }
  }

  const attempt: AttemptRow = {
    attempt_id: secureRandomId('att', 16),
    order_id: order.order_id,
    method: input.method,
    rail_id: railId,
    state: 'created',
    input_json: inputJson,
    rail_ref: null,
    start_json: null,
    failure_json: null,
    deadline_ms: order.expires_at_ms + IN_FLIGHT_GRACE_MS,
    created_at_ms: nowMs,
  };
  try {
    // The attempt is stored before the rail call, so a retry finds it.
    await insertAttempt(context.db, attempt);
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    throw new CheckoutError('order_not_open', 'Another payment of this order started first');
  }

  const railAttempt: RailAttempt = {
    id: attempt.attempt_id,
    orderReference: order.reference,
    method: input.method,
    amount: order.amount,
    currency: order.currency,
    details,
    locale: input.locale ?? 'en',
    returnUrl: `${context.checkoutOrigin}/return`,
    offlineDays: config?.voucherDays ?? DEFAULT_VOUCHER_DAYS,
    createdAtMs: nowMs,
  };
  try {
    const started = await rail.start(railAttempt);
    const change = {
      state: started.payment.state,
      railRef: started.ref,
      startJson: JSON.stringify(started.start),
      // A voucher stays payable for some time after its deadline, at the store's register.
      ...(started.deadlineMs ? { deadlineMs: started.deadlineMs + OFFLINE_GRACE_MS } : {}),
    };
    if (!(await changeAttempt(context.db, attempt.attempt_id, 'created', change, context.now()))) {
      // The attempt ended while the rail call ran. Its provider payment must not stay open.
      await rail.cancel(started.ref);
      throw new CheckoutError('order_not_open', 'The payment was cancelled while it started');
    }
    if (started.payment.state === 'pending_offline') {
      await addPendingEvent(context, order.order_id, attempt.attempt_id);
    }
    return { ...attemptView({ ...attempt, state: started.payment.state }), start: started.start };
  } catch (error) {
    if (!(error instanceof RailError)) throw error;
    const failureJson = JSON.stringify({ code: error.code, message: error.message });
    await changeAttempt(context.db, attempt.attempt_id, 'created', { state: 'failed', failureJson }, context.now());
    throw new CheckoutError(
      error.kind === 'refused' ? 'rail_refused' : 'rail_unavailable',
      error.message,
    );
  }
}

/** What the checkout frame reads: the order, the methods that can pay it, the active attempt. */
export async function readSession(context: CheckoutContext, orderId: string): Promise<CheckoutSession> {
  const loaded = await settleOrder(context, orderId);
  const { order, attempts } = loaded;
  const view = orderView(loaded);
  const open = order.state === 'open' && context.now() < order.expires_at_ms;
  const project = open ? await getProject(context.db, order.project_id) : null;
  const connected = new Set(open ? await listRailAccountIds(context.db, order.project_id) : []);
  const routing = project ? projectConfig(project).routing : {};
  const methods = Object.entries(routing)
    .map(([method, railId]) => ({ method: method as keyof typeof routing, railId }))
    .filter(
      ({ method, railId }) =>
        connected.has(railId) && context.rails.get(railId)?.accepts(method, order.currency, order.amount),
    )
    .map(({ method, railId }) => ({ method, fields: railModule(context, railId).fields(method) }));
  const active = attempts.find((attempt) => isActiveAttempt(attempt.state));
  return {
    order: {
      id: view.id,
      state: view.state,
      currency: view.currency,
      amount: view.amount,
      lines: view.lines,
      shippingAmount: view.shippingAmount,
      customerEmail: view.customerEmail,
    },
    methods,
    attempt: active ? startedView(active) : null,
  };
}
