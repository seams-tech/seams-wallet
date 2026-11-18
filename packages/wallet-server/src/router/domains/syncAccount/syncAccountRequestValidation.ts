import { isPlainObject, toOptionalTrimmedString } from '@shared/utils/validation';
import {
  parseOptionalWalletSessionBudget,
  type WalletSessionBudget,
} from '@shared/threshold/walletSessionBudget';
import { parseWebAuthnAuthenticationCredential } from '../../auth/webAuthnCredentialCodecs';
import type { PasskeyVerifyRequest } from '../../auth/authRequestValidation';

type SyncAccountOptionsRequest = {
  rp_id: string;
  account_id?: string;
  ttl_ms?: number;
};

type SyncAccountRouteErrorBody = {
  ok: false;
  code: 'invalid_body';
  message: string;
};

type SyncAccountRouteParseFailure = { ok: false; status: 400; body: SyncAccountRouteErrorBody };

type SyncAccountRouteParseResult<T> = { ok: true; request: T } | SyncAccountRouteParseFailure;

const SYNC_ACCOUNT_OPTIONS_KEYS = ['rp_id', 'account_id', 'ttl_ms'] as const;
const SYNC_ACCOUNT_VERIFY_KEYS = [
  'challengeId',
  'webauthn_authentication',
  'walletSessionBudget',
] as const;

function invalidSyncAccountBody(message: string): SyncAccountRouteParseFailure {
  return {
    ok: false,
    status: 400,
    body: { ok: false, code: 'invalid_body', message },
  };
}

function unexpectedSyncAccountKey(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
): string | null {
  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) return key;
  }
  return null;
}

function parseOptionalPositiveInteger(
  raw: unknown,
  fieldName: string,
): { ok: true; value?: number } | { ok: false; message: string } {
  if (raw == null) return { ok: true };
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, message: `${fieldName} must be a positive number` };
  }
  return { ok: true, value: Math.floor(value) };
}

export function parseSyncAccountOptionsRequest(
  raw: unknown,
): SyncAccountRouteParseResult<SyncAccountOptionsRequest> {
  if (!isPlainObject(raw)) {
    return invalidSyncAccountBody('Expected JSON object body');
  }
  const unexpectedKey = unexpectedSyncAccountKey(raw, SYNC_ACCOUNT_OPTIONS_KEYS);
  if (unexpectedKey) {
    return invalidSyncAccountBody(`Unsupported sync-account options field: ${unexpectedKey}`);
  }

  const rpId = toOptionalTrimmedString(raw.rp_id);
  if (!rpId) return invalidSyncAccountBody('rp_id is required');

  const accountId = toOptionalTrimmedString(raw.account_id);
  const parsedTtl = parseOptionalPositiveInteger(raw.ttl_ms, 'ttl_ms');
  if (!parsedTtl.ok) return invalidSyncAccountBody(parsedTtl.message);

  return {
    ok: true,
    request: {
      rp_id: rpId,
      ...(accountId ? { account_id: accountId } : {}),
      ...(parsedTtl.value ? { ttl_ms: parsedTtl.value } : {}),
    },
  };
}

/**
 * The verified request, and beside it the app's Wallet Session budget. The
 * budget stays out of the request, because the owner proof digests the request.
 */
export function parseSyncAccountVerifyRequest(input: {
  body: unknown;
  origin: unknown;
}):
  | {
      ok: true;
      request: PasskeyVerifyRequest;
      walletSessionBudget: WalletSessionBudget | null;
    }
  | SyncAccountRouteParseFailure {
  if (!isPlainObject(input.body)) {
    return invalidSyncAccountBody('Expected JSON object body');
  }
  const unexpectedKey = unexpectedSyncAccountKey(input.body, SYNC_ACCOUNT_VERIFY_KEYS);
  if (unexpectedKey) {
    return invalidSyncAccountBody(`Unsupported sync-account verify field: ${unexpectedKey}`);
  }

  const challengeId = toOptionalTrimmedString(input.body.challengeId);
  if (!challengeId) return invalidSyncAccountBody('challengeId is required');

  const webauthnAuthentication = parseWebAuthnAuthenticationCredential(
    input.body.webauthn_authentication,
  );
  if (!webauthnAuthentication) {
    return invalidSyncAccountBody('webauthn_authentication is required');
  }

  const expectedOrigin = toOptionalTrimmedString(input.origin);
  if (!expectedOrigin) {
    return invalidSyncAccountBody('Origin header is required');
  }
  let walletSessionBudget: WalletSessionBudget | null;
  try {
    walletSessionBudget = parseOptionalWalletSessionBudget(
      input.body.walletSessionBudget,
      'walletSessionBudget',
    );
  } catch (error: unknown) {
    return invalidSyncAccountBody(
      error instanceof Error ? error.message : 'walletSessionBudget is invalid',
    );
  }
  return {
    ok: true,
    request: {
      challengeId,
      webauthn_authentication: webauthnAuthentication,
      expected_origin: expectedOrigin,
    },
    walletSessionBudget,
  };
}
