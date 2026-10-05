import { parseStoredNonEmptyString } from '../normalization';
import { toTrimmedString } from '@shared/utils/validation';
import type {
  NonceLaneLeaseStoreRecord,
  NonceLaneLeaseStoreRecordState,
} from '../passkeyClientDB.types';
import type { ThresholdEcdsaChainTarget } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { thresholdEcdsaChainTargetFromRequest } from '@/core/signingEngine/interfaces/ecdsaChainTarget';

type NonceLaneLeaseRow = {
  lease_id: string;
  lane_key: string;
  wallet_id: string;
  near_account_id?: string;
  state: NonceLaneLeaseStoreRecordState;
  expires_at_ms: number;
  record: NonceLaneLeaseStoreRecord;
};

export type NonceLaneLockRow = {
  lock_key: string;
  owner_id: string;
  fencing_token: string;
  acquired_at_ms: number;
  expires_at_ms: number;
  updated_at_ms: number;
};

function nonceLeaseWalletId(record: NonceLaneLeaseStoreRecord): string {
  if (record.family === 'near') return record.walletId;
  return record.accountId;
}

function nonceLeaseNearAccountId(record: NonceLaneLeaseStoreRecord): string {
  return record.family === 'near' ? record.nearAccountId : '';
}

export function nonceLeaseRow(record: NonceLaneLeaseStoreRecord): NonceLaneLeaseRow {
  const leaseId = toTrimmedString(record.leaseId || '');
  const laneKey = toTrimmedString(record.laneKey || '');
  const walletId = toTrimmedString(nonceLeaseWalletId(record) || '');
  const nearAccountId = toTrimmedString(nonceLeaseNearAccountId(record) || '');
  if (!leaseId || !laneKey || !walletId) {
    throw new Error('[SeamsWalletDB] nonce lease requires leaseId, laneKey, and wallet identity');
  }
  return {
    lease_id: leaseId,
    lane_key: laneKey,
    wallet_id: walletId,
    ...(nearAccountId ? { near_account_id: nearAccountId } : {}),
    state: record.state,
    expires_at_ms: Math.floor(Number(record.expiresAtMs)),
    record,
  };
}

export function parseNonceLaneLockRow(value: unknown): NonceLaneLockRow | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const lockKey = parseStoredNonEmptyString(Reflect.get(value, 'lock_key'));
  const ownerId = parseStoredNonEmptyString(Reflect.get(value, 'owner_id'));
  const fencingToken = parseStoredNonEmptyString(Reflect.get(value, 'fencing_token'));
  const acquiredAtMs = Reflect.get(value, 'acquired_at_ms');
  const expiresAtMs = Reflect.get(value, 'expires_at_ms');
  const updatedAtMs = Reflect.get(value, 'updated_at_ms');
  if (
    !lockKey ||
    !ownerId ||
    !fencingToken ||
    !Number.isSafeInteger(acquiredAtMs) ||
    acquiredAtMs < 0 ||
    !Number.isSafeInteger(expiresAtMs) ||
    expiresAtMs < 0 ||
    !Number.isSafeInteger(updatedAtMs) ||
    updatedAtMs < 0
  ) {
    return null;
  }
  return {
    lock_key: lockKey,
    owner_id: ownerId,
    fencing_token: fencingToken,
    acquired_at_ms: acquiredAtMs,
    expires_at_ms: expiresAtMs,
    updated_at_ms: updatedAtMs,
  };
}

function parseStoredThresholdEcdsaChainTarget(value: unknown): ThresholdEcdsaChainTarget | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    return thresholdEcdsaChainTargetFromRequest({
      kind: Reflect.get(value, 'kind'),
      namespace: Reflect.get(value, 'namespace'),
      chainId: Reflect.get(value, 'chainId'),
      networkSlug: Reflect.get(value, 'networkSlug'),
    });
  } catch {
    return null;
  }
}

function parseNonceLeaseRecord(value: unknown): NonceLaneLeaseStoreRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const version = Reflect.get(value, 'v');
  const leaseId = parseStoredNonEmptyString(Reflect.get(value, 'leaseId'));
  const laneKey = parseStoredNonEmptyString(Reflect.get(value, 'laneKey'));
  const networkKey = parseStoredNonEmptyString(Reflect.get(value, 'networkKey'));
  const nonce = parseStoredNonEmptyString(Reflect.get(value, 'nonce'));
  const operationId = parseStoredNonEmptyString(Reflect.get(value, 'operationId'));
  const operationFingerprint = parseStoredNonEmptyString(
    Reflect.get(value, 'operationFingerprint'),
  );
  const reservedAtMs = Reflect.get(value, 'reservedAtMs');
  const expiresAtMs = Reflect.get(value, 'expiresAtMs');
  const updatedAtMs = Reflect.get(value, 'updatedAtMs');
  const state = Reflect.get(value, 'state');
  if (
    version !== 1 ||
    !leaseId ||
    !laneKey ||
    !networkKey ||
    !nonce ||
    !operationId ||
    !operationFingerprint ||
    !Number.isSafeInteger(reservedAtMs) ||
    !Number.isSafeInteger(expiresAtMs) ||
    !Number.isSafeInteger(updatedAtMs) ||
    (state !== 'reserved' && state !== 'signed' && state !== 'broadcast_accepted')
  ) {
    return null;
  }

  const txHash = Reflect.get(value, 'txHash');
  if (state === 'broadcast_accepted' && !parseStoredNonEmptyString(txHash)) return null;
  if (state !== 'broadcast_accepted' && txHash !== undefined) return null;

  const runtimeId = Reflect.get(value, 'runtimeId');
  const fencingToken = Reflect.get(value, 'fencingToken');
  const batchId = Reflect.get(value, 'batchId');
  const txIndex = Reflect.get(value, 'txIndex');
  if (
    (runtimeId !== undefined && !parseStoredNonEmptyString(runtimeId)) ||
    (fencingToken !== undefined && !parseStoredNonEmptyString(fencingToken)) ||
    (batchId !== undefined && !parseStoredNonEmptyString(batchId)) ||
    (txIndex !== undefined && !Number.isSafeInteger(txIndex))
  ) {
    return null;
  }

  const family = Reflect.get(value, 'family');
  if (family === 'near') {
    const walletId = parseStoredNonEmptyString(Reflect.get(value, 'walletId'));
    const nearAccountId = parseStoredNonEmptyString(Reflect.get(value, 'nearAccountId'));
    const publicKey = parseStoredNonEmptyString(Reflect.get(value, 'publicKey'));
    if (!walletId || !nearAccountId || !publicKey) return null;
    const record: NonceLaneLeaseStoreRecord = {
      v: 1,
      leaseId,
      laneKey,
      networkKey,
      nonce,
      operationId,
      operationFingerprint,
      reservedAtMs,
      expiresAtMs,
      updatedAtMs,
      family: 'near',
      walletId,
      nearAccountId,
      publicKey,
      state,
      ...(runtimeId === undefined ? {} : { runtimeId }),
      ...(fencingToken === undefined ? {} : { fencingToken }),
      ...(batchId === undefined ? {} : { batchId }),
      ...(txIndex === undefined ? {} : { txIndex }),
      ...(state === 'broadcast_accepted' ? { txHash } : {}),
    };
    return record;
  }
  if (family !== 'evm') return null;
  const chainTarget = parseStoredThresholdEcdsaChainTarget(Reflect.get(value, 'chainTarget'));
  const sender = parseStoredNonEmptyString(Reflect.get(value, 'sender'));
  const accountId = parseStoredNonEmptyString(Reflect.get(value, 'accountId'));
  if (!chainTarget || !sender || !accountId) return null;
  const nonceKey = Reflect.get(value, 'nonceKey');
  if (nonceKey !== undefined && !parseStoredNonEmptyString(nonceKey)) return null;
  const record: NonceLaneLeaseStoreRecord = {
    v: 1,
    leaseId,
    laneKey,
    networkKey,
    nonce,
    operationId,
    operationFingerprint,
    reservedAtMs,
    expiresAtMs,
    updatedAtMs,
    family: 'evm',
    chainTarget,
    sender,
    accountId,
    state,
    ...(runtimeId === undefined ? {} : { runtimeId }),
    ...(fencingToken === undefined ? {} : { fencingToken }),
    ...(batchId === undefined ? {} : { batchId }),
    ...(txIndex === undefined ? {} : { txIndex }),
    ...(nonceKey === undefined ? {} : { nonceKey }),
    ...(state === 'broadcast_accepted' ? { txHash } : {}),
  };
  return record;
}

export function parseNonceLeaseRow(value: unknown): NonceLaneLeaseStoreRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = parseNonceLeaseRecord(Reflect.get(value, 'record'));
  if (!record) return null;
  if (Reflect.get(value, 'lease_id') !== record.leaseId) return null;
  if (Reflect.get(value, 'lane_key') !== record.laneKey) return null;
  if (Reflect.get(value, 'wallet_id') !== nonceLeaseWalletId(record)) return null;
  if ((Reflect.get(value, 'near_account_id') || '') !== nonceLeaseNearAccountId(record)) {
    return null;
  }
  if (Reflect.get(value, 'state') !== record.state) return null;
  if (Reflect.get(value, 'expires_at_ms') !== Math.floor(Number(record.expiresAtMs))) return null;
  return record;
}
