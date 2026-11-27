// The tenant-scoped D1 plumbing the core stores share: a store's tenant scope and statements that
// bind the scope ahead of their own values. The d1-signer migrations create every table.
import { toOptionalTrimmedString } from '@shared/utils/validation';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../storage/tenantRoute';

/** The tenant scope that leads the key of every D1 table. */
export type D1TenantScope = {
  readonly namespace: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly envId: string;
};

export interface D1TenantStoreOptions {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly envId: string;
}

/** Requires each part of the scope; `store` ends the error, e.g. `identity store`. */
export function requireD1TenantScope(
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

/** A store's tables in one tenant scope. `store` names it in scope errors, e.g. `identity store`. */
export class D1TenantTable {
  readonly database: D1DatabaseLike;
  readonly scope: D1TenantScope;

  constructor(input: D1TenantStoreOptions, store: string) {
    this.database = input.database;
    this.scope = requireD1TenantScope(input, store);
  }

  prepare(sql: string, values: readonly unknown[] = []): D1PreparedStatementLike {
    return prepareD1TenantStatement(this.database, this.scope, sql, values);
  }
}
