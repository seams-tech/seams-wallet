import { buildRelayerJsonPostRequestInit, normalizeRelayerBaseUrl } from './relayerHttp';
import {
  parseWalletRecoveryEnvelopeSetRecord,
  type WalletRecoverySetRotationWireV1,
  type WalletRecoveryEnvelopeSetRecord,
} from '@shared/wallet-recovery/walletRecoveryEnvelopeSet';
import { parseWalletId } from '@shared/utils/domainIds';
import type { WalletCustodyAdminOperation } from '@shared/authorization/walletCustodyOperation';
import type { WebAuthnAuthenticationCredential } from '@/core/types/webauthn';

const WALLET_RECOVERY_READ_PATH = '/wallets/recovery/read';
const WALLET_RECOVERY_ROTATE_PATH = '/wallets/recovery/rotate';
const WALLET_RECOVERY_ACK_PATH = '/wallets/recovery/acknowledge-backup';
const WALLET_CUSTODY_EMAIL_OTP_CHALLENGE_PATH = '/wallets/custody/email-otp/challenge';

export type WalletCustodyFactorProof =
  | {
      readonly kind: 'passkey';
      readonly walletId: string;
      readonly rpId: string;
      readonly credentialIdB64u: string;
      readonly challenge_digest: string;
      readonly webauthn_authentication: WebAuthnAuthenticationCredential;
    }
  | {
      readonly kind: 'email_otp';
      readonly provider_subject_id: string;
      readonly challenge_id: string;
      readonly otp_code: string;
      readonly challenge_digest: string;
    };

export type WalletCustodyEmailOtpChallengeResult =
  | {
      readonly kind: 'ready';
      readonly challengeId: string;
      readonly challenge_digest: string;
      readonly expiresAtMs: number;
      readonly otpChannel: string;
    }
  | { readonly kind: 'rejected'; readonly message: string }
  | { readonly kind: 'transport_failed'; readonly message: string };

type WalletCustodyEmailOtpChallengeResponseDto =
  | {
      readonly kind: 'success';
      readonly challengeId: unknown;
      readonly challengeDigest: unknown;
      readonly expiresAtMs: unknown;
      readonly otpChannel: unknown;
    }
  | { readonly kind: 'failure'; readonly message: string | null }
  | { readonly kind: 'invalid' };

function decodeWalletCustodyEmailOtpChallengeResponse(
  value: unknown,
): WalletCustodyEmailOtpChallengeResponseDto {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    return { kind: 'invalid' };
  }
  const fields = new Map<string, unknown>(Object.entries(value));
  const names = [...fields.keys()];
  if (
    fields.size === 5 &&
    names.every((name) =>
      ['ok', 'challengeId', 'challenge_digest', 'expiresAtMs', 'otpChannel'].includes(name),
    ) &&
    fields.get('ok') === true
  ) {
    return {
      kind: 'success',
      challengeId: fields.get('challengeId'),
      challengeDigest: fields.get('challenge_digest'),
      expiresAtMs: fields.get('expiresAtMs'),
      otpChannel: fields.get('otpChannel'),
    };
  }
  const failureFields = ['ok', 'code', 'message', 'retryAfterMs'];
  if (
    (fields.size === 3 || fields.size === 4) &&
    names.every((name) => failureFields.includes(name)) &&
    fields.get('ok') === false &&
    typeof fields.get('code') === 'string' &&
    typeof fields.get('message') === 'string' &&
    (fields.size === 3 || typeof fields.get('retryAfterMs') === 'number')
  ) {
    const message = fields.get('message');
    return {
      kind: 'failure',
      message: typeof message === 'string' && message.trim() ? message.trim() : null,
    };
  }
  return { kind: 'invalid' };
}

export async function requestWalletCustodyEmailOtpChallenge(args: {
  readonly relayUrl: string;
  readonly walletId: string;
  readonly providerSubjectId: string;
  readonly operation: WalletCustodyAdminOperation;
  readonly payload: Record<string, unknown>;
  readonly requestOrigin?: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<WalletCustodyEmailOtpChallengeResult> {
  let response: Response;
  try {
    response = await postWalletRecoveryRoute({
      relayUrl: args.relayUrl,
      path: WALLET_CUSTODY_EMAIL_OTP_CHALLENGE_PATH,
      body: {
        walletId: args.walletId,
        providerSubjectId: args.providerSubjectId,
        operation: args.operation,
        payload: args.payload,
        ...(args.requestOrigin ? { requestOrigin: args.requestOrigin } : {}),
      },
      fetchImpl: args.fetchImpl,
    });
  } catch (error: unknown) {
    return {
      kind: 'transport_failed',
      message: error instanceof Error ? error.message : 'Email OTP challenge request failed',
    };
  }
  const body = decodeWalletCustodyEmailOtpChallengeResponse(
    await response.json().catch(() => null),
  );
  const message = body.kind === 'failure' && body.message ? body.message : '';
  if (response.status !== 200 || body.kind !== 'success') {
    return {
      kind: response.status >= 400 && response.status < 500 ? 'rejected' : 'transport_failed',
      message: message || `Email OTP challenge failed (HTTP ${response.status})`,
    };
  }
  const challengeId = typeof body.challengeId === 'string' ? body.challengeId.trim() : '';
  const challengeDigest =
    typeof body.challengeDigest === 'string' ? body.challengeDigest.trim() : '';
  const expiresAtMs = Number(body.expiresAtMs);
  const otpChannel = typeof body.otpChannel === 'string' ? body.otpChannel.trim() : '';
  if (
    !challengeId ||
    !challengeDigest ||
    !Number.isSafeInteger(expiresAtMs) ||
    expiresAtMs <= 0 ||
    !otpChannel
  ) {
    return {
      kind: 'transport_failed',
      message: 'Email OTP challenge returned an unusable payload',
    };
  }
  return { kind: 'ready', challengeId, challenge_digest: challengeDigest, expiresAtMs, otpChannel };
}

export type WalletRecoveryCodeStatusResult =
  | {
      readonly kind: 'ready';
      readonly walletId: string;
      readonly activeCodeCount: number;
      readonly totalCodeCount: number;
      readonly issuedAtMs: number;
      readonly storeVersion: string;
      readonly backupOutstanding: boolean;
      readonly pendingLocalBackup: boolean;
    }
  | { readonly kind: 'no_recovery_set'; readonly message: string }
  | { readonly kind: 'unauthorized'; readonly message: string }
  | { readonly kind: 'transport_failed'; readonly message: string };

type WalletRecoveryCodeStatusResponseDto =
  | {
      readonly kind: 'success';
      readonly activeCodeCount: unknown;
      readonly totalCodeCount: unknown;
      readonly issuedAtMs: unknown;
      readonly storeVersion: unknown;
      readonly backupOutstanding: unknown;
    }
  | { readonly kind: 'failure'; readonly message: string | null }
  | { readonly kind: 'invalid' };

function decodeWalletRecoveryCodeStatusResponse(
  value: unknown,
): WalletRecoveryCodeStatusResponseDto {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    return { kind: 'invalid' };
  }
  const fields = new Map<string, unknown>(Object.entries(value));
  const successFields = [
    'ok',
    'activeCodeCount',
    'totalCodeCount',
    'issuedAtMs',
    'storeVersion',
    'backupOutstanding',
  ];
  const names = [...fields.keys()];
  if (
    fields.size === successFields.length &&
    names.every((name) => successFields.includes(name)) &&
    fields.get('ok') === true
  ) {
    return {
      kind: 'success',
      activeCodeCount: fields.get('activeCodeCount'),
      totalCodeCount: fields.get('totalCodeCount'),
      issuedAtMs: fields.get('issuedAtMs'),
      storeVersion: fields.get('storeVersion'),
      backupOutstanding: fields.get('backupOutstanding'),
    };
  }
  const failureFields = ['ok', 'code', 'message'];
  if (
    fields.size === failureFields.length &&
    names.every((name) => failureFields.includes(name)) &&
    fields.get('ok') === false &&
    typeof fields.get('code') === 'string'
  ) {
    const message = fields.get('message');
    return {
      kind: 'failure',
      message: typeof message === 'string' && message.trim() ? message.trim() : null,
    };
  }
  return { kind: 'invalid' };
}

export async function readWalletRecoveryCodeStatus(args: {
  readonly relayUrl: string;
  readonly walletId: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<WalletRecoveryCodeStatusResult> {
  const url = `${normalizeRelayerBaseUrl(args.relayUrl)}/wallets/${encodeURIComponent(
    args.walletId,
  )}/recovery/status`;
  const doFetch = args.fetchImpl || fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    });
  } catch (error: unknown) {
    return {
      kind: 'transport_failed',
      message: error instanceof Error ? error.message : 'recovery status request failed',
    };
  }
  const body = decodeWalletRecoveryCodeStatusResponse(await response.json().catch(() => null));
  const message = body.kind === 'failure' && body.message ? body.message : '';
  if (response.status === 401 || response.status === 403) {
    return { kind: 'unauthorized', message: message || 'recovery status is unauthorized' };
  }
  if (response.status === 404) {
    return { kind: 'no_recovery_set', message: message || 'this wallet has no recovery set' };
  }
  if (response.status !== 200) {
    return {
      kind: 'transport_failed',
      message: message || `recovery status failed (HTTP ${response.status})`,
    };
  }
  if (body.kind !== 'success') {
    return { kind: 'transport_failed', message: 'recovery status returned an unusable payload' };
  }
  const activeCodeCount = Number(body.activeCodeCount);
  const totalCodeCount = Number(body.totalCodeCount);
  const issuedAtMs = Number(body.issuedAtMs);
  const storeVersion = typeof body.storeVersion === 'string' ? body.storeVersion.trim() : '';
  if (
    !Number.isSafeInteger(activeCodeCount) ||
    activeCodeCount < 0 ||
    !Number.isSafeInteger(totalCodeCount) ||
    totalCodeCount < activeCodeCount ||
    !Number.isSafeInteger(issuedAtMs) ||
    issuedAtMs <= 0 ||
    !storeVersion ||
    typeof body.backupOutstanding !== 'boolean'
  ) {
    return { kind: 'transport_failed', message: 'recovery status returned an unusable payload' };
  }
  return {
    kind: 'ready',
    walletId: args.walletId,
    activeCodeCount,
    totalCodeCount,
    issuedAtMs,
    storeVersion,
    backupOutstanding: body.backupOutstanding,
    pendingLocalBackup: false,
  };
}

export type WalletRecoveryBackupAcknowledgementResult =
  | { readonly kind: 'acknowledged'; readonly walletId: string; readonly issuedAtMs: number }
  | { readonly kind: 'no_recovery_set'; readonly message: string }
  | { readonly kind: 'unauthorized'; readonly message: string }
  | { readonly kind: 'transport_failed'; readonly message: string };

type WalletRecoveryBackupAcknowledgementResponseDto =
  | { readonly kind: 'success'; readonly issuedAtMs: unknown }
  | { readonly kind: 'failure'; readonly message: string | null }
  | { readonly kind: 'invalid' };

function decodeWalletRecoveryBackupAcknowledgementResponse(
  value: unknown,
): WalletRecoveryBackupAcknowledgementResponseDto {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    return { kind: 'invalid' };
  }
  const fields = new Map<string, unknown>(Object.entries(value));
  const names = [...fields.keys()];
  if (
    fields.size === 2 &&
    names.includes('ok') &&
    names.includes('issuedAtMs') &&
    fields.get('ok') === true
  ) {
    return { kind: 'success', issuedAtMs: fields.get('issuedAtMs') };
  }
  if (
    fields.size === 3 &&
    names.includes('ok') &&
    names.includes('code') &&
    names.includes('message') &&
    fields.get('ok') === false &&
    typeof fields.get('code') === 'string'
  ) {
    const message = fields.get('message');
    return {
      kind: 'failure',
      message: typeof message === 'string' && message.trim() ? message.trim() : null,
    };
  }
  return { kind: 'invalid' };
}

export async function acknowledgeWalletRecoveryBackup(args: {
  readonly relayUrl: string;
  readonly walletId: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<WalletRecoveryBackupAcknowledgementResult> {
  let response: Response;
  try {
    response = await postWalletRecoveryRoute({
      relayUrl: args.relayUrl,
      path: WALLET_RECOVERY_ACK_PATH,
      body: { walletId: args.walletId },
      fetchImpl: args.fetchImpl,
    });
  } catch (error: unknown) {
    return {
      kind: 'transport_failed',
      message: error instanceof Error ? error.message : 'recovery backup acknowledgement failed',
    };
  }
  const body = decodeWalletRecoveryBackupAcknowledgementResponse(
    await response.json().catch(() => null),
  );
  const message = body.kind === 'failure' && body.message ? body.message : '';
  if (response.status === 401 || response.status === 403) {
    return {
      kind: 'unauthorized',
      message: message || 'recovery backup acknowledgement is unauthorized',
    };
  }
  if (response.status === 404) {
    return { kind: 'no_recovery_set', message: message || 'this wallet has no recovery set' };
  }
  if (response.status !== 200) {
    return {
      kind: 'transport_failed',
      message: message || `recovery backup acknowledgement failed (HTTP ${response.status})`,
    };
  }
  if (body.kind !== 'success') {
    return {
      kind: 'transport_failed',
      message: 'recovery backup acknowledgement returned an unusable payload',
    };
  }
  const issuedAtMs = Number(body.issuedAtMs);
  if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs <= 0) {
    return {
      kind: 'transport_failed',
      message: 'recovery backup acknowledgement returned an unusable payload',
    };
  }
  return { kind: 'acknowledged', walletId: args.walletId, issuedAtMs };
}

export type WalletRecoverySetReadResult =
  | {
      readonly kind: 'ready';
      readonly recoverySet: WalletRecoveryEnvelopeSetRecord;
      readonly storeVersion: string;
    }
  | { readonly kind: 'no_recovery_set'; readonly message: string }
  | { readonly kind: 'transport_failed'; readonly message: string };

export async function readWalletRecoverySet(args: {
  readonly relayUrl: string;
  readonly walletId: string;
  readonly factorProof: WalletCustodyFactorProof;
  readonly fetchImpl?: typeof fetch;
}): Promise<WalletRecoverySetReadResult> {
  return await requestWalletRecoverySet({
    ...args,
    path: WALLET_RECOVERY_READ_PATH,
    body: { walletId: args.walletId, factorProof: args.factorProof },
  });
}

export type WalletRecoverySetRotateResult =
  | { readonly kind: 'rotated'; readonly issuedAtMs: number; readonly storeVersion: string }
  | { readonly kind: 'conflict'; readonly message: string }
  | { readonly kind: 'rejected'; readonly message: string }
  | { readonly kind: 'no_recovery_set'; readonly message: string }
  | { readonly kind: 'transport_failed'; readonly message: string };

type WalletRecoverySetRotateResponseDto =
  | { readonly kind: 'success'; readonly issuedAtMs: unknown; readonly storeVersion: unknown }
  | { readonly kind: 'failure'; readonly message: string | null }
  | { readonly kind: 'invalid' };

function decodeWalletRecoverySetRotateResponse(
  value: unknown,
): WalletRecoverySetRotateResponseDto {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    return { kind: 'invalid' };
  }
  const fields = new Map<string, unknown>(Object.entries(value));
  const names = [...fields.keys()];
  if (
    fields.size === 3 &&
    names.every((name) => ['ok', 'issuedAtMs', 'storeVersion'].includes(name)) &&
    fields.get('ok') === true
  ) {
    return {
      kind: 'success',
      issuedAtMs: fields.get('issuedAtMs'),
      storeVersion: fields.get('storeVersion'),
    };
  }
  if (
    fields.size === 3 &&
    names.every((name) => ['ok', 'code', 'message'].includes(name)) &&
    fields.get('ok') === false &&
    typeof fields.get('code') === 'string'
  ) {
    const message = fields.get('message');
    return {
      kind: 'failure',
      message: typeof message === 'string' && message.trim() ? message.trim() : null,
    };
  }
  return { kind: 'invalid' };
}

type WalletRecoverySetReadResponseDto =
  | { readonly kind: 'success'; readonly recoverySet: unknown; readonly storeVersion: unknown }
  | { readonly kind: 'failure'; readonly message: string | null }
  | { readonly kind: 'invalid' };

function decodeWalletRecoverySetReadResponse(value: unknown): WalletRecoverySetReadResponseDto {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    return { kind: 'invalid' };
  }
  const fields = new Map<string, unknown>(Object.entries(value));
  const names = [...fields.keys()];
  if (
    fields.size === 3 &&
    names.every((name) => ['ok', 'recoverySet', 'storeVersion'].includes(name)) &&
    fields.get('ok') === true
  ) {
    return {
      kind: 'success',
      recoverySet: fields.get('recoverySet'),
      storeVersion: fields.get('storeVersion'),
    };
  }
  if (
    fields.size === 3 &&
    names.every((name) => ['ok', 'code', 'message'].includes(name)) &&
    fields.get('ok') === false &&
    typeof fields.get('code') === 'string'
  ) {
    const message = fields.get('message');
    return {
      kind: 'failure',
      message: typeof message === 'string' && message.trim() ? message.trim() : null,
    };
  }
  return { kind: 'invalid' };
}

export type WalletRecoveryCodeLocatorPayload = {
  readonly locatorB64u: string;
  readonly recoveryKeyId: string;
};

export async function rotateWalletRecoverySet(args: {
  readonly relayUrl: string;
  readonly walletId: string;
  readonly factorProof: WalletCustodyFactorProof;
  readonly expectedStoreVersion: string;
  readonly replacement: WalletRecoverySetRotationWireV1;
  readonly recoveryCodeLocators: readonly WalletRecoveryCodeLocatorPayload[];
  readonly fetchImpl?: typeof fetch;
}): Promise<WalletRecoverySetRotateResult> {
  const response = await postWalletRecoveryRoute({
    relayUrl: args.relayUrl,
    path: WALLET_RECOVERY_ROTATE_PATH,
    body: {
      walletId: args.walletId,
      expectedStoreVersion: args.expectedStoreVersion,
      manifestKekWraps: args.replacement.manifestKekWraps,
      entries: [args.replacement.entry],
      recoveryCodeLocators: args.recoveryCodeLocators,
      factorProof: args.factorProof,
    },
    fetchImpl: args.fetchImpl,
  });
  const body = decodeWalletRecoverySetRotateResponse(await response.json().catch(() => null));
  const message = body.kind === 'failure' && body.message ? body.message : '';
  if (response.status === 200 && body.kind === 'success') {
    const issuedAtMs = Number(body.issuedAtMs);
    const storeVersion = typeof body.storeVersion === 'string' ? body.storeVersion.trim() : '';
    if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs <= 0 || !storeVersion) {
      return { kind: 'transport_failed', message: 'rotation returned an unusable response' };
    }
    return { kind: 'rotated', issuedAtMs, storeVersion };
  }
  if (response.status === 404)
    return { kind: 'no_recovery_set', message: message || 'no recovery set' };
  if (response.status === 409)
    return { kind: 'conflict', message: message || 'recovery set changed' };
  if (response.status === 400) return { kind: 'rejected', message: message || 'rotation rejected' };
  return {
    kind: 'transport_failed',
    message: message || `rotation failed (HTTP ${response.status})`,
  };
}

async function requestWalletRecoverySet(args: {
  readonly relayUrl: string;
  readonly walletId: string;
  readonly factorProof: WalletCustodyFactorProof;
  readonly path: string;
  readonly body: Record<string, unknown>;
  readonly fetchImpl?: typeof fetch;
}): Promise<WalletRecoverySetReadResult> {
  const walletId = parseWalletId(args.walletId);
  if (!walletId.ok) {
    return { kind: 'transport_failed', message: 'wallet recovery read has an invalid wallet id' };
  }
  const response = await postWalletRecoveryRoute(args);
  const body = decodeWalletRecoverySetReadResponse(await response.json().catch(() => null));
  const message = body.kind === 'failure' && body.message ? body.message : '';
  if (response.status === 404) {
    return { kind: 'no_recovery_set', message: message || 'this wallet has no recovery set' };
  }
  if (response.status !== 200) {
    return {
      kind: 'transport_failed',
      message: message || `recovery set read failed (HTTP ${response.status})`,
    };
  }
  if (body.kind !== 'success') {
    return { kind: 'transport_failed', message: 'recovery set read returned an unusable payload' };
  }
  try {
    const recoverySet = parseWalletRecoveryEnvelopeSetRecord(body.recoverySet, {
      expectedWalletId: walletId.value,
      label: 'walletRecoveryRead.recoverySet',
    });
    const storeVersion = typeof body.storeVersion === 'string' ? body.storeVersion.trim() : '';
    if (!storeVersion) throw new Error('missing recovery set store version');
    return { kind: 'ready', recoverySet, storeVersion };
  } catch {
    return { kind: 'transport_failed', message: 'recovery set read returned an unusable payload' };
  }
}

async function postWalletRecoveryRoute(args: {
  readonly relayUrl: string;
  readonly path: string;
  readonly body: Record<string, unknown>;
  readonly fetchImpl?: typeof fetch;
}): Promise<Response> {
  const url = `${normalizeRelayerBaseUrl(args.relayUrl)}${args.path}`;
  const doFetch = args.fetchImpl || fetch;
  return await doFetch(
    url,
    buildRelayerJsonPostRequestInit({
      headers: { Accept: 'application/json' },
      body: args.body,
    }),
  );
}
