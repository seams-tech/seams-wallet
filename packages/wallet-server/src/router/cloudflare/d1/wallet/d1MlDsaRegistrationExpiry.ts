import type { WalletId } from '@shared/utils/domainIds';
import { prepareD1TenantStatement, type D1TenantScope } from '../../../../core/d1TenantStore';
import type { D1DatabaseLike } from '../../../../storage/tenantRoute';

// An admitted record has never dispatched encrypted inputs to the participants.
// Keep every dispatched operation reserved, including uncertain outcomes.
export async function expireUnusedMlDsaAdmissions(
  database: D1DatabaseLike,
  scope: D1TenantScope,
  walletId: WalletId,
  nowMs: number,
): Promise<void> {
  const expired = `namespace=?1 AND org_id=?2 AND project_id=?3 AND env_id=?4
    AND substr(record_key,1,20)='ml-dsa-registration:'
    AND json_extract(record_json,'$.preparation.identity.walletId')=?5
    AND json_extract(record_json,'$.phase.kind')='admitted'
    AND json_extract(record_json,'$.expiresAtMs')<=?6`;
  await database.batch([
    prepareD1TenantStatement(
      database,
      scope,
      `UPDATE wallet_ceremony_activity SET settled=1
      WHERE namespace=?1 AND org_id=?2 AND project_id=?3 AND env_id=?4 AND wallet_id=?5
        AND record_key IN (SELECT record_key FROM router_ab_yao_versioned_json_records WHERE ${expired})`,
      [walletId, nowMs],
    ),
    prepareD1TenantStatement(
      database,
      scope,
      `UPDATE router_ab_yao_versioned_json_records SET version=version+1,
          record_json=json_set(record_json,'$.phase.kind','expired_admission') WHERE ${expired}`,
      [walletId, nowMs],
    ),
  ]);
}

export async function assertMlDsaRelocationSupported(
  database: D1DatabaseLike,
  scope: D1TenantScope,
  walletId: WalletId,
): Promise<void> {
  const row = await prepareD1TenantStatement(
    database,
    scope,
    `SELECT 1 FROM router_ab_yao_versioned_json_records
      WHERE namespace=?1 AND org_id=?2 AND project_id=?3 AND env_id=?4
        AND substr(record_key,1,20)='ml-dsa-registration:'
        AND json_extract(record_json,'$.preparation.identity.walletId')=?5
        AND json_extract(record_json,'$.phase.kind') NOT IN ('admitted','expired_admission') LIMIT 1`,
    [walletId],
  ).first();
  if (row !== null) throw new Error('ML-DSA participant relocation is not supported');
}
