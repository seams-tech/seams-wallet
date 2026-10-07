import { requireCanonicalString } from '@shared/utils/validation';
import { sha256HexUtf8 } from '@shared/utils/digests';
import { prepareD1TenantStatement, type D1TenantScope } from '../../../../core/d1TenantStore';
import { D1_BATCH_CAS_GUARD_SQL } from '../../../../storage/d1Sql';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import { AuthorizationSnapshotLayout } from './authorizationSnapshotLayout';
import { WalletRelocationSessionSource } from './d1WalletRelocationSessions';

type HistoryRow = {
  readonly layout: AuthorizationSnapshotLayout;
  readonly key: string;
  readonly json: string;
  readonly digest: string;
};
const MAX_RECORD_BYTES = 2_097_152;

// A role-local restore boundary for assembled snapshot records. Transport and
// complete-manifest verification belong to the admitted move coordinator.
export class D1WalletAuthorizationHistory {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: D1TenantScope,
  ) {}

  async prepare(source: WalletRelocationSessionSource): Promise<void> {
    if (await this.readImport(source)) return;
    const empty: string[] = [];
    for (const layout of await AuthorizationSnapshotLayout.read(this.database)) {
      if (layout.table === 'authorization_wallet_session_quotas') continue;
      empty.push(`NOT EXISTS (SELECT 1 FROM ${layout.table} AS target
        WHERE ${layout.expressions().ownership})`);
    }
    await this.database.batch([
      ...prepareCleanedDestinationReturn(this.database, this.scope, source),
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        INSERT INTO wallet_relocation_authorization_imports
          (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation, state)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'importing'
        WHERE ${empty.join(' AND ')}
          AND NOT EXISTS (SELECT 1 FROM wallet_relocation_session_fences
            WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4 AND wallet_id = ?5)
        ON CONFLICT (namespace, org_id, project_id, env_id, wallet_id) DO NOTHING`,
        [source.walletId, source.moveId, source.requestDigestHex, source.sourceGeneration],
      ),
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        UPDATE wallet_relocation_authorization_imports SET state = state
        WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
          AND wallet_id = ?5 AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8`,
        [source.walletId, source.moveId, source.requestDigestHex, source.sourceGeneration],
      ),
      this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
    ]);
  }

  async restore(
    source: WalletRelocationSessionSource,
    table: AuthorizationSnapshotLayout['table'],
    rawRecord: unknown,
  ): Promise<string> {
    const row = await this.parseRow(source, table, rawRecord);
    const existing = await this.readReceipt(source, row);
    if (existing) return existing;
    const identity = [
      source.walletId,
      source.moveId,
      source.requestDigestHex,
      source.sourceGeneration,
      table,
      row.key,
      row.digest,
    ];
    const values: string[] = [];
    for (const column of row.layout.columns) values.push(`json_extract(?6, '$.${column}')`);
    const expressions = row.layout.expressions();
    try {
      await this.database.batch([
        prepareD1TenantStatement(
          this.database,
          this.scope,
          `
          INSERT INTO wallet_relocation_authorization_import_context
            (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation,
             table_name, record_key, record_digest)
          SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
          FROM wallet_relocation_authorization_imports
          WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
            AND wallet_id = ?5 AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8
            AND state = 'importing'
            AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts
              WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
                AND wallet_id = ?5 AND move_id = ?6 AND table_name = ?9 AND record_key = ?10)`,
          identity,
        ),
        this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
        prepareD1TenantStatement(
          this.database,
          this.scope,
          `INSERT INTO ${table} (${row.layout.columns.join(', ')}) SELECT ${values.join(', ')}`,
          [source.walletId, row.json],
        ),
        prepareD1TenantStatement(
          this.database,
          this.scope,
          `
          INSERT INTO wallet_relocation_authorization_import_receipts
            (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation,
             table_name, record_key, record_digest)
          SELECT namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation,
            table_name, record_key, record_digest
          FROM wallet_relocation_authorization_import_context
          WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
            AND wallet_id = ?5 AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8
            AND table_name = ?9 AND record_key = ?10 AND record_digest = ?11
            AND EXISTS (SELECT 1 FROM ${table} AS target
              WHERE ${expressions.key} = ?10 AND ${expressions.record} = ?12)`,
          [...identity, row.json],
        ),
        this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
        prepareD1TenantStatement(
          this.database,
          this.scope,
          `
          DELETE FROM wallet_relocation_authorization_import_context
          WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
            AND wallet_id = ?5 AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8
            AND table_name = ?9 AND record_key = ?10 AND record_digest = ?11`,
          identity,
        ),
      ]);
    } catch (error) {
      const raced = await this.readReceipt(source, row);
      if (raced) return raced;
      throw error;
    }
    const receipt = await this.readReceipt(source, row);
    if (!receipt) throw new Error('Authorization history acknowledgement disappeared');
    return receipt;
  }

  // Closure requires all imported quotas to have their retired wallet parent.
  // It closes writes; it does not attest the complete manifest or activate a wallet.
  async close(source: WalletRelocationSessionSource): Promise<void> {
    await this.database.batch([
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        UPDATE wallet_relocation_authorization_imports
        SET state = CASE WHEN state = 'importing' THEN 'closed' ELSE state END
        WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
          AND wallet_id = ?5 AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8
          AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt
            WHERE receipt.namespace = ?1 AND receipt.org_id = ?2 AND receipt.project_id = ?3 AND receipt.env_id = ?4
              AND receipt.wallet_id = ?5 AND receipt.table_name = 'authorization_wallet_session_quotas'
              AND NOT EXISTS (SELECT 1 FROM authorization_wallet_session_quotas AS quota
                JOIN wallet_session_authorizations_v2 AS session ON session.namespace = quota.namespace
                  AND session.tenant_id = quota.tenant_id AND session.quota_id = quota.quota_id
                  AND session.wallet_session_id = quota.wallet_session_id
                WHERE json_array(quota.namespace, quota.quota_id, quota.tenant_id) = receipt.record_key
                  AND session.namespace = ?1 AND session.org_id = ?2 AND session.project_id = ?3 AND session.env_id = ?4
                  AND session.wallet_id = ?5 AND session.retired_at_ms IS NOT NULL))`,
        [source.walletId, source.moveId, source.requestDigestHex, source.sourceGeneration],
      ),
      this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
    ]);
  }

  private async readImport(source: WalletRelocationSessionSource): Promise<boolean> {
    const row = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      SELECT wallet_id, move_id, request_digest_hex, source_generation
      FROM wallet_relocation_authorization_imports
      WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4 AND wallet_id = ?5`,
      [source.walletId],
    ).first<Record<string, unknown>>();
    if (!row) return false;
    if (source.matches(row)) return true;
    if (
      typeof row.source_generation === 'number' &&
      row.source_generation + 1 < source.sourceGeneration
    )
      return false;
    throw new Error('Authorization history import identity conflicts');
  }

  private async readReceipt(
    source: WalletRelocationSessionSource,
    row: HistoryRow,
  ): Promise<string | null> {
    const receipt = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      SELECT wallet_id, move_id, request_digest_hex, source_generation, record_digest
      FROM wallet_relocation_authorization_import_receipts
      WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
        AND wallet_id = ?5 AND move_id = ?6 AND table_name = ?7 AND record_key = ?8`,
      [source.walletId, source.moveId, row.layout.table, row.key],
    ).first<Record<string, unknown>>();
    if (!receipt) return null;
    if (!source.matches(receipt) || receipt.record_digest !== row.digest)
      throw new Error('Authorization history import content conflicts');
    return row.digest;
  }

  private async parseRow(
    source: WalletRelocationSessionSource,
    table: AuthorizationSnapshotLayout['table'],
    raw: unknown,
  ): Promise<HistoryRow> {
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_RECORD_BYTES)
      throw new Error('Authorization history requires a bounded assembled record');
    let layout: AuthorizationSnapshotLayout | null = null;
    for (const candidate of await AuthorizationSnapshotLayout.read(this.database)) {
      if (candidate.table === table) layout = candidate;
    }
    if (!layout) throw new Error('Authorization history table is invalid');
    const fields: string[] = [];
    const keys: string[] = [];
    for (const column of layout.columns)
      fields.push(`'${column}', json_extract(?6, '$.${column}')`);
    for (const column of layout.keyColumns) keys.push(`json_extract(?6, '$.${column}')`);
    const ownership =
      table === 'authorization_wallet_session_quotas'
        ? 'target.namespace = ?1'
        : layout.expressions().ownership;
    const projectedColumns: string[] = [];
    for (const column of layout.columns)
      projectedColumns.push(`json_extract(?6, '$.${column}') AS ${column}`);
    let lifecycle = '1';
    if (table === 'wallet_session_authorizations_v2')
      lifecycle = `json_type(?6, '$.retired_at_ms') = 'integer'`;
    if (table === 'wallet_session_hosted_credentials_v2')
      lifecycle = `json_type(?6, '$.retired_at_ms') = 'integer' AND json_extract(?6, '$.lifecycle_kind') = 'retired'`;
    if (table === 'authorized_operations') lifecycle = "target.lifecycle_kind = 'completed'";
    if (table === 'authorized_operation_audit_events')
      lifecycle = "target.result_kind != 'pending'";
    const metadata = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      SELECT json_array(${keys.join(', ')}) AS record_key
      FROM (SELECT ${projectedColumns.join(', ')}) AS target
      WHERE json_valid(?6) AND json_type(?6) = 'object' AND ${ownership} AND ${lifecycle}
        AND (SELECT COUNT(*) FROM json_each(?6)) = ${layout.columns.length}
        AND (SELECT COUNT(DISTINCT key) FROM json_each(?6)) = ${layout.columns.length}
        AND NOT EXISTS (SELECT 1 FROM json_each(?6) AS value
          LEFT JOIN pragma_table_info('${table}') AS field ON field.name = value.key
          WHERE field.name IS NULL OR NOT (value.type = 'null'
            OR (field.type = 'TEXT' AND value.type = 'text')
            OR (field.type = 'INTEGER' AND value.type = 'integer' AND typeof(value.atom) = 'integer')))
        AND json_object(${fields.join(', ')}) = ?6`,
      [source.walletId, raw],
    ).first<Record<string, unknown>>();
    if (!metadata)
      throw new Error('Authorization history record scope, shape or lifecycle conflicts');
    return {
      layout,
      key: requireCanonicalString(metadata.record_key, 'authorization history record key'),
      json: raw,
      digest: await sha256HexUtf8(JSON.stringify([table, raw])),
    };
  }
}

function prepareCleanedDestinationReturn(
  database: D1DatabaseLike,
  scope: D1TenantScope,
  source: WalletRelocationSessionSource,
): readonly D1PreparedStatementLike[] {
  const identity = [
    source.walletId,
    source.moveId,
    source.requestDigestHex,
    source.sourceGeneration,
  ];
  const statements = [
    prepareD1TenantStatement(
      database,
      scope,
      `
    INSERT INTO wallet_relocation_authorization_returns
      (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex,
       source_generation, previous_move_id, previous_request_digest_hex, retired_generation)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, cleanup.move_id, cleanup.request_digest_hex, execution.generation
    FROM wallet_relocation_authorization_cleanups AS cleanup
    JOIN wallet_execution_generations AS execution USING (namespace, org_id, project_id, env_id, wallet_id)
    WHERE cleanup.namespace = ?1 AND cleanup.org_id = ?2 AND cleanup.project_id = ?3
      AND cleanup.env_id = ?4 AND cleanup.wallet_id = ?5 AND cleanup.state = 'cleaned'
      AND execution.state = 'retired' AND execution.generation = cleanup.source_generation
      AND execution.generation < ?8
    ON CONFLICT (namespace, org_id, project_id, env_id, wallet_id, move_id) DO NOTHING`,
      identity,
    ),
  ];
  for (const table of [
    'wallet_relocation_authorization_imports',
    'wallet_relocation_authorization_intakes',
    'wallet_relocation_authorization_snapshots',
    'wallet_relocation_authorization_fences',
    'wallet_relocation_session_fences',
    'wallet_execution_generations',
  ]) {
    let priorIdentity: string;
    switch (table) {
      case 'wallet_relocation_authorization_imports':
      case 'wallet_relocation_authorization_intakes':
        priorIdentity = 'target.source_generation + 1 = returned.retired_generation';
        break;
      case 'wallet_execution_generations':
        priorIdentity =
          "target.generation = returned.retired_generation AND target.state = 'retired'";
        break;
      default:
        priorIdentity = `target.source_generation = returned.retired_generation
          AND target.move_id = returned.previous_move_id
          AND target.request_digest_hex = returned.previous_request_digest_hex`;
    }
    statements.push(
      prepareD1TenantStatement(
        database,
        scope,
        `
      DELETE FROM ${table} AS target
      WHERE target.namespace = ?1 AND target.org_id = ?2 AND target.project_id = ?3
        AND target.env_id = ?4 AND target.wallet_id = ?5 AND EXISTS (
          SELECT 1 FROM wallet_relocation_authorization_returns AS returned
          WHERE returned.namespace = ?1 AND returned.org_id = ?2 AND returned.project_id = ?3
            AND returned.env_id = ?4 AND returned.wallet_id = ?5 AND returned.move_id = ?6
            AND returned.request_digest_hex = ?7 AND returned.source_generation = ?8
            AND ${priorIdentity})`,
        identity,
      ),
    );
  }
  return statements;
}
