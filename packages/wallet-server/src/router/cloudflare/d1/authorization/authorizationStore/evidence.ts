import {
  readWalletOperationEvidence,
  prepareWalletOperationEvidence,
} from '../walletOperationPersistence';
import { D1_BATCH_CAS_GUARD_SQL } from '../../../../../storage/d1Sql';
import type {
  VerifiedAuthorizationEvidenceSet,
  VerifiedOwnerProof,
} from '../../../../../authorization/domain';
import { d1ChangedRows } from '../../../../../storage/d1Sql';
import type { D1PreparedStatementLike } from '../../../../../storage/tenantRoute';
import { requirePositiveInteger } from './rowValues';
import type { D1AuthorizationContext } from './context';

export function readRecordedWalletOperationEvidence(
  context: D1AuthorizationContext,
  input: import('../../../../../authorization/service').WalletOperationEvidenceLookup,
) {
  return readWalletOperationEvidence(context.database, context.walletSignerScope, input);
}

export async function putVerifiedEvidenceSet(
  context: D1AuthorizationContext,
  evidenceSet: VerifiedAuthorizationEvidenceSet,
): Promise<void> {
  await prepareWalletOperationEvidence(
    context.database,
    context.walletSignerScope,
    evidenceSet,
  ).run();
}

export async function commitWalletOperationEvidence(
  context: D1AuthorizationContext,
  input: {
    readonly evidenceSet: VerifiedAuthorizationEvidenceSet;
    readonly consumeInBatch: readonly D1PreparedStatementLike[];
  },
): Promise<void> {
  await context.database.batch([
    ...input.consumeInBatch,
    prepareWalletOperationEvidence(context.database, context.walletSignerScope, input.evidenceSet),
    context.database.prepare(D1_BATCH_CAS_GUARD_SQL),
  ]);
}

export async function consumeVerifiedOwnerProof(
  context: D1AuthorizationContext,
  proof: VerifiedOwnerProof,
  consumedAtMs: number,
  consumptionScopeId: string,
): Promise<boolean> {
  const consumedAt = requirePositiveInteger(consumedAtMs, 'owner proof consumedAtMs');
  const scopeId = consumptionScopeId.trim();
  if (!scopeId) throw new Error('owner proof consumption scope is required');
  if (proof.verifiedAtMs > consumedAt || proof.expiresAtMs <= consumedAt) {
    throw new Error('owner proof is outside its verification window');
  }
  const result = await context.database
    .prepare(
      `INSERT OR IGNORE INTO verified_owner_proof_consumptions (
          namespace,
          tenant_id,
          proof_id,
          purpose,
          method,
          principal_id,
          wallet_id,
          authority_digest,
          replay_identity,
          consumption_scope_id,
          consumed_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      context.namespace,
      proof.tenantId,
      proof.proofId,
      proof.purpose,
      proof.method,
      proof.principalId,
      proof.walletId,
      proof.authority.authorityDigest,
      proof.replayIdentity,
      scopeId,
      consumedAt,
    )
    .run();
  if (d1ChangedRows(result) === 1) return true;
  const existing = await context.database
    .prepare(
      `SELECT
           purpose,
           method,
           principal_id,
           wallet_id,
           authority_digest,
           replay_identity,
           consumption_scope_id
           FROM verified_owner_proof_consumptions
          WHERE namespace = ?
            AND tenant_id = ?
            AND proof_id = ?
            AND replay_identity = ?`,
    )
    .bind(context.namespace, proof.tenantId, proof.proofId, proof.replayIdentity)
    .first<{
      purpose: string;
      method: string;
      principal_id: string;
      wallet_id: string;
      authority_digest: string;
      replay_identity: string;
      consumption_scope_id: string;
    }>();
  return (
    existing?.purpose === proof.purpose &&
    existing.method === proof.method &&
    existing.principal_id === proof.principalId &&
    existing.wallet_id === proof.walletId &&
    existing.authority_digest === proof.authority.authorityDigest &&
    existing.replay_identity === proof.replayIdentity &&
    existing.consumption_scope_id === scopeId
  );
}
