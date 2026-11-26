import { toTrimmedString } from '@shared/utils/validation';
import { sanitizePayload } from '../keyMaterialEnvelope';
import type { SignerOperationStatus, SignerOpOutboxRecord } from '../passkeyClientDB.types';
import {
  parseStoredNonEmptyString,
  signerChainTargetKey,
  normalizeIndexedDbAccountAddress,
  normalizeIndexedDbChainIdKey,
} from '../normalization';

type SignerOpsOutboxRow = {
  op_id: string;
  idempotency_key: string;
  status: SignerOperationStatus;
  next_attempt_at: number;
  wallet_id: string;
  chain_target_key: string;
  updated_at: number;
  record: SignerOpOutboxRecord;
};

export function signerOutboxRow(record: SignerOpOutboxRecord): SignerOpsOutboxRow {
  const opId = toTrimmedString(record.opId || '');
  const idempotencyKey = toTrimmedString(record.idempotencyKey || '');
  const chainIdKey = normalizeIndexedDbChainIdKey(record.chainIdKey);
  const accountAddress = normalizeIndexedDbAccountAddress(record.accountAddress);
  const signerId = toTrimmedString(record.signerId || '');
  if (!opId || !idempotencyKey || !chainIdKey || !accountAddress || !signerId) {
    throw new Error(
      '[SeamsWalletDB] signer op requires opId, idempotencyKey, chainIdKey, accountAddress, and signerId',
    );
  }
  return {
    op_id: opId,
    idempotency_key: idempotencyKey,
    status: record.status,
    next_attempt_at: record.nextAttemptAt,
    wallet_id: toTrimmedString(String(record.payload?.profileId || '')),
    chain_target_key: signerChainTargetKey({ chainIdKey, accountAddress }),
    updated_at: record.updatedAt,
    record: {
      ...record,
      opId,
      idempotencyKey,
      chainIdKey,
      accountAddress,
      signerId,
    },
  };
}

function parseStoredSignerOutboxRecord(value: unknown): SignerOpOutboxRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const opId = parseStoredNonEmptyString(Reflect.get(value, 'opId'));
  const idempotencyKey = parseStoredNonEmptyString(Reflect.get(value, 'idempotencyKey'));
  const opType = parseStoredNonEmptyString(Reflect.get(value, 'opType'));
  const chainIdKey = normalizeIndexedDbChainIdKey(Reflect.get(value, 'chainIdKey'));
  const accountAddress = normalizeIndexedDbAccountAddress(Reflect.get(value, 'accountAddress'));
  const signerId = parseStoredNonEmptyString(Reflect.get(value, 'signerId'));
  const status = Reflect.get(value, 'status');
  const attemptCount = Reflect.get(value, 'attemptCount');
  const nextAttemptAt = Reflect.get(value, 'nextAttemptAt');
  const createdAt = Reflect.get(value, 'createdAt');
  const updatedAt = Reflect.get(value, 'updatedAt');
  if (
    !opId ||
    !idempotencyKey ||
    !opType ||
    !chainIdKey ||
    !accountAddress ||
    !signerId ||
    (status !== 'queued' &&
      status !== 'submitted' &&
      status !== 'confirmed' &&
      status !== 'failed' &&
      status !== 'dead-letter') ||
    !Number.isSafeInteger(attemptCount) ||
    Number(attemptCount) < 0 ||
    !Number.isSafeInteger(nextAttemptAt) ||
    Number(nextAttemptAt) < 0 ||
    !Number.isSafeInteger(createdAt) ||
    Number(createdAt) < 0 ||
    !Number.isSafeInteger(updatedAt) ||
    Number(updatedAt) < 0
  ) {
    return null;
  }
  const payloadRaw = Reflect.get(value, 'payload');
  const payload = sanitizePayload(payloadRaw);
  if (
    payloadRaw !== undefined &&
    (payloadRaw === null || typeof payloadRaw !== 'object' || Array.isArray(payloadRaw))
  ) {
    return null;
  }
  const lastError = Reflect.get(value, 'lastError');
  const txHash = Reflect.get(value, 'txHash');
  if (
    (lastError !== undefined && typeof lastError !== 'string') ||
    (txHash !== undefined && typeof txHash !== 'string')
  ) {
    return null;
  }
  return {
    opId,
    idempotencyKey,
    opType,
    chainIdKey,
    accountAddress,
    signerId,
    status,
    attemptCount: Number(attemptCount),
    nextAttemptAt: Number(nextAttemptAt),
    createdAt: Number(createdAt),
    updatedAt: Number(updatedAt),
    ...(payload === undefined ? {} : { payload }),
    ...(lastError === undefined ? {} : { lastError }),
    ...(txHash === undefined ? {} : { txHash }),
  };
}

export function parseSignerOutboxRow(value: unknown): SignerOpOutboxRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = parseStoredSignerOutboxRecord(Reflect.get(value, 'record'));
  if (!record) return null;
  if (Reflect.get(value, 'op_id') !== record.opId) return null;
  if (Reflect.get(value, 'idempotency_key') !== record.idempotencyKey) return null;
  if (Reflect.get(value, 'status') !== record.status) return null;
  if (Reflect.get(value, 'next_attempt_at') !== record.nextAttemptAt) return null;
  if (
    Reflect.get(value, 'chain_target_key') !==
    signerChainTargetKey({ chainIdKey: record.chainIdKey, accountAddress: record.accountAddress })
  ) {
    return null;
  }
  const payloadProfileId = toTrimmedString(
    String(
      record.payload && Reflect.get(record.payload, 'profileId')
        ? Reflect.get(record.payload, 'profileId')
        : '',
    ),
  );
  if (Reflect.get(value, 'wallet_id') !== payloadProfileId) return null;
  if (Reflect.get(value, 'updated_at') !== record.updatedAt) return null;
  return record;
}
