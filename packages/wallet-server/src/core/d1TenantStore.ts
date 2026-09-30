// The tenant-scoped D1 plumbing the core stores share: a store's key prefix, which is also its D1
// namespace; its tenant scope; its schema, created on first use; and statements that bind the
// scope ahead of their own values.
import { toOptionalTrimmedString } from '@shared/utils/validation';
import { THRESHOLD_PREFIX_DEFAULT } from './defaultConfigsServer';
import { toPrefixWithColon } from './ThresholdService/validation';
import { formatD1ExecStatement } from '../storage/d1Sql';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../storage/tenantRoute';

/**
 * A store's key prefix, which is also its D1 namespace: the first of `explicitKeys` set in
 * `config`, else `<THRESHOLD_PREFIX>:<segment>`. It always ends with a colon.
 */
export function resolveStorePrefix(
  config: Record<string, unknown>,
  explicitKeys: readonly string[],
  segment: string,
): string {
  for (const key of explicitKeys) {
    const explicit = toOptionalTrimmedString(config[key]);
    if (explicit) return toPrefixWithColon(explicit, '');
  }
  const base = toOptionalTrimmedString(config.THRESHOLD_PREFIX) || THRESHOLD_PREFIX_DEFAULT;
  return `${toPrefixWithColon(base, `${THRESHOLD_PREFIX_DEFAULT}:`)}${segment}`;
}

/** The tenant scope that leads the key of every D1 table. */
export type D1TenantScope = {
  readonly namespace: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly envId: string;
};

export interface D1SchemaOptions {
  readonly database: D1DatabaseLike;
}

export interface D1TenantStoreOptions {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly envId: string;
  readonly ensureSchema?: boolean;
}

/** Requires each part of the scope; `store` ends the error, e.g. `identity store`. */
function requireD1TenantScope(
  input: { readonly [K in keyof D1TenantScope]: unknown },
  store: string,
): D1TenantScope {
  const field = (value: unknown, name: string): string => {
    const normalized = toOptionalTrimmedString(value);
    if (!normalized) throw new Error(`${name} is required for D1 ${store}`);
    return normalized;
  };
  return {
    namespace: field(input.namespace, 'namespace'),
    orgId: field(input.orgId, 'orgId'),
    projectId: field(input.projectId, 'projectId'),
    envId: field(input.envId, 'envId'),
  };
}

/** The scope env-shaped store config names (`orgId` or `ORG_ID`, and so on) under `namespace`. */
export function d1TenantScopeFromConfig(
  config: Record<string, unknown>,
  namespace: string,
  store: string,
): D1TenantScope {
  return requireD1TenantScope(
    {
      namespace,
      orgId: config.orgId || config.ORG_ID,
      projectId: config.projectId || config.PROJECT_ID,
      envId: config.envId || config.ENV_ID,
    },
    store,
  );
}

export async function ensureD1Schema(
  database: D1DatabaseLike,
  statements: readonly string[],
): Promise<void> {
  for (const statement of statements) {
    await database.exec(formatD1ExecStatement(statement));
  }
}

/** A schema a store creates once, on first use, unless its caller manages it (`enabled: false`). */
export class D1Schema {
  private ready = false;

  constructor(
    private readonly database: D1DatabaseLike,
    private readonly statements: readonly string[],
    private readonly enabled = true,
  ) {}

  async ensure(): Promise<void> {
    if (!this.enabled || this.ready) return;
    await ensureD1Schema(this.database, this.statements);
    this.ready = true;
  }
}

/** Prepares `sql` with the scope bound to its first four parameters and `values` after them. */
export function prepareD1TenantStatement(
  database: D1DatabaseLike,
  scope: D1TenantScope,
  sql: string,
  values: readonly unknown[] = [],
): D1PreparedStatementLike {
  return database
    .prepare(sql)
    .bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, ...values);
}

/**
 * A store's tables in one tenant scope. `store` names it in scope errors, e.g. `identity store`,
 * and the schema is created on first use unless the caller manages it (`ensureSchema: false`).
 */
export class D1TenantTable {
  readonly database: D1DatabaseLike;
  readonly scope: D1TenantScope;
  private readonly schema: D1Schema;

  constructor(input: D1TenantStoreOptions, store: string, schema: readonly string[]) {
    this.database = input.database;
    this.scope = requireD1TenantScope(input, store);
    this.schema = new D1Schema(input.database, schema, input.ensureSchema !== false);
  }

  ensureSchema(): Promise<void> {
    return this.schema.ensure();
  }

  prepare(sql: string, values: readonly unknown[] = []): D1PreparedStatementLike {
    return prepareD1TenantStatement(this.database, this.scope, sql, values);
  }
}
