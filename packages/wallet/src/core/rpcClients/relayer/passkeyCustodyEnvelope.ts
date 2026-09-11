import {
  buildBearerAuthorizationHeader,
  buildRelayerJsonPostRequestInit,
  normalizeRelayerBaseUrl,
} from './relayerHttp';
import {
  parsePasskeyCustodyEnvelopeRecord,
  type PasskeyCustodyEnvelopeRecord,
} from '@shared/passkey-custody';

/**
 * Fetching a wallet's custody envelope from a device that has none.
 *
 * The server route answers with a distinct status per failure, and this keeps
 * them distinct. Collapsing them into one error is the tempting shape and the
 * wrong one: "this credential no longer opens the wallet" is something the
 * user can act on, "no envelope exists here" means they should register, and a
 * digest mismatch is an incident. A single `throw` makes all three read as
 * "unlock failed", which is how a recoverable state becomes a support ticket.
 *
 * The response is ciphertext. Opening it needs the PRF-derived KEK, which
 * exists only inside the signing worker — nothing here can read what it
 * fetches, and that is why the envelope may cross the network at all.
 */

const PASSKEY_CUSTODY_ENVELOPE_PATH = '/wallets/custody/envelope';

export type PasskeyCustodyEnvelopeFetchResult =
  | {
      readonly kind: 'active';
      /** The sealed record is structurally validated before it reaches the worker. */
      readonly envelope: PasskeyCustodyEnvelopeRecord;
      /** The revision a cached copy must match before it is trusted. */
      readonly storeVersion: string;
    }
  /** The credential is not this wallet's, or no longer opens it. */
  | { readonly kind: 'credential_rejected'; readonly code: string; readonly message: string }
  /** This wallet has no envelope for this credential — enrolment, not unlock. */
  | { readonly kind: 'missing'; readonly message: string }
  /** Superseded; the wallet's current credential is the one to use. */
  | { readonly kind: 'retired'; readonly message: string }
  /** The stored record failed its own digest. Never retried, never derived. */
  | { readonly kind: 'corrupt'; readonly message: string }
  | { readonly kind: 'request_rejected'; readonly code: string; readonly message: string }
  | { readonly kind: 'transport_failed'; readonly message: string };

export async function fetchPasskeyCustodyEnvelope(args: {
  readonly relayUrl: string;
  readonly locator: unknown;
  readonly challengeId: string;
  readonly expectedOrigin: string;
  /** Assertion with extension outputs already stripped in the worker. */
  readonly webauthnAuthentication: unknown;
  readonly fetchImpl?: typeof fetch;
}): Promise<PasskeyCustodyEnvelopeFetchResult> {
  const url = `${normalizeRelayerBaseUrl(args.relayUrl)}${PASSKEY_CUSTODY_ENVELOPE_PATH}`;
  const doFetch = args.fetchImpl || fetch;

  let response: Response;
  try {
    response = await doFetch(
      url,
      buildRelayerJsonPostRequestInit({
        body: {
          locator: args.locator,
          challengeId: args.challengeId,
          expectedOrigin: args.expectedOrigin,
          webauthnAuthentication: args.webauthnAuthentication,
        },
      }),
    );
  } catch (error: unknown) {
    /* Kept separate from every server refusal. A network failure says nothing
       about whether the credential is valid, and retrying is reasonable —
       which is not true of any of the statuses below. */
    return {
      kind: 'transport_failed',
      message: error instanceof Error ? error.message : 'custody envelope request failed',
    };
  }

  const bodyUnknown: unknown = await response.json().catch(() => undefined);

  if (response.status === 200 && responseDeclaresSuccess(bodyUnknown)) {
    try {
      const body = decodePasskeyCustodyEnvelopeResponse(bodyUnknown);
      return { kind: 'active', envelope: body.envelope, storeVersion: body.storeVersion };
    } catch {
      /* A 200 that cannot be used is treated as corrupt rather than active:
         unlocking against a half-read response would fail later and further
         from the cause. */
      return { kind: 'corrupt', message: 'custody envelope response was incomplete' };
    }
  }

  const failure = decodeFailureResponse(bodyUnknown, 'custody envelope response');
  const code = failure.code ?? '';
  const message = failure.message ?? '';

  switch (response.status) {
    case 404:
      return { kind: 'missing', message: message || 'no custody envelope for this credential' };
    case 409:
      return { kind: 'retired', message: message || 'this envelope was superseded' };
    case 401:
    case 403:
      return {
        kind: 'credential_rejected',
        code: code || 'credential_rejected',
        message: message || 'this credential does not open the wallet',
      };
    case 500:
      if (code === 'envelope_digest_mismatch') {
        return { kind: 'corrupt', message: message || 'stored custody envelope failed its digest' };
      }
      return {
        kind: 'transport_failed',
        message: message || `custody envelope request failed (HTTP ${response.status})`,
      };
    default:
      return {
        kind: 'request_rejected',
        code: code || 'invalid_request',
        message: message || `custody envelope request rejected (HTTP ${response.status})`,
      };
  }
}

/**
 * Refactor 109C: hands a resealed pre-109C envelope to the server.
 *
 * The unlock that opened an `unbound` envelope has already resealed it under
 * the exact method that authenticated. This is the only thing left to do with
 * that result, and the only thing this call does — no new envelope, no factor
 * change, no seed leaves the worker.
 *
 * Every outcome except a transport failure is terminal for this attempt, and
 * none of them is worth surfacing to the user: the V2 row stands, the wallet
 * still opens, and the next unlock tries again. The caller logs and moves on.
 */
export type WalletCustodyEnvelopeOwnershipUpgradeOutcome =
  | { readonly kind: 'upgraded'; readonly envelopeRevision: number }
  /** The envelope already names this method — an earlier attempt landed. */
  | { readonly kind: 'already_owned' }
  | { readonly kind: 'rejected'; readonly code: string; readonly message: string }
  | { readonly kind: 'transport_failed'; readonly message: string };

export async function upgradeWalletCustodyEnvelopeOwnership(args: {
  readonly relayUrl: string;
  readonly walletId: string;
  readonly walletSessionToken: string;
  readonly envelope: unknown;
  readonly fetchImpl?: typeof fetch;
}): Promise<WalletCustodyEnvelopeOwnershipUpgradeOutcome> {
  const url = `${normalizeRelayerBaseUrl(args.relayUrl)}/wallets/${encodeURIComponent(
    args.walletId,
  )}/custody/envelope/ownership`;
  const doFetch = args.fetchImpl || fetch;

  let response: Response;
  try {
    response = await doFetch(
      url,
      buildRelayerJsonPostRequestInit({
        body: { envelope: args.envelope },
        headers: buildBearerAuthorizationHeader({
          token: args.walletSessionToken,
          missingMessage: 'custody envelope upgrade needs an active Wallet Session',
        }),
      }),
    );
  } catch (error: unknown) {
    return {
      kind: 'transport_failed',
      message: error instanceof Error ? error.message : 'custody envelope upgrade failed',
    };
  }

  const bodyUnknown: unknown = await response.json().catch(() => undefined);
  if (response.status === 200) {
    try {
      const body = decodeOwnershipUpgradeResponse(bodyUnknown);
      if (body.kind === 'already_owned') return body;
      const envelopeRevision = Number(body.envelopeRevision);
      if (!Number.isSafeInteger(envelopeRevision) || envelopeRevision <= 0) {
        throw new Error('invalid envelope revision');
      }
      return { kind: 'upgraded', envelopeRevision };
    } catch {
      return {
        kind: 'rejected',
        code: 'invalid_response',
        message: 'custody envelope upgrade returned an invalid response',
      };
    }
  }

  const failure = decodeFailureResponse(bodyUnknown, 'custody envelope upgrade response');
  return {
    kind: 'rejected',
    code: failure.code || 'upgrade_rejected',
    message: failure.message || `custody envelope upgrade rejected (HTTP ${response.status})`,
  };
}

type PasskeyCustodyEnvelopeResponseDto = {
  readonly envelope: PasskeyCustodyEnvelopeRecord;
  readonly storeVersion: string;
};

type OwnershipUpgradeResponseDto =
  | { readonly kind: 'upgraded'; readonly envelopeRevision: unknown }
  | { readonly kind: 'already_owned' };

type FailureResponseDto = {
  readonly code: string | null;
  readonly message: string | null;
};

function decodePasskeyCustodyEnvelopeResponse(
  value: unknown,
): PasskeyCustodyEnvelopeResponseDto {
  const response = requireExactResponseObject(
    value,
    ['ok', 'envelope', 'storeVersion'],
    'custody envelope response',
  );
  if (readResponseField(response, 'ok') !== true) {
    throw new Error('custody envelope response did not succeed');
  }
  const storeVersion = readResponseString(response, 'storeVersion');
  if (!storeVersion) throw new Error('custody envelope response is missing its store version');
  return {
    envelope: parsePasskeyCustodyEnvelopeRecord(
      readResponseField(response, 'envelope'),
      'custody envelope response.envelope',
    ),
    storeVersion,
  };
}

function decodeOwnershipUpgradeResponse(value: unknown): OwnershipUpgradeResponseDto {
  const response = requireJsonObject(value, 'custody envelope upgrade response');
  const upgraded = readResponseField(response, 'upgraded');
  if (upgraded === true) {
    requireExactResponseObject(
      response,
      ['ok', 'upgraded', 'envelopeRevision'],
      'custody envelope upgrade response',
    );
    if (readResponseField(response, 'ok') !== true) {
      throw new Error('custody envelope upgrade response did not succeed');
    }
    return {
      kind: 'upgraded',
      envelopeRevision: readResponseField(response, 'envelopeRevision'),
    };
  }
  if (upgraded === false) {
    requireExactResponseObject(
      response,
      ['ok', 'upgraded'],
      'custody envelope upgrade response',
    );
    if (readResponseField(response, 'ok') !== true) {
      throw new Error('custody envelope upgrade response did not succeed');
    }
    return { kind: 'already_owned' };
  }
  throw new Error('custody envelope upgrade response has an invalid branch');
}

function decodeFailureResponse(value: unknown, label: string): FailureResponseDto {
  try {
    const response = requireJsonObject(value, label);
    const keys = Object.keys(response);
    if (!keys.includes('ok') || !hasAllowedResponseFields(keys, ['ok', 'code', 'message'])) {
      throw new Error(`${label} has an unexpected response shape`);
    }
    if (readResponseField(response, 'ok') !== false) throw new Error(`${label} is not a failure`);
    return {
      code: responseStringOrNull(response, 'code'),
      message: responseStringOrNull(response, 'message'),
    };
  } catch {
    return { code: null, message: null };
  }
}

function responseDeclaresSuccess(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, 'ok');
  return Boolean(descriptor && 'value' in descriptor && descriptor.value === true);
}

function requireJsonObject(value: unknown, label: string): object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain JSON object`);
  }
  return value;
}

function requireExactResponseObject(
  value: unknown,
  fields: readonly string[],
  label: string,
): object {
  const response = requireJsonObject(value, label);
  const keys = Object.keys(response);
  if (keys.length !== fields.length || !hasExactResponseFields(keys, fields)) {
    throw new Error(`${label} has an unexpected response shape`);
  }
  return response;
}

function hasExactResponseFields(keys: readonly string[], fields: readonly string[]): boolean {
  for (const field of fields) {
    if (!keys.includes(field)) return false;
  }
  return true;
}

function hasAllowedResponseFields(keys: readonly string[], fields: readonly string[]): boolean {
  for (const key of keys) {
    if (!fields.includes(key)) return false;
  }
  return true;
}

function readResponseField(value: object, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  if (!descriptor || !('value' in descriptor)) {
    throw new Error(`response field ${field} is missing`);
  }
  return descriptor.value;
}

function readResponseString(value: object, field: string): string {
  const raw = readResponseField(value, field);
  return typeof raw === 'string' ? raw.trim() : '';
}

function responseStringOrNull(value: object, field: string): string | null {
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  if (!descriptor || !('value' in descriptor)) return null;
  const normalized = typeof descriptor.value === 'string' ? descriptor.value.trim() : '';
  return normalized || null;
}
