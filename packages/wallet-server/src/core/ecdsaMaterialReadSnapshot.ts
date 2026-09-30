import type { WalletId } from '@shared/utils/domainIds';
import type { D1WalletStoreScope } from './d1WalletStore';

const INSTALLATION_COLUMNS = [
  'link_session_id', 'authority_id', 'wallet_id', 'auth_method_id', 'device_id',
  'package_set_digest_b64u', 'target_factor_verification_digest_b64u',
  'target_factor_verified_at_ms', 'source_manifest_digest_b64u',
  'delivery_recipient_public_key_b64u', 'packages_json', 'server_reservation_ids_json',
  'installed_record_set_digest_b64u', 'activated_at_ms',
] as const;

type SqlCondition = { readonly sql: string; readonly bindings: readonly unknown[] };
type StoredRow = Readonly<Record<string, unknown>>;

/** Request-local evidence of the exact records a material resolver examined. */
export class EcdsaMaterialReadSnapshot {
  readonly #scope: D1WalletStoreScope;
  readonly #conditions: readonly SqlCondition[];

  private constructor(
    readonly walletId: WalletId,
    scope: D1WalletStoreScope,
    conditions: readonly SqlCondition[],
  ) {
    this.#scope = scope;
    this.#conditions = conditions;
  }

  static canonical(
    scope: D1WalletStoreScope,
    walletId: WalletId,
    activationId: string,
    rows: readonly StoredRow[],
  ): EcdsaMaterialReadSnapshot {
    return new EcdsaMaterialReadSnapshot(walletId, scope, [recordSetCondition(
      'wallet_signers', scope, walletId, ['record_json'], rows,
      "signer_family = 'ecdsa' AND json_extract(record_json, '$.walletKey.publicCapability.material_activation.activation_id') = ?",
      [activationId],
    )]);
  }

  static linked(
    scope: D1WalletStoreScope,
    walletId: WalletId,
    installations: readonly StoredRow[],
    signers: readonly StoredRow[],
  ): EcdsaMaterialReadSnapshot {
    return new EcdsaMaterialReadSnapshot(walletId, scope, [
      recordSetCondition('linked_device_authority_installations', scope, walletId,
        INSTALLATION_COLUMNS, installations, '1', []),
      recordSetCondition('wallet_signers', scope, walletId,
        ['record_json'], signers, "signer_family = 'ecdsa'", []),
    ]);
  }

  condition(scope: D1WalletStoreScope): SqlCondition {
    if (scope.namespace !== this.#scope.namespace || scope.orgId !== this.#scope.orgId ||
        scope.projectId !== this.#scope.projectId || scope.envId !== this.#scope.envId) {
      return { sql: '0', bindings: [] };
    }
    const clauses: string[] = [];
    const bindings: unknown[] = [];
    for (const condition of this.#conditions) {
      clauses.push(`(${condition.sql})`);
      bindings.push(...condition.bindings);
    }
    return { sql: clauses.join(' AND '), bindings };
  }
}

function recordSetCondition(
  table: 'wallet_signers' | 'linked_device_authority_installations',
  scope: D1WalletStoreScope,
  walletId: WalletId,
  columns: readonly string[],
  rows: readonly StoredRow[],
  filter: string,
  filterBindings: readonly unknown[],
): SqlCondition {
  const values: (string | number | null)[][] = [];
  for (const row of rows) {
    const tuple: (string | number | null)[] = [];
    for (const column of columns) {
      const value = row[column];
      if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
        throw new Error(`Invalid stored material column: ${column}`);
      }
      tuple.push(value);
    }
    values.push(tuple);
  }
  const predicate = `namespace = ? AND org_id = ? AND project_id = ? AND env_id = ? AND wallet_id = ? AND ${filter}`;
  const identity = [scope.namespace, scope.orgId, scope.projectId, scope.envId, walletId, ...filterBindings];
  // Cardinality detects insertions; tuple equality detects replacement and retirement.
  return {
    sql: `(SELECT COUNT(*) FROM ${table} WHERE ${predicate}) = ?
      AND NOT EXISTS (SELECT 1 FROM ${table} WHERE ${predicate}
        AND json_array(${columns.join(', ')}) NOT IN (SELECT value FROM json_each(?)))`,
    bindings: [...identity, rows.length, ...identity, JSON.stringify(values)],
  };
}
