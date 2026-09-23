import {
  MANAGED_WALLET_LANES,
  buildWalletHomeLane,
  parseManagedWalletHomeLaneId,
  parseWalletDirectoryRevision,
  parseWalletHomeLaneId,
  parseWalletLaneEpoch,
  parseWalletRegionMigration,
  parseWalletRegionMigrationGrant,
  parseWalletRegionMigrationId,
  requireWalletRegionBoundary,
  walletRegionMigrationGrantDigestIsValid,
  type AuthorizedWalletRegionMigration,
  type CompletedWalletRegionMigration,
  type CutoverCommittedWalletRegionMigration,
  type ManagedWalletLaneStatus,
  type ManagedWalletHomeLaneId,
  type ManagedWalletRegion,
  type TargetVerifiedWalletRegionMigration,
  type WalletHomeLaneId,
  type WalletRegionMigration,
  type WalletRegionMigrationGrant,
  type WalletRegionMigrationId,
} from '@shared/wallet-region';
import { parseWalletId, type WalletId } from '@shared/utils/domainIds';
import type {
  ManagedWalletLaneCatalogMutation,
  ManagedWalletLaneCatalogStore,
  ManagedWalletLaneConfiguration,
  ManagedWalletLanePlacementEvidence,
  WalletHomeLaneDirectoryRecord,
  WalletHomeLaneDirectoryStore,
  WalletLaneServiceBindingName,
  WalletRegionMigrationJournalRecord,
  WalletRegionMigrationGrantRecord,
  WalletRegionStoreConflict,
  WalletRegionStoreMutation,
} from '../../../../core/walletRegion/WalletRegionStore';
import { d1ChangedRows, formatD1ExecStatement } from '../../../../storage/d1Sql';
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from '../../../../storage/tenantRoute';

export const WALLET_REGION_D1_SCHEMA_SQL = Object.freeze([
  `
    CREATE TABLE IF NOT EXISTS managed_wallet_lanes (
      lane_id TEXT NOT NULL,
      product_region TEXT NOT NULL,
      status TEXT NOT NULL,
      router_binding TEXT NOT NULL,
      deriver_a_binding TEXT NOT NULL,
      deriver_b_binding TEXT NOT NULL,
      signing_worker_binding TEXT NOT NULL,
      placement_evidence_json TEXT NOT NULL,
      configuration_version INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      PRIMARY KEY (lane_id, configuration_version),
      CHECK (lane_id IN ('managed-na-v1', 'managed-eu-v1', 'managed-apac-v1')),
      CHECK (product_region IN ('north_america', 'europe', 'asia_pacific')),
      CHECK (
        (lane_id = 'managed-na-v1' AND product_region = 'north_america') OR
        (lane_id = 'managed-eu-v1' AND product_region = 'europe') OR
        (lane_id = 'managed-apac-v1' AND product_region = 'asia_pacific')
      ),
      CHECK (status IN ('provisioning', 'available', 'draining', 'unavailable')),
      CHECK (json_valid(placement_evidence_json)),
      CHECK (configuration_version > 0),
      CHECK (created_at_ms > 0),
      CHECK (
        status NOT IN ('available', 'draining') OR
        json_extract(placement_evidence_json, '$.kind') = 'verified'
      )
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS active_managed_wallet_lanes (
      lane_id TEXT PRIMARY KEY,
      configuration_version INTEGER NOT NULL,
      activated_at_ms INTEGER NOT NULL,
      FOREIGN KEY (lane_id, configuration_version)
        REFERENCES managed_wallet_lanes(lane_id, configuration_version),
      CHECK (activated_at_ms > 0)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS wallet_home_lanes (
      wallet_id TEXT PRIMARY KEY,
      lane_id TEXT NOT NULL,
      lane_epoch INTEGER NOT NULL,
      directory_revision INTEGER NOT NULL,
      migration_id TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      CHECK (length(wallet_id) > 0),
      CHECK (length(lane_id) > 0),
      CHECK (lane_epoch > 0),
      CHECK (directory_revision > 0),
      CHECK (migration_id IS NULL OR length(migration_id) > 0),
      CHECK (created_at_ms > 0),
      CHECK (updated_at_ms >= created_at_ms)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS wallet_home_lanes_lane_lookup
      ON wallet_home_lanes (lane_id, lane_epoch, wallet_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS wallet_region_migration_grants (
      grant_digest_b64u TEXT PRIMARY KEY,
      migration_id TEXT NOT NULL UNIQUE,
      wallet_id TEXT NOT NULL,
      grant_json TEXT NOT NULL,
      status TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at_ms INTEGER,
      CHECK (json_valid(grant_json)),
      CHECK (json_extract(grant_json, '$.grantDigest') = grant_digest_b64u),
      CHECK (json_extract(grant_json, '$.migrationId') = migration_id),
      CHECK (json_extract(grant_json, '$.walletId') = wallet_id),
      CHECK (status IN ('issued', 'consumed')),
      CHECK (expires_at > issued_at),
      CHECK (
        (status = 'issued' AND consumed_at_ms IS NULL) OR
        (status = 'consumed' AND consumed_at_ms IS NOT NULL)
      )
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS wallet_region_migrations (
      migration_id TEXT PRIMARY KEY,
      wallet_id TEXT NOT NULL,
      state_kind TEXT NOT NULL,
      record_json TEXT NOT NULL,
      record_revision INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      FOREIGN KEY (wallet_id) REFERENCES wallet_home_lanes(wallet_id),
      CHECK (state_kind IN (
        'authorized',
        'source_frozen',
        'target_verified',
        'cutover_committed',
        'completed'
      )),
      CHECK (json_valid(record_json)),
      CHECK (json_extract(record_json, '$.migrationId') = migration_id),
      CHECK (json_extract(record_json, '$.walletId') = wallet_id),
      CHECK (json_extract(record_json, '$.kind') = state_kind),
      CHECK (record_revision > 0),
      CHECK (created_at_ms > 0),
      CHECK (updated_at_ms >= created_at_ms)
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS wallet_region_migrations_active_wallet
      ON wallet_region_migrations (wallet_id)
      WHERE state_kind <> 'completed'
  `,
  `
    CREATE TABLE IF NOT EXISTS wallet_region_cutovers (
      migration_id TEXT PRIMARY KEY,
      wallet_id TEXT NOT NULL,
      source_lane_id TEXT NOT NULL,
      source_epoch INTEGER NOT NULL,
      target_lane_id TEXT NOT NULL,
      target_epoch INTEGER NOT NULL,
      directory_revision INTEGER NOT NULL,
      receipt_json TEXT NOT NULL,
      committed_at_ms INTEGER NOT NULL,
      FOREIGN KEY (migration_id) REFERENCES wallet_region_migrations(migration_id),
      FOREIGN KEY (wallet_id) REFERENCES wallet_home_lanes(wallet_id),
      CHECK (source_lane_id <> target_lane_id),
      CHECK (target_epoch = source_epoch + 1),
      CHECK (directory_revision > 1),
      CHECK (json_valid(receipt_json)),
      CHECK (committed_at_ms > 0)
    )
  `,
  `
    CREATE TRIGGER IF NOT EXISTS managed_wallet_lanes_immutable_update
    BEFORE UPDATE ON managed_wallet_lanes
    BEGIN
      SELECT RAISE(ABORT, 'managed wallet lane configurations are immutable');
    END
  `,
  `
    CREATE TRIGGER IF NOT EXISTS managed_wallet_lanes_immutable_delete
    BEFORE DELETE ON managed_wallet_lanes
    BEGIN
      SELECT RAISE(ABORT, 'managed wallet lane configurations are immutable');
    END
  `,
  `
    CREATE TRIGGER IF NOT EXISTS wallet_home_lanes_valid_update
    BEFORE UPDATE ON wallet_home_lanes
    WHEN NOT (
      NEW.wallet_id = OLD.wallet_id AND
      NEW.created_at_ms = OLD.created_at_ms AND
      NEW.updated_at_ms >= OLD.updated_at_ms AND
      (
        (
          NEW.lane_id = OLD.lane_id AND
          NEW.lane_epoch = OLD.lane_epoch AND
          NEW.directory_revision = OLD.directory_revision AND
          OLD.migration_id IS NULL AND
          NEW.migration_id IS NOT NULL
        ) OR
        (
          NEW.lane_id <> OLD.lane_id AND
          NEW.lane_epoch = OLD.lane_epoch + 1 AND
          NEW.directory_revision = OLD.directory_revision + 1 AND
          OLD.migration_id IS NOT NULL AND
          NEW.migration_id = OLD.migration_id
        ) OR
        (
          NEW.lane_id = OLD.lane_id AND
          NEW.lane_epoch = OLD.lane_epoch AND
          NEW.directory_revision = OLD.directory_revision AND
          OLD.migration_id IS NOT NULL AND
          NEW.migration_id IS NULL
        )
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'wallet Home lane update violates the migration lifecycle');
    END
  `,
  `
    CREATE TRIGGER IF NOT EXISTS wallet_home_lanes_immutable_delete
    BEFORE DELETE ON wallet_home_lanes
    BEGIN
      SELECT RAISE(ABORT, 'wallet Home lane assignments are durable');
    END
  `,
  `
    CREATE TRIGGER IF NOT EXISTS wallet_region_grants_valid_update
    BEFORE UPDATE ON wallet_region_migration_grants
    WHEN NOT (
      NEW.grant_digest_b64u = OLD.grant_digest_b64u AND
      NEW.migration_id = OLD.migration_id AND
      NEW.wallet_id = OLD.wallet_id AND
      NEW.grant_json = OLD.grant_json AND
      NEW.issued_at = OLD.issued_at AND
      NEW.expires_at = OLD.expires_at AND
      OLD.status = 'issued' AND
      OLD.consumed_at_ms IS NULL AND
      NEW.status = 'consumed' AND
      NEW.consumed_at_ms IS NOT NULL
    )
    BEGIN
      SELECT RAISE(ABORT, 'wallet region migration grant update is invalid');
    END
  `,
  `
    CREATE TRIGGER IF NOT EXISTS wallet_region_grants_immutable_delete
    BEFORE DELETE ON wallet_region_migration_grants
    BEGIN
      SELECT RAISE(ABORT, 'wallet region migration grants are durable audit records');
    END
  `,
  `
    CREATE TRIGGER IF NOT EXISTS wallet_region_migrations_valid_update
    BEFORE UPDATE ON wallet_region_migrations
    WHEN NOT (
      NEW.migration_id = OLD.migration_id AND
      NEW.wallet_id = OLD.wallet_id AND
      NEW.record_revision = OLD.record_revision + 1 AND
      NEW.created_at_ms = OLD.created_at_ms AND
      NEW.updated_at_ms >= OLD.updated_at_ms AND
      (
        (OLD.state_kind = 'authorized' AND NEW.state_kind = 'source_frozen') OR
        (OLD.state_kind = 'source_frozen' AND NEW.state_kind = 'target_verified') OR
        (OLD.state_kind = 'target_verified' AND NEW.state_kind = 'cutover_committed') OR
        (OLD.state_kind = 'cutover_committed' AND NEW.state_kind = 'completed')
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'wallet region migration transition is invalid');
    END
  `,
  `
    CREATE TRIGGER IF NOT EXISTS wallet_region_migrations_immutable_delete
    BEFORE DELETE ON wallet_region_migrations
    BEGIN
      SELECT RAISE(ABORT, 'wallet region migrations are durable audit records');
    END
  `,
  `
    CREATE TRIGGER IF NOT EXISTS wallet_region_cutovers_immutable_update
    BEFORE UPDATE ON wallet_region_cutovers
    BEGIN
      SELECT RAISE(ABORT, 'wallet region cutover receipts are immutable');
    END
  `,
  `
    CREATE TRIGGER IF NOT EXISTS wallet_region_cutovers_immutable_delete
    BEFORE DELETE ON wallet_region_cutovers
    BEGIN
      SELECT RAISE(ABORT, 'wallet region cutover receipts are immutable');
    END
  `,
] as const);

export async function ensureWalletRegionD1Schema(input: {
  readonly database: D1DatabaseLike;
}): Promise<void> {
  for (const statement of WALLET_REGION_D1_SCHEMA_SQL) {
    await input.database.exec(formatD1ExecStatement(statement));
  }
}

export type CloudflareD1WalletRegionStoreOptions = {
  readonly database: D1DatabaseLike;
  readonly now?: () => number;
  readonly ensureSchema?: boolean;
};

type ManagedWalletLaneRow = {
  readonly lane_id?: unknown;
  readonly product_region?: unknown;
  readonly status?: unknown;
  readonly router_binding?: unknown;
  readonly deriver_a_binding?: unknown;
  readonly deriver_b_binding?: unknown;
  readonly signing_worker_binding?: unknown;
  readonly placement_evidence_json?: unknown;
  readonly configuration_version?: unknown;
};

type WalletHomeLaneRow = {
  readonly wallet_id?: unknown;
  readonly lane_id?: unknown;
  readonly lane_epoch?: unknown;
  readonly directory_revision?: unknown;
  readonly migration_id?: unknown;
  readonly created_at_ms?: unknown;
  readonly updated_at_ms?: unknown;
};

type WalletRegionMigrationRow = {
  readonly migration_id?: unknown;
  readonly wallet_id?: unknown;
  readonly state_kind?: unknown;
  readonly record_json?: unknown;
  readonly record_revision?: unknown;
  readonly created_at_ms?: unknown;
  readonly updated_at_ms?: unknown;
};

type WalletRegionMigrationGrantRow = {
  readonly grant_json?: unknown;
  readonly status?: unknown;
  readonly consumed_at_ms?: unknown;
};

function requirePositiveInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return parsed;
}

function requireNonemptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new Error(`${label} must be a non-empty canonical string`);
  }
  return value;
}

function parseBindingName(value: unknown, label: string): WalletLaneServiceBindingName {
  const binding = requireNonemptyString(value, label);
  if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(binding)) {
    throw new Error(`${label} must be an uppercase Worker service binding name`);
  }
  return binding as WalletLaneServiceBindingName;
}

function parseProductRegion(value: unknown): ManagedWalletRegion {
  if (value === 'north_america' || value === 'europe' || value === 'asia_pacific') return value;
  throw new Error('managed wallet lane product region is invalid');
}

function parseLaneStatus(value: unknown): ManagedWalletLaneStatus {
  if (
    value === 'provisioning' ||
    value === 'available' ||
    value === 'draining' ||
    value === 'unavailable'
  ) {
    return value;
  }
  throw new Error('managed wallet lane status is invalid');
}

function parsePlacementEvidence(value: unknown): ManagedWalletLanePlacementEvidence {
  const raw = typeof value === 'string' ? JSON.parse(value) : value;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('managed wallet lane placement evidence must be an object');
  }
  const record = raw as Record<string, unknown>;
  const recordedAtMs = requirePositiveInteger(record.recordedAtMs, 'placement recordedAtMs');
  if (record.kind === 'pending') {
    return { kind: 'pending', recordedAtMs };
  }
  const observedD1Location = requireNonemptyString(
    record.observedD1Location,
    'placement observedD1Location',
  );
  const maximumWriteLatencyMs = requirePositiveInteger(
    record.maximumWriteLatencyMs,
    'placement maximumWriteLatencyMs',
  );
  if (record.kind === 'verified') {
    return { kind: 'verified', recordedAtMs, observedD1Location, maximumWriteLatencyMs };
  }
  if (record.kind === 'rejected') {
    return {
      kind: 'rejected',
      recordedAtMs,
      observedD1Location,
      maximumWriteLatencyMs,
      rejectionReason: requireNonemptyString(record.rejectionReason, 'placement rejectionReason'),
    };
  }
  throw new Error('managed wallet lane placement evidence kind is invalid');
}

function parseManagedWalletLaneConfiguration(
  row: ManagedWalletLaneRow,
): ManagedWalletLaneConfiguration {
  const laneId = requireWalletRegionBoundary(
    parseManagedWalletHomeLaneId(row.lane_id),
    'managed wallet lane id',
  );
  const productRegion = parseProductRegion(row.product_region);
  if (MANAGED_WALLET_LANES[productRegion].laneId !== laneId) {
    throw new Error('managed wallet lane id does not match its product region');
  }
  const status = parseLaneStatus(row.status);
  const placementEvidence = parsePlacementEvidence(row.placement_evidence_json);
  const base = {
    laneId,
    productRegion,
    routerBinding: parseBindingName(row.router_binding, 'router binding'),
    deriverABinding: parseBindingName(row.deriver_a_binding, 'Deriver A binding'),
    deriverBBinding: parseBindingName(row.deriver_b_binding, 'Deriver B binding'),
    signingWorkerBinding: parseBindingName(row.signing_worker_binding, 'SigningWorker binding'),
    configurationVersion: requirePositiveInteger(
      row.configuration_version,
      'lane configuration version',
    ),
  };
  if (status === 'available' || status === 'draining') {
    if (placementEvidence.kind !== 'verified') {
      throw new Error(`${status} managed wallet lane requires verified placement evidence`);
    }
    return { ...base, status, placementEvidence };
  }
  if (placementEvidence.kind === 'verified') {
    throw new Error(`${status} managed wallet lane cannot carry verified placement evidence`);
  }
  return { ...base, status, placementEvidence };
}

function configurationValues(configuration: ManagedWalletLaneConfiguration): readonly unknown[] {
  return [
    String(configuration.laneId),
    configuration.productRegion,
    configuration.status,
    configuration.routerBinding,
    configuration.deriverABinding,
    configuration.deriverBBinding,
    configuration.signingWorkerBinding,
    JSON.stringify(configuration.placementEvidence),
    configuration.configurationVersion,
  ];
}

function configurationsEqual(
  left: ManagedWalletLaneConfiguration,
  right: ManagedWalletLaneConfiguration,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseWalletHomeLaneRow(row: WalletHomeLaneRow): WalletHomeLaneDirectoryRecord {
  const walletIdResult = parseWalletId(row.wallet_id);
  if (!walletIdResult.ok) throw new Error(walletIdResult.error.message);
  const migrationId =
    row.migration_id == null
      ? null
      : requireWalletRegionBoundary(
          parseWalletRegionMigrationId(row.migration_id),
          'home lane migration id',
        );
  return {
    homeLane: buildWalletHomeLane({
      walletId: walletIdResult.value,
      laneId: requireWalletRegionBoundary(parseWalletHomeLaneId(row.lane_id), 'home lane id'),
      laneEpoch: requireWalletRegionBoundary(
        parseWalletLaneEpoch(Number(row.lane_epoch)),
        'home lane epoch',
      ),
    }),
    directoryRevision: requireWalletRegionBoundary(
      parseWalletDirectoryRevision(Number(row.directory_revision)),
      'directory revision',
    ),
    migrationId,
    createdAtMs: requirePositiveInteger(row.created_at_ms, 'home lane createdAtMs'),
    updatedAtMs: requirePositiveInteger(row.updated_at_ms, 'home lane updatedAtMs'),
  };
}

function parseWalletRegionMigrationRow(
  row: WalletRegionMigrationRow,
): WalletRegionMigrationJournalRecord {
  const recordJson = requireNonemptyString(row.record_json, 'migration record JSON');
  const migration = parseWalletRegionMigration(JSON.parse(recordJson));
  if (migration.kind !== row.state_kind) {
    throw new Error('migration row state kind differs from its record');
  }
  return {
    migration,
    recordRevision: requirePositiveInteger(row.record_revision, 'migration record revision'),
    createdAtMs: requirePositiveInteger(row.created_at_ms, 'migration createdAtMs'),
    updatedAtMs: requirePositiveInteger(row.updated_at_ms, 'migration updatedAtMs'),
  };
}

function parseWalletRegionMigrationGrantRow(
  row: WalletRegionMigrationGrantRow,
): WalletRegionMigrationGrantRecord {
  const grant = parseWalletRegionMigrationGrant(
    JSON.parse(requireNonemptyString(row.grant_json, 'migration grant JSON')),
  );
  if (row.status === 'issued') return { kind: 'issued', grant };
  if (row.status === 'consumed') {
    return {
      kind: 'consumed',
      grant,
      consumedAtMs: requirePositiveInteger(row.consumed_at_ms, 'grant consumedAtMs'),
    };
  }
  throw new Error('migration grant status is invalid');
}

function firstBatchResult(results: readonly unknown[], index: number): D1ResultLike {
  const result = results[index];
  if (!result || typeof result !== 'object') {
    throw new Error(`wallet region D1 batch result ${index} is missing`);
  }
  return result as D1ResultLike;
}

function mutationChanged(results: readonly unknown[]): boolean {
  for (let index = 0; index < results.length; index += 1) {
    if (d1ChangedRows(firstBatchResult(results, index)) > 0) return true;
  }
  return false;
}

function sameMigration(left: WalletRegionMigration, right: WalletRegionMigration): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isOrdinaryMigrationTransition(
  current: WalletRegionMigration,
  next: WalletRegionMigration,
): boolean {
  return (
    (current.kind === 'authorized' && next.kind === 'source_frozen') ||
    (current.kind === 'source_frozen' && next.kind === 'target_verified')
  );
}

export class CloudflareD1WalletRegionStore
  implements ManagedWalletLaneCatalogStore, WalletHomeLaneDirectoryStore
{
  private readonly database: D1DatabaseLike;
  private readonly now: () => number;
  private readonly ready: Promise<void>;

  constructor(options: CloudflareD1WalletRegionStoreOptions) {
    this.database = options.database;
    this.now = options.now ?? Date.now;
    this.ready =
      options.ensureSchema === false
        ? Promise.resolve()
        : ensureWalletRegionD1Schema({ database: options.database });
  }

  async putConfiguration(
    configuration: ManagedWalletLaneConfiguration,
  ): Promise<ManagedWalletLaneCatalogMutation> {
    await this.ready;
    const normalized = parseManagedWalletLaneConfiguration({
      lane_id: configuration.laneId,
      product_region: configuration.productRegion,
      status: configuration.status,
      router_binding: configuration.routerBinding,
      deriver_a_binding: configuration.deriverABinding,
      deriver_b_binding: configuration.deriverBBinding,
      signing_worker_binding: configuration.signingWorkerBinding,
      placement_evidence_json: JSON.stringify(configuration.placementEvidence),
      configuration_version: configuration.configurationVersion,
    });
    const result = await this.database
      .prepare(
        `INSERT OR IGNORE INTO managed_wallet_lanes (
           lane_id, product_region, status, router_binding, deriver_a_binding,
           deriver_b_binding, signing_worker_binding, placement_evidence_json,
           configuration_version, created_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .bind(...configurationValues(normalized), this.now())
      .run();
    const stored = await this.getConfiguration(normalized.laneId, normalized.configurationVersion);
    if (!stored || !configurationsEqual(stored, normalized)) {
      return { outcome: 'conflict', current: stored };
    }
    return { outcome: d1ChangedRows(result) === 1 ? 'applied' : 'replayed', value: stored };
  }

  async activateConfiguration(input: {
    readonly laneId: ManagedWalletHomeLaneId;
    readonly configurationVersion: number;
    readonly expectedConfigurationVersion: number | null;
  }): Promise<ManagedWalletLaneCatalogMutation> {
    await this.ready;
    const requested = await this.getConfiguration(input.laneId, input.configurationVersion);
    if (!requested)
      return { outcome: 'conflict', current: await this.getActiveConfiguration(input.laneId) };
    const nowMs = this.now();
    const statement =
      input.expectedConfigurationVersion == null
        ? this.database
            .prepare(
              `INSERT OR IGNORE INTO active_managed_wallet_lanes (
               lane_id, configuration_version, activated_at_ms
             ) VALUES (?1, ?2, ?3)`,
            )
            .bind(String(input.laneId), input.configurationVersion, nowMs)
        : this.database
            .prepare(
              `UPDATE active_managed_wallet_lanes
                SET configuration_version = ?2, activated_at_ms = ?3
              WHERE lane_id = ?1 AND configuration_version = ?4`,
            )
            .bind(
              String(input.laneId),
              input.configurationVersion,
              nowMs,
              input.expectedConfigurationVersion,
            );
    const result = await statement.run();
    const current = await this.getActiveConfiguration(input.laneId);
    if (!current || current.configurationVersion !== input.configurationVersion) {
      return { outcome: 'conflict', current };
    }
    return { outcome: d1ChangedRows(result) === 1 ? 'applied' : 'replayed', value: current };
  }

  async getActiveConfiguration(
    laneId: ManagedWalletHomeLaneId,
  ): Promise<ManagedWalletLaneConfiguration | null> {
    await this.ready;
    const row = await this.database
      .prepare(
        `SELECT lanes.*
           FROM active_managed_wallet_lanes active
           JOIN managed_wallet_lanes lanes
             ON lanes.lane_id = active.lane_id
            AND lanes.configuration_version = active.configuration_version
          WHERE active.lane_id = ?1`,
      )
      .bind(String(laneId))
      .first<ManagedWalletLaneRow>();
    return row ? parseManagedWalletLaneConfiguration(row) : null;
  }

  async listActiveConfigurations(input?: {
    readonly status?: ManagedWalletLaneStatus;
  }): Promise<readonly ManagedWalletLaneConfiguration[]> {
    await this.ready;
    const status = input?.status ?? null;
    const result = await this.database
      .prepare(
        `SELECT lanes.*
           FROM active_managed_wallet_lanes active
           JOIN managed_wallet_lanes lanes
             ON lanes.lane_id = active.lane_id
            AND lanes.configuration_version = active.configuration_version
          WHERE (?1 IS NULL OR lanes.status = ?1)
          ORDER BY lanes.lane_id`,
      )
      .bind(status)
      .all<ManagedWalletLaneRow>();
    return (result.results ?? []).map(parseManagedWalletLaneConfiguration);
  }

  async assignInitialHomeLane(input: {
    readonly homeLane: WalletHomeLaneDirectoryRecord['homeLane'];
    readonly nowMs: number;
  }): Promise<WalletRegionStoreMutation<WalletHomeLaneDirectoryRecord>> {
    await this.ready;
    if (input.homeLane.laneEpoch !== 1) {
      throw new Error('initial wallet Home region assignment must use lane epoch 1');
    }
    const nowMs = requirePositiveInteger(input.nowMs, 'initial Home region timestamp');
    const result = await this.database
      .prepare(
        `INSERT OR IGNORE INTO wallet_home_lanes (
           wallet_id, lane_id, lane_epoch, directory_revision, migration_id,
           created_at_ms, updated_at_ms
         ) VALUES (?1, ?2, 1, 1, NULL, ?3, ?3)`,
      )
      .bind(String(input.homeLane.walletId), String(input.homeLane.laneId), nowMs)
      .run();
    const stored = await this.getHomeLane(input.homeLane.walletId);
    if (
      !stored ||
      stored.homeLane.laneId !== input.homeLane.laneId ||
      stored.homeLane.laneEpoch !== input.homeLane.laneEpoch
    ) {
      return this.conflict(input.homeLane.walletId, null);
    }
    return { outcome: d1ChangedRows(result) === 1 ? 'applied' : 'replayed', value: stored };
  }

  async getHomeLane(walletId: WalletId): Promise<WalletHomeLaneDirectoryRecord | null> {
    await this.ready;
    const row = await this.database
      .prepare(
        `SELECT wallet_id, lane_id, lane_epoch, directory_revision,
                migration_id, created_at_ms, updated_at_ms
           FROM wallet_home_lanes
          WHERE wallet_id = ?1`,
      )
      .bind(String(walletId))
      .first<WalletHomeLaneRow>();
    return row ? parseWalletHomeLaneRow(row) : null;
  }

  async beginMigration(input: {
    readonly migration: AuthorizedWalletRegionMigration;
    readonly grant: WalletRegionMigrationGrant;
    readonly nowMs: number;
  }): Promise<WalletRegionStoreMutation<WalletRegionMigrationJournalRecord>> {
    await this.ready;
    const nowMs = requirePositiveInteger(input.nowMs, 'migration authorization timestamp');
    if (!(await walletRegionMigrationGrantDigestIsValid(input.grant))) {
      throw new Error('wallet region migration grant digest is invalid');
    }
    this.requireGrantMatchesMigration(input.grant, input.migration);
    if (nowMs >= input.grant.expiresAt) {
      throw new Error('wallet region migration grant has expired');
    }
    const migrationJson = JSON.stringify(input.migration);
    const statements: D1PreparedStatementLike[] = [
      this.database
        .prepare(
          `INSERT OR IGNORE INTO wallet_region_migrations (
             migration_id, wallet_id, state_kind, record_json,
             record_revision, created_at_ms, updated_at_ms
           )
           SELECT ?1, ?2, 'authorized', ?3, 1, ?4, ?4
           WHERE EXISTS (
             SELECT 1 FROM wallet_home_lanes
              WHERE wallet_id = ?2 AND lane_id = ?5 AND lane_epoch = ?6
                AND migration_id IS NULL
           ) AND EXISTS (
             SELECT 1 FROM wallet_region_migration_grants
              WHERE grant_digest_b64u = ?7 AND migration_id = ?1
                AND wallet_id = ?2 AND status = 'issued' AND expires_at > ?4
           )`,
        )
        .bind(
          String(input.migration.migrationId),
          String(input.migration.walletId),
          migrationJson,
          nowMs,
          String(input.migration.source.laneId),
          input.migration.source.laneEpoch,
          String(input.grant.grantDigest),
        ),
      this.database
        .prepare(
          `UPDATE wallet_region_migration_grants
              SET status = 'consumed', consumed_at_ms = ?4
            WHERE grant_digest_b64u = ?1 AND migration_id = ?2 AND wallet_id = ?3
              AND status = 'issued' AND expires_at > ?4
              AND EXISTS (
                SELECT 1 FROM wallet_region_migrations
                 WHERE migration_id = ?2 AND wallet_id = ?3
                   AND state_kind = 'authorized' AND record_json = ?5
              )`,
        )
        .bind(
          String(input.grant.grantDigest),
          String(input.grant.migrationId),
          String(input.grant.walletId),
          nowMs,
          migrationJson,
        ),
      this.database
        .prepare(
          `UPDATE wallet_home_lanes
              SET migration_id = ?4, updated_at_ms = ?5
            WHERE wallet_id = ?1 AND lane_id = ?2 AND lane_epoch = ?3
              AND migration_id IS NULL
              AND EXISTS (
                SELECT 1 FROM wallet_region_migration_grants
                 WHERE grant_digest_b64u = ?6 AND migration_id = ?4
                   AND wallet_id = ?1 AND status = 'consumed'
              )
              AND EXISTS (
                SELECT 1 FROM wallet_region_migrations
                 WHERE migration_id = ?4 AND wallet_id = ?1
                   AND state_kind = 'authorized' AND record_json = ?7
              )`,
        )
        .bind(
          String(input.migration.walletId),
          String(input.migration.source.laneId),
          input.migration.source.laneEpoch,
          String(input.migration.migrationId),
          nowMs,
          String(input.grant.grantDigest),
          migrationJson,
        ),
    ];
    const results = await this.database.batch(statements);
    const stored = await this.getMigration(input.migration.migrationId);
    if (!stored || !sameMigration(stored.migration, input.migration)) {
      return this.conflict(input.migration.walletId, input.migration.migrationId);
    }
    return { outcome: mutationChanged(results) ? 'applied' : 'replayed', value: stored };
  }

  async issueMigrationGrant(input: {
    readonly grant: WalletRegionMigrationGrant;
    readonly nowMs: number;
  }): Promise<WalletRegionMigrationGrantRecord> {
    await this.ready;
    const nowMs = requirePositiveInteger(input.nowMs, 'migration grant issuance timestamp');
    if (!(await walletRegionMigrationGrantDigestIsValid(input.grant))) {
      throw new Error('wallet region migration grant digest is invalid');
    }
    if (nowMs < input.grant.issuedAt || nowMs >= input.grant.expiresAt) {
      throw new Error('wallet region migration grant is outside its issuance window');
    }
    await this.database
      .prepare(
        `INSERT OR IGNORE INTO wallet_region_migration_grants (
           grant_digest_b64u, migration_id, wallet_id, grant_json,
           status, issued_at, expires_at, consumed_at_ms
         ) VALUES (?1, ?2, ?3, ?4, 'issued', ?5, ?6, NULL)`,
      )
      .bind(
        String(input.grant.grantDigest),
        String(input.grant.migrationId),
        String(input.grant.walletId),
        JSON.stringify(input.grant),
        input.grant.issuedAt,
        input.grant.expiresAt,
      )
      .run();
    const stored = await this.getMigrationGrant(input.grant.grantDigest);
    if (!stored || JSON.stringify(stored.grant) !== JSON.stringify(input.grant)) {
      throw new Error('wallet region migration grant conflicts with an existing grant');
    }
    return stored;
  }

  async getMigrationGrant(
    grantDigest: WalletRegionMigrationGrant['grantDigest'],
  ): Promise<WalletRegionMigrationGrantRecord | null> {
    await this.ready;
    const row = await this.database
      .prepare(
        `SELECT grant_json, status, consumed_at_ms
           FROM wallet_region_migration_grants
          WHERE grant_digest_b64u = ?1`,
      )
      .bind(String(grantDigest))
      .first<WalletRegionMigrationGrantRow>();
    return row ? parseWalletRegionMigrationGrantRow(row) : null;
  }

  async compareAndSetMigration(input: {
    readonly expected: WalletRegionMigrationJournalRecord;
    readonly next: WalletRegionMigration;
    readonly nowMs: number;
  }): Promise<WalletRegionStoreMutation<WalletRegionMigrationJournalRecord>> {
    await this.ready;
    if (!isOrdinaryMigrationTransition(input.expected.migration, input.next)) {
      throw new Error(
        `ordinary migration CAS cannot apply ${input.expected.migration.kind} -> ${input.next.kind}`,
      );
    }
    if (input.expected.migration.migrationId !== input.next.migrationId) {
      throw new Error('migration CAS cannot change migration identity');
    }
    const nowMs = requirePositiveInteger(input.nowMs, 'migration transition timestamp');
    const result = await this.database
      .prepare(
        `UPDATE wallet_region_migrations
            SET state_kind = ?4, record_json = ?5,
                record_revision = record_revision + 1, updated_at_ms = ?6
          WHERE migration_id = ?1 AND wallet_id = ?2
            AND state_kind = ?3 AND record_revision = ?7 AND record_json = ?8`,
      )
      .bind(
        String(input.next.migrationId),
        String(input.next.walletId),
        input.expected.migration.kind,
        input.next.kind,
        JSON.stringify(input.next),
        nowMs,
        input.expected.recordRevision,
        JSON.stringify(input.expected.migration),
      )
      .run();
    const stored = await this.getMigration(input.next.migrationId);
    if (!stored || !sameMigration(stored.migration, input.next)) {
      return this.conflict(input.next.walletId, input.next.migrationId);
    }
    return { outcome: d1ChangedRows(result) === 1 ? 'applied' : 'replayed', value: stored };
  }

  async commitCutover(input: {
    readonly expected: WalletRegionMigrationJournalRecord & {
      readonly migration: TargetVerifiedWalletRegionMigration;
    };
    readonly next: CutoverCommittedWalletRegionMigration;
    readonly nowMs: number;
  }): Promise<WalletRegionStoreMutation<WalletRegionMigrationJournalRecord>> {
    await this.ready;
    this.requireSameMigrationIdentity(input.expected.migration, input.next);
    const sourceRevision = input.expected.migration.sourceFence.directoryRevision;
    const cutoverRevision = input.next.cutoverReceipt.directoryRevision;
    if (cutoverRevision !== sourceRevision + 1) {
      throw new Error('directory cutover must advance its exact source revision by one');
    }
    const nowMs = requirePositiveInteger(input.nowMs, 'directory cutover timestamp');
    const nextJson = JSON.stringify(input.next);
    const statements: D1PreparedStatementLike[] = [
      this.database
        .prepare(
          `UPDATE wallet_home_lanes
              SET lane_id = ?5, lane_epoch = ?6, directory_revision = ?7,
                  updated_at_ms = ?8
            WHERE wallet_id = ?1 AND lane_id = ?2 AND lane_epoch = ?3
              AND directory_revision = ?4 AND migration_id = ?9`,
        )
        .bind(
          String(input.next.walletId),
          String(input.next.source.laneId),
          input.next.source.laneEpoch,
          sourceRevision,
          String(input.next.targetLaneId),
          input.next.targetEpoch,
          cutoverRevision,
          nowMs,
          String(input.next.migrationId),
        ),
      this.database
        .prepare(
          `UPDATE wallet_region_migrations
              SET state_kind = 'cutover_committed', record_json = ?5,
                  record_revision = record_revision + 1, updated_at_ms = ?6
            WHERE migration_id = ?1 AND wallet_id = ?2
              AND state_kind = 'target_verified' AND record_revision = ?3
              AND record_json = ?4
              AND EXISTS (
                SELECT 1 FROM wallet_home_lanes
                 WHERE wallet_id = ?2 AND lane_id = ?7 AND lane_epoch = ?8
                   AND directory_revision = ?9 AND migration_id = ?1
              )`,
        )
        .bind(
          String(input.next.migrationId),
          String(input.next.walletId),
          input.expected.recordRevision,
          JSON.stringify(input.expected.migration),
          nextJson,
          nowMs,
          String(input.next.targetLaneId),
          input.next.targetEpoch,
          cutoverRevision,
        ),
      this.database
        .prepare(
          `INSERT OR IGNORE INTO wallet_region_cutovers (
             migration_id, wallet_id, source_lane_id, source_epoch,
             target_lane_id, target_epoch, directory_revision,
             receipt_json, committed_at_ms
           )
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
           WHERE EXISTS (
             SELECT 1 FROM wallet_region_migrations
              WHERE migration_id = ?1 AND state_kind = 'cutover_committed'
                AND record_json = ?10
           )`,
        )
        .bind(
          String(input.next.migrationId),
          String(input.next.walletId),
          String(input.next.source.laneId),
          input.next.source.laneEpoch,
          String(input.next.targetLaneId),
          input.next.targetEpoch,
          cutoverRevision,
          JSON.stringify(input.next.cutoverReceipt),
          input.next.cutoverReceipt.committedAtMs,
          nextJson,
        ),
    ];
    const results = await this.database.batch(statements);
    const stored = await this.getMigration(input.next.migrationId);
    const homeLane = await this.getHomeLane(input.next.walletId);
    if (
      !stored ||
      !sameMigration(stored.migration, input.next) ||
      !homeLane ||
      homeLane.homeLane.laneId !== input.next.targetLaneId ||
      homeLane.homeLane.laneEpoch !== input.next.targetEpoch ||
      homeLane.directoryRevision !== cutoverRevision ||
      homeLane.migrationId !== input.next.migrationId
    ) {
      return { outcome: 'conflict', currentHomeLane: homeLane, currentMigration: stored };
    }
    return { outcome: mutationChanged(results) ? 'applied' : 'replayed', value: stored };
  }

  async completeMigration(input: {
    readonly expected: WalletRegionMigrationJournalRecord & {
      readonly migration: CutoverCommittedWalletRegionMigration;
    };
    readonly next: CompletedWalletRegionMigration;
    readonly nowMs: number;
  }): Promise<WalletRegionStoreMutation<WalletRegionMigrationJournalRecord>> {
    await this.ready;
    this.requireSameMigrationIdentity(input.expected.migration, input.next);
    const nowMs = requirePositiveInteger(input.nowMs, 'migration completion timestamp');
    const nextJson = JSON.stringify(input.next);
    const statements: D1PreparedStatementLike[] = [
      this.database
        .prepare(
          `UPDATE wallet_region_migrations
              SET state_kind = 'completed', record_json = ?4,
                  record_revision = record_revision + 1, updated_at_ms = ?5
            WHERE migration_id = ?1 AND wallet_id = ?2
              AND state_kind = 'cutover_committed' AND record_revision = ?3
              AND record_json = ?6`,
        )
        .bind(
          String(input.next.migrationId),
          String(input.next.walletId),
          input.expected.recordRevision,
          nextJson,
          nowMs,
          JSON.stringify(input.expected.migration),
        ),
      this.database
        .prepare(
          `UPDATE wallet_home_lanes
              SET migration_id = NULL, updated_at_ms = ?5
            WHERE wallet_id = ?1 AND lane_id = ?2 AND lane_epoch = ?3
              AND directory_revision = ?4 AND migration_id = ?6
              AND EXISTS (
                SELECT 1 FROM wallet_region_migrations
                 WHERE migration_id = ?6 AND state_kind = 'completed'
                   AND record_json = ?7
              )`,
        )
        .bind(
          String(input.next.walletId),
          String(input.next.targetLaneId),
          input.next.targetEpoch,
          input.next.cutoverReceipt.directoryRevision,
          nowMs,
          String(input.next.migrationId),
          nextJson,
        ),
    ];
    const results = await this.database.batch(statements);
    const stored = await this.getMigration(input.next.migrationId);
    const homeLane = await this.getHomeLane(input.next.walletId);
    if (!stored || !sameMigration(stored.migration, input.next) || !homeLane) {
      return { outcome: 'conflict', currentHomeLane: homeLane, currentMigration: stored };
    }
    if (homeLane.migrationId !== null) {
      return { outcome: 'conflict', currentHomeLane: homeLane, currentMigration: stored };
    }
    return { outcome: mutationChanged(results) ? 'applied' : 'replayed', value: stored };
  }

  async getMigration(
    migrationId: WalletRegionMigrationId,
  ): Promise<WalletRegionMigrationJournalRecord | null> {
    await this.ready;
    const row = await this.database
      .prepare(
        `SELECT migration_id, wallet_id, state_kind, record_json,
                record_revision, created_at_ms, updated_at_ms
           FROM wallet_region_migrations
          WHERE migration_id = ?1`,
      )
      .bind(String(migrationId))
      .first<WalletRegionMigrationRow>();
    return row ? parseWalletRegionMigrationRow(row) : null;
  }

  private async getConfiguration(
    laneId: ManagedWalletHomeLaneId,
    configurationVersion: number,
  ): Promise<ManagedWalletLaneConfiguration | null> {
    const row = await this.database
      .prepare(
        `SELECT lane_id, product_region, status, router_binding,
                deriver_a_binding, deriver_b_binding, signing_worker_binding,
                placement_evidence_json, configuration_version
           FROM managed_wallet_lanes
          WHERE lane_id = ?1 AND configuration_version = ?2`,
      )
      .bind(String(laneId), configurationVersion)
      .first<ManagedWalletLaneRow>();
    return row ? parseManagedWalletLaneConfiguration(row) : null;
  }

  private async conflict(
    walletId: WalletId,
    migrationId: WalletRegionMigrationId | null,
  ): Promise<WalletRegionStoreConflict> {
    return {
      outcome: 'conflict',
      currentHomeLane: await this.getHomeLane(walletId),
      currentMigration: migrationId ? await this.getMigration(migrationId) : null,
    };
  }

  private requireSameMigrationIdentity(
    current: TargetVerifiedWalletRegionMigration | CutoverCommittedWalletRegionMigration,
    next: CutoverCommittedWalletRegionMigration | CompletedWalletRegionMigration,
  ): void {
    if (
      current.migrationId !== next.migrationId ||
      current.walletId !== next.walletId ||
      current.source.laneId !== next.source.laneId ||
      current.source.laneEpoch !== next.source.laneEpoch ||
      current.targetLaneId !== next.targetLaneId ||
      current.targetEpoch !== next.targetEpoch
    ) {
      throw new Error('wallet region transition cannot change migration identity or lane binding');
    }
  }

  private requireGrantMatchesMigration(
    grant: WalletRegionMigrationGrant,
    migration: AuthorizedWalletRegionMigration,
  ): void {
    if (
      grant.migrationId !== migration.migrationId ||
      grant.walletId !== migration.walletId ||
      grant.source.walletId !== migration.source.walletId ||
      grant.source.laneId !== migration.source.laneId ||
      grant.source.laneEpoch !== migration.source.laneEpoch ||
      grant.targetLaneId !== migration.targetLaneId ||
      grant.targetEpoch !== migration.targetEpoch ||
      grant.grantDigest !== migration.grantDigest ||
      grant.expiresAt !== migration.expiresAt
    ) {
      throw new Error('wallet region migration grant does not authorize this exact migration');
    }
  }
}

export function createCloudflareD1WalletRegionStore(
  options: CloudflareD1WalletRegionStoreOptions,
): CloudflareD1WalletRegionStore {
  return new CloudflareD1WalletRegionStore(options);
}
