import { buildWalletRecoveryCodeSet, type WalletRecoveryCodeSet } from '@shared/wallet-recovery';
import { SEAMS_WALLET_STORES } from '../schemaNames';
import { seamsWalletDB } from '../singletons';

const RECORD_VERSION = 1 as const;
const RECORD_ID = 'wallet_recovery_codes_v1' as const;
const AES_GCM_IV_BYTES = 12;

type PendingWalletRecoveryCodeBackupRow = {
  readonly record_version: typeof RECORD_VERSION;
  readonly wallet_id: string;
  readonly enrollment_id: typeof RECORD_ID;
  readonly recovery_codes_issued_at_ms: number;
  readonly status: 'pending';
  readonly key: CryptoKey;
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
};

export type PendingWalletRecoveryCodeBackup = {
  readonly walletId: string;
  readonly issuedAtMs: number;
  readonly recoveryCodes: WalletRecoveryCodeSet;
};

type PendingWalletRecoveryCodeBackupRawRow = {
  readonly record_version: unknown;
  readonly wallet_id: unknown;
  readonly enrollment_id: unknown;
  readonly recovery_codes_issued_at_ms: unknown;
  readonly status: unknown;
  readonly key: unknown;
  readonly iv: unknown;
  readonly ciphertext: unknown;
};

const PENDING_WALLET_RECOVERY_CODE_BACKUP_FIELDS = [
  'record_version',
  'wallet_id',
  'enrollment_id',
  'recovery_codes_issued_at_ms',
  'status',
  'key',
  'iv',
  'ciphertext',
] as const;

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

function decodePendingWalletRecoveryCodeBackupRawRow(
  value: unknown,
): PendingWalletRecoveryCodeBackupRawRow | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = new Map<string, unknown>(Object.entries(value));
  const expected = new Set<string>(PENDING_WALLET_RECOVERY_CODE_BACKUP_FIELDS);
  if (fields.size !== expected.size || [...fields.keys()].some((field) => !expected.has(field))) {
    return null;
  }
  return {
    record_version: fields.get('record_version'),
    wallet_id: fields.get('wallet_id'),
    enrollment_id: fields.get('enrollment_id'),
    recovery_codes_issued_at_ms: fields.get('recovery_codes_issued_at_ms'),
    status: fields.get('status'),
    key: fields.get('key'),
    iv: fields.get('iv'),
    ciphertext: fields.get('ciphertext'),
  };
}

function parseRow(value: unknown, walletId: string): PendingWalletRecoveryCodeBackupRow | null {
  const raw = decodePendingWalletRecoveryCodeBackupRawRow(value);
  if (!raw) return null;
  const issuedAtMs = Number(raw.recovery_codes_issued_at_ms);
  if (
    raw.record_version !== RECORD_VERSION ||
    raw.wallet_id !== walletId ||
    raw.enrollment_id !== RECORD_ID ||
    raw.status !== 'pending' ||
    !Number.isSafeInteger(issuedAtMs) ||
    issuedAtMs <= 0 ||
    !isNonExtractableAesGcmKey(raw.key) ||
    !(raw.iv instanceof Uint8Array) ||
    raw.iv.byteLength !== AES_GCM_IV_BYTES ||
    !(raw.ciphertext instanceof Uint8Array) ||
    raw.ciphertext.byteLength === 0
  ) {
    return null;
  }
  return {
    record_version: RECORD_VERSION,
    wallet_id: walletId,
    enrollment_id: RECORD_ID,
    recovery_codes_issued_at_ms: issuedAtMs,
    status: 'pending',
    key: raw.key,
    iv: raw.iv,
    ciphertext: raw.ciphertext,
  };
}

function additionalData(walletId: string, issuedAtMs: number): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ kind: RECORD_ID, walletId, issuedAtMs }));
}

function storageKey(walletId: string): [string, typeof RECORD_ID] {
  return [walletId, RECORD_ID];
}

export class PendingWalletRecoveryCodeBackupRepository {
  async write(input: {
    readonly walletId: string;
    readonly recoveryCodes: readonly string[];
    readonly issuedAtMs?: number;
  }): Promise<void> {
    const walletId = input.walletId.trim();
    if (!walletId) throw new Error('Pending recovery-code backup requires a wallet');
    const recoveryCodes = buildWalletRecoveryCodeSet(input.recoveryCodes.map(String));
    const issuedAtMs = input.issuedAtMs ?? Date.now();
    if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs <= 0) {
      throw new Error('Pending recovery-code backup issue time is invalid');
    }
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
    const aad = additionalData(walletId, issuedAtMs);
    const plaintext = new TextEncoder().encode(JSON.stringify(recoveryCodes));
    let ciphertext: Uint8Array | null = null;
    try {
      ciphertext = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plaintext),
      );
      await seamsWalletDB.runTransaction(
        [SEAMS_WALLET_STORES.pendingWalletRecoveryCodeBackups],
        'readwrite',
        async (ctx) => {
          await ctx.store(SEAMS_WALLET_STORES.pendingWalletRecoveryCodeBackups).put({
            record_version: RECORD_VERSION,
            wallet_id: walletId,
            enrollment_id: RECORD_ID,
            recovery_codes_issued_at_ms: issuedAtMs,
            status: 'pending',
            key,
            iv,
            ciphertext,
          });
        },
      );
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
    const aad = additionalData(walletId, row.recovery_codes_issued_at_ms);
    let plaintext: Uint8Array | null = null;
    try {
      plaintext = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: row.iv, additionalData: aad },
          row.key,
          row.ciphertext,
        ),
      );
      const decoded: unknown = JSON.parse(new TextDecoder().decode(plaintext));
      if (!Array.isArray(decoded)) throw new Error('Pending recovery-code backup is invalid');
      return {
        walletId,
        issuedAtMs: row.recovery_codes_issued_at_ms,
        recoveryCodes: buildWalletRecoveryCodeSet(decoded.map(String)),
      };
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

  async delete(walletIdInput: string): Promise<void> {
    const walletId = walletIdInput.trim();
    if (!walletId) return;
    await seamsWalletDB.runTransaction(
      [SEAMS_WALLET_STORES.pendingWalletRecoveryCodeBackups],
      'readwrite',
      async (ctx) => {
        await ctx
          .store(SEAMS_WALLET_STORES.pendingWalletRecoveryCodeBackups)
          .delete(storageKey(walletId));
      },
    );
  }
}

export const pendingWalletRecoveryCodeBackupRepository =
  new PendingWalletRecoveryCodeBackupRepository();
