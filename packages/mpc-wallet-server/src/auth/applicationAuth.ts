import type {
  ExternalAuthConfiguration,
  ExternalAuthPurpose,
  ExternalAuthResult,
  ExternalIdentity,
} from '@shared/auth/externalAuth';
import { externalAuthFailure } from '@shared/auth/externalAuth';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import type { Variant } from '@shared/utils/variant';

const ASSERTION_TTL_MS = 120_000;

type ApplicationTrust = Variant<ExternalAuthConfiguration, 'kind', 'application'>;
type ApplicationAssertionClaims = Readonly<{
  iss: string;
  sub: string;
  aud: string;
  walletId: string;
  attemptId: string;
  iat: number;
  exp: number;
  sessionExp: number;
  purpose: ExternalAuthPurpose;
}>;

function parseClaims(raw: unknown): ApplicationAssertionClaims {
  const value = requireRecord(raw, 'application assertion claims');
  if (
    typeof value.iat !== 'number' ||
    typeof value.exp !== 'number' ||
    typeof value.sessionExp !== 'number'
  ) {
    throw new Error('Application assertion timestamps are missing');
  }
  if (
    !Number.isSafeInteger(value.iat) ||
    !Number.isSafeInteger(value.exp) ||
    !Number.isSafeInteger(value.sessionExp)
  )
    throw new Error('Application assertion timestamps must be integer seconds');
  if (value.purpose !== 'authenticate' && value.purpose !== 'associate') {
    throw new Error('Application assertion purpose is invalid');
  }
  return {
    iss: requireCanonicalString(value.iss, 'iss'),
    sub: requireCanonicalString(value.sub, 'sub'),
    aud: requireCanonicalString(value.aud, 'aud'),
    walletId: requireCanonicalString(value.walletId, 'walletId'),
    attemptId: requireCanonicalString(value.attemptId, 'attemptId'),
    iat: value.iat,
    exp: value.exp,
    sessionExp: value.sessionExp,
    purpose: value.purpose,
  };
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeJson(value: string): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(base64UrlDecode(value)));
}

function audience(environmentId: string): string {
  return `seams:external-auth:${environmentId}`;
}

/** Called only by the application's authenticated backend with its enrolled issuer key. */
export async function createApplicationAuthAssertion(input: {
  readonly privateKey: CryptoKey;
  readonly issuer: string;
  readonly subject: string;
  readonly environmentId: string;
  readonly walletId: string;
  readonly attemptId: string;
  readonly nowMs: number;
  readonly sessionExpiresAtMs: number;
  readonly purpose: ExternalAuthPurpose;
}): Promise<string> {
  if (input.privateKey.type !== 'private' || input.privateKey.algorithm.name !== 'Ed25519') {
    throw new Error('Application issuer requires an Ed25519 signing key');
  }
  const claims = parseClaims({
    iss: input.issuer,
    sub: input.subject,
    aud: audience(requireCanonicalString(input.environmentId, 'environmentId')),
    walletId: input.walletId,
    attemptId: input.attemptId,
    iat: Math.floor(input.nowMs / 1000),
    exp: Math.floor(Math.min(input.nowMs + ASSERTION_TTL_MS, input.sessionExpiresAtMs) / 1000),
    sessionExp: Math.floor(input.sessionExpiresAtMs / 1000),
    purpose: input.purpose,
  });
  const signed = `${encodeJson({ alg: 'EdDSA', typ: 'JWT' })}.${encodeJson(claims)}`;
  const signature = await crypto.subtle.sign(
    'Ed25519',
    input.privateKey,
    new TextEncoder().encode(signed),
  );
  return `${signed}.${base64UrlEncode(signature)}`;
}

export async function verifyApplicationAuthAssertion(input: {
  readonly trust: ApplicationTrust;
  readonly assertion: string;
  readonly environmentId: string;
  readonly walletId: string;
  readonly attemptId: string;
  readonly nowMs: number;
  readonly purpose: ExternalAuthPurpose;
}): Promise<
  ExternalAuthResult<{
    identity: Variant<ExternalIdentity, 'provider', 'application'>;
    expiresAtMs: number;
  }>
> {
  try {
    const segments = input.assertion.split('.');
    if (segments.length !== 3) return externalAuthFailure('invalid_credential');
    const [headerText, claimsText, signatureText] = segments;
    if (!headerText || !claimsText || !signatureText)
      return externalAuthFailure('invalid_credential');
    const header = requireRecord(decodeJson(headerText), 'application assertion header');
    if (header.alg !== 'EdDSA' || header.typ !== 'JWT' || 'crit' in header) {
      return externalAuthFailure('invalid_credential');
    }
    const key = await crypto.subtle.importKey(
      'raw',
      base64UrlDecode(input.trust.publicKeyB64u),
      'Ed25519',
      false,
      ['verify'],
    );
    const verified = await crypto.subtle.verify(
      'Ed25519',
      key,
      base64UrlDecode(signatureText),
      new TextEncoder().encode(`${headerText}.${claimsText}`),
    );
    if (!verified) return externalAuthFailure('invalid_credential');
    const claims = parseClaims(decodeJson(claimsText));
    const expiresAtMs = claims.exp * 1000;
    const issuedAtMs = claims.iat * 1000;
    if (expiresAtMs <= input.nowMs) return externalAuthFailure('expired');
    if (
      claims.iss !== input.trust.issuer ||
      claims.aud !== audience(input.environmentId) ||
      claims.walletId !== input.walletId ||
      claims.attemptId !== input.attemptId ||
      claims.purpose !== input.purpose ||
      issuedAtMs > input.nowMs + 30_000 ||
      expiresAtMs <= issuedAtMs ||
      expiresAtMs - issuedAtMs > ASSERTION_TTL_MS ||
      claims.sessionExp < claims.exp
    )
      return externalAuthFailure('invalid_credential');
    return {
      ok: true,
      value: {
        identity: { provider: 'application', issuer: claims.iss, subject: claims.sub },
        expiresAtMs: claims.sessionExp * 1000,
      },
    };
  } catch {
    return externalAuthFailure('invalid_credential');
  }
}
