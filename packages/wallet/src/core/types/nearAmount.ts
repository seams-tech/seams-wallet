/**
 * A NEAR amount in yoctoNEAR (1 NEAR = 10^24 yoctoNEAR), as a canonical
 * non-negative integer string. Only `near` and `yoctoNear` produce one, so an
 * amount reaches `transfer` already checked.
 */
export type YoctoNear = string & { readonly __yoctoNearBrand: 'YoctoNear' };

export type NearAmountErrorCode = 'invalid_format' | 'too_many_decimals';

export class NearAmountError extends Error {
  constructor(
    readonly code: NearAmountErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'NearAmountError';
  }
}

const YOCTO_DECIMALS = 24;
const NEAR_DECIMAL = /^(\d+)(?:\.(\d+))?$/;
const YOCTO_INTEGER = /^\d+$/;

/**
 * Convert a decimal NEAR amount to yoctoNEAR with exact string arithmetic.
 *
 * @example
 * near('1'); // '1000000000000000000000000'
 * near('0.5'); // '500000000000000000000000'
 *
 * @throws {NearAmountError} `invalid_format` for anything other than digits
 * with an optional fraction (no sign, unit or exponent), and
 * `too_many_decimals` for more than 24 fractional digits.
 */
export function near(amount: string): YoctoNear {
  const match = NEAR_DECIMAL.exec(amount);
  if (!match) {
    throw new NearAmountError(
      'invalid_format',
      `Invalid NEAR amount ${JSON.stringify(amount)}: expected a decimal such as '1' or '0.5'`,
    );
  }
  const [, whole, fraction = ''] = match;
  if (fraction.length > YOCTO_DECIMALS) {
    throw new NearAmountError(
      'too_many_decimals',
      `Invalid NEAR amount ${JSON.stringify(amount)}: at most ${YOCTO_DECIMALS} decimal places`,
    );
  }
  return BigInt(whole + fraction.padEnd(YOCTO_DECIMALS, '0')).toString() as YoctoNear;
}

/**
 * Take an amount that is already in yoctoNEAR.
 *
 * @example
 * yoctoNear('1000000000000000000000000'); // 1 NEAR
 *
 * @throws {NearAmountError} `invalid_format` unless `amount` is a
 * non-negative integer.
 */
export function yoctoNear(amount: string | bigint): YoctoNear {
  const digits = typeof amount === 'bigint' ? amount.toString() : amount;
  if (!YOCTO_INTEGER.test(digits)) {
    throw new NearAmountError(
      'invalid_format',
      `Invalid yoctoNEAR amount ${JSON.stringify(digits)}: expected a non-negative integer`,
    );
  }
  return BigInt(digits).toString() as YoctoNear;
}
