import { requireArray, requireRecord } from '@shared/utils/validation';
import type { D1DatabaseLike } from '../../../../storage/tenantRoute';

const TABLES = [
  'wallet_authorities',
  'wallet_auth_methods',
  'authorization_wallet_session_quotas',
  'wallet_session_authorizations_v2',
  'wallet_session_hosted_credentials_v2',
  'wallet_session_hosted_exchange_codes_v2',
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
    const ownership =
      this.table === 'authorization_wallet_session_quotas'
        ? `EXISTS (SELECT 1 FROM wallet_session_authorizations_v2 AS session
          WHERE session.namespace = ?1 AND session.org_id = ?2 AND session.project_id = ?3 AND session.env_id = ?4
            AND session.wallet_id = ?5 AND session.namespace = target.namespace AND session.tenant_id = target.tenant_id
            AND session.quota_id = target.quota_id AND session.wallet_session_id = target.wallet_session_id)`
        : 'target.namespace = ?1 AND target.org_id = ?2 AND target.project_id = ?3 AND target.env_id = ?4 AND target.wallet_id = ?5';
    return {
      key: `json_array(${keys.join(', ')})`,
      record: `json_object(${fields.join(', ')})`,
      ownership,
    };
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
