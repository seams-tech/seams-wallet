/**
 * Exact token amounts. Each helper turns a decimal string into integer base
 * units with string and BigInt arithmetic, never floating point.
 */

export type AmountErrorCode = 'invalid_format' | 'too_many_decimals';

export class AmountError extends Error {
  constructor(
    readonly code: AmountErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AmountError';
  }
}

const DECIMAL_AMOUNT = /^(\d+)(?:\.(\d+))?$/;

/**
 * Convert a decimal amount to integer base units: `amount * 10^decimals`.
 * Use it for a token whose decimals are not 18 or 24, such as an ERC-20.
 *
 * @example
 * parseUnits('1.5', 6); // 1500000n
 *
 * @throws {AmountError} `invalid_format` for anything other than digits with
 * an optional fraction (no sign, unit or exponent), and `too_many_decimals`
 * for more fractional digits than `decimals`.
 */
export function parseUnits(amount: string, decimals: number): bigint {
  if (!Number.isSafeInteger(decimals) || decimals < 0) {
    throw new RangeError(`decimals must be a non-negative integer, got ${decimals}`);
  }
  const match = DECIMAL_AMOUNT.exec(amount);
  if (!match) {
    throw new AmountError(
      'invalid_format',
      `Invalid amount ${JSON.stringify(amount)}: expected a decimal such as '1' or '0.5'`,
    );
  }
  const [, whole, fraction = ''] = match;
  if (fraction.length > decimals) {
    throw new AmountError(
      'too_many_decimals',
      `Invalid amount ${JSON.stringify(amount)}: at most ${decimals} decimal places`,
    );
  }
  return BigInt(whole + fraction.padEnd(decimals, '0'));
}

/**
 * A NEAR amount in yoctoNEAR (1 NEAR = 10^24 yoctoNEAR), as a canonical
 * non-negative integer string. Only `parseNear` and `yoctoNear` produce one,
 * so a `YoctoNear` is always a checked amount.
 */
export type YoctoNear = string & { readonly __yoctoNearBrand: 'YoctoNear' };

/**
 * Convert a decimal NEAR amount to yoctoNEAR.
 *
 * @example
 * parseNear('1'); // '1000000000000000000000000'
 * parseNear('0.5'); // '500000000000000000000000'
 *
 * @throws {AmountError} as `parseUnits`, with at most 24 decimal places.
 */
export function parseNear(amount: string): YoctoNear {
  return parseUnits(amount, 24).toString() as YoctoNear;
}

/**
 * Take an amount that is already in yoctoNEAR.
 *
 * @example
 * yoctoNear('1000000000000000000000000'); // 1 NEAR
 *
 * @throws {AmountError} unless `amount` is a non-negative integer.
 */
export function yoctoNear(amount: string | bigint): YoctoNear {
  const digits = typeof amount === 'bigint' ? amount.toString() : amount;
  return parseUnits(digits, 0).toString() as YoctoNear;
}

/**
 * A NEAR amount that `transfer` takes: a `YoctoNear`, or a literal with its
 * unit, such as `'1 NEAR'` or `'1000 yoctoNEAR'`. A string without a unit does
 * not compile, because it could mean either unit.
 */
export type NearAmount = YoctoNear | `${number} NEAR` | `${bigint} yoctoNEAR`;

const YOCTO_NEAR_SUFFIX = ' yoctoNEAR';
const NEAR_SUFFIX = ' NEAR';

/**
 * Resolve a `NearAmount` to yoctoNEAR with the same exact parsers.
 *
 * @throws {AmountError} for a negative, non-numeric or over-precise amount,
 * or for spacing other than one space before the unit.
 */
export function toYoctoNear(amount: NearAmount): YoctoNear {
  if (amount.endsWith(YOCTO_NEAR_SUFFIX)) {
    return yoctoNear(amount.slice(0, -YOCTO_NEAR_SUFFIX.length));
  }
  if (amount.endsWith(NEAR_SUFFIX)) return parseNear(amount.slice(0, -NEAR_SUFFIX.length));
  return yoctoNear(amount);
}

/**
 * Convert a decimal amount of an EVM chain's native coin to wei
 * (1 coin = 10^18 wei). "Ether" names the 10^18 denomination, so this is
 * correct for any chain whose native coin has 18 decimals: ETH on Ethereum
 * and Base, POL on Polygon, and so on.
 *
 * @example
 * parseEther('1'); // 1000000000000000000n
 * parseEther('0.5'); // 500000000000000000n
 *
 * @throws {AmountError} as `parseUnits`, with at most 18 decimal places.
 */
export function parseEther(amount: string): bigint {
  return parseUnits(amount, 18);
}
