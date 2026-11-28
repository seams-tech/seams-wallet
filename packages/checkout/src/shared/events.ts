import type { CheckoutOrder } from './api';

/** The header of an order event that holds its signature: `t=<unix seconds>,v1=<hex>`. */
export const SIGNATURE_HEADER = 'seams-signature';

/** Each event that the checkout sends to a merchant's server. */
export type OrderEvent = {
  readonly id: string;
  readonly createdAtMs: number;
  /** The order at the time of the event. */
  readonly order: CheckoutOrder;
} & (
  | { readonly type: 'order.paid' | 'order.expired' | 'order.cancelled' }
  | {
      readonly type: 'order.unexpected_payment';
      /** Money that the order did not wait for. The merchant refunds it or accepts it. */
      readonly payment: {
        readonly rail: string;
        readonly amount: number;
        readonly currency: string;
        readonly reason: 'attempt_not_active' | 'wrong_amount';
      };
    }
);
