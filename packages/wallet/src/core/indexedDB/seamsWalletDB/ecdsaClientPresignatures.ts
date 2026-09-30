// Durable ECDSA client presignatures: the sealed row, its parsing and sealing, and pool cleanup.
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { mpcMaterialActivationRefsEqual } from '@shared/utils/domainIds';
import {
  canonicalRouterAbMpcMaterialActivationRefBytes,
  routerAbMpcMaterialActivationRefToWire,
} from '@shared/utils/routerAbNormalSigningIdentity';
import {
  parseEcdsaCiphertextB64u,
  parseEcdsaCiphertextDigest,
  parseEcdsaIv12B64u,
  parseEcdsaMaterialSealingKeyId,
  type EcdsaMaterialSealingKeyId,
} from '@shared/utils/ecdsaCapabilityActivation';
import { sha256Bytes } from '@shared/utils/digests';
import { routerAbEcdsaDerivationNormalSigningScopeCanonicalBytesV1 } from '@shared/utils/routerAbEcdsaDerivation';
import {
  parseEcdsaClientVerifyingPublicKey33B64u,
  parseEcdsaRoleLocalPersistedMaterialRef,
  type EcdsaRoleLocalPersistedMaterialRef,
} from '@/core/signingEngine/session/keyMaterialBrands';
import type { ValidatedEncryptedEcdsaReadyMaterial } from '@/core/signingEngine/session/material/ecdsaCapabilityManifest';
import { requireRecord } from '@shared/utils/validation';
import { SEAMS_WALLET_INDEXES } from '../schemaNames';
import type { SeamsWalletTransactionContext } from './manager';
import {
  ecdsaClientPresignPoolKey,
  parseEcdsaClientPresignPoolIdentity,
  type EcdsaClientPresignPoolIdentity,
} from '@/core/signingEngine/workerManager/ecdsaPresignPoolIdentity';
import {
  MAX_DURABLE_CLIENT_PRESIGNATURE_LIFETIME_MS,
  type EcdsaClientPresignUnavailableReason,
} from '@/core/signingEngine/workerManager/ecdsaPresignLifecycle';
import {
  PRESIGNATURE_STORE,
  AES_GCM_IV_BYTES,
  requireExactKeys,
  additionalData,
} from './ecdsaCapabilityManifestRecords';
const CLIENT_PRESIGNATURE_AAD_DOMAIN = 'seams/ecdsa-client-presignature/v1' as const;
const MAX_EXPIRED_CLIENT_PRESIGNATURE_DELETIONS_PER_TRANSACTION = 32;
export const MAX_DURABLE_CLIENT_PRESIGNATURE_FUTURE_SKEW_MS = 5 * 60_000;

type DurableClientPresignatureRecordId = string & {
  readonly __brand: 'DurableClientPresignatureRecordId';
};

export type DurableClientPresignatureMetadata = {
  readonly kind: 'sealed_available_client_presignature_v1';
  readonly recordId: DurableClientPresignatureRecordId;
  readonly poolIdentity: EcdsaClientPresignPoolIdentity;
  readonly durableMaterialRef: EcdsaRoleLocalPersistedMaterialRef;
  readonly presignatureId: string;
  readonly groupPublicKey33B64u: string;
  readonly bigR33B64u: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly sealingKeyId: EcdsaMaterialSealingKeyId;
};

export type DurableClientPresignatureAdmissionResult =
  | {
      readonly kind: 'stored';
      readonly metadata: DurableClientPresignatureMetadata;
    }
  | {
      readonly kind: 'capacity_full';
    }
  | {
      readonly kind: 'persistence_unavailable';
    }
  | {
      readonly kind: 'persistence_ambiguous';
    };

export type DurableClientPresignatureAdmissionInput = {
  readonly poolIdentity: EcdsaClientPresignPoolIdentity;
  readonly durableMaterialRef: EcdsaRoleLocalPersistedMaterialRef;
  readonly presignatureId: string;
  readonly groupPublicKey33: Uint8Array;
  readonly bigR33: Uint8Array;
  readonly plaintext97: Uint8Array;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
};

export type DurableClientPresignatureTakeResult =
  | {
      readonly kind: 'opened';
      readonly metadata: DurableClientPresignatureMetadata;
      readonly plaintext97: Uint8Array;
    }
  | {
      readonly kind: Exclude<EcdsaClientPresignUnavailableReason, 'not_found'>;
    };

export type SealedAvailableClientPresignatureRow = {
  readonly kind: 'sealed_available_client_presignature_v1';
  readonly record_id: DurableClientPresignatureRecordId;
  readonly pool_identity: EcdsaClientPresignPoolIdentity;
  readonly pool_identity_key: string;
  readonly wallet_id: string;
  readonly material_activation_id: string;
  readonly durable_material_ref: EcdsaRoleLocalPersistedMaterialRef;
  readonly presignature_id: string;
  readonly group_public_key33_b64u: string;
  readonly big_r33_b64u: string;
  readonly created_at_ms: number;
  readonly expires_at_ms: number;
  readonly sealed: {
    readonly kind: 'ecdsa_activation_aes_gcm_v1';
    readonly sealing_key_id: EcdsaMaterialSealingKeyId;
    readonly iv12_b64u: string;
    readonly ciphertext_b64u: string;
    readonly ciphertext_digest_b64u: string;
  };
};

// Whether the active material is the one both the pool and the presignature's ref name.
export function activeMaterialMatchesPresignature(
  material: ValidatedEncryptedEcdsaReadyMaterial,
  poolIdentity: EcdsaClientPresignPoolIdentity,
  materialRef: EcdsaRoleLocalPersistedMaterialRef,
): boolean {
  const normalSigning = material.binding.routerAbEcdsaDerivationNormalSigning;
  const scope = normalSigning.scope;
  const materialActivation = routerAbMpcMaterialActivationRefToWire(
    material.binding.materialActivation,
  );
  return (
    scope.wallet_id === poolIdentity.walletId &&
    base64UrlEncode(routerAbEcdsaDerivationNormalSigningScopeCanonicalBytesV1(scope)) ===
      poolIdentity.signingScopeB64u &&
    base64UrlEncode(canonicalRouterAbMpcMaterialActivationRefBytes(materialActivation)) ===
      poolIdentity.materialActivationB64u &&
    scope.signing_worker.key_epoch === poolIdentity.keyEpoch &&
    scope.activation_epoch === poolIdentity.activationEpoch &&
    materialActivation.activation_id === poolIdentity.materialActivationId &&
    materialActivation.capability === poolIdentity.capability &&
    materialActivation.key_binding === poolIdentity.keyBinding &&
    materialActivation.material_owner === poolIdentity.walletId &&
    material.binding.durableMaterialRef === materialRef.durableMaterialRef &&
    material.binding.bindingDigest === materialRef.bindingDigest &&
    mpcMaterialActivationRefsEqual(
      material.binding.materialActivation,
      materialRef.materialActivation,
    )
  );
}

export function materialRefMatchesPoolIdentity(
  materialRef: EcdsaRoleLocalPersistedMaterialRef,
  poolIdentity: EcdsaClientPresignPoolIdentity,
): boolean {
  return (
    materialRef.materialActivation.activationId === poolIdentity.materialActivationId &&
    materialRef.materialActivation.capability === poolIdentity.capability &&
    materialRef.materialActivation.keyBinding === poolIdentity.keyBinding &&
    materialRef.materialActivation.materialOwner === poolIdentity.walletId
  );
}

export function parseDurableClientPresignatureRecordId(
  value: unknown,
): DurableClientPresignatureRecordId {
  if (typeof value !== 'string' || !/^ecdsa-client-presignature-[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('ECDSA durable presignature record id is invalid');
  }
  return value as DurableClientPresignatureRecordId;
}

export function parsePresignatureTimestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function rawRecordId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('record_id' in value)) return null;
  const recordId = value.record_id;
  return typeof recordId === 'string' ? recordId : null;
}

export function supportsStrictIndexedDbDurability(): boolean {
  return typeof IDBTransaction !== 'undefined' && 'durability' in IDBTransaction.prototype;
}

type DeletableCursor = {
  delete(): Promise<void>;
  continue(): Promise<DeletableCursor | null>;
};

export async function deleteCursorRows(
  cursor: DeletableCursor | null,
  limit = Number.POSITIVE_INFINITY,
): Promise<number> {
  let deletedCount = 0;
  while (cursor && deletedCount < limit) {
    await cursor.delete();
    deletedCount += 1;
    cursor = await cursor.continue();
  }
  return deletedCount;
}

async function deleteExpiredClientPresignatureRows(
  context: SeamsWalletTransactionContext,
  walletId: string,
  nowMs: number,
): Promise<number> {
  const expiryIndex = context
    .store(PRESIGNATURE_STORE)
    .index(SEAMS_WALLET_INDEXES.walletExpiresAt);
  return await deleteCursorRows(
    await expiryIndex.openCursor(IDBKeyRange.bound([walletId, 0], [walletId, nowMs])),
    MAX_EXPIRED_CLIENT_PRESIGNATURE_DELETIONS_PER_TRANSACTION,
  );
}

// Deletes the pool's expired and malformed rows, and returns the rows still available.
export async function readAvailableClientPresignatureRows(
  context: SeamsWalletTransactionContext,
  poolIdentity: EcdsaClientPresignPoolIdentity,
  nowMs: number,
): Promise<SealedAvailableClientPresignatureRow[]> {
  await deleteExpiredClientPresignatureRows(context, poolIdentity.walletId, nowMs);
  const store = context.store(PRESIGNATURE_STORE);
  const rows = await store
    .index(SEAMS_WALLET_INDEXES.poolIdentityKey)
    .getAll(ecdsaClientPresignPoolKey(poolIdentity));
  const available: SealedAvailableClientPresignatureRow[] = [];
  for (const raw of rows) {
    try {
      const row = parseSealedAvailableClientPresignatureRow(raw);
      if (row.expires_at_ms <= nowMs) {
        await store.delete(row.record_id);
      } else {
        available.push(row);
      }
    } catch {
      const malformedRecordId = rawRecordId(raw);
      if (malformedRecordId) await store.delete(malformedRecordId);
    }
  }
  return available;
}

function presignatureAadProjection(metadata: DurableClientPresignatureMetadata): unknown {
  return {
    domain: CLIENT_PRESIGNATURE_AAD_DOMAIN,
    version: 1,
    pool_identity: metadata.poolIdentity,
    durable_material_ref: metadata.durableMaterialRef,
    presignature_id: metadata.presignatureId,
    group_public_key33_b64u: metadata.groupPublicKey33B64u,
    big_r33_b64u: metadata.bigR33B64u,
    created_at_ms: metadata.createdAtMs,
    expires_at_ms: metadata.expiresAtMs,
    sealing_key_id: metadata.sealingKeyId,
  };
}

export function parseSealedAvailableClientPresignatureRow(
  value: unknown,
): SealedAvailableClientPresignatureRow {
  const record = requireRecord(value, 'ECDSA durable presignature row');
  requireExactKeys(record, 'ECDSA durable presignature row', [
    'kind',
    'record_id',
    'pool_identity',
    'pool_identity_key',
    'wallet_id',
    'material_activation_id',
    'durable_material_ref',
    'presignature_id',
    'group_public_key33_b64u',
    'big_r33_b64u',
    'created_at_ms',
    'expires_at_ms',
    'sealed',
  ]);
  if (record.kind !== 'sealed_available_client_presignature_v1') {
    throw new Error('ECDSA durable presignature row kind is invalid');
  }
  const poolIdentityRecord = requireRecord(
    record.pool_identity,
    'ECDSA durable presignature pool identity',
  );
  requireExactKeys(poolIdentityRecord, 'ECDSA durable presignature pool identity', [
    'activationEpoch',
    'capability',
    'keyBinding',
    'keyEpoch',
    'materialActivationB64u',
    'materialActivationId',
    'pairRole',
    'protocolId',
    'relayerUrl',
    'signingScopeB64u',
    'walletId',
  ]);
  const poolIdentity = parseEcdsaClientPresignPoolIdentity(poolIdentityRecord);
  const recordId = parseDurableClientPresignatureRecordId(record.record_id);
  const poolIdentityKeyValue = String(record.pool_identity_key ?? '');
  if (poolIdentityKeyValue !== ecdsaClientPresignPoolKey(poolIdentity)) {
    throw new Error('ECDSA durable presignature pool identity index is inconsistent');
  }
  const walletId = String(record.wallet_id ?? '').trim();
  const materialActivationId = String(record.material_activation_id ?? '').trim();
  if (!walletId || walletId !== poolIdentity.walletId) {
    throw new Error('ECDSA durable presignature wallet binding is inconsistent');
  }
  if (!materialActivationId || materialActivationId !== poolIdentity.materialActivationId) {
    throw new Error('ECDSA durable presignature activation binding is inconsistent');
  }
  const durableMaterialRef = parseEcdsaRoleLocalPersistedMaterialRef(record.durable_material_ref);
  if (!materialRefMatchesPoolIdentity(durableMaterialRef, poolIdentity)) {
    throw new Error('ECDSA durable presignature material binding is inconsistent');
  }
  const presignatureId = String(record.presignature_id ?? '').trim();
  if (!presignatureId) throw new Error('ECDSA durable presignature id is invalid');
  const groupPublicKey33B64u = parseEcdsaClientVerifyingPublicKey33B64u(
    record.group_public_key33_b64u,
  );
  const bigR33B64u = parseEcdsaClientVerifyingPublicKey33B64u(record.big_r33_b64u);
  const createdAtMs = parsePresignatureTimestamp(record.created_at_ms, 'created_at_ms');
  const expiresAtMs = parsePresignatureTimestamp(record.expires_at_ms, 'expires_at_ms');
  if (createdAtMs > Date.now() + MAX_DURABLE_CLIENT_PRESIGNATURE_FUTURE_SKEW_MS) {
    throw new Error('ECDSA durable presignature creation timestamp is in the future');
  }
  if (expiresAtMs <= createdAtMs) {
    throw new Error('ECDSA durable presignature expiry must follow creation');
  }
  if (expiresAtMs - createdAtMs > MAX_DURABLE_CLIENT_PRESIGNATURE_LIFETIME_MS) {
    throw new Error('ECDSA durable presignature lifetime exceeds the maximum');
  }
  const sealed = requireRecord(record.sealed, 'ECDSA durable presignature sealed payload');
  requireExactKeys(sealed, 'ECDSA durable presignature sealed payload', [
    'kind',
    'sealing_key_id',
    'iv12_b64u',
    'ciphertext_b64u',
    'ciphertext_digest_b64u',
  ]);
  if (sealed.kind !== 'ecdsa_activation_aes_gcm_v1') {
    throw new Error('ECDSA durable presignature sealing kind is invalid');
  }
  return {
    kind: 'sealed_available_client_presignature_v1',
    record_id: recordId,
    pool_identity: poolIdentity,
    pool_identity_key: poolIdentityKeyValue,
    wallet_id: walletId,
    material_activation_id: materialActivationId,
    durable_material_ref: durableMaterialRef,
    presignature_id: presignatureId,
    group_public_key33_b64u: groupPublicKey33B64u,
    big_r33_b64u: bigR33B64u,
    created_at_ms: createdAtMs,
    expires_at_ms: expiresAtMs,
    sealed: {
      kind: 'ecdsa_activation_aes_gcm_v1',
      sealing_key_id: parseEcdsaMaterialSealingKeyId(sealed.sealing_key_id),
      iv12_b64u: parseEcdsaIv12B64u(sealed.iv12_b64u),
      ciphertext_b64u: parseEcdsaCiphertextB64u(sealed.ciphertext_b64u),
      ciphertext_digest_b64u: parseEcdsaCiphertextDigest(sealed.ciphertext_digest_b64u),
    },
  };
}

export function metadataFromPresignatureRow(
  row: SealedAvailableClientPresignatureRow,
): DurableClientPresignatureMetadata {
  return {
    kind: 'sealed_available_client_presignature_v1',
    recordId: row.record_id,
    poolIdentity: row.pool_identity,
    durableMaterialRef: row.durable_material_ref,
    presignatureId: row.presignature_id,
    groupPublicKey33B64u: row.group_public_key33_b64u,
    bigR33B64u: row.big_r33_b64u,
    createdAtMs: row.created_at_ms,
    expiresAtMs: row.expires_at_ms,
    sealingKeyId: row.sealed.sealing_key_id,
  };
}

export async function encryptPresignatureBytes(input: {
  readonly key: CryptoKey;
  readonly plaintext97: Uint8Array;
  readonly metadata: DurableClientPresignatureMetadata;
}): Promise<{
  readonly iv12B64u: ReturnType<typeof parseEcdsaIv12B64u>;
  readonly ciphertextB64u: ReturnType<typeof parseEcdsaCiphertextB64u>;
  readonly ciphertextDigestB64u: ReturnType<typeof parseEcdsaCiphertextDigest>;
}> {
  const iv12 = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const aad = additionalData(presignatureAadProjection(input.metadata));
  try {
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv12, additionalData: aad },
        input.key,
        input.plaintext97,
      ),
    );
    try {
      const ciphertextB64u = base64UrlEncode(ciphertext);
      return {
        iv12B64u: parseEcdsaIv12B64u(base64UrlEncode(iv12)),
        ciphertextB64u: parseEcdsaCiphertextB64u(ciphertextB64u),
        ciphertextDigestB64u: parseEcdsaCiphertextDigest(
          base64UrlEncode(await sha256Bytes(ciphertext)),
        ),
      };
    } finally {
      ciphertext.fill(0);
    }
  } finally {
    iv12.fill(0);
    aad.fill(0);
    input.plaintext97.fill(0);
  }
}

export async function decryptPresignatureBytes(input: {
  readonly key: CryptoKey;
  readonly metadata: DurableClientPresignatureMetadata;
  readonly sealed: SealedAvailableClientPresignatureRow['sealed'];
}): Promise<Uint8Array> {
  const iv12 = base64UrlDecode(input.sealed.iv12_b64u);
  const ciphertext = base64UrlDecode(input.sealed.ciphertext_b64u);
  const aad = additionalData(presignatureAadProjection(input.metadata));
  let plaintext: Uint8Array | null = null;
  try {
    const digest = base64UrlEncode(await sha256Bytes(ciphertext));
    if (digest !== input.sealed.ciphertext_digest_b64u) {
      throw new Error('ECDSA durable presignature ciphertext digest mismatch');
    }
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv12, additionalData: aad },
        input.key,
        ciphertext,
      ),
    );
    if (plaintext.length !== 97) {
      throw new Error('ECDSA durable presignature plaintext length is invalid');
    }
    return plaintext.slice();
  } finally {
    iv12.fill(0);
    ciphertext.fill(0);
    aad.fill(0);
    plaintext?.fill(0);
  }
}

export async function retireClientPresignaturesForActivationInTransaction(
  context: SeamsWalletTransactionContext,
  walletId: string,
  materialActivationId: string,
): Promise<void> {
  const store = context.store(PRESIGNATURE_STORE);
  const rows = await store
    .index(SEAMS_WALLET_INDEXES.walletMaterialActivationId)
    .getAll([walletId, materialActivationId]);
  for (const raw of rows) {
    const recordId = rawRecordId(raw);
    if (recordId) await store.delete(recordId);
  }
}
