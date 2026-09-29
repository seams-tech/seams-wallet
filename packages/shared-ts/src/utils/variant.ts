/**
 * The members of union `U` whose `K` field is `V`.
 *
 * A bare `Extract<U, { K: V }>` accepts any `V` and quietly becomes `never` when
 * nothing matches, so a misspelled or renamed discriminant only fails later, at
 * some distant use. Here `V` must be one of the values `U[K]` already has.
 */
export type Variant<U, K extends keyof U, V extends U[K]> = Extract<U, { readonly [P in K]: V }>;
