import { parseUnixMs } from '@shared/passkey-custody/primitives';
import { prepareD1TenantStatement, type D1TenantScope } from '../../../../core/d1TenantStore';
import { D1_BATCH_CAS_GUARD_SQL } from '../../../../storage/d1Sql';
import type { D1DatabaseLike } from '../../../../storage/tenantRoute';
import { WalletRelocationSessionSource } from './d1WalletRelocationSessions';

// The admitted coordinator calls this after session retirement and settlement.
// It freezes authorization records, not other wallet stores or shared authority.
export class D1WalletAuthorizationFreeze {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: D1TenantScope,
  ) {}

  async freeze(source: WalletRelocationSessionSource, nowMs: number): Promise<number> {
    parseUnixMs(nowMs, 'authorization freeze time');
    const existing = await this.read(source);
    if (existing !== null) return existing;
    const identity = [
      source.walletId,
      source.moveId,
      source.requestDigestHex,
      source.sourceGeneration,
    ];
    await this.database.batch([
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        INSERT INTO wallet_relocation_authorization_fences
          (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation, frozen_at_ms)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
        WHERE NOT EXISTS (
          SELECT 1 FROM wallet_relocation_authorization_fences
          WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4 AND wallet_id = ?5
        )`,
        [...identity, nowMs],
      ),
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        UPDATE wallet_relocation_authorization_fences SET frozen_at_ms = frozen_at_ms
        WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
          AND wallet_id = ?5 AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8`,
        identity,
      ),
      this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
    ]);
    const frozenAtMs = await this.read(source);
    if (frozenAtMs === null) throw new Error('Authorization freeze disappeared');
    return frozenAtMs;
  }

  private async read(source: WalletRelocationSessionSource): Promise<number | null> {
    const row = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      SELECT wallet_id, move_id, request_digest_hex, source_generation, frozen_at_ms
      FROM wallet_relocation_authorization_fences
      WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4 AND wallet_id = ?5`,
      [source.walletId],
    ).first<Record<string, unknown>>();
    if (!row) return null;
    if (!source.matches(row)) throw new Error('Authorization freeze identity conflicts');
    return parseUnixMs(row.frozen_at_ms, 'stored authorization freeze time');
  }
}
