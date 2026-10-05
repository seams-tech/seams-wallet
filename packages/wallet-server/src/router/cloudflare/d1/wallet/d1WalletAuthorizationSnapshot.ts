import { parseNonNegativeSafeInteger } from '@shared/device-linking/wireFields';
import { sha256HexUtf8 } from '@shared/utils/digests';
import { requireCanonicalString } from '@shared/utils/validation';
import { prepareD1TenantStatement, type D1TenantScope } from '../../../../core/d1TenantStore';
import { D1_BATCH_CAS_GUARD_SQL } from '../../../../storage/d1Sql';
import type { D1DatabaseLike } from '../../../../storage/tenantRoute';
import { WalletRelocationSessionSource } from './d1WalletRelocationSessions';
import { AuthorizationSnapshotLayout } from './authorizationSnapshotLayout';

const CHUNK_BYTES = 32_768;
type Manifest = {
  readonly schemaJson: string;
  readonly chunkCount: number;
  readonly recordCount: number;
  readonly digestHex: string;
};
type SnapshotState =
  | { readonly state: 'building'; readonly schemaJson: string; readonly manifest?: never }
  | { readonly state: 'sealed'; readonly schemaJson: string; readonly manifest: Manifest };

type RecordCursor =
  | {
      readonly kind: 'after';
      readonly key: string;
      readonly nextSegment?: never;
      readonly segmentCount?: never;
    }
  | {
      readonly kind: 'resume';
      readonly key: string;
      readonly nextSegment: number;
      readonly segmentCount: number;
    };
type CaptureProgress = {
  readonly tableIndex: number;
  readonly cursor: RecordCursor;
  readonly chunkCount: number;
  readonly recordCount: number;
  readonly digestHex: string;
};

// Only the admitted coordinator may invoke this after the authorization freeze.
// SQLite encodes values before chunking; JavaScript never decodes stored integers.
export class D1WalletAuthorizationSnapshot {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: D1TenantScope,
  ) {}

  async seal(source: WalletRelocationSessionSource): Promise<Manifest> {
    const state = await this.prepare(source);
    if (state.state === 'sealed') return state.manifest;
    const layout = AuthorizationSnapshotLayout.parse(JSON.parse(state.schemaJson));
    const progress = await this.readProgress(source, layout, state.schemaJson);
    let digestHex = progress.digestHex;
    let chunkCount = progress.chunkCount;
    let recordCount = progress.recordCount;
    for (let tableIndex = progress.tableIndex; tableIndex < layout.length; tableIndex += 1) {
      const table = layout[tableIndex];
      let cursor: RecordCursor =
        tableIndex === progress.tableIndex ? progress.cursor : { kind: 'after', key: '' };
      while (true) {
        const record = await this.nextRecord(source, table, cursor);
        if (record === null) {
          if (cursor.kind === 'resume')
            throw new Error('Authorization snapshot partial record disappeared');
          break;
        }
        const segmentCount = Math.ceil(record.byteLength / CHUNK_BYTES);
        if (cursor.kind === 'resume' && cursor.segmentCount !== segmentCount)
          throw new Error('Authorization snapshot partial record size changed');
        const firstSegment = cursor.kind === 'resume' ? cursor.nextSegment : 0;
        for (let segmentIndex = firstSegment; segmentIndex < segmentCount; segmentIndex += 1) {
          const bytesHex = await this.readSegment(source, table, record.key, segmentIndex);
          const expectedBytes = Math.min(
            CHUNK_BYTES,
            record.byteLength - segmentIndex * CHUNK_BYTES,
          );
          if (!/^[A-F0-9]+$/u.test(bytesHex) || bytesHex.length !== expectedBytes * 2)
            throw new Error('Authorization snapshot record changed during capture');
          const chunkJson = JSON.stringify({
            table: table.table,
            recordKey: record.key,
            segmentIndex,
            segmentCount,
            bytesHex,
          });
          digestHex = await sha256HexUtf8(JSON.stringify([digestHex, chunkCount, chunkJson]));
          const completedRecords = recordCount + (segmentIndex + 1 === segmentCount ? 1 : 0);
          await this.storeChunk(source, chunkCount, chunkJson, digestHex, completedRecords);
          chunkCount += 1;
        }
        recordCount += 1;
        cursor = { kind: 'after', key: record.key };
      }
    }
    await this.database.batch([
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        UPDATE wallet_relocation_authorization_snapshots
        SET state = 'sealed', chunk_count = ?9, record_count = ?10, digest_hex = ?11
        WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
          AND wallet_id = ?5 AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8`,
        [
          source.walletId,
          source.moveId,
          source.requestDigestHex,
          source.sourceGeneration,
          chunkCount,
          recordCount,
          digestHex,
        ],
      ),
      this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
    ]);
    const sealed = await this.read(source);
    if (sealed?.state !== 'sealed') throw new Error('Authorization snapshot seal disappeared');
    return sealed.manifest;
  }

  async exportChunk(
    source: WalletRelocationSessionSource,
    rawIndex: unknown,
  ): Promise<{
    readonly index: number;
    readonly chunkJson: string;
    readonly digestHex: string;
  }> {
    const index = parseNonNegativeSafeInteger(rawIndex, 'snapshot chunk index');
    const state = await this.read(source);
    if (state?.state !== 'sealed') throw new Error('Authorization snapshot is not sealed');
    if (index >= state.manifest.chunkCount)
      throw new Error('Authorization snapshot chunk is absent');
    const row = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      SELECT chunk_json, digest_hex FROM wallet_relocation_authorization_chunks
      WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
        AND wallet_id = ?5 AND chunk_index = ?6`,
      [source.walletId, index],
    ).first<Record<string, unknown>>();
    if (!row) throw new Error('Authorization snapshot chunk disappeared');
    return Object.freeze({
      index,
      chunkJson: requireCanonicalString(row.chunk_json, 'snapshot chunk'),
      digestHex: requireCanonicalString(row.digest_hex, 'snapshot chunk digest'),
    });
  }

  private async prepare(source: WalletRelocationSessionSource): Promise<SnapshotState> {
    const existing = await this.read(source);
    if (existing) return existing;
    const schemaJson = JSON.stringify(await AuthorizationSnapshotLayout.read(this.database));
    await this.database.batch([
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        INSERT INTO wallet_relocation_authorization_snapshots
          (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation, schema_json, state)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'building'
        WHERE NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_snapshots
          WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4 AND wallet_id = ?5)`,
        [
          source.walletId,
          source.moveId,
          source.requestDigestHex,
          source.sourceGeneration,
          schemaJson,
        ],
      ),
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        UPDATE wallet_relocation_authorization_snapshots SET schema_json = schema_json
        WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
          AND wallet_id = ?5 AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8
          AND schema_json = ?9`,
        [
          source.walletId,
          source.moveId,
          source.requestDigestHex,
          source.sourceGeneration,
          schemaJson,
        ],
      ),
      this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
    ]);
    const state = await this.read(source);
    if (!state) throw new Error('Authorization snapshot preparation disappeared');
    return state;
  }

  private async read(source: WalletRelocationSessionSource): Promise<SnapshotState | null> {
    const row = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      SELECT wallet_id, move_id, request_digest_hex, source_generation, schema_json,
        state, chunk_count, record_count, digest_hex FROM wallet_relocation_authorization_snapshots
      WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4 AND wallet_id = ?5`,
      [source.walletId],
    ).first<Record<string, unknown>>();
    if (!row) return null;
    if (!source.matches(row)) throw new Error('Authorization snapshot identity conflicts');
    const schemaJson = requireCanonicalString(row.schema_json, 'snapshot schema');
    switch (row.state) {
      case 'building':
        if (row.chunk_count !== null || row.record_count !== null || row.digest_hex !== null)
          throw new Error('Authorization snapshot building state conflicts');
        return { state: 'building', schemaJson };
      case 'sealed':
        return {
          state: 'sealed',
          schemaJson,
          manifest: Object.freeze({
            schemaJson,
            chunkCount: parseNonNegativeSafeInteger(row.chunk_count, 'snapshot chunk count'),
            recordCount: parseNonNegativeSafeInteger(row.record_count, 'snapshot record count'),
            digestHex: requireCanonicalString(row.digest_hex, 'snapshot digest'),
          }),
        };
      default:
        throw new Error('Authorization snapshot state is invalid');
    }
  }

  private async readProgress(
    source: WalletRelocationSessionSource,
    layout: readonly AuthorizationSnapshotLayout[],
    schemaJson: string,
  ): Promise<CaptureProgress> {
    const row = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      SELECT chunk_index, digest_hex,
        json_extract(chunk_json, '$.table') AS table_name,
        json_extract(chunk_json, '$.recordKey') AS record_key,
        json_extract(chunk_json, '$.segmentIndex') AS segment_index,
        json_extract(chunk_json, '$.segmentCount') AS segment_count, record_count
      FROM wallet_relocation_authorization_chunks
      WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4 AND wallet_id = ?5
      ORDER BY chunk_index DESC LIMIT 1`,
      [source.walletId],
    ).first<Record<string, unknown>>();
    if (!row) {
      return {
        tableIndex: 0,
        cursor: { kind: 'after', key: '' },
        chunkCount: 0,
        recordCount: 0,
        digestHex: await sha256HexUtf8(
          JSON.stringify([
            'seams/wallet-authorization-snapshot/v1',
            this.scope.namespace,
            this.scope.orgId,
            this.scope.projectId,
            this.scope.envId,
            source.walletId,
            source.moveId,
            source.requestDigestHex,
            source.sourceGeneration,
            schemaJson,
          ]),
        ),
      };
    }
    let tableIndex = -1;
    for (const [index, table] of layout.entries()) {
      if (table.table === row.table_name) tableIndex = index;
    }
    const segmentIndex = parseNonNegativeSafeInteger(row.segment_index, 'snapshot last segment');
    const segmentCount = parseNonNegativeSafeInteger(row.segment_count, 'snapshot segment count');
    if (tableIndex < 0 || segmentIndex >= segmentCount)
      throw new Error('Authorization snapshot checkpoint is invalid');
    const key = requireCanonicalString(row.record_key, 'snapshot checkpoint key');
    const cursor: RecordCursor =
      segmentIndex + 1 === segmentCount
        ? { kind: 'after', key }
        : { kind: 'resume', key, nextSegment: segmentIndex + 1, segmentCount };
    return {
      tableIndex,
      cursor,
      chunkCount: parseNonNegativeSafeInteger(row.chunk_index, 'snapshot last chunk') + 1,
      recordCount: parseNonNegativeSafeInteger(row.record_count, 'snapshot completed records'),
      digestHex: requireCanonicalString(row.digest_hex, 'snapshot checkpoint digest'),
    };
  }

  private async nextRecord(
    source: WalletRelocationSessionSource,
    table: AuthorizationSnapshotLayout,
    cursor: RecordCursor,
  ): Promise<{ readonly key: string; readonly byteLength: number } | null> {
    const sql = table.expressions();
    const comparison = cursor.kind === 'resume' ? '=' : '>';
    const row = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      SELECT ${sql.key} AS record_key, length(CAST(${sql.record} AS BLOB)) AS byte_length
      FROM ${table.table} AS target WHERE ${sql.ownership} AND ${sql.key} ${comparison} ?6
      ORDER BY record_key COLLATE BINARY LIMIT 1`,
      [source.walletId, cursor.key],
    ).first<Record<string, unknown>>();
    if (!row) return null;
    const byteLength = parseNonNegativeSafeInteger(row.byte_length, 'snapshot record length');
    if (byteLength === 0) throw new Error('Authorization snapshot record is empty');
    return { key: requireCanonicalString(row.record_key, 'snapshot record key'), byteLength };
  }

  private async readSegment(
    source: WalletRelocationSessionSource,
    table: AuthorizationSnapshotLayout,
    key: string,
    segmentIndex: number,
  ): Promise<string> {
    const sql = table.expressions();
    const row = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      SELECT hex(substr(CAST(${sql.record} AS BLOB), ?7, ?8)) AS bytes_hex
      FROM ${table.table} AS target WHERE ${sql.ownership} AND ${sql.key} = ?6`,
      [source.walletId, key, segmentIndex * CHUNK_BYTES + 1, CHUNK_BYTES],
    ).first<Record<string, unknown>>();
    if (!row) throw new Error('Authorization snapshot record disappeared');
    return requireCanonicalString(row.bytes_hex, 'snapshot bytes');
  }

  private async storeChunk(
    source: WalletRelocationSessionSource,
    index: number,
    chunkJson: string,
    digestHex: string,
    recordCount: number,
  ): Promise<void> {
    await this.database.batch([
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        INSERT INTO wallet_relocation_authorization_chunks
          (namespace, org_id, project_id, env_id, wallet_id, chunk_index, chunk_json, digest_hex, record_count)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
        WHERE NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_chunks
          WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
            AND wallet_id = ?5 AND chunk_index = ?6)`,
        [source.walletId, index, chunkJson, digestHex, recordCount],
      ),
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        UPDATE wallet_relocation_authorization_chunks SET digest_hex = digest_hex
        WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
          AND wallet_id = ?5 AND chunk_index = ?6 AND chunk_json = ?7 AND digest_hex = ?8 AND record_count = ?9`,
        [source.walletId, index, chunkJson, digestHex, recordCount],
      ),
      this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
    ]);
  }
}
