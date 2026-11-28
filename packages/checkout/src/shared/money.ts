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
