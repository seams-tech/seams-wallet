import type { CheckoutMethod, CustomerDetails, CustomerField, RailStart } from './methods';
import type { Currency, MinorUnits } from './money';
import type { AttemptState, OrderState } from './orderState';

/** The routes of the checkout Worker. The merchant backend, the frame and the tests share them. */
export const CHECKOUT_ROUTES = {
  orders: '/checkout/orders',
  session: '/checkout/session',
  attempts: '/checkout/attempts',
  webhooks: '/checkout/webhooks',
  projects: '/checkout/projects',
} as const;

export type OrderLine = {
  readonly name: string;
  readonly unitAmount: MinorUnits;
  readonly quantity: number;
};

export type CreateOrderInput = {
  /** The merchant's own name for the order. One project has one order for each reference. */
  readonly reference: string;
  readonly currency: Currency;
  readonly lines: readonly OrderLine[];
  readonly shipping?: { readonly amount: MinorUnits };
  /** A guest's address, or the address of the signed-in account. */
  readonly customerEmail?: string;
  /** How long the customer can start a payment. The default is 60 minutes. */
  readonly expiresInMinutes?: number;
};

export type AttemptFailure = { readonly code: string; readonly message: string };

export type AttemptView = {
  readonly id: string;
  readonly method: CheckoutMethod;
  readonly rail: string;
  readonly state: AttemptState;
  /** The last refusal of the rail, such as a declined card. The attempt can still be open. */
  readonly failure: AttemptFailure | null;
};

export type RefundView = {
  readonly id: string;
  readonly amount: MinorUnits;
  /** `pending`: the provider has the refund, and the money is not back yet. */
  readonly state: 'pending' | 'succeeded' | 'failed';
};

/** An order as the merchant's backend reads it. */
export type CheckoutOrder = {
  readonly id: string;
  readonly reference: string;
  readonly state: OrderState;
  readonly currency: Currency;
  readonly amount: MinorUnits;
  readonly lines: readonly OrderLine[];
  readonly shippingAmount: MinorUnits;
  readonly customerEmail: string | null;
  /** The sum of the refunds that are complete. */
  readonly refundedAmount: MinorUnits;
  readonly refunds: readonly RefundView[];
  /** Money arrived that the order did not wait for. The merchant refunds or accepts it. */
  readonly needsReview: boolean;
  readonly disputed: boolean;
  readonly expiresAtMs: number;
  readonly createdAtMs: number;
  readonly attempts: readonly AttemptView[];
};

/** A new order. The ID and the client token go to the browser. */
export type CreatedOrder = CheckoutOrder & { readonly clientToken: string };

export type MethodOption = {
  readonly method: CheckoutMethod;
  /** The customer details that the method needs before it starts. */
  readonly fields: readonly CustomerField[];
};

/** What the checkout frame reads with a client token: one order and how it can be paid. */
export type CheckoutSession = {
  readonly order: Pick<
    CheckoutOrder,
    'id' | 'state' | 'currency' | 'amount' | 'lines' | 'shippingAmount' | 'customerEmail'
  >;
  readonly methods: readonly MethodOption[];
  /** The active attempt with its next step, when the order has one. */
  readonly attempt: (AttemptView & { readonly start: RailStart | null }) | null;
};

export type StartAttemptInput = {
  readonly method: CheckoutMethod;
  readonly details?: CustomerDetails;
  readonly locale?: CheckoutLocale;
};

export type CheckoutLocale = 'en' | 'ja';

export const CHECKOUT_ERROR_CODES = [
  'invalid_request',
  'unauthorized',
  'not_found',
  'reference_reused',
  'order_not_open',
  'refund_not_possible',
  'method_not_available',
  'details_required',
  'rail_refused',
  'rail_unavailable',
  'invalid_signature',
] as const;

export type CheckoutErrorCode = (typeof CHECKOUT_ERROR_CODES)[number];

export type CheckoutErrorBody = {
  readonly error: { readonly code: CheckoutErrorCode; readonly message: string };
};
