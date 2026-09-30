import { isPlainObject } from '@shared/utils/validation';
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from './storage/tenantRoute';
import { isLocalIntendedYaoFaultTokenV1 } from './localIntendedYaoFault';

const MODE_HEADER = 'x-seams-intended-material-admission-fault-v1';
const TOKEN_HEADER = 'x-seams-intended-material-admission-token-v1';
const PROOF_HEADER = 'x-seams-intended-material-admission-proof-v1';
type Mode = 'canonical_claim' | 'canonical_existing' | 'linked_claim' | 'linked_existing';
type Role = 'material' | 'claim' | 'existing';
const SCOPE_PREDICATE = 'namespace = ? AND org_id = ? AND project_id = ? AND env_id = ? AND wallet_id = ?';
type SavedRecord = { readonly key: string; readonly value: string | number | null };
type MutationState =
  | { readonly kind: 'armed' }
  | { readonly kind: 'restored'; readonly rows: number; readonly quotaBefore: number; readonly quotaAfter: number };

type LocalMaterialAdmissionFault = {
  readonly database: LocalMaterialAdmissionFaultDatabase;
  readonly request: Request;
  readonly token: string;
};

export function localMaterialAdmissionFault(
  request: Request,
  database: D1DatabaseLike,
): LocalMaterialAdmissionFault | Response | null {
  const raw = request.headers.get(MODE_HEADER);
  const token = request.headers.get(TOKEN_HEADER);
  if (raw === null && token === null) return null;
  const url = new URL(request.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || request.method !== 'POST' ||
      !['/router-ab/ecdsa-derivation/sign/prepare', '/router-ab/ecdsa-derivation/sign'].includes(url.pathname) ||
      !isLocalIntendedYaoFaultTokenV1(token) ||
      (raw !== 'canonical_claim' && raw !== 'canonical_existing' && raw !== 'linked_claim' && raw !== 'linked_existing')) {
    return Response.json({ code: 'invalid_intended_material_admission_fault' }, { status: 400 });
  }
  const headers = new Headers(request.headers);
  headers.delete(MODE_HEADER);
  headers.delete(TOKEN_HEADER);
  return {
    database: new LocalMaterialAdmissionFaultDatabase(database, raw),
    request: new Request(request, { headers }),
    token,
  };
}

/** Retire material after resolution and before one admission statement, then restore it. */
class LocalMaterialAdmissionFaultDatabase implements D1DatabaseLike {
  private scope: readonly string[] | null = null;
  private state: MutationState = { kind: 'armed' };

  constructor(private readonly base: D1DatabaseLike, private readonly mode: Mode) {}

  prepare(query: string): D1PreparedStatementLike {
    const inner = this.base.prepare(query);
    if (/^\s*INSERT INTO authorized_operations/.test(query)) {
      return new FaultStatement(this, inner, 'claim');
    }
    if (query.includes('AS material_snapshot_active')) {
      return new FaultStatement(this, inner, 'existing');
    }
    if (query.includes('AS ecdsa_material_records_json')) {
      return new FaultStatement(this, inner, 'material');
    }
    return inner;
  }

  captureScope(values: readonly unknown[]): void {
    const scope = values.slice(0, 5);
    const strings: string[] = [];
    for (const value of scope) {
      if (typeof value !== 'string' || value.length === 0) throw new Error('Invalid material fault scope');
      strings.push(value);
    }
    if (strings.length !== 5) {
      throw new Error('Material fault did not observe a scoped material read');
    }
    this.scope = strings;
  }

  async batch<T = unknown>(statements: readonly D1PreparedStatementLike[]): Promise<readonly T[]> {
    const roles = statements.filter(isFaultStatement).map(statementRole);
    const boundary = this.mode.endsWith('_claim') ? 'claim' : 'existing';
    return this.execute<T>(statements.map(unwrap), roles.includes(boundary) ? boundary : 'material');
  }

  exec(query: string): Promise<unknown> {
    return this.base.exec(query);
  }

  async first<T>(statement: FaultStatement, columnName: string | undefined): Promise<T | null> {
    if (statement.role === 'material') {
      const row = await statement.inner.first<T>(columnName);
      if (isPlainObject(row)) {
        this.captureScope([
          row.session_namespace, row.session_org_id, row.session_project_id,
          row.session_env_id, row.session_wallet_id,
        ]);
      }
      return row;
    }
    if (!this.shouldRetire(statement.role)) return statement.inner.first<T>(columnName);
    if (columnName !== undefined) throw new Error('Material admission reads must return a row');
    const [result] = await this.execute<D1ResultLike<T>>([statement.inner], statement.role);
    return result?.results?.[0] ?? null;
  }

  private shouldRetire(role: Role): boolean {
    const boundary = this.mode.endsWith('_claim') ? 'claim' : 'existing';
    return role === boundary && this.state.kind === 'armed';
  }

  private async execute<T>(
    statements: readonly D1PreparedStatementLike[],
    role: Role,
  ): Promise<readonly T[]> {
    if (!this.shouldRetire(role)) return this.base.batch<T>(statements);
    if (!this.scope) throw new Error('Material fault has no scoped read');
    const { table, key, column } = this.target();
    const predicate = this.mode.startsWith('canonical')
      ? `${SCOPE_PREDICATE} AND signer_family = 'ecdsa'`
      : SCOPE_PREDICATE;
    const result = await this.base.prepare(
      `SELECT ${key} AS record_key, ${column} AS record_value FROM ${table} WHERE ${predicate}`,
    ).bind(...this.scope).all<Record<string, unknown>>();
    const records: SavedRecord[] = [];
    for (const row of result.results ?? []) {
      const value = row.record_value;
      if (typeof row.record_key !== 'string' ||
          (value !== null && typeof value !== 'number' && typeof value !== 'string')) {
        throw new Error('Invalid material fault backup');
      }
      records.push({ key: row.record_key, value });
    }
    if (records.length === 0) throw new Error('Material fault did not find custody records');
    const replacement = this.mode.startsWith('canonical')
      ? "json_set(record_json, '$.walletKey.publicCapability.material_activation.lifecycle_binding', 'retired-by-intended-test')"
      : 'NULL';
    const retire = this.base.prepare(
      `UPDATE ${table} SET ${column} = ${replacement} WHERE ${predicate}`,
    ).bind(...this.scope);
    const restore: D1PreparedStatementLike[] = [];
    for (const record of records) {
      restore.push(this.base.prepare(
        `UPDATE ${table} SET ${column} = ? WHERE ${predicate} AND ${key} = ?`,
      ).bind(record.value, ...this.scope, record.key));
    }
    // Other requests never observe the test's temporary material retirement.
    const quota = this.base.prepare(
      `SELECT COALESCE(SUM(quota.remaining_uses), 0) AS remaining
         FROM authorization_wallet_session_quotas AS quota
         JOIN wallet_session_authorizations_v2 AS session
           ON session.namespace = quota.namespace AND session.tenant_id = quota.tenant_id
          AND session.quota_id = quota.quota_id
        WHERE session.namespace = ? AND session.org_id = ? AND session.project_id = ?
          AND session.env_id = ? AND session.wallet_id = ?`,
    ).bind(...this.scope);
    const results = await this.base.batch<T>([quota, retire, ...statements, ...restore, quota]);
    this.state = {
      kind: 'restored',
      rows: records.length,
      quotaBefore: quotaTotal(results[0]),
      quotaAfter: quotaTotal(results.at(-1)),
    };
    return results.slice(2, 2 + statements.length);
  }

  response(response: Response, token: string): Response {
    const headers = new Headers(response.headers);
    headers.set(PROOF_HEADER, this.state.kind === 'restored'
      ? `${token}:${this.mode}:${this.state.rows}:${this.state.quotaBefore}:${this.state.quotaAfter}` : `${token}:not_observed`);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  private target(): { readonly table: string; readonly key: string; readonly column: string } {
    return this.mode.startsWith('canonical')
      ? { table: 'wallet_signers', key: 'signer_id', column: 'record_json' }
      : { table: 'linked_device_authority_installations', key: 'link_session_id', column: 'activated_at_ms' };
  }
}

class FaultStatement implements D1PreparedStatementLike {
  constructor(
    private readonly database: LocalMaterialAdmissionFaultDatabase,
    readonly inner: D1PreparedStatementLike,
    readonly role: Role,
  ) {}

  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    return new FaultStatement(this.database, this.inner.bind(...values), this.role);
  }
  async first<T = unknown>(columnName?: string): Promise<T | null> {
    return this.database.first<T>(this, columnName);
  }
  all<T = unknown>(): Promise<D1ResultLike<T>> {
    return this.inner.all<T>();
  }

  run<T = unknown>(): Promise<D1ResultLike<T>> {
    return this.inner.run<T>();
  }
}

function unwrap(statement: D1PreparedStatementLike): D1PreparedStatementLike {
  return statement instanceof FaultStatement ? statement.inner : statement;
}

function isFaultStatement(statement: D1PreparedStatementLike): statement is FaultStatement {
  return statement instanceof FaultStatement;
}

function statementRole(statement: FaultStatement): Role {
  return statement.role;
}

function quotaTotal(result: unknown): number {
  if (!isPlainObject(result) || !Array.isArray(result.results)) {
    throw new Error('Material fault quota result is unavailable');
  }
  const row: unknown = result.results[0];
  if (!isPlainObject(row) || typeof row.remaining !== 'number' || !Number.isSafeInteger(row.remaining)) {
    throw new Error('Material fault quota total is invalid');
  }
  return row.remaining;
}
