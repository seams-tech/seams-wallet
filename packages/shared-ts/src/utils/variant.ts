/**
 * The members of union `U` whose `K` field is `V`.
 *
 * A bare `Extract<U, { K: V }>` accepts any `V` and quietly becomes `never` when
 * nothing matches, so a misspelled or renamed discriminant only fails later, at
 * some distant use. Here `V` must be one of the values `U[K]` already has.
 */
export type Variant<U, K extends keyof U, V extends U[K]> = Extract<U, { readonly [P in K]: V }>;

type KeysOfUnion<U> = U extends unknown ? keyof U : never;
type Flatten<T> = { [K in keyof T]: T[K] };

/**
 * Union `U` with each member's missing keys added as `?: never`, where the missing keys are
 * those that other members declare. The members stay mutually exclusive, and code can read any
 * member's key without narrowing first (it reads as `undefined` on the members that lack it).
 * `K` holds every member's keys, taken before `U` distributes.
 */
export type ExclusiveUnion<U, K extends PropertyKey = KeysOfUnion<U>> = U extends unknown
  ? Flatten<U & { [P in Exclude<K, keyof U>]?: never }>
  : never;

/** `ExclusiveUnion` for readonly members: the added keys are `readonly` too. */
export type ReadonlyExclusiveUnion<U, K extends PropertyKey = KeysOfUnion<U>> = U extends unknown
  ? Flatten<U & { readonly [P in Exclude<K, keyof U>]?: never }>
  : never;
