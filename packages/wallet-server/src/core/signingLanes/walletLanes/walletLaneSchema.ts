import { sha256HexUtf8 } from '@shared/utils/digests';
import type { SyncSqliteConnectionV1 } from '../../../storage/syncSqlite';
import {
  parseWalletLaneOwnerV1,
  walletLaneOwnersEqual,
  type WalletLaneOwnerV1,
} from './walletLaneRecords';

export const WALLET_LANE_SCHEMA_VERSION = 1;

/**
 * The Router lane aggregate for one wallet. The table definitions are the
 * former Gateway D1 lane tables, unchanged, so the shared SQL store keeps its
 * statements and guards. Each database belongs to exactly one wallet owner,
 * which makes every uniqueness constraint below wallet-local.
 */
const WALLET_LANE_SCHEMA_V1 = `
CREATE TABLE wallet_lane_store_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  owner_json TEXT NOT NULL CHECK (json_valid(owner_json)),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0)
);
CREATE TRIGGER wallet_lane_store_meta_immutable
BEFORE UPDATE ON wallet_lane_store_meta
BEGIN
  SELECT RAISE(ABORT, 'wallet lane owner is immutable');
END;
CREATE TRIGGER wallet_lane_store_meta_no_delete
BEFORE DELETE ON wallet_lane_store_meta
BEGIN
  SELECT RAISE(ABORT, 'wallet lane owner is immutable');
END;
CREATE TABLE lane_cas_guard (
  guard_id INTEGER PRIMARY KEY CHECK (guard_id = 1)
);
CREATE TABLE lane_effect_journal (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  effect_id TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  wallet_key_id TEXT NOT NULL,
  lane_id TEXT NOT NULL,
  lane_share_epoch TEXT NOT NULL,
  effect_kind TEXT NOT NULL,
  request_digest_b64u TEXT NOT NULL,
  status TEXT NOT NULL,
  response_digest_b64u TEXT,
  recorded_at_ms INTEGER NOT NULL,
  confirmed_at_ms INTEGER,
  version INTEGER NOT NULL,
  command_digest_b64u TEXT NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, effect_id),
  UNIQUE (namespace, org_id, project_id, env_id, operation_id, effect_kind),
  FOREIGN KEY (namespace, org_id, project_id, env_id, enrollment_id)
    REFERENCES lane_enrollments(namespace, org_id, project_id, env_id, enrollment_id),
  FOREIGN KEY (namespace, org_id, project_id, env_id, operation_id)
    REFERENCES lane_protocol_operations(namespace, org_id, project_id, env_id, operation_id),
  CHECK (effect_kind IN ('activate_server_material', 'retire_server_material', 'invalidate_holder_material')),
  CHECK (status IN ('recorded', 'confirmed')),
  CHECK (
    (status = 'recorded' AND response_digest_b64u IS NULL AND confirmed_at_ms IS NULL)
    OR (status = 'confirmed' AND response_digest_b64u IS NOT NULL AND confirmed_at_ms IS NOT NULL AND confirmed_at_ms >= recorded_at_ms)
  ),
  CHECK (version > 0),
  CHECK (recorded_at_ms >= 0)
);
CREATE TABLE lane_enrollments (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  manifest_digest_b64u TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  lifecycle_json TEXT NOT NULL,
  version INTEGER NOT NULL,
  command_digest_b64u TEXT NOT NULL,
  revocation_fence_command_digest_b64u TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, enrollment_id),
  UNIQUE (namespace, org_id, project_id, env_id, manifest_digest_b64u),
  CHECK (length(enrollment_id) > 0),
  CHECK (length(wallet_id) > 0),
  CHECK (length(manifest_digest_b64u) > 0),
  CHECK (json_valid(manifest_json)),
  CHECK (json_valid(lifecycle_json)),
  CHECK (version > 0),
  CHECK (created_at_ms >= 0 AND updated_at_ms >= created_at_ms)
);
CREATE TABLE lane_locks (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  lock_key TEXT NOT NULL,
  lock_kind TEXT NOT NULL,
  enrollment_id TEXT,
  wallet_key_id TEXT,
  lane_id TEXT,
  lock_id TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  acquired_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, lock_key),
  CHECK (lock_kind IN ('wallet_key', 'enrollment')),
  CHECK (length(lock_id) > 0),
  CHECK (expires_at_ms > acquired_at_ms),
  CHECK ((lock_kind = 'wallet_key' AND wallet_key_id IS NOT NULL AND enrollment_id IS NULL AND lane_id IS NULL) OR
         (lock_kind = 'enrollment' AND enrollment_id IS NOT NULL AND wallet_key_id IS NULL AND lane_id IS NULL))
);
CREATE TABLE lane_product_epochs (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  wallet_key_id TEXT NOT NULL,
  lane_id TEXT NOT NULL,
  lane_share_epoch TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  target_material_activation_id TEXT NOT NULL,
  material_activation_json TEXT NOT NULL,
  holder_participant_json TEXT NOT NULL,
  signing_worker_participant_json TEXT NOT NULL,
  participant_set_binding_digest_b64u TEXT NOT NULL,
  revocation_epoch INTEGER NOT NULL,
  lane_kind TEXT NOT NULL,
  key_family TEXT NOT NULL,
  public_identity_digest_b64u TEXT NOT NULL,
  state TEXT NOT NULL,
  product_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  command_digest_b64u TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_key_id, lane_id, lane_share_epoch),
  UNIQUE (namespace, org_id, project_id, env_id, target_material_activation_id),
  FOREIGN KEY (namespace, org_id, project_id, env_id, enrollment_id)
    REFERENCES lane_enrollments(namespace, org_id, project_id, env_id, enrollment_id),
  FOREIGN KEY (namespace, org_id, project_id, env_id, operation_id)
    REFERENCES lane_protocol_operations(namespace, org_id, project_id, env_id, operation_id),
  CHECK (json_valid(material_activation_json)),
  CHECK (json_valid(holder_participant_json)),
  CHECK (json_valid(signing_worker_participant_json)),
  CHECK (length(participant_set_binding_digest_b64u) > 0),
  CHECK (revocation_epoch >= 0),
  CHECK (json_valid(product_json)),
  CHECK (state IN ('pending_visibility', 'active', 'retired', 'revocation_pending', 'revoked')),
  CHECK (lane_kind IN ('owner_passkey', 'owner_email_otp', 'linked_device', 'delegated_execution', 'recovery', 'break_glass')),
  CHECK (length(command_digest_b64u) > 0),
  CHECK (version > 0),
  CHECK (key_family IN ('ed25519', 'ecdsa_secp256k1')),
  CHECK (created_at_ms >= 0 AND updated_at_ms >= created_at_ms)
);
CREATE TABLE lane_protocol_operations (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  wallet_key_id TEXT NOT NULL,
  source_lane_id TEXT NOT NULL,
  source_lane_share_epoch TEXT NOT NULL,
  source_revocation_epoch INTEGER NOT NULL,
  target_lane_id TEXT NOT NULL,
  target_lane_share_epoch TEXT NOT NULL,
  target_material_activation_id TEXT NOT NULL,
  key_family TEXT NOT NULL,
  job_json TEXT NOT NULL,
  lifecycle_json TEXT NOT NULL,
  version INTEGER NOT NULL,
  command_digest_b64u TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, operation_id),
  UNIQUE (namespace, org_id, project_id, env_id, target_material_activation_id),
  FOREIGN KEY (namespace, org_id, project_id, env_id, enrollment_id)
    REFERENCES lane_enrollments(namespace, org_id, project_id, env_id, enrollment_id),
  CHECK (source_revocation_epoch >= 0),
  CHECK (key_family IN ('ed25519', 'ecdsa_secp256k1')),
  CHECK (json_valid(job_json)),
  CHECK (json_valid(lifecycle_json)),
  CHECK (version > 0),
  CHECK (created_at_ms >= 0 AND updated_at_ms >= created_at_ms)
);
CREATE TABLE lane_receipts (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  operation_id TEXT,
  receipt_kind TEXT NOT NULL,
  receipt_digest_b64u TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, receipt_id),
  UNIQUE (namespace, org_id, project_id, env_id, operation_id, receipt_kind),
  FOREIGN KEY (namespace, org_id, project_id, env_id, enrollment_id)
    REFERENCES lane_enrollments(namespace, org_id, project_id, env_id, enrollment_id),
  FOREIGN KEY (namespace, org_id, project_id, env_id, operation_id)
    REFERENCES lane_protocol_operations(namespace, org_id, project_id, env_id, operation_id),
  CHECK (json_valid(receipt_json)),
  CHECK (created_at_ms >= 0)
);
CREATE INDEX lane_enrollments_wallet_idx
  ON lane_enrollments(namespace, org_id, project_id, env_id, wallet_id, updated_at_ms);
CREATE UNIQUE INDEX lane_product_epochs_one_active_idx
  ON lane_product_epochs(namespace, org_id, project_id, env_id, wallet_key_id, lane_id)
  WHERE state = 'active';
CREATE INDEX lane_product_epochs_wallet_active_idx
  ON lane_product_epochs(namespace, org_id, project_id, env_id, wallet_id, state, updated_at_ms);
CREATE INDEX lane_protocol_operations_enrollment_idx
  ON lane_protocol_operations(namespace, org_id, project_id, env_id, enrollment_id, operation_id);
CREATE TRIGGER lane_cas_guard_no_delete
BEFORE DELETE ON lane_cas_guard
BEGIN
  SELECT RAISE(ABORT, 'lane_cas_guard is immutable');
END;
INSERT INTO lane_cas_guard (guard_id) VALUES (1);
`;

export type WalletLaneDatabaseOpenResultV1 =
  | { readonly kind: 'initialized'; readonly owner: WalletLaneOwnerV1 }
  | { readonly kind: 'opened'; readonly owner: WalletLaneOwnerV1 };

/**
 * Opens one wallet's lane database. An empty database is initialized for the
 * requesting owner in one transaction; an existing database must carry the
 * current schema version and exactly that owner. A different owner, an
 * unknown schema version, or unrelated tables fail closed.
 */
export function openWalletLaneDatabaseV1(
  connection: SyncSqliteConnectionV1,
  owner: WalletLaneOwnerV1,
  nowMs: number,
): WalletLaneDatabaseOpenResultV1 {
  return connection.transaction(() => {
    const tables = userTables(connection);
    if (tables.length === 0) {
      connection.executeScript(WALLET_LANE_SCHEMA_V1);
      connection.execute(
        'INSERT INTO wallet_lane_store_meta (singleton, schema_version, owner_json, created_at_ms) VALUES (1, ?1, ?2, ?3)',
        [WALLET_LANE_SCHEMA_VERSION, canonicalOwnerJson(owner), nowMs],
      );
      return { kind: 'initialized', owner };
    }
    if (!tables.some((row) => row === 'wallet_lane_store_meta')) {
      throw new Error('wallet lane database contains unrelated tables');
    }
    const [meta] = connection.execute(
      'SELECT schema_version, owner_json FROM wallet_lane_store_meta WHERE singleton = 1',
      [],
    );
    if (!meta) throw new Error('wallet lane database has no owner record');
    const version = Number(meta.schema_version);
    if (version !== WALLET_LANE_SCHEMA_VERSION) {
      throw new Error(
        `wallet lane database schema version ${version} is not supported; expected ${WALLET_LANE_SCHEMA_VERSION}`,
      );
    }
    if (typeof meta.owner_json !== 'string') throw new Error('wallet lane owner record is invalid');
    const stored = parseWalletLaneOwnerV1(JSON.parse(meta.owner_json));
    if (!walletLaneOwnersEqual(stored, owner)) {
      throw new Error('wallet lane database belongs to another owner');
    }
    return { kind: 'opened', owner: stored };
  });
}

/** Reads the owner and schema version without creating or changing anything. */
export function inspectWalletLaneDatabaseV1(
  connection: SyncSqliteConnectionV1,
):
  | { readonly kind: 'empty' }
  | { readonly kind: 'wallet_lanes'; readonly schemaVersion: number; readonly owner: WalletLaneOwnerV1 }
  | { readonly kind: 'unrecognized' } {
  const tables = userTables(connection);
  if (tables.length === 0) return { kind: 'empty' };
  if (!tables.some((row) => row === 'wallet_lane_store_meta')) return { kind: 'unrecognized' };
  const [meta] = connection.execute(
    'SELECT schema_version, owner_json FROM wallet_lane_store_meta WHERE singleton = 1',
    [],
  );
  if (!meta || typeof meta.owner_json !== 'string') return { kind: 'unrecognized' };
  return {
    kind: 'wallet_lanes',
    schemaVersion: Number(meta.schema_version),
    owner: parseWalletLaneOwnerV1(JSON.parse(meta.owner_json)),
  };
}

/**
 * Stable storage identity for one wallet's Router lane aggregate. It depends
 * only on the canonical tenant scope and wallet id, never on a root version,
 * placement hint, or client location.
 */
export async function walletLaneStorageNameV1(owner: WalletLaneOwnerV1): Promise<string> {
  const digest = await sha256HexUtf8(`seams/router/wallet-lanes/v1\u0000${canonicalOwnerJson(owner)}`);
  return `router-wallet-lanes-${digest}`;
}

export function canonicalOwnerJson(owner: WalletLaneOwnerV1): string {
  return JSON.stringify({
    namespace: owner.namespace,
    orgId: owner.orgId,
    projectId: owner.projectId,
    envId: owner.envId,
    walletId: String(owner.walletId),
  });
}

/** Host-internal tables (SQLite's own, and Durable Object bookkeeping) are not wallet data. */
function userTables(connection: SyncSqliteConnectionV1): readonly string[] {
  return connection
    .execute("SELECT name FROM sqlite_master WHERE type = 'table'", [])
    .map((row) => String(row.name))
    .filter((name) => !name.startsWith('sqlite_') && !name.startsWith('_cf_'));
}
