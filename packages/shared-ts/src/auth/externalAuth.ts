import { parseWalletId, type WalletId } from '../utils/domainIds';
import { requireCanonicalString, requireRecord } from '../utils/validation';
import {
  parseUnixMs,
  parseEd25519PublicKeyB64u,
  type Ed25519PublicKeyB64u,
} from '../passkey-custody/primitives';
import type { ReadonlyExclusiveUnion } from '../utils/variant';
import { parseDigestB64u, type DigestB64u } from '../utils/canonicalPrimitives';

export const EXTERNAL_AUTH_PATH = '/wallet/external-auth';

export type ExternalAuthProvider = ReadonlyExclusiveUnion<
  | { kind: 'disabled' }
  | { kind: 'google'; clientId: string }
  | { kind: 'application'; issuer: string; publicKeyB64u: Ed25519PublicKeyB64u }
>;

export type ExternalAuthConfiguration = ExternalAuthProvider & Readonly<{ revision: number }>;

export type ExternalIdentity = ReadonlyExclusiveUnion<
  | { provider: 'google'; issuer: 'https://accounts.google.com'; subject: string }
  | { provider: 'application'; issuer: string; subject: string }
>;

export type ExternalIdentityProof = ReadonlyExclusiveUnion<
  | { kind: 'google'; idToken: string }
  | { kind: 'application'; assertion: string }
>;

export function parseExternalAuthProvider(raw: unknown): ExternalAuthProvider {
  const value = requireRecord(raw, 'external authentication provider');
  switch (value.kind) {
    case 'disabled':
      return { kind: 'disabled' };
    case 'google':
      return { kind: 'google', clientId: requireCanonicalString(value.clientId, 'clientId') };
    case 'application': {
      const issuer = requireCanonicalString(value.issuer, 'issuer');
      const url = new URL(issuer);
      if (url.protocol !== 'https:' || url.origin !== issuer) {
        throw new Error('Application issuer must be a canonical HTTPS origin');
      }
      const publicKeyB64u = parseEd25519PublicKeyB64u(value.publicKeyB64u, 'publicKeyB64u');
      return { kind: 'application', issuer, publicKeyB64u };
    }
    default:
      throw new Error('Unsupported external authentication provider');
  }
}

function externalAuthConfiguration(
  provider: ExternalAuthProvider,
  revision: number,
): ExternalAuthConfiguration {
  switch (provider.kind) {
    case 'disabled':
      return { kind: 'disabled', revision };
    case 'google':
      return { kind: 'google', revision, clientId: provider.clientId };
    case 'application':
      return {
        kind: 'application', revision,
        issuer: provider.issuer, publicKeyB64u: provider.publicKeyB64u,
      };
    default:
      return assertNever(provider);
  }
}

export function parseExternalAuthConfiguration(raw: unknown): ExternalAuthConfiguration {
  const value = requireRecord(raw, 'external authentication configuration');
  if (
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  ) {
    throw new Error('Invalid external authentication revision');
  }
  return externalAuthConfiguration(parseExternalAuthProvider(value), value.revision);
}

export function serializeExternalIdentity(identity: ExternalIdentity): string {
  return JSON.stringify([identity.provider, identity.issuer, identity.subject]);
}

export function parseStoredExternalIdentity(serialized: string): ExternalIdentity {
  const raw: unknown = JSON.parse(serialized);
  if (!Array.isArray(raw) || raw.length !== 3) throw new Error('Invalid external identity');
  const [provider, issuer, subject] = raw;
  return parseExternalIdentity({ provider, issuer, subject });
}

function parseExternalIdentity(raw: unknown): ExternalIdentity {
  const value = requireRecord(raw, 'external identity');
  const provider = value.provider;
  const issuer = requireCanonicalString(value.issuer, 'issuer');
  const subject = requireCanonicalString(value.subject, 'subject');
  switch (provider) {
    case 'google':
      if (issuer !== 'https://accounts.google.com') throw new Error('Invalid Google issuer');
      return { provider, issuer, subject };
    case 'application':
      return { provider, issuer, subject };
    default:
      throw new Error('Invalid external identity provider');
  }
}

export type ExternalOwnerChallenge = Readonly<{
  walletId: WalletId;
  attemptId: string;
  identity: ExternalIdentity;
  challengeB64u: DigestB64u;
  expiresAtMs: number;
}> & ReadonlyExclusiveUnion<
  { kind: 'associate' } | { kind: 'unlink'; associationId: string }
>;

export function parseExternalOwnerChallenge(raw: unknown): ExternalOwnerChallenge {
  const value = requireRecord(raw, 'external owner challenge');
  const wallet = parseWalletId(value.walletId);
  if (!wallet.ok) throw new Error('Invalid owner challenge wallet');
  const walletId = wallet.value;
  const attemptId = requireCanonicalString(value.attemptId, 'attemptId');
  const identity = parseExternalIdentity(value.identity);
  const challengeB64u = parseDigestB64u(value.challengeB64u);
  const expiresAtMs = parseUnixMs(value.expiresAtMs, 'owner challenge expiry');
  switch (value.kind) {
    case 'associate':
      return { kind: 'associate', walletId, attemptId, identity, challengeB64u, expiresAtMs };
    case 'unlink':
      return {
        kind: 'unlink', walletId, attemptId, identity, challengeB64u, expiresAtMs,
        associationId: requireCanonicalString(value.associationId, 'associationId'),
      };
    default:
      throw new Error('Invalid owner challenge purpose');
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported external authentication provider: ${String(value)}`);
}

type ExternalAuthFailureCode =
  | 'invalid_request'
  | 'invalid_credential'
  | 'access_denied'
  | 'expired'
  | 'superseded'
  | 'unavailable'
  | 'rate_limited'
  | 'cancelled';

export type ExternalAuthResult<T> = ReadonlyExclusiveUnion<
  { ok: true; value: T } | { ok: false; code: ExternalAuthFailureCode; message: string }
>;

export type ExternalAuthenticateInput = ReadonlyExclusiveUnion<
  | { method: 'google'; walletId: string; idToken: string }
  | { method: 'handoff'; walletId: string; attemptId: string; code: string }
>;

export type ExternalAuthPurpose = 'authenticate' | 'associate';

export type ExternalAuthAttempt<Purpose extends ExternalAuthPurpose = 'authenticate'> = Readonly<{
  purpose: Purpose;
  attemptId: string;
  walletId: WalletId;
  expiresAtMs: number;
}>;

export type ExternalAuthCommand = ReadonlyExclusiveUnion<
  | { action: 'authenticate'; input: ExternalAuthenticateInput }
  | { action: 'prepare'; walletId: string }
  | { action: 'prepare_association'; walletId: string }
  | { action: 'associate'; input: ExternalAuthenticateInput }
  | { action: 'unlink'; walletId: string; associationId: string }
>;

export function parseExternalAuthCommand(raw: unknown): ExternalAuthCommand {
  const value = requireRecord(raw, 'external auth command');
  if (value.action === 'prepare' || value.action === 'prepare_association')
    return { action: value.action, walletId: requireCanonicalString(value.walletId, 'walletId') };
  if (value.action === 'unlink')
    return {
      action: 'unlink',
      walletId: requireCanonicalString(value.walletId, 'walletId'),
      associationId: requireCanonicalString(value.associationId, 'associationId'),
    };
  if (value.action !== 'authenticate' && value.action !== 'associate') throw new Error('Invalid external authentication command');
  const input = requireRecord(value.input, 'authentication input');
  const walletId = requireCanonicalString(input.walletId, 'walletId');
  if (input.method === 'google')
    return {
      action: value.action,
      input: {
        method: 'google',
        walletId,
        idToken: requireCanonicalString(input.idToken, 'idToken'),
      },
    };
  if (input.method === 'handoff')
    return {
      action: value.action,
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
  provider: ExternalIdentity['provider'];
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
    (record.provider !== 'google' && record.provider !== 'application') ||
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
    provider: record.provider,
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
    case 'cancelled':
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
