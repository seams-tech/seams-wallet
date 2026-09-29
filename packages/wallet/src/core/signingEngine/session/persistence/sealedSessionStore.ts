import { normalizeInteger, normalizeOptionalNonEmptyString } from '@shared/utils/normalize';
import { secureRandomId } from '@shared/utils/secureRandomId';
import { mpcMaterialActivationRefsEqual } from '@shared/utils/domainIds';
import type { Ed25519DurableMaterialLocator } from '../sealedRecovery/materialActivationKey';
import {
  signingSessionSealsRepository,
  type StoredRawSealedRecordEntry,
} from '../../../indexedDB/seamsWalletDB/signingSessionSeals';
import {
  thresholdEcdsaChainTargetsEqual,
  type ThresholdEcdsaChainTarget,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import {
  exactSealedSessionFilterForIdentity,
  type DeleteDurableSealedSessionCommand,
} from './durableSealedSessionCommands';
import { alphabetizeStringify } from '@shared/utils/digests';
import { asRecord } from '@shared/utils/validation';
import {
  buildEcdsaInactiveMaterialPublicRestore,
  classifyNonCurrentRecord,
  classifyRawSealedSessionRecord,
  type CurrentEcdsaSealedSessionRecord,
  type CurrentEd25519SealedSessionRecord,
  type CurrentSealedSessionRecord,
  type CurrentSealedSessionRecordClassification,
  type EcdsaDurableLaneRecord,
  type EcdsaInactiveSealedMaterialRecord,
  hasRetiredAuthorizationIdentityField,
  inactiveEcdsaMaterialStorageRow,
  logSealedSessionClassification,
  makeInactiveEcdsaMaterialStoreKey,
  type NonCurrentSealedSessionRecordClassification,
  normalizeSigningSessionSealedStoreRecord,
  normalizeThresholdSessionIdsFromStoredRecord,
  requireInactiveEcdsaSealedMaterial,
  sealedRecordStorageRow,
  type SealedSessionRecordClassification,
  type SigningSessionSealedStoreRecord,
  storagePayloadFromSealedStoreRow,
} from './sealedSessionRecords';

type SigningSessionRestoreLease = {
  v: 1;
  leaseKey: string;
  ownerId: string;
  attemptId: string;
  startedAtMs: number;
  expiresAtMs: number;
};

type SigningSessionRestoreLeaseHandle = SigningSessionRestoreLease & {
  thresholdSessionId: string;
};

class SealedSessionRecordUserActionRequiredError extends Error {
  readonly classification: Extract<
    NonCurrentSealedSessionRecordClassification,
    { kind: 'user_action_required' }
  >;

  constructor(
    classification: Extract<
      NonCurrentSealedSessionRecordClassification,
      { kind: 'user_action_required' }
    >,
  ) {
    super(
      `[SigningSessionSealedStore] sealed session record requires user action: ${classification.reason}`,
    );
    this.name = 'SealedSessionRecordUserActionRequiredError';
    this.classification = classification;
  }
}
// Sealed records are indexed by threshold session id, but that id can appear
// on more than one lane. Every read/delete/lease must name the intended lane.
export type SigningSessionSealedRecordFilter =
  | {
      authMethod: 'passkey' | 'email_otp';
      curve: 'ed25519';
    }
  | {
      authMethod: 'passkey' | 'email_otp';
      curve: 'ecdsa';
      chainTarget: ThresholdEcdsaChainTarget;
    };

type ListEcdsaSigningSessionSealedRecordsForWalletFilter = {
  authMethod?: 'passkey' | 'email_otp';
  curve: 'ecdsa';
};

export type UpdateExactSealedSessionPolicyInput = {
  thresholdSessionId: string;
  filter: SigningSessionSealedRecordFilter;
  expiresAtMs?: number;
  remainingUses?: number;
  updatedAtMs: number;
};

type ResolvedIdentityDeleteReason =
  | 'durable_record_deleted'
  | 'invalid_persisted_record'
  | 'same_lane_replaced'
  | 'same_scope_replaced';

type DeleteExactSealedSessionOptions =
  | {
      deleteResolvedIdentity: true;
      resolvedIdentityDeleteReason: ResolvedIdentityDeleteReason;
    }
  | {
      deleteResolvedIdentity: false;
      resolvedIdentityDeleteReason?: never;
    };

const DEFAULT_RESTORE_LEASE_TTL_MS = 15_000;

function createRandomId(prefix: string): string {
  return secureRandomId(prefix, 32, 'sealed signing session restore IDs');
}

function restoreLeaseStorageRow(lease: SigningSessionRestoreLease): Record<string, unknown> {
  return {
    lease_key: lease.leaseKey,
    owner_id: lease.ownerId,
    attempt_id: lease.attemptId,
    started_at_ms: lease.startedAtMs,
    expires_at_ms: lease.expiresAtMs,
    lease,
  };
}

function sealedRecordAccountKeys(record: SigningSessionSealedStoreRecord): Set<string> {
  const keys = new Set<string>();
  const walletId = normalizeOptionalNonEmptyString(record.walletId);
  if (walletId) keys.add(walletId);
  return keys;
}

function sealedRecordsShareAccount(
  left: SigningSessionSealedStoreRecord,
  right: SigningSessionSealedStoreRecord,
): boolean {
  const leftKeys = sealedRecordAccountKeys(left);
  if (!leftKeys.size) return false;
  for (const key of sealedRecordAccountKeys(right)) {
    if (leftKeys.has(key)) return true;
  }
  return false;
}

function sealedRecordsHaveSamePurpose(
  left: SigningSessionSealedStoreRecord,
  right: SigningSessionSealedStoreRecord,
): boolean {
  if (!sealedRecordsShareAccount(left, right)) return false;
  if (left.authMethod !== right.authMethod || left.curve !== right.curve) return false;
  if (left.curve === 'ed25519' && right.curve === 'ed25519') {
    return mpcMaterialActivationRefsEqual(
      left.ed25519Restore.materialActivation,
      right.ed25519Restore.materialActivation,
    );
  }
  if (left.curve === 'ecdsa') {
    const leftKeyHandle = normalizeOptionalNonEmptyString(left.ecdsaRestore?.keyHandle);
    const rightKeyHandle = normalizeOptionalNonEmptyString(right.ecdsaRestore?.keyHandle);
    if (!leftKeyHandle || !rightKeyHandle || leftKeyHandle !== rightKeyHandle) return false;
    const leftTarget = left.ecdsaRestore?.chainTarget;
    const rightTarget = right.ecdsaRestore?.chainTarget;
    if (!leftTarget || !rightTarget) return false;
    if (!thresholdEcdsaChainTargetsEqual(leftTarget, rightTarget)) return false;
  }
  return true;
}

type PersistedCurrentEd25519Record = {
  readonly primaryKey: string;
  readonly record: CurrentEd25519SealedSessionRecord;
};

function exactEd25519PublicIdentityKey(record: CurrentEd25519SealedSessionRecord): string {
  return alphabetizeStringify({
    storeKey: record.storeKey,
    walletId: record.walletId,
    authMethod: record.authMethod,
    signingRootId: record.signingRootId ?? null,
    signingRootVersion: record.signingRootVersion ?? null,
    restore: record.ed25519Restore,
  });
}

function persistedEd25519Record(
  entry: StoredRawSealedRecordEntry,
  record: CurrentEd25519SealedSessionRecord,
): PersistedCurrentEd25519Record {
  if (typeof entry.primaryKey !== 'string' || !entry.primaryKey.trim()) {
    throw new Error('[SigningSessionSealedStore] exact Ed25519 record key is invalid');
  }
  return { primaryKey: entry.primaryKey, record };
}

function preferredExactEd25519Record(
  left: PersistedCurrentEd25519Record,
  right: PersistedCurrentEd25519Record,
): PersistedCurrentEd25519Record {
  if (left.record.updatedAtMs !== right.record.updatedAtMs) {
    return left.record.updatedAtMs > right.record.updatedAtMs ? left : right;
  }
  if (left.primaryKey === left.record.storeKey) return left;
  if (right.primaryKey === right.record.storeKey) return right;
  return left.primaryKey.localeCompare(right.primaryKey) <= 0 ? left : right;
}

async function compactExactEd25519Records(
  matches: readonly PersistedCurrentEd25519Record[],
  options: { readonly writeCanonical: boolean } = { writeCanonical: false },
): Promise<CurrentEd25519SealedSessionRecord | null> {
  const first = matches[0];
  if (!first) return null;
  const exactIdentity = exactEd25519PublicIdentityKey(first.record);
  for (const match of matches.slice(1)) {
    if (exactEd25519PublicIdentityKey(match.record) !== exactIdentity) {
      throw new Error(
        '[SigningSessionSealedStore] exact Ed25519 material has conflicting public identity facts',
      );
    }
  }
  const selected = matches.reduce(preferredExactEd25519Record);
  const canonicalStoreKey = selected.record.storeKey;
  const staleStoreKeys = [...new Set(matches.map((match) => match.primaryKey))].filter(
    (primaryKey) => primaryKey !== canonicalStoreKey,
  );
  if (
    options.writeCanonical ||
    staleStoreKeys.length > 0 ||
    selected.primaryKey !== canonicalStoreKey
  ) {
    await signingSessionSealsRepository.replaceSealedRecord({
      row: sealedRecordStorageRow(selected.record),
      staleStoreKeys,
    });
  }
  return selected.record;
}

async function classifyPersistedSealedRecord(
  entry: StoredRawSealedRecordEntry,
): Promise<SealedSessionRecordClassification> {
  const payload = storagePayloadFromSealedStoreRow(entry.value);
  const classification = classifyRawSealedSessionRecord(payload);
  if (classification.kind !== 'current') {
    return classification;
  }
  const raw = asRecord(payload);
  const rawRow = asRecord(entry.value);
  if (hasRetiredAuthorizationIdentityField(rawRow) || hasRetiredAuthorizationIdentityField(raw)) {
    return classifyNonCurrentRecord('delete_required', raw, 'invalid_identity');
  }
  const persistedStoreKey = normalizeOptionalNonEmptyString(raw?.storeKey);
  if (!persistedStoreKey || persistedStoreKey === classification.record.storeKey) {
    return classification;
  }
  return classification;
}

function rawThresholdSessionIdsFromSealedStoreRow(value: unknown): {
  ed25519?: string;
  ecdsa?: string;
} {
  return normalizeThresholdSessionIdsFromStoredRecord(storagePayloadFromSealedStoreRow(value));
}

/** Logs a record that is not current, and queues it for deletion when it cannot be kept. */
function setAsideRejectedSealedRecord(
  operation: string,
  classification: Exclude<
    SealedSessionRecordClassification,
    CurrentSealedSessionRecordClassification
  >,
  primaryKey: unknown,
  deletePrimaryKeys: unknown[],
): void {
  logSealedSessionClassification({ operation, classification });
  if (classification.kind === 'delete_required' || classification.kind === 'malformed') {
    deletePrimaryKeys.push(primaryKey);
  }
}

function normalizeSigningSessionRestoreLease(value: unknown): SigningSessionRestoreLease | null {
  const obj = asRecord(value);
  if (!obj) return null;
  if (asRecord(obj.lease)) {
    return normalizeSigningSessionRestoreLease(obj.lease);
  }
  if (Number(obj.v) !== 1) return null;
  if (hasRetiredAuthorizationIdentityField(obj)) return null;
  const leaseKey = normalizeOptionalNonEmptyString(obj.leaseKey);
  const ownerId = normalizeOptionalNonEmptyString(obj.ownerId);
  const attemptId = normalizeOptionalNonEmptyString(obj.attemptId);
  const startedAtMs = normalizeInteger(obj.startedAtMs);
  const expiresAtMs = normalizeInteger(obj.expiresAtMs);
  if (!leaseKey || !ownerId || !attemptId) return null;
  if (startedAtMs == null || startedAtMs <= 0) return null;
  if (expiresAtMs == null || expiresAtMs <= startedAtMs) return null;
  return {
    v: 1,
    leaseKey,
    ownerId,
    attemptId,
    startedAtMs,
    expiresAtMs,
  };
}

function makeSigningSessionRestoreLease(args: {
  leaseKey: string;
  ownerId: string;
  nowMs: number;
  ttlMs: number;
}): SigningSessionRestoreLease {
  return {
    v: 1,
    leaseKey: args.leaseKey,
    ownerId: args.ownerId,
    attemptId: createRandomId('restore-attempt'),
    startedAtMs: args.nowMs,
    expiresAtMs: args.nowMs + args.ttlMs,
  };
}

function recordMatchesFilter(
  record: SigningSessionSealedStoreRecord,
  thresholdSessionId: string,
  filter: SigningSessionSealedRecordFilter,
): boolean {
  if (record.authMethod !== filter.authMethod) return false;
  // Some Email OTP seals bind a single secret to both ECDSA and Ed25519 lane ids.
  // The requested curve is enforced by the thresholdSessionIds map below.
  if (record.thresholdSessionIds[filter.curve] !== thresholdSessionId) return false;
  if (
    filter.curve === 'ecdsa' &&
    (!record.ecdsaRestore?.chainTarget ||
      !thresholdEcdsaChainTargetsEqual(record.ecdsaRestore.chainTarget, filter.chainTarget))
  ) {
    return false;
  }
  return true;
}

function requireSealedRecordPurpose(
  filter: SigningSessionSealedRecordFilter | undefined,
  operation: string,
): SigningSessionSealedRecordFilter {
  if (filter?.authMethod && filter.curve === 'ed25519') return filter;
  if (filter?.authMethod && filter.curve === 'ecdsa' && filter.chainTarget) {
    return filter;
  }
  console.warn('[SigningSessionSealedStore] rejected ambiguous sealed record access', {
    operation,
  });
  throw new Error(
    `[SigningSessionSealedStore] ${operation} requires an explicit authMethod, curve, and ECDSA chain target`,
  );
}

async function collectRawSealedRecordEntriesByThresholdSessionId(
  thresholdSessionId: string,
): Promise<StoredRawSealedRecordEntry[]> {
  const entries =
    await signingSessionSealsRepository.collectRawSealedRecordEntriesByThresholdSessionId(
      thresholdSessionId,
    );
  if (entries.length) return entries;
  const allEntries = await signingSessionSealsRepository.collectAllRawSealedRecordEntries();
  return allEntries.filter((entry) => {
    const rawThresholdSessionIds = rawThresholdSessionIdsFromSealedStoreRow(entry.value);
    return (
      rawThresholdSessionIds.ed25519 === thresholdSessionId ||
      rawThresholdSessionIds.ecdsa === thresholdSessionId
    );
  });
}

async function readRecordByThresholdSessionId(
  thresholdSessionId: string,
  filter: SigningSessionSealedRecordFilter,
  operation: string,
): Promise<CurrentSealedSessionRecord | null> {
  const entries = await collectRawSealedRecordEntriesByThresholdSessionId(thresholdSessionId);

  let selected: CurrentSealedSessionRecord | null = null;
  const exactEd25519Matches: PersistedCurrentEd25519Record[] = [];
  const deletePrimaryKeys: unknown[] = [];
  for (const entry of entries) {
    const classification = await classifyPersistedSealedRecord(entry);
    if (classification.kind === 'current') {
      if (recordMatchesFilter(classification.record, thresholdSessionId, filter)) {
        selected = classification.record;
        if (classification.record.curve === 'ed25519') {
          exactEd25519Matches.push(persistedEd25519Record(entry, classification.record));
        }
      }
      continue;
    }
    setAsideRejectedSealedRecord(operation, classification, entry.primaryKey, deletePrimaryKeys);
    if (classification.kind === 'user_action_required') {
      await signingSessionSealsRepository.deleteSealedRecords(deletePrimaryKeys);
      throw new SealedSessionRecordUserActionRequiredError(classification);
    }
  }
  await signingSessionSealsRepository.deleteSealedRecords(deletePrimaryKeys);
  if (exactEd25519Matches.length > 0) {
    return await compactExactEd25519Records(exactEd25519Matches);
  }
  return selected;
}

async function deleteRecordByThresholdSessionId(
  thresholdSessionId: string,
  filter: SigningSessionSealedRecordFilter,
): Promise<void> {
  try {
    const entries = await collectRawSealedRecordEntriesByThresholdSessionId(thresholdSessionId);
    const deletePrimaryKeys: unknown[] = [];
    for (const entry of entries) {
      const classification = await classifyPersistedSealedRecord(entry);
      const record = classification.kind === 'current' ? classification.record : null;
      if (record?.storeKey && recordMatchesFilter(record, thresholdSessionId, filter)) {
        deletePrimaryKeys.push(entry.primaryKey);
      }
    }
    await signingSessionSealsRepository.deleteSealedRecords(deletePrimaryKeys);
  } catch {}
}

async function listSameScopeRecords(
  record: CurrentSealedSessionRecord,
): Promise<CurrentSealedSessionRecord[]> {
  if (!sealedRecordAccountKeys(record).size || !record.authMethod) return [];
  try {
    const all = await signingSessionSealsRepository.collectAllRawSealedRecordEntries();
    const records: CurrentSealedSessionRecord[] = [];
    for (const entry of all) {
      const classification = await classifyPersistedSealedRecord(entry);
      const existing = classification.kind === 'current' ? classification.record : null;
      if (!existing) continue;
      if (existing.storeKey === record.storeKey) continue;
      if (sealedRecordsHaveSamePurpose(existing, record)) {
        records.push(existing);
      }
    }
    return records;
  } catch {
    return [];
  }
}

function inactiveMaterialStoreKeyReplacedByCurrent(
  record: CurrentSealedSessionRecord,
): string | null {
  if (record.curve !== 'ecdsa') return null;
  const publicRestore = buildEcdsaInactiveMaterialPublicRestore(
    record.ecdsaRestore,
    record.relayerUrl,
  );
  if (!publicRestore) return null;
  return makeInactiveEcdsaMaterialStoreKey({
    walletId: record.walletId,
    authMethod: record.authMethod,
    restore: publicRestore,
  });
}

export async function readExactSealedSession(
  thresholdSessionIdRaw: string,
  filter: SigningSessionSealedRecordFilter,
): Promise<CurrentSealedSessionRecord | null> {
  const purpose = requireSealedRecordPurpose(filter, 'read');
  const thresholdSessionId = String(thresholdSessionIdRaw || '').trim();
  if (!thresholdSessionId) return null;
  return await readRecordByThresholdSessionId(thresholdSessionId, purpose, 'read');
}

function recordMatchesEd25519Locator(
  record: CurrentSealedSessionRecord,
  locator: Ed25519DurableMaterialLocator,
): record is CurrentEd25519SealedSessionRecord {
  return (
    record.curve === 'ed25519' &&
    record.authMethod === locator.authMethod &&
    mpcMaterialActivationRefsEqual(
      record.ed25519Restore.materialActivation,
      locator.materialActivation,
    )
  );
}

export async function readExactEd25519SealedSession(
  locator: Ed25519DurableMaterialLocator,
): Promise<CurrentEd25519SealedSessionRecord | null> {
  const entries = await signingSessionSealsRepository.collectAllRawSealedRecordEntries();
  const deletePrimaryKeys: unknown[] = [];
  const matches: PersistedCurrentEd25519Record[] = [];
  for (const entry of entries) {
    const classification = await classifyPersistedSealedRecord(entry);
    if (classification.kind === 'current') {
      const record = classification.record;
      if (recordMatchesEd25519Locator(record, locator)) {
        matches.push(persistedEd25519Record(entry, record));
      }
      continue;
    }
    setAsideRejectedSealedRecord(
      'read exact Ed25519 material',
      classification,
      entry.primaryKey,
      deletePrimaryKeys,
    );
    if (classification.kind === 'user_action_required') {
      await signingSessionSealsRepository.deleteSealedRecords(deletePrimaryKeys);
      throw new SealedSessionRecordUserActionRequiredError(classification);
    }
  }
  await signingSessionSealsRepository.deleteSealedRecords(deletePrimaryKeys);
  return await compactExactEd25519Records(matches);
}

export async function listExactSealedSessionsForWallet(args: {
  walletId: string;
  filter: SigningSessionSealedRecordFilter;
}): Promise<CurrentSealedSessionRecord[]> {
  const walletId = normalizeOptionalNonEmptyString(args.walletId);
  if (!walletId) return [];
  const purpose = requireSealedRecordPurpose(args.filter, 'list exact account records');
  const chainTarget = args.filter.curve === 'ecdsa' ? args.filter.chainTarget : undefined;
  const values = await signingSessionSealsRepository.collectAllRawSealedRecordEntries();
  const deletePrimaryKeys: unknown[] = [];
  try {
    const records: CurrentSealedSessionRecord[] = [];
    const seen = new Set<string>();
    const ed25519RecordsByCanonicalKey = new Map<string, PersistedCurrentEd25519Record[]>();
    for (const value of values) {
      const classification = await classifyPersistedSealedRecord(value);
      if (classification.kind !== 'current') {
        setAsideRejectedSealedRecord(
          'list exact account records',
          classification,
          value.primaryKey,
          deletePrimaryKeys,
        );
        if (classification.kind === 'user_action_required') {
          await signingSessionSealsRepository.deleteSealedRecords(deletePrimaryKeys);
          throw new SealedSessionRecordUserActionRequiredError(classification);
        }
        continue;
      }
      const record = classification.record;
      if (record.walletId !== walletId) continue;
      if (record.authMethod !== purpose.authMethod) continue;
      if (!record.thresholdSessionIds[purpose.curve]) continue;
      if (
        chainTarget &&
        (!record.ecdsaRestore?.chainTarget ||
          !thresholdEcdsaChainTargetsEqual(record.ecdsaRestore.chainTarget, chainTarget))
      ) {
        continue;
      }
      if (record.curve === 'ed25519') {
        const exactRecords = ed25519RecordsByCanonicalKey.get(record.storeKey) ?? [];
        exactRecords.push(persistedEd25519Record(value, record));
        ed25519RecordsByCanonicalKey.set(record.storeKey, exactRecords);
        continue;
      }
      if (seen.has(record.storeKey)) continue;
      seen.add(record.storeKey);
      records.push(record);
    }
    for (const exactRecords of ed25519RecordsByCanonicalKey.values()) {
      const compacted = await compactExactEd25519Records(exactRecords);
      if (compacted) records.push(compacted);
    }
    await signingSessionSealsRepository.deleteSealedRecords(deletePrimaryKeys);
    return records;
  } finally {
    await signingSessionSealsRepository.deleteSealedRecords(deletePrimaryKeys);
  }
}

export async function listEcdsaSealedSessionsForWallet(args: {
  walletId: string;
  filter: ListEcdsaSigningSessionSealedRecordsForWalletFilter;
}): Promise<EcdsaDurableLaneRecord[]> {
  const walletId = normalizeOptionalNonEmptyString(args.walletId);
  if (!walletId) return [];
  if (args.filter.curve !== 'ecdsa') {
    console.warn('[SigningSessionSealedStore] rejected non-ECDSA wallet-scoped list', {
      operation: 'list wallet ecdsa records',
    });
    return [];
  }
  const values = await signingSessionSealsRepository.collectAllRawSealedRecordEntries();
  const deletePrimaryKeys: unknown[] = [];
  try {
    const records: EcdsaDurableLaneRecord[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const classification = await classifyPersistedSealedRecord(value);
      if (classification.kind === 'ecdsa_inactive_material') {
        const record = classification.record;
        if (record.walletId !== walletId) continue;
        if (args.filter.authMethod && record.authMethod !== args.filter.authMethod) continue;
        if (seen.has(record.storeKey)) continue;
        seen.add(record.storeKey);
        records.push(record);
        continue;
      }
      if (classification.kind !== 'current') {
        setAsideRejectedSealedRecord(
          'list wallet ecdsa records',
          classification,
          value.primaryKey,
          deletePrimaryKeys,
        );
        if (classification.kind === 'user_action_required') {
          await signingSessionSealsRepository.deleteSealedRecords(deletePrimaryKeys);
          throw new SealedSessionRecordUserActionRequiredError(classification);
        }
        continue;
      }
      const record = classification.record;
      if (record.walletId !== walletId) continue;
      if (args.filter.authMethod && record.authMethod !== args.filter.authMethod) continue;
      if (!record.thresholdSessionIds.ecdsa) continue;
      if (!record.ecdsaRestore?.chainTarget) continue;
      if (seen.has(record.storeKey)) continue;
      seen.add(record.storeKey);
      records.push(record);
    }
    await signingSessionSealsRepository.deleteSealedRecords(deletePrimaryKeys);
    return records;
  } finally {
    await signingSessionSealsRepository.deleteSealedRecords(deletePrimaryKeys);
  }
}

export async function writeExactSealedSession(record: CurrentSealedSessionRecord): Promise<void> {
  const classification = classifyRawSealedSessionRecord(record);
  if (classification.kind !== 'current') {
    logSealedSessionClassification({
      operation: 'write exact sealed session',
      classification,
    });
    return;
  }
  const currentRecord = classification.record;

  if (currentRecord.curve === 'ed25519') {
    const matches: PersistedCurrentEd25519Record[] = [
      { primaryKey: currentRecord.storeKey, record: currentRecord },
    ];
    const entries = await signingSessionSealsRepository.collectAllRawSealedRecordEntries();
    for (const entry of entries) {
      const persisted = await classifyPersistedSealedRecord(entry);
      if (
        persisted.kind === 'current' &&
        persisted.record.curve === 'ed25519' &&
        persisted.record.storeKey === currentRecord.storeKey
      ) {
        matches.push(persistedEd25519Record(entry, persisted.record));
      }
    }
    await compactExactEd25519Records(matches, { writeCanonical: true });
    return;
  }

  const staleRecords = await listSameScopeRecords(currentRecord);
  const replacedInactiveMaterialStoreKey = inactiveMaterialStoreKeyReplacedByCurrent(currentRecord);
  await signingSessionSealsRepository.replaceSealedRecord({
    row: sealedRecordStorageRow(currentRecord),
    staleStoreKeys: [
      ...staleRecords.map((record) => record.storeKey),
      ...(replacedInactiveMaterialStoreKey ? [replacedInactiveMaterialStoreKey] : []),
    ],
  });
}

function retireEcdsaSealedSession(
  record: CurrentEcdsaSealedSessionRecord,
  retirement: 'expired' | 'exhausted',
  updatedAtMs: number,
): Promise<void> {
  return writeInactiveEcdsaSealedMaterial({
    current: record,
    inactive: requireInactiveEcdsaSealedMaterial({ record, retirement, updatedAtMs }),
  });
}

async function writeInactiveEcdsaSealedMaterial(args: {
  current: CurrentEcdsaSealedSessionRecord;
  inactive: EcdsaInactiveSealedMaterialRecord;
}): Promise<void> {
  await signingSessionSealsRepository.replaceSealedRecordAndDeleteRestoreLease({
    row: inactiveEcdsaMaterialStorageRow(args.inactive),
    staleStoreKeys: [args.current.storeKey],
    restoreLeaseKey: args.current.storeKey,
  });
}

export async function updateExactSealedSessionPolicy(
  args: UpdateExactSealedSessionPolicyInput,
): Promise<void> {
  const purpose = requireSealedRecordPurpose(args.filter, 'update policy');
  const thresholdSessionId = String(args.thresholdSessionId || '').trim();
  if (!thresholdSessionId) return;
  const existing = await readExactSealedSession(thresholdSessionId, purpose);
  if (!existing) return;
  await writeUpdatedSealedSessionPolicy(existing, args);
}

export async function updateExactEd25519SealedSessionPolicy(args: {
  locator: Ed25519DurableMaterialLocator;
  expiresAtMs: number;
  remainingUses: number;
  updatedAtMs: number;
}): Promise<void> {
  const existing = await readExactEd25519SealedSession(args.locator);
  if (!existing) return;
  await writeUpdatedSealedSessionPolicy(existing, args);
}

async function writeUpdatedSealedSessionPolicy(
  existing: CurrentSealedSessionRecord,
  args: {
    expiresAtMs?: number;
    remainingUses?: number;
    updatedAtMs: number;
  },
): Promise<void> {
  const expiresAtMs = normalizeInteger(args.expiresAtMs ?? existing.expiresAtMs);
  const remainingUses = normalizeInteger(args.remainingUses ?? existing.remainingUses);
  const updatedAtMs = normalizeInteger(args.updatedAtMs);
  if (expiresAtMs == null || expiresAtMs <= 0) return;
  if (remainingUses == null || remainingUses < 0) return;
  if (updatedAtMs == null || updatedAtMs <= 0) return;
  const updatedRecord: CurrentSealedSessionRecord = {
    ...existing,
    expiresAtMs,
    remainingUses,
    updatedAtMs,
  };
  if (updatedRecord.curve === 'ecdsa') {
    const retirement =
      expiresAtMs <= Date.now() ? 'expired' : remainingUses === 0 ? 'exhausted' : null;
    if (retirement) {
      await retireEcdsaSealedSession(updatedRecord, retirement, updatedAtMs);
      return;
    }
  }
  await writeExactSealedSession(updatedRecord);
}

async function deleteExactSealedSession(
  thresholdSessionIdRaw: string,
  filter: SigningSessionSealedRecordFilter,
  options: DeleteExactSealedSessionOptions,
): Promise<void> {
  const purpose = requireSealedRecordPurpose(filter, 'delete');
  const thresholdSessionId = String(thresholdSessionIdRaw || '').trim();
  if (!thresholdSessionId) return;
  const record = await readRecordByThresholdSessionId(thresholdSessionId, purpose, 'delete');
  await deleteRecordByThresholdSessionId(thresholdSessionId, purpose);
  if (record && options.deleteResolvedIdentity) {
    await signingSessionSealsRepository.deleteRestoreLease(record.storeKey);
  }
}

async function deleteExactEd25519SealedSession(
  locator: Ed25519DurableMaterialLocator,
  options: DeleteExactSealedSessionOptions,
): Promise<void> {
  const entries = await signingSessionSealsRepository.collectAllRawSealedRecordEntries();
  const deletePrimaryKeys: unknown[] = [];
  const restoreLeaseKeys: string[] = [];
  for (const entry of entries) {
    const classification = await classifyPersistedSealedRecord(entry);
    if (classification.kind !== 'current') {
      logSealedSessionClassification({
        operation: 'delete exact Ed25519 material',
        classification,
      });
      continue;
    }
    const record = classification.record;
    if (!recordMatchesEd25519Locator(record, locator)) {
      continue;
    }
    deletePrimaryKeys.push(entry.primaryKey);
    if (options.deleteResolvedIdentity) restoreLeaseKeys.push(record.storeKey);
  }
  await signingSessionSealsRepository.deleteSealedRecords(deletePrimaryKeys);
  if (options.deleteResolvedIdentity) {
    for (const leaseKey of restoreLeaseKeys) {
      await signingSessionSealsRepository.deleteRestoreLease(leaseKey);
    }
  }
}

export async function deleteDurableSealedSessionRecord(
  command: DeleteDurableSealedSessionCommand,
): Promise<void> {
  const options: DeleteExactSealedSessionOptions = command.preserveResolvedIdentity
    ? { deleteResolvedIdentity: false }
    : { deleteResolvedIdentity: true, resolvedIdentityDeleteReason: 'durable_record_deleted' };
  if (command.durableRecord.curve === 'ed25519') {
    await deleteExactEd25519SealedSession(
      {
        kind: 'ed25519_durable_material',
        authMethod: command.durableRecord.authMethod,
        materialActivation: command.durableRecord.materialActivation,
      },
      options,
    );
    return;
  }
  const filter = exactSealedSessionFilterForIdentity(command.durableRecord);
  const existingRecord = await readExactSealedSessionOrNull(
    command.durableRecord.thresholdSessionId,
    filter,
  );
  if (
    command.preserveResolvedIdentity &&
    command.durableRecord.curve === 'ecdsa' &&
    existingRecord?.curve === 'ecdsa' &&
    (command.deleteReason === 'expired' || command.deleteReason === 'exhausted')
  ) {
    await retireEcdsaSealedSession(existingRecord, command.deleteReason, Date.now());
    return;
  }
  await deleteExactSealedSession(command.durableRecord.thresholdSessionId, filter, options);
}

async function readExactSealedSessionOrNull(
  thresholdSessionId: string,
  filter: SigningSessionSealedRecordFilter,
): Promise<CurrentSealedSessionRecord | null> {
  try {
    return await readExactSealedSession(thresholdSessionId, filter);
  } catch {
    return null;
  }
}

export async function acquireSigningSessionRestoreLease(
  args: {
    thresholdSessionId: string;
    ownerId?: string;
    nowMs?: number;
    ttlMs?: number;
  } & SigningSessionSealedRecordFilter,
): Promise<SigningSessionRestoreLeaseHandle | null> {
  const purpose = requireSealedRecordPurpose(args, 'acquire restore lease');
  const thresholdSessionId = String(args.thresholdSessionId || '').trim();
  if (!thresholdSessionId) return null;
  const nowMs = normalizeInteger(args.nowMs ?? Date.now()) ?? Date.now();
  const ttlMs = Math.max(
    1,
    normalizeInteger(args.ttlMs ?? DEFAULT_RESTORE_LEASE_TTL_MS) ?? DEFAULT_RESTORE_LEASE_TTL_MS,
  );
  const ownerId = normalizeOptionalNonEmptyString(args.ownerId) || createRandomId('restore-owner');
  const currentRecord = await readRecordByThresholdSessionId(
    thresholdSessionId,
    purpose,
    'acquire restore lease',
  );
  if (!currentRecord) return null;
  return await signingSessionSealsRepository.withRestoreLeaseTransaction(
    thresholdSessionId,
    async (tx) => {
      const records: SigningSessionSealedStoreRecord[] = [];
      for (const entry of tx.entries) {
        const normalized = normalizeSigningSessionSealedStoreRecord(entry.value);
        if (
          normalized?.storeKey &&
          !records.some((record) => record.storeKey === normalized.storeKey)
        ) {
          records.push(normalized);
        }
      }
      const record =
        records.find((candidate) => recordMatchesFilter(candidate, thresholdSessionId, purpose)) ||
        null;
      if (!record) {
        tx.abort();
        return null;
      }

      const existing = normalizeSigningSessionRestoreLease(
        await tx.getRawRestoreLease(record.storeKey),
      );
      if (existing && existing.expiresAtMs > nowMs && existing.ownerId !== ownerId) {
        tx.abort();
        return null;
      }

      const lease = makeSigningSessionRestoreLease({
        leaseKey: record.storeKey,
        ownerId,
        nowMs,
        ttlMs,
      });
      tx.putRestoreLease(restoreLeaseStorageRow(lease));
      return {
        ...lease,
        thresholdSessionId,
      };
    },
  );
}

export async function releaseSigningSessionRestoreLease(
  lease: SigningSessionRestoreLeaseHandle | null | undefined,
): Promise<void> {
  if (!lease?.leaseKey || !lease.ownerId || !lease.attemptId) return;
  await signingSessionSealsRepository.deleteRestoreLeaseIf({
    leaseKey: lease.leaseKey,
    shouldDelete: (rawLease) => {
      const existing = normalizeSigningSessionRestoreLease(rawLease);
      return existing?.ownerId === lease.ownerId && existing.attemptId === lease.attemptId;
    },
  });
}
