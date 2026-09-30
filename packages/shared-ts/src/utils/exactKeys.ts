/**
 * True when `value` is a non-array object whose own enumerable string keys are exactly `keys`.
 *
 * A key whose value is `undefined` still counts as present. Symbol, non-enumerable and inherited
 * keys are not counted, and the prototype is not checked. A list that repeats a key never matches.
 * Kept apart from validation.ts, which the wallet iframe's boot path loads.
 */
export function hasExactKeys<const K extends readonly string[]>(
  value: unknown,
  keys: K,
): value is { readonly [P in K[number]]: unknown } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}
