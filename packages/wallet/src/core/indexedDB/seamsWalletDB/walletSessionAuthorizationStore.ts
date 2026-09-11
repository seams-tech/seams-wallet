import {
  parseWalletSessionAuthorizationId,
  parseMpcWalletSigningQuotaId,
  type WalletSessionAuthorizationId,
  parseWalletSessionId,
  type MpcWalletSigningQuotaId,
  type WalletSessionId,
} from '@shared/authorization/capabilityKinds';
import {
  parseMpcMaterialActivationRef,
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  parseWalletId,
  type WalletAuthMethodId,
  type WalletAuthorityId,
  type WalletId,
} from '@shared/utils/domainIds';
import { parseDigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  SEAMS_WALLET_INDEXES,
  SEAMS_WALLET_STORES,
  type SeamsWalletStoreName,
} from '../schemaNames';
import { seamsWalletDB } from '../singletons';
import type { SeamsWalletDBManager, SeamsWalletTransactionContext } from './manager';
import type {
  ActiveWalletSessionV1,
  WalletSessionOperationCredentialV1,
  WalletCapabilitySubjectV1,
} from '@shared/device-linking/contracts';
import { parseWalletSessionOperationCredentialV1 } from '@shared/device-linking/parsers';
export type {
  ActiveWalletSessionV1,
  WalletSessionOperationCredentialV1,
  WalletCapabilitySubjectV1,
} from '@shared/device-linking/contracts';

export const WALLET_SESSION_AUTHORIZATION_RECORD_VERSION_V6 =
  'wallet_session_authorization_v6' as const;
export type WalletSessionAuthorizationRetirementReason =
  | 'expired'
  | 'exhausted'
  | 'replaced'
  | 'wallet_locked'
  | 'invalidated';

export type RetiredWalletSessionV1 = {
  readonly kind: 'retired_wallet_session_v1';
  readonly walletId: WalletId;
  readonly authorityId: WalletAuthorityId;
  readonly authMethodId: WalletAuthMethodId;
  readonly authorizationId: WalletSessionAuthorizationId;
  readonly quotaId: MpcWalletSigningQuotaId;
  readonly authorityDigestB64u: DigestB64u;
  readonly authorityRevocationEpoch: number;
  readonly capabilitySubjects: readonly [WalletCapabilitySubjectV1, ...WalletCapabilitySubjectV1[]];
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly retiredAtMs: number;
  readonly retirementReason: WalletSessionAuthorizationRetirementReason;
};

export type WalletSessionAuthorizationRecord = ActiveWalletSessionV1 | RetiredWalletSessionV1;

export type WalletSessionAuthorizationExactOperationCredentialReadResult =
  | {
      readonly kind: 'found';
      readonly record: ActiveWalletSessionV1;
      readonly operationCredential: WalletSessionOperationCredentialV1;
    }
  | {
      readonly kind: 'missing';
      readonly record?: never;
      readonly operationCredential?: never;
    }
  | {
      readonly kind: 'upgrade_required';
      readonly record?: never;
      readonly operationCredential?: never;
    };

export type WalletSessionAuthorizationExactActiveReadResult =
  | Extract<
      WalletSessionAuthorizationExactOperationCredentialReadResult,
      { readonly kind: 'found' | 'missing' | 'upgrade_required' }
    >
  | {
      readonly kind: 'corrupt';
      readonly record?: never;
      readonly operationCredential?: never;
    }
  | {
      readonly kind: 'persistence_unavailable';
      readonly record?: never;
      readonly operationCredential?: never;
    };

export class WalletSessionAuthorizationUpgradeRequiredError extends Error {
  readonly kind = 'upgrade_required';
  readonly code = 'upgrade_required';

  constructor(message: string) {
    super(message);
    this.name = 'WalletSessionAuthorizationUpgradeRequiredError';
  }
}

const STORE = SEAMS_WALLET_STORES.walletSessionAuthorizations;

type WalletSessionObjectFields = ReadonlyMap<string, unknown>;

function decodeExactWalletSessionFields(
  value: unknown,
  expected: readonly string[],
): WalletSessionObjectFields | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = Object.keys(value);
  if (fields.length !== expected.length || fields.some((field) => !expected.includes(field))) {
    return null;
  }
  const decoded = new Map<string, unknown>();
  for (const field of fields) decoded.set(field, Reflect.get(value, field));
  return decoded;
}

function readWalletSessionField(value: unknown, field: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Reflect.get(value, field);
}

function parseRetirementReason(value: unknown): WalletSessionAuthorizationRetirementReason | null {
  switch (value) {
    case 'expired':
    case 'exhausted':
    case 'replaced':
    case 'wallet_locked':
    case 'invalidated':
      return value;
    default:
      return null;
  }
}

type StoredActiveWalletSessionV6 = ActiveWalletSessionV1 & {
  readonly walletSessionId: WalletSessionId;
};

export type StoredExactWalletSessionAuthorizationRowV6 = {
  readonly record_version: typeof WALLET_SESSION_AUTHORIZATION_RECORD_VERSION_V6;
  readonly wallet_session_id: string;
  readonly authorization_id: string;
  readonly wallet_id: string;
  readonly wallet_authority_id: string;
  readonly wallet_auth_method_id: string;
  readonly authority_digest_b64u: string;
  readonly authority_revocation_epoch: number;
  readonly status: 'active';
  readonly issued_at_ms: number;
  readonly expires_at_ms: number;
  readonly record: StoredActiveWalletSessionV6;
  readonly operation_credential: WalletSessionOperationCredentialV1;
};

const EXACT_ACTIVE_FIELDS = [
  'kind',
  'walletId',
  'authorityId',
  'authMethodId',
  'authorizationId',
  'quotaId',
  'authorityDigestB64u',
  'authorityRevocationEpoch',
  'capabilitySubjects',
  'issuedAtMs',
  'expiresAtMs',
] as const;
const EXACT_RETIRED_FIELDS = [...EXACT_ACTIVE_FIELDS, 'retiredAtMs', 'retirementReason'] as const;
const EXACT_STORED_ROW_V6_FIELDS = [
  'record_version',
  'wallet_session_id',
  'authorization_id',
  'wallet_id',
  'wallet_authority_id',
  'wallet_auth_method_id',
  'authority_digest_b64u',
  'authority_revocation_epoch',
  'status',
  'issued_at_ms',
  'expires_at_ms',
  'record',
  'operation_credential',
] as const;

const WALLET_SESSION_AUTHORIZATION_RECORD_VERSION_PATTERN =
  /^wallet_session_authorization_v([0-9]+)$/;
const FIRST_SUPPORTED_LEGACY_WALLET_SESSION_AUTHORIZATION_VERSION = 3;
const CURRENT_WALLET_SESSION_AUTHORIZATION_VERSION = 6;

type WalletSessionAuthorizationRowClassification =
  | { readonly kind: 'legacy'; readonly version: number }
  | {
      readonly kind: 'current';
      readonly version: typeof CURRENT_WALLET_SESSION_AUTHORIZATION_VERSION;
    }
  | { readonly kind: 'future'; readonly version: number }
  | { readonly kind: 'unknown' };

function parseWalletSessionAuthorizationRecordVersion(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = WALLET_SESSION_AUTHORIZATION_RECORD_VERSION_PATTERN.exec(value);
  if (!match) return null;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) ? version : null;
}

function classifyWalletSessionAuthorizationRow(
  value: unknown,
): WalletSessionAuthorizationRowClassification {
  const hasTopLevelVersion =
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, 'record_version');
  const topLevelVersion = parseWalletSessionAuthorizationRecordVersion(
    readWalletSessionField(value, 'record_version'),
  );
  const nestedVersion =
    !hasTopLevelVersion
      ? parseWalletSessionAuthorizationRecordVersion(
          readWalletSessionField(readWalletSessionField(value, 'record'), 'recordVersion'),
        )
      : null;
  const version = topLevelVersion ?? nestedVersion;
  if (version === null) return { kind: 'unknown' };
  if (
    version >= FIRST_SUPPORTED_LEGACY_WALLET_SESSION_AUTHORIZATION_VERSION &&
    version < CURRENT_WALLET_SESSION_AUTHORIZATION_VERSION
  ) {
    return { kind: 'legacy', version };
  }
  if (hasTopLevelVersion && version === CURRENT_WALLET_SESSION_AUTHORIZATION_VERSION) {
    return { kind: 'current', version };
  }
  if (hasTopLevelVersion && version > CURRENT_WALLET_SESSION_AUTHORIZATION_VERSION) {
    return { kind: 'future', version };
  }
  return { kind: 'unknown' };
}

function futureWalletSessionAuthorizationRowMatchesExactScope(
  value: unknown,
  scope: {
    readonly walletId: WalletId;
    readonly authorityId: WalletAuthorityId;
    readonly authMethodId: WalletAuthMethodId;
  },
): boolean {
  const classification = classifyWalletSessionAuthorizationRow(value);
  if (classification.kind !== 'future') return false;
  if (readWalletSessionField(value, 'wallet_id') !== scope.walletId) return false;
  const authorityId = readWalletSessionField(value, 'wallet_authority_id');
  const authMethodId = readWalletSessionField(value, 'wallet_auth_method_id');
  if (
    typeof authorityId !== 'string' ||
    typeof authMethodId !== 'string'
  ) {
    return true;
  }
  return (
    authorityId === scope.authorityId &&
    authMethodId === scope.authMethodId
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function storedWalletSessionRowKey(value: unknown): string {
  const key = readWalletSessionField(value, 'wallet_session_id');
  if (typeof key !== 'string') {
    throw new Error('Stored Wallet Session authorization key is invalid');
  }
  return key;
}

async function settleAbortedTransaction(transaction: {
  readonly done: Promise<unknown>;
}): Promise<void> {
  try {
    await transaction.done;
  } catch {}
}

function walletSessionStoreForTransaction<Name extends SeamsWalletStoreName>(
  tx: SeamsWalletTransactionContext['tx'],
  _name: Name,
): ReturnType<SeamsWalletTransactionContext['store']> {
  return tx.objectStore(STORE);
}

function walletSessionTransactionContext(
  db: SeamsWalletTransactionContext['db'],
  tx: SeamsWalletTransactionContext['tx'],
): SeamsWalletTransactionContext {
  return {
    db,
    tx,
    store: walletSessionStoreForTransaction.bind(null, tx),
  };
}

function walletCapabilitySubjectKey(subject: WalletCapabilitySubjectV1): string {
  switch (subject.kind) {
    case 'sign':
    case 'export_keys':
      return `${subject.kind}:${subject.keyFamily}:${subject.materialActivation.activationId}`;
    case 'link_devices':
    case 'revoke_devices':
      return subject.kind;
    default:
      return assertNeverWalletCapabilitySubject(subject);
  }
}

function assertNeverWalletCapabilitySubject(value: never): never {
  throw new Error(`Unknown Wallet Capability subject: ${String(value)}`);
}

function parseExactWalletCapabilitySubject(value: unknown): WalletCapabilitySubjectV1 | null {
  const kind = readWalletSessionField(value, 'kind');
  if (kind === 'sign' || kind === 'export_keys') {
    const fields = decodeExactWalletSessionFields(value, [
      'kind',
      'keyFamily',
      'materialActivation',
    ]);
    if (!fields) return null;
    const keyFamily = fields.get('keyFamily');
    if (keyFamily !== 'ed25519' && keyFamily !== 'ecdsa_secp256k1') return null;
    const activation = parseMpcMaterialActivationRef(fields.get('materialActivation'));
    if (!activation.ok) return null;
    return {
      kind,
      keyFamily,
      materialActivation: activation.value,
    };
  }
  if (kind === 'link_devices' || kind === 'revoke_devices') {
    return decodeExactWalletSessionFields(value, ['kind']) ? { kind } : null;
  }
  return null;
}

function parseExactWalletCapabilitySubjects(
  value: unknown,
): readonly [WalletCapabilitySubjectV1, ...WalletCapabilitySubjectV1[]] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parsed: WalletCapabilitySubjectV1[] = [];
  for (const rawSubject of value) {
    const subject = parseExactWalletCapabilitySubject(rawSubject);
    if (!subject) return null;
    parsed.push(subject);
  }

  const keys = new Set<string>();
  for (const subject of parsed) {
    const key = walletCapabilitySubjectKey(subject);
    if (keys.has(key)) return null;
    keys.add(key);
  }

  const [first, ...rest] = parsed;
  if (!first) return null;
  return [first, ...rest];
}

function parseExactWalletSessionRecord(value: unknown): WalletSessionAuthorizationRecord | null {
  const kind = readWalletSessionField(value, 'kind');
  const fields =
    kind === 'active_wallet_session_v1'
      ? decodeExactWalletSessionFields(value, EXACT_ACTIVE_FIELDS)
      : kind === 'retired_wallet_session_v1'
        ? decodeExactWalletSessionFields(value, EXACT_RETIRED_FIELDS)
        : null;
  if (!fields) return null;
  const walletId = parseWalletId(fields.get('walletId'));
  const authorityId = parseWalletAuthorityId(fields.get('authorityId'));
  const authMethodId = parseWalletAuthMethodId(fields.get('authMethodId'));
  const authorizationId = parseWalletSessionAuthorizationId(fields.get('authorizationId'));
  const quotaId = parseMpcWalletSigningQuotaId(fields.get('quotaId'));
  if (!walletId.ok || !authorityId.ok || !authMethodId.ok || !authorizationId.ok || !quotaId.ok) {
    return null;
  }
  let authorityDigestB64u: DigestB64u;
  try {
    authorityDigestB64u = parseDigestB64u(fields.get('authorityDigestB64u'));
  } catch {
    return null;
  }
  const capabilitySubjects = parseExactWalletCapabilitySubjects(fields.get('capabilitySubjects'));
  const authorityRevocationEpoch = fields.get('authorityRevocationEpoch');
  const issuedAtMs = fields.get('issuedAtMs');
  const expiresAtMs = fields.get('expiresAtMs');
  if (
    !capabilitySubjects ||
    !isNonNegativeSafeInteger(authorityRevocationEpoch) ||
    !isNonNegativeSafeInteger(issuedAtMs) ||
    !isNonNegativeSafeInteger(expiresAtMs) ||
    expiresAtMs <= issuedAtMs
  ) {
    return null;
  }
  const identity = {
    walletId: walletId.value,
    authorityId: authorityId.value,
    authMethodId: authMethodId.value,
    authorizationId: authorizationId.value,
    quotaId: quotaId.value,
    authorityDigestB64u,
    authorityRevocationEpoch,
    capabilitySubjects,
    issuedAtMs,
    expiresAtMs,
  };
  if (kind === 'active_wallet_session_v1') {
    return {
      kind: 'active_wallet_session_v1',
      walletId: identity.walletId,
      authorityId: identity.authorityId,
      authMethodId: identity.authMethodId,
      authorizationId: identity.authorizationId,
      quotaId: identity.quotaId,
      authorityDigestB64u: identity.authorityDigestB64u,
      authorityRevocationEpoch: identity.authorityRevocationEpoch,
      capabilitySubjects: identity.capabilitySubjects,
      issuedAtMs: identity.issuedAtMs,
      expiresAtMs: identity.expiresAtMs,
    };
  }
  if (kind === 'retired_wallet_session_v1') {
    const retiredAtMs = fields.get('retiredAtMs');
    if (!isNonNegativeSafeInteger(retiredAtMs) || retiredAtMs < identity.issuedAtMs) {
      return null;
    }
    const retirementReason = parseRetirementReason(fields.get('retirementReason'));
    if (!retirementReason) return null;
    if (retirementReason === 'expired' && retiredAtMs < identity.expiresAtMs) {
      return null;
    }
    return {
      kind: 'retired_wallet_session_v1',
      walletId: identity.walletId,
      authorityId: identity.authorityId,
      authMethodId: identity.authMethodId,
      authorizationId: identity.authorizationId,
      quotaId: identity.quotaId,
      authorityDigestB64u: identity.authorityDigestB64u,
      authorityRevocationEpoch: identity.authorityRevocationEpoch,
      capabilitySubjects: identity.capabilitySubjects,
      issuedAtMs: identity.issuedAtMs,
      expiresAtMs: identity.expiresAtMs,
      retiredAtMs,
      retirementReason,
    };
  }
  return null;
}

export function buildActiveWalletSessionV1(
  input: Omit<ActiveWalletSessionV1, 'kind'>,
): ActiveWalletSessionV1 {
  const record = parseExactWalletSessionRecord({
    kind: 'active_wallet_session_v1',
    walletId: input.walletId,
    authorityId: input.authorityId,
    authMethodId: input.authMethodId,
    authorizationId: input.authorizationId,
    quotaId: input.quotaId,
    authorityDigestB64u: input.authorityDigestB64u,
    authorityRevocationEpoch: input.authorityRevocationEpoch,
    capabilitySubjects: input.capabilitySubjects,
    issuedAtMs: input.issuedAtMs,
    expiresAtMs: input.expiresAtMs,
  });
  if (!record || record.kind !== 'active_wallet_session_v1') {
    throw new Error('Active Wallet Session v1 is invalid');
  }
  return record;
}

export function retireWalletSessionV1(args: {
  readonly active: ActiveWalletSessionV1;
  readonly reason: WalletSessionAuthorizationRetirementReason;
  readonly retiredAtMs: number;
}): RetiredWalletSessionV1 {
  if (!isNonNegativeSafeInteger(args.retiredAtMs)) {
    throw new Error('Retired Wallet Session v1 time is invalid');
  }
  const record = parseExactWalletSessionRecord({
    kind: 'retired_wallet_session_v1',
    walletId: args.active.walletId,
    authorityId: args.active.authorityId,
    authMethodId: args.active.authMethodId,
    authorizationId: args.active.authorizationId,
    quotaId: args.active.quotaId,
    authorityDigestB64u: args.active.authorityDigestB64u,
    authorityRevocationEpoch: args.active.authorityRevocationEpoch,
    capabilitySubjects: args.active.capabilitySubjects,
    issuedAtMs: args.active.issuedAtMs,
    expiresAtMs: args.active.expiresAtMs,
    retiredAtMs: args.retiredAtMs,
    retirementReason: args.reason,
  });
  if (!record || record.kind !== 'retired_wallet_session_v1') {
    throw new Error('Retired Wallet Session v1 is invalid');
  }
  return record;
}

export function toStoredExactWalletSessionAuthorizationRowV6(
  record: ActiveWalletSessionV1,
  operationCredential: WalletSessionOperationCredentialV1,
): StoredExactWalletSessionAuthorizationRowV6 {
  const parsedRecord = parseExactWalletSessionRecord(record);
  if (!parsedRecord || parsedRecord.kind !== 'active_wallet_session_v1') {
    throw new Error('Active Wallet Session v1 is invalid');
  }
  let parsedOperationCredential: WalletSessionOperationCredentialV1;
  try {
    parsedOperationCredential = parseWalletSessionOperationCredentialV1(operationCredential);
  } catch {
    throw new Error('Wallet Session operation credential is invalid');
  }
  const row: StoredExactWalletSessionAuthorizationRowV6 = {
    record_version: WALLET_SESSION_AUTHORIZATION_RECORD_VERSION_V6,
    wallet_session_id: parsedOperationCredential.walletSessionId,
    authorization_id: parsedRecord.authorizationId,
    wallet_id: parsedRecord.walletId,
    wallet_authority_id: parsedRecord.authorityId,
    wallet_auth_method_id: parsedRecord.authMethodId,
    authority_digest_b64u: parsedRecord.authorityDigestB64u,
    authority_revocation_epoch: parsedRecord.authorityRevocationEpoch,
    status: 'active',
    issued_at_ms: parsedRecord.issuedAtMs,
    expires_at_ms: parsedRecord.expiresAtMs,
    record: {
      kind: parsedRecord.kind,
      walletId: parsedRecord.walletId,
      authorityId: parsedRecord.authorityId,
      authMethodId: parsedRecord.authMethodId,
      authorizationId: parsedRecord.authorizationId,
      walletSessionId: parsedOperationCredential.walletSessionId,
      quotaId: parsedRecord.quotaId,
      authorityDigestB64u: parsedRecord.authorityDigestB64u,
      authorityRevocationEpoch: parsedRecord.authorityRevocationEpoch,
      capabilitySubjects: parsedRecord.capabilitySubjects,
      issuedAtMs: parsedRecord.issuedAtMs,
      expiresAtMs: parsedRecord.expiresAtMs,
    },
    operation_credential: parsedOperationCredential,
  };
  if (!parseStoredExactWalletSessionAuthorizationRowV6(row)) {
    throw new Error('Wallet Session authorization v6 is invalid');
  }
  return row;
}

export function parseStoredExactWalletSessionAuthorizationRowV6(value: unknown): {
  readonly record: ActiveWalletSessionV1;
  readonly operationCredential: WalletSessionOperationCredentialV1;
  readonly physicalKey: string;
} | null {
  const fields = decodeExactWalletSessionFields(value, EXACT_STORED_ROW_V6_FIELDS);
  if (
    !fields ||
    fields.get('record_version') !== WALLET_SESSION_AUTHORIZATION_RECORD_VERSION_V6 ||
    fields.get('status') !== 'active'
  ) {
    return null;
  }
  const walletSessionId = parseWalletSessionId(fields.get('wallet_session_id'));
  const authorizationId = parseWalletSessionAuthorizationId(fields.get('authorization_id'));
  if (!walletSessionId.ok || !authorizationId.ok) return null;
  let operationCredential: WalletSessionOperationCredentialV1;
  try {
    operationCredential = parseWalletSessionOperationCredentialV1(fields.get('operation_credential'));
  } catch {
    return null;
  }
  if (walletSessionId.value !== operationCredential.walletSessionId) return null;
  const recordFields = decodeExactWalletSessionFields(
    fields.get('record'),
    [...EXACT_ACTIVE_FIELDS, 'walletSessionId'],
  );
  if (!recordFields) return null;
  const recordWalletSessionId = parseWalletSessionId(recordFields.get('walletSessionId'));
  if (!recordWalletSessionId.ok || recordWalletSessionId.value !== walletSessionId.value) {
    return null;
  }
  const record = parseExactWalletSessionRecord({
    kind: recordFields.get('kind'),
    walletId: recordFields.get('walletId'),
    authorityId: recordFields.get('authorityId'),
    authMethodId: recordFields.get('authMethodId'),
    authorizationId: recordFields.get('authorizationId'),
    quotaId: recordFields.get('quotaId'),
    authorityDigestB64u: recordFields.get('authorityDigestB64u'),
    authorityRevocationEpoch: recordFields.get('authorityRevocationEpoch'),
    capabilitySubjects: recordFields.get('capabilitySubjects'),
    issuedAtMs: recordFields.get('issuedAtMs'),
    expiresAtMs: recordFields.get('expiresAtMs'),
  });
  if (
    !record ||
    record.kind !== 'active_wallet_session_v1' ||
    fields.get('wallet_id') !== record.walletId ||
    fields.get('wallet_authority_id') !== record.authorityId ||
    fields.get('wallet_auth_method_id') !== record.authMethodId ||
    fields.get('authority_digest_b64u') !== record.authorityDigestB64u ||
    fields.get('authority_revocation_epoch') !== record.authorityRevocationEpoch ||
    fields.get('issued_at_ms') !== record.issuedAtMs ||
    fields.get('expires_at_ms') !== record.expiresAtMs ||
    authorizationId.value !== record.authorizationId
  ) {
    return null;
  }
  return {
    record,
    operationCredential,
    physicalKey: walletSessionId.value,
  };
}

export async function replaceExactActiveWalletSessionAuthorizationInTransaction(args: {
  readonly ctx: SeamsWalletTransactionContext;
  readonly active: ActiveWalletSessionV1;
  readonly operationCredential: WalletSessionOperationCredentialV1;
}): Promise<ActiveWalletSessionV1> {
  const incoming = parseExactWalletSessionRecord(args.active);
  if (!incoming || incoming.kind !== 'active_wallet_session_v1') {
    throw new Error('Active Wallet Session v1 is invalid');
  }
  const operationCredential = parseWalletSessionOperationCredentialV1(args.operationCredential);
  const incomingRow = toStoredExactWalletSessionAuthorizationRowV6(incoming, operationCredential);
  const store = args.ctx.store(STORE);
  const rows = await store.index(SEAMS_WALLET_INDEXES.walletId).getAll(incoming.walletId);
  for (const raw of rows) {
    const classification = classifyWalletSessionAuthorizationRow(raw);
    if (classification.kind === 'future') continue;
    if (classification.kind === 'legacy') {
      await store.delete(storedWalletSessionRowKey(raw));
      continue;
    }
    if (classification.kind !== 'current') {
      throw new Error('Stored Wallet Session authorization row is corrupt');
    }
    const parsedCurrent = parseStoredExactWalletSessionAuthorizationRowV6(raw);
    if (!parsedCurrent) {
      throw new Error('Stored Wallet Session authorization v6 is corrupt');
    }
    const current = parsedCurrent.record;
    if (
      current.kind !== 'active_wallet_session_v1' ||
      current.authorityId !== incoming.authorityId ||
      current.authMethodId !== incoming.authMethodId
    ) {
      continue;
    }
    if (
      current.authorizationId === incoming.authorizationId &&
      parsedCurrent.operationCredential.walletSessionId === operationCredential.walletSessionId
    ) {
      if (parsedCurrent.operationCredential.token !== operationCredential.token) {
        throw new Error('Stored Wallet Session conflicts with the issued operation credential');
      }
      continue;
    }
    await store.delete(parsedCurrent.physicalKey);
  }
  await store.put(incomingRow);
  return incoming;
}

export type ExactActiveWalletSessionAuthorizationInTransactionRead =
  | {
      readonly kind: 'found';
      readonly record: ActiveWalletSessionV1;
      readonly operationCredential: WalletSessionOperationCredentialV1;
    }
  | { readonly kind: 'missing' }
  | { readonly kind: 'upgrade_required' }
  | { readonly kind: 'corrupt' };

export async function readExactActiveWalletSessionForScopeInTransaction(args: {
  readonly ctx: SeamsWalletTransactionContext;
  readonly walletId: WalletId;
  readonly authorityId: WalletAuthorityId;
  readonly authMethodId: WalletAuthMethodId;
}): Promise<ExactActiveWalletSessionAuthorizationInTransactionRead> {
  const store = args.ctx.store(STORE);
  const rows = await store.index(SEAMS_WALLET_INDEXES.walletId).getAll(args.walletId);
  let match: {
    readonly record: ActiveWalletSessionV1;
    readonly operationCredential: WalletSessionOperationCredentialV1;
  } | null = null;
  let upgradeRequired = false;
  for (const raw of rows) {
    if (futureWalletSessionAuthorizationRowMatchesExactScope(raw, args)) {
      upgradeRequired = true;
      continue;
    }
    const classification = classifyWalletSessionAuthorizationRow(raw);
    if (classification.kind === 'legacy') {
      await store.delete(storedWalletSessionRowKey(raw));
      continue;
    }
    if (classification.kind !== 'current') return { kind: 'corrupt' };
    const parsed = parseStoredExactWalletSessionAuthorizationRowV6(raw);
    if (!parsed) return { kind: 'corrupt' };
    if (
      parsed.record.walletId !== args.walletId ||
      parsed.record.authorityId !== args.authorityId ||
      parsed.record.authMethodId !== args.authMethodId
    ) {
      continue;
    }
    if (match) return { kind: 'corrupt' };
    match = parsed;
  }
  if (upgradeRequired) return { kind: 'upgrade_required' };
  if (!match) return { kind: 'missing' };
  return { kind: 'found', ...match };
}

export class WalletSessionAuthorizationRepository {
  constructor(private readonly manager: SeamsWalletDBManager = seamsWalletDB) {}

  async writeExactWithOperationCredential(input: {
    readonly record: ActiveWalletSessionV1;
    readonly operationCredential: WalletSessionOperationCredentialV1;
  }): Promise<ActiveWalletSessionV1> {
    const parsed = parseExactWalletSessionRecord(input.record);
    if (!parsed || parsed.kind !== 'active_wallet_session_v1') {
      throw new Error('Active Wallet Session v1 is invalid');
    }
    const operationCredential = parseWalletSessionOperationCredentialV1(input.operationCredential);
    await this.replaceExactActive({
      active: parsed,
      operationCredential,
    });
    return parsed;
  }

  async readExact(
    walletSessionId: WalletSessionId,
  ): Promise<WalletSessionAuthorizationRecord | null> {
    const db = await this.manager.getDB();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    try {
      const raw = await store.get(walletSessionId);
      if (raw === undefined) {
        await tx.done;
        return null;
      }
      const classification = classifyWalletSessionAuthorizationRow(raw);
      switch (classification.kind) {
        case 'future':
          throw new WalletSessionAuthorizationUpgradeRequiredError(
            'Wallet Session authorization requires a newer client',
          );
        case 'legacy':
          await store.delete(storedWalletSessionRowKey(raw));
          await tx.done;
          return null;
        case 'current':
          break;
        case 'unknown':
          throw new Error('Stored Wallet Session authorization v6 is corrupt');
      }
      const parsed = parseStoredExactWalletSessionAuthorizationRowV6(raw);
      if (!parsed) throw new Error('Stored Wallet Session authorization v6 is corrupt');
      await tx.done;
      return parsed.record;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await settleAbortedTransaction(tx);
      throw error;
    }
  }

  async readExactWithOperationCredential(input: {
    readonly walletId: WalletId;
    readonly authorityId: WalletAuthorityId;
    readonly authMethodId: WalletAuthMethodId;
  }): Promise<WalletSessionAuthorizationExactOperationCredentialReadResult> {
    const read = await this.readExactActiveForWallet(input);
    switch (read.kind) {
      case 'found':
      case 'missing':
      case 'upgrade_required':
        return read;
      case 'corrupt':
        throw new Error('Stored Wallet Session authorization v6 is corrupt');
      case 'persistence_unavailable':
        throw new Error('Wallet Session authorization persistence is unavailable');
    }
  }

  async readExactActiveForWallet(input: {
    readonly walletId: WalletId;
    readonly authorityId: WalletAuthorityId;
    readonly authMethodId: WalletAuthMethodId;
  }): Promise<WalletSessionAuthorizationExactActiveReadResult> {
    try {
      const db = await this.manager.getDB();
      const tx = db.transaction(STORE, 'readwrite');
      try {
        const result = await readExactActiveWalletSessionForScopeInTransaction({
          ctx: walletSessionTransactionContext(db, tx),
          ...input,
        });
        if (result.kind === 'corrupt') {
          try {
            tx.abort();
          } catch {}
          await settleAbortedTransaction(tx);
          return result;
        }
        await tx.done;
        return result;
      } catch {
        try {
          tx.abort();
        } catch {}
        await settleAbortedTransaction(tx);
        return { kind: 'persistence_unavailable' };
      }
    } catch {
      return { kind: 'persistence_unavailable' };
    }
  }

  async retireExactActiveForWallet(args: {
    readonly walletId: WalletId;
    readonly reason: WalletSessionAuthorizationRetirementReason;
    readonly retiredAtMs: number;
  }): Promise<readonly RetiredWalletSessionV1[]> {
    if (!isNonNegativeSafeInteger(args.retiredAtMs)) {
      throw new Error('Wallet Session v1 retirement time is invalid');
    }
    const db = await this.manager.getDB();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const retired: RetiredWalletSessionV1[] = [];
    try {
      const rows = await store.index(SEAMS_WALLET_INDEXES.walletId).getAll(args.walletId);
      for (const raw of rows) {
        const classification = classifyWalletSessionAuthorizationRow(raw);
        if (classification.kind === 'future') continue;
        if (classification.kind === 'legacy') {
          await store.delete(storedWalletSessionRowKey(raw));
          continue;
        }
        if (classification.kind !== 'current') continue;
        const parsedCurrent = parseStoredExactWalletSessionAuthorizationRowV6(raw);
        if (!parsedCurrent) {
          tx.abort();
          throw new Error('Stored Wallet Session authorization v6 is corrupt');
        }
        const current = parsedCurrent.record;
        if (current.kind !== 'active_wallet_session_v1') continue;
        const next = retireWalletSessionV1({
          active: current,
          reason: args.reason,
          retiredAtMs: args.retiredAtMs,
        });
        await store.delete(parsedCurrent.physicalKey);
        retired.push(next);
      }
      await tx.done;
      return retired;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await settleAbortedTransaction(tx);
      throw error;
    }
  }

  async replaceExactActive(args: {
    readonly active: ActiveWalletSessionV1;
    readonly operationCredential: WalletSessionOperationCredentialV1;
  }): Promise<ActiveWalletSessionV1> {
    const db = await this.manager.getDB();
    const tx = db.transaction(STORE, 'readwrite');
    try {
      const incoming = await replaceExactActiveWalletSessionAuthorizationInTransaction({
        ctx: walletSessionTransactionContext(db, tx),
        active: args.active,
        operationCredential: args.operationCredential,
      });
      await tx.done;
      return incoming;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await settleAbortedTransaction(tx);
      throw error;
    }
  }

  async clearWallet(walletId: WalletId): Promise<void> {
    const db = await this.manager.getDB();
    const keys = await db.getAllKeysFromIndex(STORE, SEAMS_WALLET_INDEXES.walletId, walletId);
    if (keys.length === 0) return;
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const key of keys) {
      await store.delete(key);
    }
    await tx.done;
  }

  async clearAll(): Promise<void> {
    const db = await this.manager.getDB();
    await db.clear(STORE);
  }
}

export const walletSessionAuthorizations = new WalletSessionAuthorizationRepository();
