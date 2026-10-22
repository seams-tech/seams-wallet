import { buildWalletRecoveryCodeSet, type WalletRecoveryCodeSet } from '@shared/wallet-recovery';
import { secureRandomId } from '@shared/utils/secureRandomId';
import { SEAMS_WALLET_STORES } from '../schemaNames';
import { seamsWalletDB } from '../singletons';
import type { SeamsWalletTransactionContext } from './manager';

const RECORD_VERSION = 2 as const;
const LEGACY_RECORD_VERSION = 1 as const;
const RECORD_ID = 'wallet_recovery_codes_v1' as const;
const AES_GCM_IV_BYTES = 12;

type PendingWalletRecoveryCodeBackupRow = {
  readonly aadIssuedAtMs: number;
  readonly key: CryptoKey;
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
} & (
  | {
      readonly kind: 'legacy_unbound';
      readonly pendingBackupId?: never;
      readonly issuedAtMs?: never;
    }
  | {
      readonly kind: 'awaiting_commit';
      readonly pendingBackupId: string;
      readonly issuedAtMs?: never;
    }
  | { readonly kind: 'ready'; readonly pendingBackupId: string; readonly issuedAtMs: number }
);

type PendingWalletRecoveryCodeBackupStoredRow = {
  readonly record_version: typeof RECORD_VERSION;
  readonly wallet_id: string;
  readonly enrollment_id: typeof RECORD_ID;
  readonly aad_issued_at_ms: number;
  readonly pending_backup_id: string;
  readonly key: CryptoKey;
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
} & (
  | { readonly status: 'awaiting_commit'; readonly recovery_codes_issued_at_ms?: never }
  | { readonly status: 'ready'; readonly recovery_codes_issued_at_ms: number }
);

type PendingWalletRecoveryCodeBackup =
  | {
      readonly kind: 'awaiting_commit';
      readonly walletId: string;
      readonly recoveryCodes: WalletRecoveryCodeSet;
      readonly issuedAtMs?: never;
    }
  | {
      readonly kind: 'ready';
      readonly walletId: string;
      readonly recoveryCodes: WalletRecoveryCodeSet;
      readonly issuedAtMs: number;
    };

export type PendingWalletRecoveryBackupRef = {
  readonly walletId: string;
  readonly pendingBackupId: string;
};

const LEGACY_FIELDS = [
  'record_version',
  'wallet_id',
  'enrollment_id',
  'recovery_codes_issued_at_ms',
  'status',
  'key',
  'iv',
  'ciphertext',
] as const;

const AWAITING_COMMIT_FIELDS = [
  'record_version',
  'wallet_id',
  'enrollment_id',
  'aad_issued_at_ms',
  'pending_backup_id',
  'status',
  'key',
  'iv',
  'ciphertext',
] as const;

const READY_FIELDS = [...AWAITING_COMMIT_FIELDS, 'recovery_codes_issued_at_ms'] as const;

function isNonExtractableAesGcmKey(value: unknown): value is CryptoKey {
  return (
    typeof CryptoKey !== 'undefined' &&
    value instanceof CryptoKey &&
    value.type === 'secret' &&
    !value.extractable &&
    value.algorithm.name === 'AES-GCM' &&
    value.usages.includes('encrypt') &&
    value.usages.includes('decrypt')
  );
}

function hasExactFields(fields: Map<string, unknown>, expected: readonly string[]): boolean {
  if (fields.size !== expected.length) return false;
  for (const field of expected) {
    if (!fields.has(field)) return false;
  }
  return true;
}

function parseRow(value: unknown, walletId: string): PendingWalletRecoveryCodeBackupRow | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = new Map<string, unknown>(Object.entries(value));
  const isLegacy =
    fields.get('record_version') === LEGACY_RECORD_VERSION &&
    fields.get('status') === 'pending' &&
    hasExactFields(fields, LEGACY_FIELDS);
  const isAwaitingCommit =
    fields.get('record_version') === RECORD_VERSION &&
    fields.get('status') === 'awaiting_commit' &&
    hasExactFields(fields, AWAITING_COMMIT_FIELDS);
  const isReady =
    fields.get('record_version') === RECORD_VERSION &&
    fields.get('status') === 'ready' &&
    hasExactFields(fields, READY_FIELDS);
  if (!isLegacy && !isAwaitingCommit && !isReady) return null;

  const rawAadIssuedAtMs = fields.get(
    isLegacy ? 'recovery_codes_issued_at_ms' : 'aad_issued_at_ms',
  );
  const aadIssuedAtMs = isLegacy ? Number(rawAadIssuedAtMs) : rawAadIssuedAtMs;
  const key = fields.get('key');
  const iv = fields.get('iv');
  const ciphertext = fields.get('ciphertext');
  if (
    fields.get('wallet_id') !== walletId ||
    fields.get('enrollment_id') !== RECORD_ID ||
    typeof aadIssuedAtMs !== 'number' ||
    !Number.isSafeInteger(aadIssuedAtMs) ||
    aadIssuedAtMs <= 0 ||
    !isNonExtractableAesGcmKey(key) ||
    !(iv instanceof Uint8Array) ||
    iv.byteLength !== AES_GCM_IV_BYTES ||
    !(ciphertext instanceof Uint8Array) ||
    ciphertext.byteLength === 0
  ) {
    return null;
  }
  if (isLegacy) {
    return { kind: 'legacy_unbound', aadIssuedAtMs, key, iv, ciphertext };
  }
  const pendingBackupId = fields.get('pending_backup_id');
  if (typeof pendingBackupId !== 'string' || !pendingBackupId.trim()) return null;
  if (isReady) {
    const issuedAtMs = fields.get('recovery_codes_issued_at_ms');
    if (!Number.isSafeInteger(issuedAtMs) || typeof issuedAtMs !== 'number' || issuedAtMs <= 0) {
      return null;
    }
    return { kind: 'ready', aadIssuedAtMs, pendingBackupId, issuedAtMs, key, iv, ciphertext };
  }
  return {
    kind: 'awaiting_commit',
    aadIssuedAtMs,
    pendingBackupId,
    key,
    iv,
    ciphertext,
  };
}

function additionalData(walletId: string, issuedAtMs: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify({ kind: RECORD_ID, walletId, issuedAtMs }));
}

function storageKey(walletId: string): [string, typeof RECORD_ID] {
  return [walletId, RECORD_ID];
}

async function persistRow(
  row: PendingWalletRecoveryCodeBackupStoredRow,
  ctx: SeamsWalletTransactionContext,
): Promise<void> {
  await ctx.store(SEAMS_WALLET_STORES.pendingWalletRecoveryCodeBackups).put(row);
}

async function bindRowIssuedAtMs(
  ref: PendingWalletRecoveryBackupRef,
  serverIssuedAtMs: number,
  ctx: SeamsWalletTransactionContext,
): Promise<void> {
  const store = ctx.store(SEAMS_WALLET_STORES.pendingWalletRecoveryCodeBackups);
  const row = parseRow(await store.get(storageKey(ref.walletId)), ref.walletId);
  if (row?.kind !== 'awaiting_commit' || row.pendingBackupId !== ref.pendingBackupId) {
    throw new Error('Pending recovery-code backup reference does not match an unbound backup');
  }
  const boundRow: PendingWalletRecoveryCodeBackupStoredRow = {
    record_version: RECORD_VERSION,
    wallet_id: ref.walletId,
    enrollment_id: RECORD_ID,
    aad_issued_at_ms: row.aadIssuedAtMs,
    pending_backup_id: row.pendingBackupId,
    recovery_codes_issued_at_ms: serverIssuedAtMs,
    status: 'ready',
    key: row.key,
    iv: row.iv,
    ciphertext: row.ciphertext,
  };
  await store.put(boundRow);
}

async function deleteRowIssuedAtMs(
  walletId: string,
  issuedAtMs: number,
  ctx: SeamsWalletTransactionContext,
): Promise<void> {
  const store = ctx.store(SEAMS_WALLET_STORES.pendingWalletRecoveryCodeBackups);
  const row = parseRow(await store.get(storageKey(walletId)), walletId);
  if (row?.kind === 'ready' && row.issuedAtMs === issuedAtMs) {
    await store.delete(storageKey(walletId));
  }
}

class PendingWalletRecoveryCodeBackupRepository {
  async write(input: {
    readonly walletId: string;
    readonly recoveryCodes: readonly string[];
  }): Promise<PendingWalletRecoveryBackupRef> {
    const walletId = input.walletId.trim();
    if (!walletId) throw new Error('Pending recovery-code backup requires a wallet');
    const recoveryCodes = buildWalletRecoveryCodeSet(input.recoveryCodes.map(String));
    const pendingBackupId = secureRandomId(
      'pending-recovery-backup',
      32,
      'pending recovery-code backup references',
    );
    const aadIssuedAtMs = Date.now();
    if (!Number.isSafeInteger(aadIssuedAtMs) || aadIssuedAtMs <= 0) {
      throw new Error('Pending recovery-code backup encryption time is invalid');
    }
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
    const aad = additionalData(walletId, aadIssuedAtMs);
    const plaintext = new TextEncoder().encode(JSON.stringify(recoveryCodes));
    let ciphertext: Uint8Array | null = null;
    try {
      const encryptedCodes = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plaintext),
      );
      ciphertext = encryptedCodes;
      const row: PendingWalletRecoveryCodeBackupStoredRow = {
        record_version: RECORD_VERSION,
        wallet_id: walletId,
        enrollment_id: RECORD_ID,
        aad_issued_at_ms: aadIssuedAtMs,
        pending_backup_id: pendingBackupId,
        status: 'awaiting_commit',
        key,
        iv,
        ciphertext: encryptedCodes,
      };
      await seamsWalletDB.runTransaction(
        [SEAMS_WALLET_STORES.pendingWalletRecoveryCodeBackups],
        'readwrite',
        persistRow.bind(null, row),
      );
      return { walletId, pendingBackupId };
    } finally {
      aad.fill(0);
      plaintext.fill(0);
      ciphertext?.fill(0);
    }
  }

  async read(walletIdInput: string): Promise<PendingWalletRecoveryCodeBackup | null> {
    const walletId = walletIdInput.trim();
    if (!walletId) return null;
    const db = await seamsWalletDB.getDB();
    const row = parseRow(
      await db.get(SEAMS_WALLET_STORES.pendingWalletRecoveryCodeBackups, storageKey(walletId)),
      walletId,
    );
    if (!row) return null;
    const aad = additionalData(walletId, row.aadIssuedAtMs);
    let plaintext: Uint8Array | null = null;
    try {
      plaintext = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: row.iv.slice(), additionalData: aad },
          row.key,
          row.ciphertext.slice(),
        ),
      );
      const decoded: unknown = JSON.parse(new TextDecoder().decode(plaintext));
      if (!Array.isArray(decoded)) throw new Error('Pending recovery-code backup is invalid');
      const recoveryCodes = buildWalletRecoveryCodeSet(decoded.map(String));
      if (row.kind === 'ready') {
        return { kind: 'ready', walletId, recoveryCodes, issuedAtMs: row.issuedAtMs };
      }
      return { kind: 'awaiting_commit', walletId, recoveryCodes };
    } finally {
      aad.fill(0);
      plaintext?.fill(0);
    }
  }

  async has(walletId: string): Promise<boolean> {
    const normalized = walletId.trim();
    if (!normalized) return false;
    const db = await seamsWalletDB.getDB();
    return (
      parseRow(
        await db.get(SEAMS_WALLET_STORES.pendingWalletRecoveryCodeBackups, storageKey(normalized)),
        normalized,
      ) !== null
    );
  }

  async bindIssuedAtMs(
    ref: PendingWalletRecoveryBackupRef,
    serverIssuedAtMs: number,
  ): Promise<void> {
    if (
      !ref.walletId ||
      ref.walletId !== ref.walletId.trim() ||
      !ref.pendingBackupId ||
      ref.pendingBackupId !== ref.pendingBackupId.trim() ||
      !Number.isSafeInteger(serverIssuedAtMs) ||
      serverIssuedAtMs <= 0
    ) {
      throw new Error('Pending recovery-code backup identity is invalid');
    }
    await seamsWalletDB.runTransaction(
      [SEAMS_WALLET_STORES.pendingWalletRecoveryCodeBackups],
      'readwrite',
      bindRowIssuedAtMs.bind(null, ref, serverIssuedAtMs),
    );
  }

  async deleteIssuedAtMs(walletIdInput: string, issuedAtMs: number): Promise<void> {
    const walletId = walletIdInput.trim();
    if (!walletId || !Number.isSafeInteger(issuedAtMs) || issuedAtMs <= 0) {
      throw new Error('Pending recovery-code backup identity is invalid');
    }
    await seamsWalletDB.runTransaction(
      [SEAMS_WALLET_STORES.pendingWalletRecoveryCodeBackups],
      'readwrite',
      deleteRowIssuedAtMs.bind(null, walletId, issuedAtMs),
    );
  }
}

export const pendingWalletRecoveryCodeBackupRepository =
  new PendingWalletRecoveryCodeBackupRepository();
