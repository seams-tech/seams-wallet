import { requireArray, requireRecord } from '@shared/utils/validation';
import type { D1DatabaseLike } from '../../../../storage/tenantRoute';

const TABLES = [
  'wallet_email_otp_rate_limits',
  'wallets',
  'wallet_signers',
  'wallet_authorities',
  'wallet_auth_methods',
  'webauthn_credential_bindings',
  'webauthn_authenticators',
  'router_ab_yao_versioned_json_records',
  'authorization_wallet_session_quotas',
  'wallet_session_authorizations_v2',
  'wallet_session_hosted_credentials_v2',
  'wallet_session_hosted_exchange_codes_v2',
  'verified_wallet_operation_evidence_sets',
  'authorized_operations',
  'authorized_operation_audit_events',
] as const;

type Table = (typeof TABLES)[number];

// Only validated persisted column names can become SQL expressions.
export class AuthorizationSnapshotLayout {
  readonly #validated = true;

  private constructor(
    readonly table: Table,
    readonly columns: readonly string[],
    readonly keyColumns: readonly string[],
  ) {
    Object.freeze(this);
  }

  static async read(database: D1DatabaseLike): Promise<readonly AuthorizationSnapshotLayout[]> {
    const layout: unknown[] = [];
    for (const table of TABLES) {
      const result = await database.prepare(`PRAGMA table_info(${table})`).all<{
        name: string;
        type: string;
        pk: number;
      }>();
      const columns: string[] = [];
      const keys: string[] = [];
      for (const field of result.results ?? []) {
        if (!Number.isSafeInteger(field.pk) || field.pk < 0)
          throw new Error('Authorization snapshot primary key is invalid');
        if (field.type !== 'TEXT' && field.type !== 'INTEGER')
          throw new Error('Authorization snapshot column type is unsupported');
        columns.push(field.name);
        if (field.pk > 0) keys.push(field.name);
      }
      columns.sort();
      keys.sort();
      layout.push({ table, columns, keyColumns: keys });
    }
    return AuthorizationSnapshotLayout.parse(layout);
  }

  static parse(raw: unknown): readonly AuthorizationSnapshotLayout[] {
    const entries = requireArray(raw, 'authorization snapshot layout');
    if (entries.length !== TABLES.length)
      throw new Error('Authorization snapshot table set conflicts');
    const result: AuthorizationSnapshotLayout[] = [];
    for (const [index, table] of TABLES.entries()) {
      const entry = requireRecord(entries[index], 'authorization snapshot table');
      if (Object.keys(entry).length !== 3 || entry.table !== table)
        throw new Error('Authorization snapshot table order conflicts');
      const columns = columnNames(entry.columns);
      const keyColumns = columnNames(entry.keyColumns);
      for (const key of keyColumns) {
        if (!columns.includes(key)) throw new Error('Authorization snapshot key column is absent');
      }
      result.push(new AuthorizationSnapshotLayout(table, columns, keyColumns));
    }
    return Object.freeze(result);
  }

  expressions(): { readonly key: string; readonly record: string; readonly ownership: string } {
    if (!this.#validated) throw new Error('Authorization snapshot layout is unvalidated');
    const fields: string[] = [];
    for (const column of this.columns) fields.push(`'${column}', target.${column}`);
    const keys: string[] = [];
    for (const column of this.keyColumns) keys.push(`target.${column}`);
    return {
      key: `json_array(${keys.join(', ')})`,
      record: `json_object(${fields.join(', ')})`,
      ownership: AuthorizationSnapshotLayout.ownership(this.table),
    };
  }

  snapshotSelection(): string {
    const ownership = AuthorizationSnapshotLayout.ownership(this.table);
    if (this.table !== 'wallet_email_otp_rate_limits') return ownership;
    return `${ownership} AND target.reset_at_ms > (
      SELECT frozen_at_ms FROM wallet_relocation_authorization_fences
      WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4 AND wallet_id = ?5)`;
  }

  static ownership(table: Table): string {
    switch (table) {
      case 'router_ab_yao_versioned_json_records':
        return `target.namespace = ?1 AND target.org_id = ?2 AND target.project_id = ?3
          AND target.env_id = ?4 AND json_extract(target.record_json, '$.walletId') = ?5
          AND CASE
            WHEN substr(target.record_key, 1, 17) = 'passkey-envelope:' AND json_valid(substr(target.record_key, 18))
              THEN json_extract(substr(target.record_key, 18), '$[0]') = ?5
            WHEN substr(target.record_key, 1, 28) = 'passkey-credential-activity:' AND json_valid(substr(target.record_key, 29))
              THEN json_extract(substr(target.record_key, 29), '$[0]') = ?5
            ELSE target.record_key IN ('passkey-envelope:recovery-set:' || ?5,
              'passkey-envelope:wallet-recovery-backup-ack/' || ?5)
          END`;

      case 'webauthn_credential_bindings':
      case 'webauthn_authenticators':
        return `target.namespace = ?1 AND target.org_id = ?2 AND target.project_id = ?3
          AND target.env_id = ?4 AND target.user_id = ?5
          AND EXISTS (SELECT 1 FROM wallet_auth_methods AS method
            WHERE method.namespace = target.namespace AND method.org_id = target.org_id
              AND method.project_id = target.project_id AND method.env_id = target.env_id
              AND method.wallet_id = ?5 AND method.kind = 'passkey'
              AND method.credential_id_b64u = target.credential_id_b64u
              AND ${
                table === 'webauthn_credential_bindings'
                  ? 'method.rp_id = target.rp_id'
                  : 'method.credential_public_key_b64u = target.credential_public_key_b64u'
              })`;

      case 'authorization_wallet_session_quotas':
        return `EXISTS (SELECT 1 FROM wallet_session_authorizations_v2 AS session
          WHERE session.namespace = ?1 AND session.org_id = ?2 AND session.project_id = ?3 AND session.env_id = ?4
            AND session.wallet_id = ?5 AND session.namespace = target.namespace AND session.tenant_id = target.tenant_id
            AND session.quota_id = target.quota_id AND session.wallet_session_id = target.wallet_session_id)`;
      case 'authorized_operations':
        return `EXISTS (SELECT 1 FROM wallet_operation_authorizations AS owner
          WHERE owner.namespace = ?1 AND owner.org_id = ?2 AND owner.project_id = ?3 AND owner.env_id = ?4
            AND owner.wallet_id = ?5 AND owner.namespace = target.namespace AND owner.tenant_id = target.tenant_id
            AND owner.source_kind = target.authorization_source_kind
            AND owner.source_id = CASE target.authorization_source_kind
              WHEN 'authorization_grant' THEN target.authorization_id ELSE target.evidence_set_digest END
            AND (target.authorization_source_kind = 'verified_step_up' OR
              (target.authorization_grant_kind = 'wallet_session_authorization'
                AND owner.org_id = target.owner_scope_org_id AND owner.project_id = target.owner_scope_project_id
                AND owner.env_id = target.owner_scope_env_id)))`;
      case 'authorized_operation_audit_events':
        return `EXISTS (SELECT 1 FROM wallet_operation_owners AS owner
          WHERE owner.namespace = ?1 AND owner.org_id = ?2 AND owner.project_id = ?3 AND owner.env_id = ?4
            AND owner.wallet_id = ?5 AND owner.namespace = target.namespace AND owner.tenant_id = target.tenant_id
            AND owner.authorized_operation_id = target.authorized_operation_id)`;
      default:
        return 'target.namespace = ?1 AND target.org_id = ?2 AND target.project_id = ?3 AND target.env_id = ?4 AND target.wallet_id = ?5';
    }
  }
}

function columnNames(raw: unknown): readonly string[] {
  const names: string[] = [];
  for (const name of requireArray(raw, 'authorization snapshot columns')) {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/u.test(name) || names.includes(name))
      throw new Error('Authorization snapshot column is invalid');
    names.push(name);
  }
  if (names.length === 0) throw new Error('Authorization snapshot columns are empty');
  return Object.freeze(names);
}
