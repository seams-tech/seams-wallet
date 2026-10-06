import { parseNonNegativeSafeInteger } from '@shared/device-linking/wireFields';
import { parseUnixMs } from '@shared/passkey-custody/primitives';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import { prepareD1TenantStatement, type D1TenantScope } from '../../../../core/d1TenantStore';
import { D1_BATCH_CAS_GUARD_SQL } from '../../../../storage/d1Sql';
import type { D1DatabaseLike } from '../../../../storage/tenantRoute';
import { AuthorizationSnapshotLayout } from './authorizationSnapshotLayout';
import { WalletRelocationSessionSource } from './d1WalletRelocationSessions';

const SCOPE =
  'namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4 AND wallet_id = ?5';
const TABLES = [
  'authorized_operation_audit_events',
  'authorized_operations',
  'verified_wallet_operation_evidence_sets',
  'wallet_session_hosted_exchange_codes_v2',
  'wallet_session_hosted_credentials_v2',
  'wallet_session_authorizations_v2',
  'router_ab_yao_versioned_json_records',
  'webauthn_authenticators',
  'webauthn_credential_bindings',
  'wallet_signers',
  'wallets',
  'wallet_auth_methods',
  'wallet_authorities',
  'wallet_relocation_authorization_import_receipts',
  'wallet_relocation_authorization_chunks',
  'wallet_relocation_authorization_intake_chunks',
] as const;
type CleanupProgress =
  | { readonly state: 'cleaning'; readonly completedAtMs?: never }
  | { readonly state: 'cleaned'; readonly completedAtMs: number };

// Only the Console-authorized cleanup command can start deletion. Fences remain permanent.
export class D1WalletAuthorizationCleanup {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: D1TenantScope,
  ) {}

  async advance(
    source: WalletRelocationSessionSource,
    rawManifest: unknown,
    commandDigest: string,
    nowMs: number,
  ): Promise<CleanupProgress> {
    parseUnixMs(nowMs, 'authorization cleanup time');
    const manifestJson = await this.manifest(source, rawManifest);
    const prior = await this.read(source, manifestJson, commandDigest);
    if (prior?.state === 'cleaned') return prior;
    const identity = [
      source.walletId,
      source.moveId,
      source.requestDigestHex,
      source.sourceGeneration,
    ];
    if (!prior) {
      await prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        INSERT INTO wallet_relocation_authorization_cleanups
          (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex,
           source_generation, command_digest, manifest_json, state)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'cleaning')
        ON CONFLICT DO NOTHING`,
        [...identity, commandDigest, manifestJson],
      ).run();
    }
    const admitted = await this.read(source, manifestJson, commandDigest);
    if (!admitted) throw new Error('Authorization cleanup admission disappeared');
    if (admitted.state === 'cleaned') return admitted;
    for (const table of TABLES) {
      const ownership =
        table === 'authorized_operations' ||
        table === 'authorized_operation_audit_events' ||
        table === 'webauthn_authenticators' ||
        table === 'webauthn_credential_bindings' ||
        table === 'router_ab_yao_versioned_json_records'
          ? AuthorizationSnapshotLayout.ownership(table)
          : 'target.namespace = ?1 AND target.org_id = ?2 AND target.project_id = ?3 AND target.env_id = ?4 AND target.wallet_id = ?5';
      const quota =
        table === 'wallet_session_authorizations_v2'
          ? ', json_array(target.namespace, target.tenant_id, target.quota_id) AS quota_key'
          : '';
      const rows = await prepareD1TenantStatement(
        this.database,
        this.scope,
        `SELECT target.rowid AS row_id${quota} FROM ${table} AS target WHERE ${ownership} ORDER BY target.rowid LIMIT 16`,
        [source.walletId],
      ).all<Record<string, unknown>>();
      const rowIds: number[] = [];
      const quotaKeys: string[] = [];
      for (const row of rows.results ?? []) {
        rowIds.push(parseNonNegativeSafeInteger(row.row_id, 'cleanup row id'));
        if (table === 'wallet_session_authorizations_v2')
          quotaKeys.push(requireCanonicalString(row.quota_key, 'cleanup quota key'));
      }
      if (rowIds.length === 0) continue;
      const statements = [
        prepareD1TenantStatement(
          this.database,
          this.scope,
          `
          UPDATE wallet_relocation_authorization_cleanups SET state = state
          WHERE ${SCOPE} AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8
            AND command_digest = ?9 AND state = 'cleaning'`,
          [...identity, commandDigest],
        ),
        this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
        prepareD1TenantStatement(
          this.database,
          this.scope,
          `DELETE FROM ${table} AS target WHERE ${ownership} AND target.rowid IN (SELECT value FROM json_each(?6))`,
          [source.walletId, JSON.stringify(rowIds)],
        ),
      ];
      if (quotaKeys.length > 0) {
        statements.push(
          this.database
            .prepare(
              `
          DELETE FROM authorization_wallet_session_quotas
          WHERE json_array(namespace, tenant_id, quota_id) IN (SELECT value FROM json_each(?1))`,
            )
            .bind(JSON.stringify(quotaKeys)),
        );
      }
      await this.database.batch(statements);
      return { state: 'cleaning' };
    }
    await this.database.batch([
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        UPDATE wallet_relocation_authorization_cleanups SET state = 'cleaned', completed_at_ms = ?10
        WHERE ${SCOPE} AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8
          AND command_digest = ?9 AND state = 'cleaning'`,
        [...identity, commandDigest, nowMs],
      ),
      this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
    ]);
    const completed = await this.read(source, manifestJson, commandDigest);
    if (completed?.state !== 'cleaned')
      throw new Error('Authorization cleanup completion disappeared');
    return completed;
  }

  private async manifest(source: WalletRelocationSessionSource, raw: unknown): Promise<string> {
    const expected = requireRecord(raw, 'cleanup manifest');
    const row = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `SELECT * FROM wallet_relocation_authorization_snapshots WHERE ${SCOPE} AND state = 'sealed'`,
      [source.walletId],
    ).first<Record<string, unknown>>();
    if (!row || !source.matches(row)) throw new Error('Authorization cleanup snapshot conflicts');
    const manifest = {
      schemaJson: requireCanonicalString(row.schema_json, 'cleanup snapshot schema'),
      chunkCount: parseNonNegativeSafeInteger(row.chunk_count, 'cleanup snapshot chunks'),
      recordCount: parseNonNegativeSafeInteger(row.record_count, 'cleanup snapshot records'),
      digestHex: requireCanonicalString(row.digest_hex, 'cleanup snapshot digest'),
    };
    if (Object.keys(expected).length !== 4)
      throw new Error('Authorization cleanup manifest conflicts');
    for (const [key, value] of Object.entries(manifest))
      if (expected[key] !== value) throw new Error('Authorization cleanup manifest conflicts');
    return JSON.stringify(manifest);
  }

  private async read(
    source: WalletRelocationSessionSource,
    manifestJson: string,
    commandDigest: string,
  ): Promise<CleanupProgress | null> {
    const row = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `SELECT * FROM wallet_relocation_authorization_cleanups WHERE ${SCOPE} AND move_id = ?6`,
      [source.walletId, source.moveId],
    ).first<Record<string, unknown>>();
    if (!row) return null;
    if (
      !source.matches(row) ||
      row.manifest_json !== manifestJson ||
      row.command_digest !== commandDigest
    )
      throw new Error('Authorization cleanup identity conflicts');
    switch (row.state) {
      case 'cleaning':
        return { state: 'cleaning' };
      case 'cleaned':
        return {
          state: 'cleaned',
          completedAtMs: parseUnixMs(row.completed_at_ms, 'cleanup completion time'),
        };
      default:
        throw new Error('Authorization cleanup state is invalid');
    }
  }
}
