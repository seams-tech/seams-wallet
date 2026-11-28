import type { CheckoutOrder, RefundView } from './api';

/** The header of an order event that holds its signature: `t=<unix seconds>,v1=<hex>`. */
export const SIGNATURE_HEADER = 'seams-signature';

/** Each event that the checkout sends to a merchant's server. */
export type OrderEvent = {
  readonly id: string;
  readonly createdAtMs: number;
  /** The order at the time of the event. */
  readonly order: CheckoutOrder;
} & (
  /** `order.pending`: a voucher or bank details were issued, and the order waits for the money. */
  | { readonly type: 'order.paid' | 'order.pending' | 'order.expired' | 'order.cancelled' }
  /** `order.refunded`: one refund is complete. The order says how much is refunded in all. */
  | { readonly type: 'order.refunded'; readonly refund: RefundView }
  | {
      readonly type: 'order.disputed';
      /** The customer disputes the payment at the provider. The merchant answers there. */
      readonly dispute: { readonly rail: string; readonly ref: string };
    }
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
