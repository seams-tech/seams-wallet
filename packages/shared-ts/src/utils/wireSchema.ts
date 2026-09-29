// Declares each field of a wire record once: one shape gives the parser, its exact key list
// and its output, and the record's type is inferred from it. Build schemas in functions, and
// mark a module-level combinator call /* @__PURE__ */: Bun, which bundles the workers, keeps
// any other module-level call, so the schema would ship in every worker importing its module.
import { requireArray, requireRecord } from './validation';
import { exactRecord } from './exactRecord';

/** Parses one wire value; `label` is the value's path, for its error messages. */
export type WireParser<T> = (raw: unknown, label: string) => T;

type WireType<P> = P extends WireParser<infer T> ? T : never;

type WireShape = Record<string, WireParser<unknown>>;

type WireObjectType<S extends WireShape> = { -readonly [K in keyof S]: WireType<S[K]> };

type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly message: string } };

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// `field?: never` members only keep a union's variants apart; no parser produces them.
type NeverPaddingKeys<T> = {
  [K in keyof T]-?: [T[K]] extends [undefined] ? K : never;
}[keyof T];

// A parser builds a fresh value, so whether a declared type marks its fields readonly says
// nothing about the parse; the check compares types with every field writable.
type Writable<T> = T extends string | number | boolean | bigint | symbol | null | undefined
  ? T
  : { -readonly [K in keyof T]: Writable<T[K]> };

/**
 * Whether parser `P`, or the parser that function `P` builds, produces exactly `T`, apart
 * from `T`'s `?: never` padding and readonly markers.
 */
export type ParsesExactly<P, T> = Equal<
  Writable<P extends () => infer Built ? WireType<Built> : WireType<P>>,
  Writable<T extends unknown ? Omit<T, NeverPaddingKeys<T>> : never>
>;

/** Compiles only when every check holds; the error shows which entry is false. */
export type AllTrue<T extends readonly true[]> = T;

/** One of the given strings. */
export function wireLiteral<V extends string>(
  ...literals: V[]
): WireParser<V> & { readonly literals: readonly V[] } {
  const parse = (raw: unknown, label: string): V => {
    if (!literals.includes(raw as V)) throw new Error(`${label} is invalid`);
    return raw as V;
  };
  return Object.assign(parse, { literals });
}

/**
 * An object with exactly the fields of `shape`, all required, returned in the shape's order.
 * Checks run in this order: exact keys, then literals (they say which record this is), then
 * the other fields in declaration order, then `refine`'s cross-field rules.
 */
export function wireObject<S extends WireShape>(
  shape: S,
  refine?: (value: WireObjectType<S>, label: string) => void,
): WireParser<WireObjectType<S>> & { readonly shape: S } {
  const keys = Object.keys(shape);
  const order = [
    ...keys.filter((key) => 'literals' in shape[key]),
    ...keys.filter((key) => !('literals' in shape[key])),
  ];
  const parse = (raw: unknown, label: string): WireObjectType<S> => {
    const record = exactRecord(raw, keys, label);
    const parsed = new Map<string, unknown>();
    for (const key of order) parsed.set(key, shape[key](record[key], `${label}.${key}`));
    const value = Object.fromEntries(keys.map((key) => [key, parsed.get(key)]));
    refine?.(value as WireObjectType<S>, label);
    return value as WireObjectType<S>;
  };
  return Object.assign(parse, { shape });
}

/** One of `variants`, chosen by the literal each declares for field `tag`. */
export function wireUnion<
  K extends string,
  V extends WireParser<unknown> & {
    readonly shape: { readonly [P in K]: { readonly literals: readonly string[] } };
  },
>(tag: K, variants: readonly V[]): WireParser<WireType<V>> {
  const byTag = new Map<unknown, V>();
  for (const variant of variants) {
    for (const literal of variant.shape[tag].literals) byTag.set(literal, variant);
  }
  return (raw, label) => {
    const record = requireRecord(raw, label);
    const variant = byTag.get(record[tag]);
    if (!variant) throw new Error(`${label}.${tag} is invalid`);
    return variant(record, label) as WireType<V>;
  };
}

/** `null`, or a value `parse` accepts. */
export function wireNullable<T>(parse: WireParser<T>): WireParser<T | null> {
  return (raw, label) => (raw === null ? null : parse(raw, label));
}

/** A non-empty array of `item`; `refine` checks rules that span the items. */
export function wireNonEmptyArray<T>(
  item: WireParser<T>,
  refine?: (items: readonly [T, ...T[]], label: string) => void,
): WireParser<readonly [T, ...T[]]> {
  return (raw, label) => {
    const entries = requireArray(raw, label);
    if (entries.length === 0) throw new Error(`${label} must be non-empty`);
    const [first, ...rest] = entries.map((entry, index) => item(entry, `${label}[${index}]`));
    const items: readonly [T, ...T[]] = [first, ...rest];
    refine?.(items, label);
    return items;
  };
}

/** Adapts a parser that returns a result, putting the field's label before its error. */
export function wireResult<T>(parse: (raw: unknown) => ParseResult<T>): WireParser<T> {
  return (raw, label) => {
    const result = parse(raw);
    if (result.ok) return result.value;
    throw new Error(`${label} ${result.error.message}`);
  };
}

/** Adapts a parser that throws, putting the field's label before its error. */
export function wireLabeled<T>(parse: (raw: unknown) => T): WireParser<T> {
  return (raw, label) => {
    try {
      return parse(raw);
    } catch (error) {
      throw new Error(`${label} ${error instanceof Error ? error.message : 'is invalid'}`);
    }
  };
}
