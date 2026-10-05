import { isPlainObject, requireCanonicalString } from '@shared/utils/validation';
import { sha256HexUtf8 } from '@shared/utils/digests';
import { prepareD1TenantStatement, type D1TenantScope } from '../../../../core/d1TenantStore';
import { D1_BATCH_CAS_GUARD_SQL } from '../../../../storage/d1Sql';
import type { D1DatabaseLike } from '../../../../storage/tenantRoute';
import { WalletRelocationSessionSource } from './d1WalletRelocationSessions';

type HistoryKind = 'credential' | 'exchange';
type HistoryValue = string | number | null;
type HistoryRow = {
  readonly tenantId: string;
  readonly authorizationId: string;
  readonly recordId: string;
  readonly columns: readonly string[];
  readonly values: readonly HistoryValue[];
  readonly digest: string;
};

function historyTable(kind: HistoryKind): { table: string; identity: string } {
  switch (kind) {
    case 'credential':
      return { table: 'wallet_session_hosted_credentials_v2', identity: 'hosted_credential_id' };
    case 'exchange':
      return { table: 'wallet_session_hosted_exchange_codes_v2', identity: 'exchange_code_id' };
    default: {
      const unexpected: never = kind;
      throw new Error(`Invalid hosted history kind: ${String(unexpected)}`);
    }
  }
}

// The coordinator prepares this inactive import after authenticating the move.
// Each record is a bounded chunk. Ordinary lifecycle guards remain installed.
export class D1WalletHostedHistory {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: D1TenantScope,
  ) {}

  async prepare(source: WalletRelocationSessionSource): Promise<void> {
    const existing = await this.readImport(source);
    if (existing) return;
    await this.database.batch([
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        INSERT INTO wallet_relocation_hosted_imports
          (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation, state)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'importing'
        WHERE NOT EXISTS (SELECT 1 FROM wallet_session_authorizations_v2
          WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
            AND wallet_id = ?5 AND retired_at_ms IS NULL)
          AND NOT EXISTS (SELECT 1 FROM wallet_relocation_session_fences
          WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4 AND wallet_id = ?5)
        ON CONFLICT (namespace, org_id, project_id, env_id, wallet_id) DO NOTHING`,
        [source.walletId, source.moveId, source.requestDigestHex, source.sourceGeneration],
      ),
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        UPDATE wallet_relocation_hosted_imports SET state = state
        WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
          AND wallet_id = ?5 AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8`,
        [source.walletId, source.moveId, source.requestDigestHex, source.sourceGeneration],
      ),
      this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
    ]);
  }

  async restore(
    source: WalletRelocationSessionSource,
    kind: HistoryKind,
    raw: unknown,
  ): Promise<string> {
    const row = await this.parseRow(source, kind, raw);
    const existing = await this.readReceipt(source, kind, row);
    if (existing) return existing;
    const identity = [
      source.walletId,
      source.moveId,
      source.requestDigestHex,
      source.sourceGeneration,
      kind,
      row.tenantId,
      row.recordId,
      row.digest,
    ];
    const { table } = historyTable(kind);
    try {
      await this.database.batch([
        prepareD1TenantStatement(
          this.database,
          this.scope,
          `
          INSERT INTO wallet_relocation_hosted_import_context
            (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation,
             kind, tenant_id, record_id, record_digest)
          SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
          FROM wallet_relocation_hosted_imports
          WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
            AND wallet_id = ?5 AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8
            AND state = 'importing'
            AND EXISTS (SELECT 1 FROM wallet_session_authorizations_v2 AS parent
              WHERE parent.namespace = ?1 AND parent.org_id = ?2 AND parent.project_id = ?3 AND parent.env_id = ?4
                AND parent.wallet_id = ?5 AND parent.tenant_id = ?10 AND parent.authorization_id = ?13
                AND parent.retired_at_ms IS NOT NULL)
            AND NOT EXISTS (SELECT 1 FROM wallet_relocation_hosted_import_receipts
              WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
                AND wallet_id = ?5 AND move_id = ?6 AND kind = ?9 AND tenant_id = ?10 AND record_id = ?11)`,
          [...identity, row.authorizationId],
        ),
        this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
        this.database
          .prepare(
            `INSERT INTO ${table} (${row.columns.join(', ')}) VALUES (${row.columns.map(placeholder).join(', ')})`,
          )
          .bind(...row.values),
        prepareD1TenantStatement(
          this.database,
          this.scope,
          `
          INSERT INTO wallet_relocation_hosted_import_receipts
            (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex,
             source_generation, kind, tenant_id, record_id, record_digest)
          SELECT namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex,
            source_generation, kind, tenant_id, record_id, record_digest
          FROM wallet_relocation_hosted_import_context
          WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
            AND wallet_id = ?5 AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8
            AND kind = ?9 AND tenant_id = ?10 AND record_id = ?11 AND record_digest = ?12`,
          identity,
        ),
        this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
        prepareD1TenantStatement(
          this.database,
          this.scope,
          `
          DELETE FROM wallet_relocation_hosted_import_context
          WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
            AND wallet_id = ?5 AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8
            AND kind = ?9 AND tenant_id = ?10 AND record_id = ?11 AND record_digest = ?12`,
          identity,
        ),
      ]);
    } catch (error) {
      const raced = await this.readReceipt(source, kind, row);
      if (raced) return raced;
      throw error;
    }
    const receipt = await this.readReceipt(source, kind, row);
    if (!receipt) throw new Error('Hosted history import acknowledgement disappeared');
    return receipt;
  }

  // Closing import does not activate the wallet or attest the complete manifest.
  async close(source: WalletRelocationSessionSource): Promise<void> {
    await this.database.batch([
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        UPDATE wallet_relocation_hosted_imports
        SET state = CASE WHEN state = 'importing' THEN 'closed' ELSE state END
        WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
          AND wallet_id = ?5 AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8
          AND state IN ('importing', 'closed', 'activated')`,
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
      SELECT * FROM wallet_relocation_hosted_imports
      WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4 AND wallet_id = ?5`,
      [source.walletId],
    ).first<Record<string, unknown>>();
    if (row && !source.matches(row)) throw new Error('Hosted history import identity conflicts');
    return row !== null;
  }

  private async readReceipt(
    source: WalletRelocationSessionSource,
    kind: HistoryKind,
    row: HistoryRow,
  ): Promise<string | null> {
    const receipt = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      SELECT wallet_id, move_id, request_digest_hex, source_generation, record_digest
      FROM wallet_relocation_hosted_import_receipts
      WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
        AND wallet_id = ?5 AND move_id = ?6 AND kind = ?7 AND tenant_id = ?8 AND record_id = ?9`,
      [source.walletId, source.moveId, kind, row.tenantId, row.recordId],
    ).first<Record<string, unknown>>();
    if (!receipt) return null;
    if (!source.matches(receipt) || receipt.record_digest !== row.digest)
      throw new Error('Hosted history import content conflicts');
    return row.digest;
  }

  private async parseRow(
    source: WalletRelocationSessionSource,
    kind: HistoryKind,
    raw: unknown,
  ): Promise<HistoryRow> {
    const { table, identity } = historyTable(kind);
    if (
      !isPlainObject(raw) ||
      raw.namespace !== this.scope.namespace ||
      raw.org_id !== this.scope.orgId ||
      raw.project_id !== this.scope.projectId ||
      raw.env_id !== this.scope.envId ||
      raw.wallet_id !== source.walletId
    ) {
      throw new Error('Hosted history import scope conflicts');
    }
    if (kind === 'credential' && (raw.lifecycle_kind !== 'retired' || raw.retired_at_ms === null)) {
      throw new Error('Hosted history requires a retired credential');
    }
    const schema = await this.database
      .prepare(`PRAGMA table_info(${table})`)
      .all<{ name: string; type: string }>();
    const columns: string[] = [];
    const values: HistoryValue[] = [];
    const fields = [...(schema.results ?? [])];
    fields.sort(compareColumnNames);
    if (Object.keys(raw).length !== fields.length || fields.length === 0)
      throw new Error('Hosted history row shape conflicts');
    for (const field of fields) {
      const value = raw[field.name];
      if (
        !/^[a-z][a-z0-9_]*$/u.test(field.name) ||
        !(
          value === null ||
          (field.type === 'TEXT' && typeof value === 'string') ||
          (field.type === 'INTEGER' && typeof value === 'number' && Number.isSafeInteger(value))
        )
      ) {
        throw new Error('Hosted history column is invalid');
      }
      columns.push(field.name);
      values.push(value);
    }
    const encoded = JSON.stringify([kind, columns, values]);
    if (new TextEncoder().encode(encoded).byteLength > 65_536)
      throw new Error('Hosted history record exceeds the chunk limit');
    return {
      tenantId: requireCanonicalString(raw.tenant_id, 'history tenant'),
      authorizationId: requireCanonicalString(raw.authorization_id, 'history parent authorization'),
      recordId: requireCanonicalString(raw[identity], 'history record identity'),
      columns,
      values,
      digest: await sha256HexUtf8(encoded),
    };
  }
}

function placeholder(): string {
  return '?';
}
function compareColumnNames(left: { name: string }, right: { name: string }): number {
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}
