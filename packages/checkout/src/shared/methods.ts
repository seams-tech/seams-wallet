/** Each way to pay that the checkout can show. The routing table sends each one to one rail. */
export const CHECKOUT_METHODS = ['card'] as const;

export type CheckoutMethod = (typeof CHECKOUT_METHODS)[number];

export function isCheckoutMethod(value: unknown): value is CheckoutMethod {
  return typeof value === 'string' && (CHECKOUT_METHODS as readonly string[]).includes(value);
}

/**
 * What the customer gives before a method can start. The rail of the method names the fields
 * that its provider needs, and the checkout frame draws them with Seams labels.
 */
export const CUSTOMER_FIELDS = ['email'] as const;

export type CustomerField = (typeof CUSTOMER_FIELDS)[number];

export type CustomerDetails = { readonly [K in CustomerField]?: string };

/** What the browser needs to run the next step of a payment. The browser switches on `kind`. */
export type RailStart =
  | {
      readonly kind: 'card_form';
      readonly fields: 'stripe';
      readonly publishableKey: string;
      readonly clientSecret: string;
    }
  | {
      readonly kind: 'card_form';
      readonly fields: 'komoju';
      readonly publishableKey: string;
      readonly sessionId: string;
    };
