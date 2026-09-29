import type { Variant } from './variant';

type Method =
  | { readonly kind: 'passkey'; readonly status: 'active'; readonly credentialId: string }
  | { readonly kind: 'passkey'; readonly status: 'revoked'; readonly credentialId: string }
  | { readonly kind: 'email_otp'; readonly status: 'active'; readonly email: string };

type ActivePasskey = Variant<Variant<Method, 'status', 'active'>, 'kind', 'passkey'>;

export const activePasskey: ActivePasskey = {
  kind: 'passkey',
  status: 'active',
  credentialId: 'credential',
};

export const activeMethods: readonly Variant<Method, 'status', 'active'>[] = [
  activePasskey,
  { kind: 'email_otp', status: 'active', email: 'alice@example.test' },
];

export const revokedPasskey: ActivePasskey = {
  kind: 'passkey',
  // @ts-expect-error The narrowed variant keeps only the active passkey.
  status: 'revoked',
  credentialId: 'credential',
};

// @ts-expect-error A discriminant value that no member has is rejected, not narrowed to never.
export type MisspelledKind = Variant<Method, 'kind', 'pass_key'>;

// @ts-expect-error A field that only some members carry cannot select a variant.
export type NotADiscriminant = Variant<Method, 'email', string>;
