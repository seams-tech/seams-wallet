import { base64UrlEncode } from './encoders';
import { alphabetizeStringify, sha256BytesUtf8 } from './digests';
import {
  parseEmailOtpProviderUserId,
  parseWalletAuthorityBindingDigest,
  parseWalletAuthMethodId,
  parseWalletId,
  parseWebAuthnCredentialIdB64u,
  parseWebAuthnRpId,
  type EmailOtpChallengeId,
  type EmailOtpProviderUserId,
  type VerifiedEmailAddress,
  type WalletAuthorityBindingDigest,
  type WalletAuthMethodId,
  type WalletId,
  type WebAuthnCredentialIdB64u,
  type WebAuthnRpId,
} from './domainIds';

const WALLET_AUTHORITY_BINDING_DIGEST_DOMAIN = 'seams:wallet-authority-binding:v1|';

export type EmailOtpProvider = 'google' | 'email';

export type PasskeyFactorIdentity = {
  kind: 'passkey';
  credentialIdB64u: WebAuthnCredentialIdB64u;
  rpId?: never;
  provider?: never;
  providerUserId?: never;
};

export type EmailOtpFactorIdentity = {
  kind: 'email_otp';
  provider: EmailOtpProvider;
  providerUserId: EmailOtpProviderUserId;
  rpId?: never;
  credentialIdB64u?: never;
};

export type AuthFactorIdentity = PasskeyFactorIdentity | EmailOtpFactorIdentity;

export type PasskeyWalletAuthAuthority = {
  walletId: WalletId;
  factor: PasskeyFactorIdentity;
  verifier: {
    kind: 'webauthn';
    rpId: WebAuthnRpId;
  };
  bindingId: WalletAuthMethodId;
  kind?: never;
  rpId?: never;
  credentialIdB64u?: never;
  provider?: never;
  providerUserId?: never;
};

export type EmailOtpWalletAuthAuthority = {
  walletId: WalletId;
  factor: EmailOtpFactorIdentity;
  verifier: {
    kind: 'email_otp_wallet_auth_method';
    emailHashHex: string;
  };
  bindingId: WalletAuthMethodId;
  kind?: never;
  rpId?: never;
  credentialIdB64u?: never;
  provider?: never;
  providerUserId?: never;
};

export type WalletAuthAuthority = PasskeyWalletAuthAuthority | EmailOtpWalletAuthAuthority;

export function isPasskeyWalletAuthAuthority(
  authority: WalletAuthAuthority,
): authority is PasskeyWalletAuthAuthority {
  return authority.factor.kind === 'passkey';
}

export function isEmailOtpWalletAuthAuthority(
  authority: WalletAuthAuthority,
): authority is EmailOtpWalletAuthAuthority {
  return authority.factor.kind === 'email_otp';
}

export function walletAuthAuthoritiesMatch(
  left: WalletAuthAuthority,
  right: WalletAuthAuthority,
): boolean {
  if (left.walletId !== right.walletId || left.bindingId !== right.bindingId) return false;
  if (isPasskeyWalletAuthAuthority(left)) {
    if (!isPasskeyWalletAuthAuthority(right)) return false;
    return (
      left.factor.credentialIdB64u === right.factor.credentialIdB64u &&
      left.verifier.rpId === right.verifier.rpId
    );
  }
  if (isEmailOtpWalletAuthAuthority(left)) {
    if (!isEmailOtpWalletAuthAuthority(right)) return false;
    return (
      left.factor.provider === right.factor.provider &&
      left.factor.providerUserId === right.factor.providerUserId &&
      left.verifier.emailHashHex === right.verifier.emailHashHex
    );
  }
  left satisfies never;
  return false;
}

export type EmailOtpFactorProfile = {
  factor: EmailOtpFactorIdentity;
  email: VerifiedEmailAddress;
};

export type WalletAuthAuthorityRef = {
  kind: 'wallet_auth_authority_ref';
  walletId: WalletId;
  authorityDigest: WalletAuthorityBindingDigest;
  /**
   * Which wallet auth method issued this authority.
   *
   * The digest already proves *what* the authority was, but proving is not
   * addressing: revoking or pausing one credential has to select every session
   * that credential issued, and a digest can only be recomputed and compared
   * one candidate at a time. Carrying the binding id makes that selection a
   * lookup. It is always derived from the authority rather than supplied, so a
   * ref whose id disagrees with its digest cannot be built.
   */
  walletAuthMethodId: WalletAuthMethodId;
};

export function parseWalletAuthAuthorityRef(raw: unknown): WalletAuthAuthorityRef | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const fields = Object.keys(record);
  if (
    fields.length !== 4 ||
    !fields.every((field) =>
      ['kind', 'walletId', 'authorityDigest', 'walletAuthMethodId'].includes(field),
    ) ||
    record.kind !== 'wallet_auth_authority_ref'
  ) {
    return null;
  }
  const walletId = parseWalletId(record.walletId);
  const authorityDigest = parseWalletAuthorityBindingDigest(record.authorityDigest);
  const walletAuthMethodId = parseWalletAuthMethodId(record.walletAuthMethodId);
  if (!walletId.ok || !authorityDigest.ok || !walletAuthMethodId.ok) return null;
  return {
    kind: 'wallet_auth_authority_ref',
    walletId: walletId.value,
    authorityDigest: authorityDigest.value,
    walletAuthMethodId: walletAuthMethodId.value,
  };
}

export type AuthOperationPurpose =
  | 'registration'
  | 'unlock'
  | 'step_up'
  | 'recovery'
  | 'key_export';

export type AuthMethodProof =
  | {
      kind: 'passkey_registration_credential';
      webauthnRegistration: unknown;
    }
  | {
      kind: 'passkey_assertion';
      assertion: unknown;
    }
  | {
      kind: 'email_otp_challenge';
      challengeId: EmailOtpChallengeId;
      otpCode: string;
    }
  | {
      kind: 'google_sso_registration';
      registrationAttemptId: string;
      registrationOfferId: string;
      registrationCandidateId: string;
    };

export type AuthBoundaryProof = {
  purpose: AuthOperationPurpose;
  proof: AuthMethodProof;
};

export type ProofFor<P extends AuthOperationPurpose> = AuthBoundaryProof & {
  readonly __authOperationPurpose?: P;
};

function parseEmailOtpProvider(raw: unknown): EmailOtpProvider | null {
  const provider = String(raw || '')
    .trim()
    .toLowerCase();
  if (provider === 'google' || provider === 'email') return provider;
  return null;
}

function requireParsed<T>(
  parsed: { ok: true; value: T } | { ok: false; error: unknown },
  message: string,
): T {
  if (parsed.ok) return parsed.value;
  throw new Error(message);
}

function hasOwnField(obj: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, field);
}

function hasAnyOwnField(obj: Record<string, unknown>, fields: readonly string[]): boolean {
  for (const field of fields) {
    if (hasOwnField(obj, field)) return true;
  }
  return false;
}

export function buildPasskeyWalletAuthAuthority(args: {
  walletId: unknown;
  rpId: unknown;
  credentialIdB64u: unknown;
}): PasskeyWalletAuthAuthority {
  const walletId = requireParsed(
    parseWalletId(args.walletId),
    'Passkey wallet auth authority requires walletId',
  );
  const rpId = requireParsed(
    parseWebAuthnRpId(args.rpId),
    'Passkey wallet auth authority requires rpId',
  );
  const credentialIdB64u = requireParsed(
    parseWebAuthnCredentialIdB64u(args.credentialIdB64u),
    'Passkey wallet auth authority requires credentialIdB64u',
  );
  const bindingId = requireParsed(
    parseWalletAuthMethodId(`passkey:${rpId}:${credentialIdB64u}`),
    'Passkey wallet auth authority requires bindingId',
  );
  return {
    walletId,
    factor: {
      kind: 'passkey',
      credentialIdB64u,
    },
    verifier: {
      kind: 'webauthn',
      rpId,
    },
    bindingId,
  };
}

export function buildEmailOtpFactorIdentity(args: {
  provider: unknown;
  providerUserId: unknown;
}): EmailOtpFactorIdentity {
  const provider = parseEmailOtpProvider(args.provider);
  if (!provider) {
    throw new Error('Email OTP factor identity requires provider');
  }
  return {
    kind: 'email_otp',
    provider,
    providerUserId: requireParsed(
      parseEmailOtpProviderUserId(args.providerUserId),
      'Email OTP factor identity requires providerUserId',
    ),
  };
}

export function buildEmailOtpWalletAuthAuthority(args: {
  walletId: unknown;
  provider: unknown;
  providerUserId: unknown;
  emailHashHex: unknown;
}): EmailOtpWalletAuthAuthority {
  const walletId = requireParsed(
    parseWalletId(args.walletId),
    'Email OTP wallet auth authority requires walletId',
  );
  const factor = buildEmailOtpFactorIdentity(args);
  const emailHashHex = String(args.emailHashHex || '').trim();
  if (!emailHashHex) {
    throw new Error('Email OTP wallet auth authority requires emailHashHex');
  }
  const bindingId = requireParsed(
    parseWalletAuthMethodId(`email_otp:${walletId}:${emailHashHex}`),
    'Email OTP wallet auth authority requires bindingId',
  );
  return {
    walletId,
    factor,
    verifier: {
      kind: 'email_otp_wallet_auth_method',
      emailHashHex,
    },
    bindingId,
  };
}

export function emailOtpWalletAuthAuthorityProvider(
  authority: EmailOtpWalletAuthAuthority,
): EmailOtpProvider {
  return authority.factor.provider;
}

export function emailOtpWalletAuthAuthorityProviderUserId(
  authority: EmailOtpWalletAuthAuthority,
): EmailOtpProviderUserId {
  return authority.factor.providerUserId;
}

export function emailOtpWalletAuthAuthorityEmailHashHex(
  authority: EmailOtpWalletAuthAuthority,
): string {
  return authority.verifier.emailHashHex;
}

function parsePasskeyWalletAuthAuthorityObject(
  obj: Record<string, unknown>,
): PasskeyWalletAuthAuthority | null {
  const factor = obj.factor;
  if (!factor || typeof factor !== 'object' || Array.isArray(factor)) return null;
  const verifier = obj.verifier;
  if (!verifier || typeof verifier !== 'object' || Array.isArray(verifier)) return null;
  const factorObj = factor as Record<string, unknown>;
  const verifierObj = verifier as Record<string, unknown>;
  const factorKind = String(factorObj.kind || '')
    .trim()
    .toLowerCase();
  const verifierKind = String(verifierObj.kind || '')
    .trim()
    .toLowerCase();
  if (factorKind !== 'passkey' || verifierKind !== 'webauthn') return null;
  try {
    if (hasAnyOwnField(obj, ['kind', 'rpId', 'credentialIdB64u', 'provider', 'providerUserId'])) {
      return null;
    }
    const walletId = parseWalletId(obj.walletId);
    const rpId = parseWebAuthnRpId(verifierObj.rpId);
    const credentialIdB64u = parseWebAuthnCredentialIdB64u(factorObj.credentialIdB64u);
    const bindingId = parseWalletAuthMethodId(obj.bindingId);
    if (!walletId.ok || !rpId.ok || !credentialIdB64u.ok || !bindingId.ok) return null;
    return {
      walletId: walletId.value,
      factor: { kind: 'passkey', credentialIdB64u: credentialIdB64u.value },
      verifier: { kind: 'webauthn', rpId: rpId.value },
      bindingId: bindingId.value,
    };
  } catch {
    return null;
  }
}

function parseEmailOtpWalletAuthAuthorityObject(
  obj: Record<string, unknown>,
): EmailOtpWalletAuthAuthority | null {
  const factor = obj.factor;
  if (!factor || typeof factor !== 'object' || Array.isArray(factor)) return null;
  const verifier = obj.verifier;
  if (!verifier || typeof verifier !== 'object' || Array.isArray(verifier)) return null;
  const factorObj = factor as Record<string, unknown>;
  const verifierObj = verifier as Record<string, unknown>;
  const factorKind = String(factorObj.kind || '')
    .trim()
    .toLowerCase();
  const verifierKind = String(verifierObj.kind || '')
    .trim()
    .toLowerCase();
  if (factorKind !== 'email_otp' || verifierKind !== 'email_otp_wallet_auth_method') {
    return null;
  }
  try {
    if (hasAnyOwnField(obj, ['kind', 'rpId', 'credentialIdB64u', 'provider', 'providerUserId'])) {
      return null;
    }
    const walletId = parseWalletId(obj.walletId);
    const provider = parseEmailOtpProvider(factorObj.provider);
    const providerUserId = parseEmailOtpProviderUserId(factorObj.providerUserId);
    const emailHashHex = String(verifierObj.emailHashHex || '').trim();
    const bindingId = parseWalletAuthMethodId(obj.bindingId);
    if (!walletId.ok || !provider || !providerUserId.ok || !emailHashHex || !bindingId.ok) {
      return null;
    }
    return {
      walletId: walletId.value,
      factor: { kind: 'email_otp', provider, providerUserId: providerUserId.value },
      verifier: { kind: 'email_otp_wallet_auth_method', emailHashHex },
      bindingId: bindingId.value,
    };
  } catch {
    return null;
  }
}

export function parseWalletAuthAuthority(raw: unknown): WalletAuthAuthority | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  return parsePasskeyWalletAuthAuthorityObject(obj) || parseEmailOtpWalletAuthAuthorityObject(obj);
}

export function parseEmailOtpWalletAuthAuthority(raw: unknown): EmailOtpWalletAuthAuthority | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return parseEmailOtpWalletAuthAuthorityObject(raw as Record<string, unknown>);
}

export function parsePasskeyWalletAuthAuthority(raw: unknown): PasskeyWalletAuthAuthority | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return parsePasskeyWalletAuthAuthorityObject(raw as Record<string, unknown>);
}

export function canonicalWalletAuthorityBindingDigestInput(args: {
  authority: WalletAuthAuthority;
}): string {
  return `${WALLET_AUTHORITY_BINDING_DIGEST_DOMAIN}${alphabetizeStringify(args.authority)}`;
}

export async function walletAuthorityBindingDigest(args: {
  authority: WalletAuthAuthority;
}): Promise<WalletAuthorityBindingDigest> {
  const digest = base64UrlEncode(
    await sha256BytesUtf8(canonicalWalletAuthorityBindingDigestInput(args)),
  );
  return requireParsed(
    parseWalletAuthorityBindingDigest(digest),
    'Wallet authority binding digest must be non-empty',
  );
}

export async function walletAuthAuthorityRef(args: {
  authority: WalletAuthAuthority;
}): Promise<WalletAuthAuthorityRef> {
  return {
    kind: 'wallet_auth_authority_ref',
    walletId: args.authority.walletId,
    authorityDigest: await walletAuthorityBindingDigest({
      authority: args.authority,
    }),
    walletAuthMethodId: args.authority.bindingId,
  };
}
