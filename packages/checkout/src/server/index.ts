import { isObject, isString } from '@shared/utils/validation';
import {
  CHECKOUT_ROUTES,
  type CheckoutErrorCode,
  type CheckoutOrder,
  type CreateOrderInput,
  type CreatedOrder,
} from '../shared/api';
import { SIGNATURE_HEADER, type OrderEvent } from '../shared/events';
import { verifyTimestamped } from '../shared/signature';

export type { CheckoutOrder, CreateOrderInput, CreatedOrder, OrderLine } from '../shared/api';
export type { OrderEvent } from '../shared/events';
export { SIGNATURE_HEADER };

/** A request that the checkout refused, with its reason. */
export class CheckoutServerError extends Error {
  readonly code: CheckoutErrorCode | 'bad_answer';
  readonly status: number;

  constructor(code: CheckoutErrorCode | 'bad_answer', status: number, message: string) {
    super(message);
    this.name = 'CheckoutServerError';
    this.code = code;
    this.status = status;
  }
}

type CheckoutServerOptions = {
  /** The origin of the checkout, for example `https://checkout.example.com`. */
  readonly checkoutOrigin: string;
  /** The project's secret key. It stays on the merchant's server. */
  readonly secretKey: string;
  readonly fetch?: typeof fetch;
};

export type CheckoutServer = {
  /**
   * Makes an order from the cart. The amount comes from the lines and the shipping. The ID and
   * the client token go to the browser. A repeat with the same reference returns the same order.
   */
  createOrder(input: CreateOrderInput): Promise<CreatedOrder>;
  getOrder(orderId: string): Promise<CheckoutOrder>;
  /** Cancels an order that is not paid. */
  cancelOrder(orderId: string): Promise<CheckoutOrder>;
};

/** The client of the checkout for a merchant's backend. */
export function createCheckoutServer(options: CheckoutServerOptions): CheckoutServer {
  const fetcher = options.fetch ?? fetch;
  const origin = new URL(options.checkoutOrigin).origin;

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const response = await fetcher(`${origin}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${options.secretKey}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const answer: unknown = await response.json().catch(() => null);
    if (response.ok && isObject(answer)) return answer as T;
    const error = isObject(answer) && isObject(answer.error) ? answer.error : {};
    throw new CheckoutServerError(
      isString(error.code) ? (error.code as CheckoutErrorCode) : 'bad_answer',
      response.status,
      isString(error.message) ? error.message : `The checkout answered ${response.status}`,
    );
  }

  const orderPath = (orderId: string): string =>
    `${CHECKOUT_ROUTES.orders}/${encodeURIComponent(orderId)}`;
  return {
    createOrder: (input) => call('POST', CHECKOUT_ROUTES.orders, input),
    getOrder: (orderId) => call('GET', orderPath(orderId)),
    cancelOrder: (orderId) => call('POST', `${orderPath(orderId)}/cancel`),
  };
}

type OrderEventCheck = {
  /** The raw body of the request, before any JSON parse. */
  readonly body: string;
  /** The value of the `seams-signature` header. */
  readonly signature: string | null;
  /** The event secret of the project. */
  readonly secret: string;
  /** How old an event can be. The default is 5 minutes. */
  readonly toleranceSeconds?: number;
  readonly nowMs?: number;
};

/**
 * Checks the signature of an order event and returns the event, or null when the signature is
 * not valid or the event is too old. The merchant's server acts only on a checked event.
 */
export async function verifyOrderEvent(check: OrderEventCheck): Promise<OrderEvent | null> {
  const valid = await verifyTimestamped({
    secret: check.secret,
    body: check.body,
    header: check.signature,
    nowMs: check.nowMs ?? Date.now(),
    toleranceSeconds: check.toleranceSeconds ?? 300,
  });
  return valid ? (JSON.parse(check.body) as OrderEvent) : null;
}
