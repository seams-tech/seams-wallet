import { prepareD1TenantStatement, type D1TenantScope } from '../../../../core/d1TenantStore';
import { D1_BATCH_CAS_GUARD_SQL } from '../../../../storage/d1Sql';
import type { D1DatabaseLike } from '../../../../storage/tenantRoute';
import { parseUnixMs } from '@shared/passkey-custody/primitives';
import { D1WalletCeremonyActivity } from '../ed25519Yao/d1WalletCeremonyActivity';
import { D1WalletAuthorizationFreeze } from './d1WalletAuthorizationFreeze';
import { D1WalletAuthorizationSnapshot } from './d1WalletAuthorizationSnapshot';
import {
  D1WalletRelocationSessions,
  WalletRelocationSessionSource,
} from './d1WalletRelocationSessions';

const SCOPE =
  'namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4 AND wallet_id = ?5';
type BlockState = 'draining' | 'checked' | 'released' | 'frozen';

// Console owns the admission decision. Release requires its durable rejection, never a local timeout.
export class D1WalletRelocationWriteBlock {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: D1TenantScope,
  ) {}

  async check(source: WalletRelocationSessionSource, nowMs: number): Promise<'ready' | 'draining'> {
    const identity = [
      source.walletId,
      source.moveId,
      source.requestDigestHex,
      source.sourceGeneration,
    ];
    await prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      INSERT INTO wallet_relocation_write_blocks
        (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex,
         source_generation, state, started_at_ms)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'draining', ?9
      FROM wallet_execution_generations WHERE ${SCOPE} AND generation = ?8 AND state = 'active'
      ON CONFLICT DO NOTHING`,
      [...identity, nowMs],
    ).run();
    const state = await this.read(source);
    if (state === 'checked') return 'ready';
    if (state !== 'draining') throw new Error('Wallet write block is unavailable');
    const sessions = new D1WalletRelocationSessions(this.database, this.scope);
    if (
      (await sessions.hasPendingOperations(source.walletId)) ||
      (await new D1WalletCeremonyActivity(this.database, this.scope).hasPending(source.walletId))
    )
      return 'draining';
    // Existing history guards now reject every write to this wallet's snapshot rows.
    // The insert trigger also checks settlement atomically against concurrent operations.
    await prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      INSERT INTO wallet_relocation_authorization_fences
        (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation, frozen_at_ms)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 FROM wallet_relocation_write_blocks
      WHERE ${SCOPE} AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8 AND state = 'draining'
      ON CONFLICT DO NOTHING`,
      [...identity, nowMs],
    ).run();
    await new D1WalletAuthorizationSnapshot(this.database, this.scope).assertCapacity(
      source.walletId,
    );
    await this.database.batch([
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `UPDATE wallet_relocation_write_blocks
        SET state = 'checked' WHERE ${SCOPE} AND move_id = ?6 AND request_digest_hex = ?7
          AND source_generation = ?8 AND state IN ('draining', 'checked')
          AND EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences fence
            WHERE fence.namespace = ?1 AND fence.org_id = ?2 AND fence.project_id = ?3
              AND fence.env_id = ?4 AND fence.wallet_id = ?5 AND fence.move_id = ?6
              AND fence.request_digest_hex = ?7 AND fence.source_generation = ?8)`,
        identity,
      ),
      this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
    ]);
    return 'ready';
  }

  async release(source: WalletRelocationSessionSource, nowMs: number): Promise<void> {
    const identity = [
      source.walletId,
      source.moveId,
      source.requestDigestHex,
      source.sourceGeneration,
    ];
    await this.database.batch([
      // Retain a tombstone so a delayed block request cannot recreate the pause.
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `INSERT INTO wallet_relocation_write_blocks
        (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex,
         source_generation, state, started_at_ms)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'released', ?9)
        ON CONFLICT DO UPDATE SET state = 'released'
        WHERE request_digest_hex = ?7 AND source_generation = ?8 AND state != 'frozen'`,
        [...identity, nowMs],
      ),
      this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `DELETE FROM wallet_relocation_authorization_fences
        WHERE ${SCOPE} AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8`,
        identity,
      ),
    ]);
  }

  async freeze(
    source: WalletRelocationSessionSource,
    nowMs: number,
  ): Promise<{
    readonly retiredAtMs: number;
    readonly frozenAtMs: number;
  }> {
    const sessions = new D1WalletRelocationSessions(this.database, this.scope);
    const freeze = new D1WalletAuthorizationFreeze(this.database, this.scope);
    const completed = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      SELECT fence.frozen_at_ms, retired.retired_at_ms FROM wallet_relocation_authorization_fences fence
      JOIN wallet_relocation_session_fences retired
        USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
      WHERE fence.namespace = ?1 AND fence.org_id = ?2 AND fence.project_id = ?3 AND fence.env_id = ?4
        AND fence.wallet_id = ?5 AND fence.move_id = ?6 AND fence.request_digest_hex = ?7 AND fence.source_generation = ?8`,
      [source.walletId, source.moveId, source.requestDigestHex, source.sourceGeneration],
    ).first<Record<string, unknown>>();
    if (completed)
      return {
        retiredAtMs: parseUnixMs(completed.retired_at_ms, 'session retirement'),
        frozenAtMs: parseUnixMs(completed.frozen_at_ms, 'authorization freeze'),
      };
    const state = await this.read(source);
    if (state !== 'checked' && state !== 'frozen')
      throw new Error('Wallet capacity is not reserved');
    if (state === 'checked') {
      const identity = [
        source.walletId,
        source.moveId,
        source.requestDigestHex,
        source.sourceGeneration,
      ];
      try {
        await this.database.batch([
          prepareD1TenantStatement(
            this.database,
            this.scope,
            `DELETE FROM wallet_relocation_authorization_fences
          WHERE ${SCOPE} AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8`,
            identity,
          ),
          this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
          ...sessions.retirementStatements(source, nowMs),
          ...freeze.freezeStatements(source, nowMs),
          prepareD1TenantStatement(
            this.database,
            this.scope,
            `UPDATE wallet_relocation_write_blocks SET state = 'frozen'
          WHERE ${SCOPE} AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8
            AND state = 'checked'`,
            identity,
          ),
          this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
        ]);
      } catch (error) {
        if ((await this.read(source)) !== 'frozen') throw error;
      }
    }
    return {
      retiredAtMs: await sessions.retire(source, nowMs),
      frozenAtMs: await freeze.freeze(source, nowMs),
    };
  }

  private async read(source: WalletRelocationSessionSource): Promise<BlockState | null> {
    const row = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `SELECT * FROM wallet_relocation_write_blocks
      WHERE ${SCOPE} AND move_id = ?6`,
      [source.walletId, source.moveId],
    ).first<Record<string, unknown>>();
    if (!row) return null;
    if (!source.matches(row)) throw new Error('Wallet write block identity conflicts');
    switch (row.state) {
      case 'draining':
      case 'checked':
      case 'released':
      case 'frozen':
        return row.state;
      default:
        throw new Error('Wallet write block state is invalid');
    }
  }
}
