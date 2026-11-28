/** Each way to pay that the checkout can show. The routing table sends each one to one rail. */
export const CHECKOUT_METHODS = [
  'card',
  'apple_pay',
  'google_pay',
  'konbini',
  'bank_transfer',
  'pay_easy',
  'paypay',
  'rakuten_pay',
  'merpay',
  'au_pay',
  'd_barai',
  'paidy',
] as const;

export type CheckoutMethod = (typeof CHECKOUT_METHODS)[number];

export function isCheckoutMethod(value: unknown): value is CheckoutMethod {
  return typeof value === 'string' && (CHECKOUT_METHODS as readonly string[]).includes(value);
}

export const KONBINI_STORES = [
  'seven_eleven',
  'lawson',
  'family_mart',
  'ministop',
  'daily_yamazaki',
  'seicomart',
] as const;

export type KonbiniStore = (typeof KONBINI_STORES)[number];

/**
 * What the customer gives before a method can start. The rail of the method names the fields
 * that its provider needs, and the checkout frame draws them with Seams labels.
 */
export const CUSTOMER_FIELDS = [
  'email',
  'full_name',
  'family_name',
  'given_name',
  'family_name_kana',
  'given_name_kana',
  'phone',
  'konbini_store',
] as const;

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
    }
  /** The provider's own button, which opens the payment sheet of the device. */
  | {
      readonly kind: 'wallet_button';
      readonly wallet: 'apple_pay' | 'google_pay';
      readonly publishableKey: string;
      readonly clientSecret: string;
    }
  /** The customer approves the payment at the provider's page or in its app. */
  | { readonly kind: 'redirect'; readonly url: string }
  | {
      readonly kind: 'voucher';
      readonly deadlineMs: number;
      /** The provider's own page, for a store whose code the provider does not give as data. */
      readonly instructionsUrl: string | null;
      readonly codes: readonly VoucherCode[];
    }
  | {
      readonly kind: 'bank_details';
      /** Null when the provider sets no deadline for the transfer. */
      readonly deadlineMs: number | null;
      readonly instructionsUrl: string | null;
      readonly bankName: string;
      readonly branchName: string;
      readonly accountType: string;
      readonly accountNumber: string;
      readonly accountHolder: string;
    };

export type VoucherCode = {
  readonly stores: readonly KonbiniStore[];
  readonly paymentCode: string | null;
  readonly confirmationCode: string | null;
};
