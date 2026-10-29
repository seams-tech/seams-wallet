import { parseWalletId, type WalletId } from '../utils/domainIds';
import { requireCanonicalString, requireRecord } from '../utils/validation';
import { parseUnixMs } from '../passkey-custody/primitives';
import type { ReadonlyExclusiveUnion } from '../utils/variant';

export const EXTERNAL_AUTH_PATH = '/wallet/external-auth';

export type ExternalAuthConfiguration = ReadonlyExclusiveUnion<
  { kind: 'disabled'; revision: number } | { kind: 'google'; revision: number; clientId: string }
>;

export function parseExternalAuthConfiguration(raw: unknown): ExternalAuthConfiguration {
  const value = requireRecord(raw, 'external authentication configuration');
  if (
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  ) {
    throw new Error('Invalid external authentication revision');
  }
  if (value.kind === 'disabled') return { kind: 'disabled', revision: value.revision };
  if (value.kind === 'google')
    return {
      kind: 'google',
      revision: value.revision,
      clientId: requireCanonicalString(value.clientId, 'clientId'),
    };
  throw new Error('Unsupported external authentication configuration');
}

type ExternalAuthFailureCode =
  | 'invalid_request'
  | 'invalid_credential'
  | 'access_denied'
  | 'expired'
  | 'superseded'
  | 'unavailable'
  | 'rate_limited';

export type ExternalAuthResult<T> = ReadonlyExclusiveUnion<
  { ok: true; value: T } | { ok: false; code: ExternalAuthFailureCode; message: string }
>;

export type ExternalAuthenticateInput = ReadonlyExclusiveUnion<
  | { method: 'google'; walletId: string; idToken: string }
  | { method: 'handoff'; walletId: string; attemptId: string; code: string }
>;

export type ExternalAuthAttempt = Readonly<{
  attemptId: string;
  walletId: WalletId;
  expiresAtMs: number;
}>;

export type ExternalAuthCommand = ReadonlyExclusiveUnion<
  | { action: 'authenticate'; input: ExternalAuthenticateInput }
  | { action: 'prepare'; walletId: string }
  | { action: 'associate'; walletId: string; idToken: string }
  | { action: 'unlink'; walletId: string; associationId: string }
>;

export function parseExternalAuthCommand(raw: unknown): ExternalAuthCommand {
  const value = requireRecord(raw, 'external auth command');
  if (value.action === 'prepare')
    return { action: 'prepare', walletId: requireCanonicalString(value.walletId, 'walletId') };
  if (value.action === 'associate')
    return {
      action: 'associate',
      walletId: requireCanonicalString(value.walletId, 'walletId'),
      idToken: requireCanonicalString(value.idToken, 'idToken'),
    };
  if (value.action === 'unlink')
    return {
      action: 'unlink',
      walletId: requireCanonicalString(value.walletId, 'walletId'),
      associationId: requireCanonicalString(value.associationId, 'associationId'),
    };
  if (value.action !== 'authenticate') throw new Error('Invalid external authentication command');
  const input = requireRecord(value.input, 'authentication input');
  const walletId = requireCanonicalString(input.walletId, 'walletId');
  if (input.method === 'google')
    return {
      action: 'authenticate',
      input: {
        method: 'google',
        walletId,
        idToken: requireCanonicalString(input.idToken, 'idToken'),
      },
    };
  if (input.method === 'handoff')
    return {
      action: 'authenticate',
      input: {
        method: 'handoff',
        walletId,
        attemptId: requireCanonicalString(input.attemptId, 'attemptId'),
        code: requireCanonicalString(input.code, 'code'),
      },
    };
  throw new Error('Unsupported external authentication method');
}

export type ExternalWalletAuthentication = Readonly<{
  kind: 'external_authenticated';
  walletId: WalletId;
  sessionId: string;
  associationId: string;
  environmentId: string;
  provider: 'google';
  permission: 'wallet_settings_read';
  expiresAtMs: number;
  authMethod?: never;
}>;

export type ExternalWalletSettings = Readonly<{
  authentication: ExternalWalletAuthentication;
  accounts: readonly Readonly<{
    family: 'ed25519' | 'ecdsa';
    address: string;
    publicKey: string;
  }>[];
  methods: readonly Readonly<{ id: string; kind: 'passkey' | 'email_otp' | 'voiceid' }>[];
  devices: readonly Readonly<{ id: string }>[];
}>;

export function parseExternalWalletAuthentication(value: unknown): ExternalWalletAuthentication {
  const record = requireRecord(value, 'external authentication');
  const walletId = parseWalletId(record.walletId);
  if (
    !walletId.ok ||
    record.kind !== 'external_authenticated' ||
    record.provider !== 'google' ||
    record.permission !== 'wallet_settings_read' ||
    'authMethod' in record
  )
    throw new Error('External authentication is invalid');
  return {
    kind: 'external_authenticated',
    walletId: walletId.value,
    sessionId: requireCanonicalString(record.sessionId, 'sessionId'),
    associationId: requireCanonicalString(record.associationId, 'associationId'),
    environmentId: requireCanonicalString(record.environmentId, 'environmentId'),
    provider: 'google',
    permission: 'wallet_settings_read',
    expiresAtMs: parseUnixMs(record.expiresAtMs, 'expiresAtMs'),
  };
}

export function externalAuthFailure(code: ExternalAuthFailureCode): ExternalAuthResult<never> {
  return { ok: false, code, message: 'Wallet authentication could not be completed.' };
}

export function parseExternalAuthFailure(value: unknown): ExternalAuthResult<never> {
  const record = requireRecord(value, 'external authentication failure');
  switch (record.code) {
    case 'invalid_request':
    case 'invalid_credential':
    case 'access_denied':
    case 'expired':
    case 'superseded':
    case 'unavailable':
    case 'rate_limited':
      return externalAuthFailure(record.code);
    default:
      return externalAuthFailure('unavailable');
  }
}

export function parseExternalWalletSettings(value: unknown): ExternalWalletSettings {
  const record = requireRecord(value, 'external settings');
  if (
    !Array.isArray(record.accounts) ||
    !Array.isArray(record.methods) ||
    !Array.isArray(record.devices)
  )
    throw new Error('Invalid wallet settings');
  return {
    authentication: parseExternalWalletAuthentication(record.authentication),
    accounts: record.accounts.map(parseAccount),
    methods: record.methods.map(parseMethod),
    devices: record.devices.map(parseDevice),
  };
}

function parseAccount(value: unknown): ExternalWalletSettings['accounts'][number] {
  const record = requireRecord(value, 'account');
  if (record.family !== 'ed25519' && record.family !== 'ecdsa')
    throw new Error('Invalid account family');
  return {
    family: record.family,
    address: requireCanonicalString(record.address, 'address'),
    publicKey: requireCanonicalString(record.publicKey, 'publicKey'),
  };
}

function parseMethod(value: unknown): ExternalWalletSettings['methods'][number] {
  const record = requireRecord(value, 'method');
  if (record.kind !== 'passkey' && record.kind !== 'email_otp' && record.kind !== 'voiceid')
    throw new Error('Invalid method');
  return { id: requireCanonicalString(record.id, 'id'), kind: record.kind };
}

function parseDevice(value: unknown): ExternalWalletSettings['devices'][number] {
  const record = requireRecord(value, 'device');
  return { id: requireCanonicalString(record.id, 'id') };
}
