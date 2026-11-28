import { secureRandomId } from '@shared/utils/secureRandomId';
import {
  isArray,
  isPlainObject,
  isString,
  requireTrimmedString,
  toOptionalTrimmedNonEmptyString,
} from '@shared/utils/validation';
import type { CreatedOrder, OrderLine } from '../shared/api';
import { isCurrency, isPositiveAmount } from '../shared/money';
import { isActiveAttempt } from '../shared/orderState';
import type { CheckoutContext } from './context';
import { isUniqueConflict } from './d1';
import { CheckoutError, endAttempt, orderView, settleOrder, type LoadedOrder } from './payments';
import { cancelOrderRow, getOrderByReference, insertOrder, type OrderRow } from './store';
import { mintClientToken } from './vault';

const DEFAULT_EXPIRY_MINUTES = 60;
const LONGEST_EXPIRY_MINUTES = 60 * 24 * 30;
const MAX_LINES = 100;
const MAX_TEXT = 200;

function invalid(message: string): CheckoutError {
  return new CheckoutError('invalid_request', message);
}

function parseLine(input: unknown, index: number): OrderLine {
  if (!isPlainObject(input)) throw invalid(`Line ${index + 1} is not an object`);
  const name = isString(input.name) ? input.name.trim() : '';
  if (!name || name.length > MAX_TEXT) throw invalid(`Line ${index + 1} needs a name`);
  if (!isPositiveAmount(input.unitAmount)) {
    throw invalid(`Line ${index + 1}: unitAmount is a positive integer in minor units`);
  }
  if (!isPositiveAmount(input.quantity)) {
    throw invalid(`Line ${index + 1}: quantity is a positive integer`);
  }
  return { name, unitAmount: input.unitAmount, quantity: input.quantity };
}

/** Checks the merchant's order and computes its amount. The browser never sets an amount. */
function parseOrder(context: CheckoutContext, projectId: string, input: unknown): OrderRow {
  if (!isPlainObject(input)) throw invalid('The order is not an object');
  let reference: string;
  try {
    reference = requireTrimmedString(input.reference, 'reference');
  } catch {
    throw invalid('The order needs a reference');
  }
  if (reference.length > MAX_TEXT) throw invalid('The reference is too long');
  if (!isCurrency(input.currency)) throw invalid('The currency is JPY or USD');
  if (!isArray(input.lines) || input.lines.length === 0 || input.lines.length > MAX_LINES) {
    throw invalid(`The order has 1 to ${MAX_LINES} lines`);
  }
  const lines = input.lines.map(parseLine);
  const shipping = input.shipping === undefined ? 0 : (isPlainObject(input.shipping) ? input.shipping.amount : null);
  if (shipping !== 0 && !isPositiveAmount(shipping)) {
    throw invalid('shipping.amount is a positive integer in minor units');
  }
  const amount = lines.reduce((sum, line) => sum + line.unitAmount * line.quantity, shipping);
  if (!isPositiveAmount(amount)) throw invalid('The order amount is too large');
  const minutes = input.expiresInMinutes ?? DEFAULT_EXPIRY_MINUTES;
  if (!isPositiveAmount(minutes) || minutes > LONGEST_EXPIRY_MINUTES) {
    throw invalid(`expiresInMinutes is 1 to ${LONGEST_EXPIRY_MINUTES}`);
  }
  const email = toOptionalTrimmedNonEmptyString(input.customerEmail) ?? null;
  if (email !== null && (!/^[^@\s]+@[^@\s]+$/.test(email) || email.length > MAX_TEXT)) {
    throw invalid('customerEmail is not an email address');
  }
  const nowMs = context.now();
  return {
    order_id: secureRandomId('ord', 16),
    project_id: projectId,
    reference,
    currency: input.currency,
    amount,
    lines_json: JSON.stringify(lines),
    shipping_amount: shipping,
    customer_email: email,
    state: 'open',
    needs_review: 0,
    disputed: 0,
    expires_at_ms: nowMs + minutes * 60_000,
    cancelled_at_ms: null,
    created_at_ms: nowMs,
  };
}

function sameOrder(left: OrderRow, right: OrderRow): boolean {
  return (
    left.currency === right.currency &&
    left.amount === right.amount &&
    left.lines_json === right.lines_json &&
    left.shipping_amount === right.shipping_amount &&
    left.customer_email === right.customer_email
  );
}

/**
 * Makes an order. A repeat with the same reference and the same content returns the first
 * order and the same client token, so the merchant's server can retry safely.
 */
export async function createOrder(
  context: CheckoutContext,
  projectId: string,
  input: unknown,
): Promise<CreatedOrder> {
  const order = parseOrder(context, projectId, input);
  let loaded: LoadedOrder = { order, attempts: [], refunds: [] };
  try {
    await insertOrder(context.db, order);
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const first = await getOrderByReference(context.db, projectId, order.reference);
    if (!first || !sameOrder(first, order)) {
      throw new CheckoutError('reference_reused', 'Another order has this reference');
    }
    loaded = await settleOrder(context, first.order_id);
  }
  return {
    ...orderView(loaded),
    clientToken: await mintClientToken(context.keys.clientToken, loaded.order.order_id),
  };
}

/** Cancels an open order for the merchant. The provider payment of its attempt is cancelled first. */
export async function cancelOrder(context: CheckoutContext, orderId: string): Promise<LoadedOrder> {
  const { order, attempts } = await settleOrder(context, orderId);
  if (order.state !== 'open') {
    throw new CheckoutError('order_not_open', `The order is ${order.state}`);
  }
  const active = attempts.find((attempt) => isActiveAttempt(attempt.state));
  if (active && !(await endAttempt(context, order, active, 'cancelled'))) {
    throw new CheckoutError('order_not_open', 'A payment of this order is in its last step');
  }
  await cancelOrderRow(context.db, orderId, context.now());
  return settleOrder(context, orderId);
}
