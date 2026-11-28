/** An amount in the minor unit of its currency: yen for JPY, cents for USD. Always an integer. */
export type MinorUnits = number;

/** The digits after the decimal point of each currency that an order can have. */
const CURRENCY_EXPONENTS = { JPY: 0, USD: 2 } as const;

export type Currency = keyof typeof CURRENCY_EXPONENTS;

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && Object.hasOwn(CURRENCY_EXPONENTS, value);
}

/** True for an amount that an order, a line or a refund can have: a positive safe integer. */
export function isPositiveAmount(value: unknown): value is MinorUnits {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** The amount as text for a person, in the notation of `locale`. */
export function formatAmount(amount: MinorUnits, currency: Currency, locale: string): string {
  const exponent = CURRENCY_EXPONENTS[currency];
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(amount / 10 ** exponent);
}
