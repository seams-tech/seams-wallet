import { base64UrlDecode } from '@shared/utils/encoders';
import { SIGNING_SESSION_SEAL_ALG } from '@shared/utils/signingSessionSeal';
import { toOptionalTrimmedString } from '@shared/utils/validation';
import { parseSigningSessionSealKeyVersion } from '../../../core/keyMaterialBrands';
import { createSigningSessionSealEvaluator } from './crypto/oprf';
import { createInMemorySigningSessionSealRateLimiter } from './guards';
import { createSigningSessionSealRoutesOptions } from './routesOptions';

export type CreateSigningSessionSealOptionsInput = {
  readonly rootSecretB64u: string;
  readonly currentKeyVersion: unknown;
  readonly acceptedWarmKeyVersions?: readonly unknown[];
};

/** Evaluations allowed for one wallet and threshold session in each window. */
const SIGNING_SESSION_SEAL_RATE_LIMIT = 30;
const SIGNING_SESSION_SEAL_RATE_LIMIT_WINDOW_MS = 60_000;

function parseKeyVersion(value: unknown, label: string): string {
  const parsed = toOptionalTrimmedString(value);
  if (!parsed) throw new Error(`${label} is required`);
  return String(parseSigningSessionSealKeyVersion(parsed));
}

function requireRootSecretB64u(value: unknown): string {
  const encoded = toOptionalTrimmedString(value);
  if (!encoded) throw new Error('SIGNING_SESSION_SEAL_ROOT_SECRET_B64U is required');
  const rootSecret32 = base64UrlDecode(encoded);
  const length = rootSecret32.length;
  rootSecret32.fill(0);
  if (length !== 32) {
    throw new Error('SIGNING_SESSION_SEAL_ROOT_SECRET_B64U must decode to exactly 32 bytes');
  }
  return encoded;
}

/**
 * The signing-session seal routes. The evaluation is an oracle for the POPRF under one key, so a
 * rate limit for each wallet and threshold session bounds the evaluations that one key answers.
 */
export function createSigningSessionSealOptions(input: CreateSigningSessionSealOptionsInput) {
  const currentKeyVersion = parseKeyVersion(input.currentKeyVersion, 'currentKeyVersion');
  const acceptedKeyVersions = (input.acceptedWarmKeyVersions ?? [currentKeyVersion]).map(
    (value, index) => parseKeyVersion(value, `acceptedWarmKeyVersions[${index}]`),
  );
  if (new Set(acceptedKeyVersions).size !== acceptedKeyVersions.length) {
    throw new Error('acceptedWarmKeyVersions must not contain duplicates');
  }
  return createSigningSessionSealRoutesOptions({
    evaluator: createSigningSessionSealEvaluator({
      rootSecretB64u: requireRootSecretB64u(input.rootSecretB64u),
      currentKeyVersion,
      acceptedKeyVersions,
    }),
    capabilities: {
      mode: 'sealed_refresh_v1',
      protocol: { algorithm: SIGNING_SESSION_SEAL_ALG },
      currentKeyVersion,
    },
    rateLimit: {
      limiter: createInMemorySigningSessionSealRateLimiter(),
      limit: SIGNING_SESSION_SEAL_RATE_LIMIT,
      windowMs: SIGNING_SESSION_SEAL_RATE_LIMIT_WINDOW_MS,
    },
    logger: console,
  });
}
