import type { CheckoutLocale } from '../../shared/api';
import type {
  CheckoutMethod,
  CustomerDetails,
  CustomerField,
  RailStart,
} from '../../shared/methods';
import type { Currency, MinorUnits } from '../../shared/money';
import type { AttemptState } from '../../shared/orderState';

/** One payment attempt, as a rail gets it. The amount and the currency come from the order. */
export type RailAttempt = {
  /** Also the idempotency key of the rail call and the Seams reference at the provider. */
  readonly id: string;
  readonly orderReference: string;
  readonly method: CheckoutMethod;
  readonly amount: MinorUnits;
  readonly currency: Currency;
  readonly details: CustomerDetails;
  readonly locale: CheckoutLocale;
  /** The page of the checkout origin that the provider sends the customer back to. */
  readonly returnUrl: string;
  /** How many days a voucher or bank details stay payable. */
  readonly offlineDays: number;
  readonly createdAtMs: number;
};

/** The provider's name for the payment of one attempt. */
export type RailPaymentRef = string;

export type RailFailure = { readonly code: string; readonly message: string };

/** The state of a provider payment, in the states of an attempt. */
export type RailPaymentState = {
  readonly state: AttemptState;
  /** The money that arrived, for `succeeded`. */
  readonly paid: { readonly amount: MinorUnits; readonly currency: string } | null;
  /** The last refusal, such as a declined card. The payment can still be open. */
  readonly failure: RailFailure | null;
};

export type RailStarted = {
  readonly ref: RailPaymentRef;
  readonly payment: RailPaymentState;
  readonly start: RailStart;
  /** When the provider stops taking the money of a voucher or bank details. */
  readonly deadlineMs?: number;
};

export type RailCancel =
  | { readonly kind: 'cancelled' }
  /** The rail cannot cancel this payment. Money can still arrive. */
  | { readonly kind: 'not_supported' }
  /** The payment is past the point where a cancel works, for example because it is paid. */
  | { readonly kind: 'too_late' };

export type RailRefund =
  /** The rail took the refund. `pending`: the money is not back yet, and an event follows. */
  | { readonly kind: 'refunded'; readonly state: 'succeeded' | 'pending' }
  /** The rail cannot refund this payment. The merchant refunds it at the provider. */
  | { readonly kind: 'not_supported' };

/** What a verified webhook says. The Worker then reads the payment before it changes a state. */
export type RailEvent =
  | { readonly kind: 'payment'; readonly attemptId: string | null; readonly ref: RailPaymentRef | null }
  /** Money at the provider that paid no payment, such as a bank transfer after a cancel. */
  | {
      readonly kind: 'unmatched_funds';
      readonly attemptId: string;
      /** The provider's name for this money. One name is recorded once. */
      readonly ref: string;
      readonly amount: MinorUnits;
      readonly currency: string;
    }
  /** A refund that was pending is complete, or failed. */
  | { readonly kind: 'refund'; readonly refundId: string; readonly state: 'succeeded' | 'failed' }
  /** The customer disputes a payment. `attemptId` or `ref` names the payment. */
  | {
      readonly kind: 'dispute';
      readonly attemptId: string | null;
      readonly ref: RailPaymentRef | null;
      readonly disputeRef: string;
    }
  | { readonly kind: 'ignored' };

export type RailWebhook = {
  readonly body: string;
  readonly header: (name: string) => string | null;
  readonly nowMs: number;
};

export type RailEvents = {
  readonly kind: 'webhook';
  /** The event of a webhook with a valid signature, or null when the signature is not valid. */
  verify(webhook: RailWebhook): Promise<RailEvent | null>;
};

/** One way to move money, connected to one merchant's account. */
export type PaymentRail = {
  readonly events: RailEvents;
  start(attempt: RailAttempt): Promise<RailStarted>;
  read(ref: RailPaymentRef): Promise<RailPaymentState>;
  cancel(ref: RailPaymentRef): Promise<RailCancel>;
  /** Sends `amount` of a paid payment back. `refundId` makes a repeat of the call safe. */
  refund(ref: RailPaymentRef, amount: MinorUnits, refundId: string): Promise<RailRefund>;
};

export type RailAccount = {
  /** What the browser can see, such as a publishable key. */
  readonly public: Readonly<Record<string, string>>;
  readonly secrets: Readonly<Record<string, string>>;
};

export type RailContext = {
  readonly fetch: typeof fetch;
  readonly now: () => number;
};

/**
 * A rail that the Worker can load. The Worker's configuration is a list of these, so a
 * deployment loads only the rails that it names.
 */
export type RailModule = {
  readonly id: string;
  readonly methods: ReadonlySet<CheckoutMethod>;
  /** True when the rail takes this method for an order of this currency and amount. */
  accepts(method: CheckoutMethod, currency: Currency, amount: MinorUnits): boolean;
  /** The customer details that the provider needs for a method. */
  fields(method: CheckoutMethod): readonly CustomerField[];
  /** Checks the keys that a merchant gives, and refuses a key with more access than needed. */
  parseAccount(input: unknown): RailAccount;
  connect(account: RailAccount, context: RailContext): PaymentRail;
};

type YenLimits = Readonly<Partial<Record<CheckoutMethod, readonly [min: number, max: number]>>>;

/**
 * True when `method` is one of `methods` and the order is inside the provider's limits. A
 * method with limits takes yen only.
 */
export function acceptsOrder(
  methods: ReadonlySet<CheckoutMethod>,
  yenLimits: YenLimits,
  method: CheckoutMethod,
  currency: Currency,
  amount: MinorUnits,
): boolean {
  const limits = yenLimits[method];
  if (!limits) return methods.has(method);
  return currency === 'JPY' && amount >= limits[0] && amount <= limits[1];
}

type RailErrorKind = 'refused' | 'unavailable';

/**
 * A rail call that failed. `refused`: the provider answered and said no. `unavailable`: no
 * answer, or an answer that a retry can change.
 */
export class RailError extends Error {
  readonly kind: RailErrorKind;
  readonly code: string;

  constructor(kind: RailErrorKind, code: string, message: string) {
    super(message);
    this.name = 'RailError';
    this.kind = kind;
    this.code = code;
  }
}
