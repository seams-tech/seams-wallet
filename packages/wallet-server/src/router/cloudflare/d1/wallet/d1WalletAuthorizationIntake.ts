import { parseNonNegativeSafeInteger } from '@shared/device-linking/wireFields';
import { sha256HexUtf8 } from '@shared/utils/digests';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import { prepareD1TenantStatement, type D1TenantScope } from '../../../../core/d1TenantStore';
import type { D1DatabaseLike } from '../../../../storage/tenantRoute';
import { AuthorizationSnapshotLayout } from './authorizationSnapshotLayout';
import { D1WalletAuthorizationHistory } from './d1WalletAuthorizationHistory';
import { WalletRelocationSessionSource } from './d1WalletRelocationSessions';

const SCOPE =
  'namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4 AND wallet_id = ?5';
type Manifest = { schemaJson: string; chunkCount: number; recordCount: number; digestHex: string };
type IntakeState = {
  readonly manifest: Manifest;
  readonly nextIndex: number;
  readonly recordCount: number;
  readonly digestHex: string;
} & ({ readonly state: 'receiving' } | { readonly state: 'verified' });
type Chunk = {
  index: number;
  chunkJson: string;
  digestHex: string;
  table: AuthorizationSnapshotLayout;
  recordKey: string;
  segmentIndex: number;
  segmentCount: number;
};

// The authenticated participant supplies the admitted identity and pinned manifest.
// Staging survives a failed restore. Progress advances only after its durable receipt.
export class D1WalletAuthorizationIntake {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: D1TenantScope,
  ) {}

  async prepare(source: WalletRelocationSessionSource, rawManifest: unknown): Promise<void> {
    const manifest = parseManifest(rawManifest);
    if (
      manifest.schemaJson !== JSON.stringify(await AuthorizationSnapshotLayout.read(this.database))
    )
      throw new Error('Authorization intake schema conflicts');
    const json = JSON.stringify(manifest);
    const existing = await this.read(source);
    if (existing) {
      if (JSON.stringify(existing.manifest) !== json)
        throw new Error('Authorization intake manifest conflicts');
      return;
    }
    await new D1WalletAuthorizationHistory(this.database, this.scope).prepare(source);
    const digest = await sha256HexUtf8(
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
        manifest.schemaJson,
      ]),
    );
    await prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      INSERT INTO wallet_relocation_authorization_intakes
      (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex,
       source_generation, manifest_json, digest_hex)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
      ON CONFLICT DO NOTHING`,
      [
        source.walletId,
        source.moveId,
        source.requestDigestHex,
        source.sourceGeneration,
        json,
        digest,
      ],
    ).run();
    const saved = await this.read(source);
    if (!saved || JSON.stringify(saved.manifest) !== json)
      throw new Error('Authorization intake manifest conflicts');
  }

  async accept(source: WalletRelocationSessionSource, rawChunk: unknown): Promise<string> {
    const state = await this.read(source);
    if (!state) throw new Error('Authorization intake is absent');
    const manifest = state.manifest;
    const chunk = parseChunk(
      rawChunk,
      AuthorizationSnapshotLayout.parse(JSON.parse(manifest.schemaJson)),
    );
    const next = state.nextIndex;
    const existing = await this.readChunk(source, chunk.index);
    if (
      existing &&
      (existing.chunk_json !== chunk.chunkJson || existing.digest_hex !== chunk.digestHex)
    )
      throw new Error('Authorization intake chunk conflicts');
    if (chunk.index < next && existing) return chunk.digestHex;
    if (state.state !== 'receiving' || chunk.index !== next || chunk.index >= manifest.chunkCount)
      throw new Error('Authorization intake chunk is out of order');
    const expected = await sha256HexUtf8(
      JSON.stringify([state.digestHex, chunk.index, chunk.chunkJson]),
    );
    if (expected !== chunk.digestHex) throw new Error('Authorization intake digest conflicts');
    if (chunk.index === 0) {
      if (chunk.segmentIndex !== 0) throw new Error('Authorization intake first segment is absent');
    } else {
      const previous = await this.readChunk(source, chunk.index - 1);
      if (!previous) throw new Error('Authorization intake previous chunk is absent');
      const prior = requireRecord(
        JSON.parse(requireCanonicalString(previous.chunk_json, 'previous chunk')),
        'previous chunk',
      );
      const final = Number(prior.segmentIndex) + 1 === prior.segmentCount;
      if (
        final
          ? chunk.segmentIndex !== 0
          : chunk.segmentIndex !== Number(prior.segmentIndex) + 1 ||
            chunk.segmentCount !== prior.segmentCount ||
            chunk.recordKey !== prior.recordKey ||
            chunk.table.table !== prior.table
      )
        throw new Error('Authorization intake record segments conflict');
    }
    if (!existing) {
      try {
        await prepareD1TenantStatement(
          this.database,
          this.scope,
          `
        INSERT INTO wallet_relocation_authorization_intake_chunks
        (namespace, org_id, project_id, env_id, wallet_id, chunk_index, chunk_json, digest_hex)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT DO NOTHING`,
          [source.walletId, chunk.index, chunk.chunkJson, chunk.digestHex],
        ).run();
      } catch (error) {
        const raced = await this.readChunk(source, chunk.index);
        if (!raced || raced.chunk_json !== chunk.chunkJson || raced.digest_hex !== chunk.digestHex)
          throw error;
      }
      const saved = await this.readChunk(source, chunk.index);
      if (!saved || saved.chunk_json !== chunk.chunkJson || saved.digest_hex !== chunk.digestHex)
        throw new Error('Authorization intake staged chunk conflicts');
    }
    const completed = chunk.segmentIndex + 1 === chunk.segmentCount;
    if (completed) {
      const record = await prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        SELECT group_concat(payload, '') AS record_json FROM (
          SELECT CAST(unhex(json_extract(chunk_json, '$.bytesHex')) AS TEXT) AS payload
          FROM wallet_relocation_authorization_intake_chunks WHERE ${SCOPE}
            AND chunk_index BETWEEN ?6 AND ?7 ORDER BY chunk_index)`,
        [source.walletId, chunk.index - chunk.segmentIndex, chunk.index],
      ).first<Record<string, unknown>>();
      const json = requireCanonicalString(record?.record_json, 'assembled authorization record');
      const keys: string[] = [];
      for (const key of chunk.table.keyColumns) keys.push(`json_extract(?1, '$.${key}')`);
      const identity = await this.database
        .prepare(`SELECT json_array(${keys.join(', ')}) AS record_key`)
        .bind(json)
        .first<Record<string, unknown>>();
      if (identity?.record_key !== chunk.recordKey)
        throw new Error('Authorization intake record key conflicts');
      await new D1WalletAuthorizationHistory(this.database, this.scope).restore(
        source,
        chunk.table.table,
        json,
      );
    }
    await prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      UPDATE wallet_relocation_authorization_intakes SET next_index = next_index + 1,
        record_count = record_count + ?8, digest_hex = ?7
      WHERE ${SCOPE} AND next_index = ?6 AND state = 'receiving'`,
      [source.walletId, chunk.index, chunk.digestHex, completed ? 1 : 0],
    ).run();
    const acknowledged = await this.read(source);
    if (!acknowledged || acknowledged.nextIndex <= chunk.index)
      throw new Error('Authorization intake acknowledgement disappeared');
    return chunk.digestHex;
  }

  async verify(source: WalletRelocationSessionSource): Promise<string> {
    const state = await this.read(source);
    if (!state) throw new Error('Authorization intake is absent');
    const manifest = state.manifest;
    if (state.state === 'verified') return manifest.digestHex;
    if (
      state.nextIndex !== manifest.chunkCount ||
      state.recordCount !== manifest.recordCount ||
      state.digestHex !== manifest.digestHex
    )
      throw new Error('Authorization intake is incomplete');
    if (manifest.chunkCount > 0) {
      const last = await this.readChunk(source, manifest.chunkCount - 1);
      const chunk = requireRecord(
        JSON.parse(requireCanonicalString(last?.chunk_json, 'last chunk')),
        'last chunk',
      );
      if (Number(chunk.segmentIndex) + 1 !== chunk.segmentCount)
        throw new Error('Authorization intake record is incomplete');
    }
    await new D1WalletAuthorizationHistory(this.database, this.scope).close(source);
    const count = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      SELECT COUNT(*) AS count FROM wallet_relocation_authorization_import_receipts WHERE ${SCOPE} AND move_id = ?6`,
      [source.walletId, source.moveId],
    ).first<Record<string, unknown>>();
    if (count?.count !== manifest.recordCount)
      throw new Error('Authorization intake record count conflicts');
    await prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      UPDATE wallet_relocation_authorization_intakes SET state = 'verified'
      WHERE ${SCOPE} AND state = 'receiving'`,
      [source.walletId],
    ).run();
    return manifest.digestHex;
  }

  private async read(source: WalletRelocationSessionSource): Promise<IntakeState | null> {
    const row = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      SELECT * FROM wallet_relocation_authorization_intakes WHERE ${SCOPE}`,
      [source.walletId],
    ).first<Record<string, unknown>>();
    if (!row) return null;
    if (!source.matches(row)) throw new Error('Authorization intake identity conflicts');
    const manifest = parseManifest(
      JSON.parse(requireCanonicalString(row.manifest_json, 'intake manifest')),
    );
    const nextIndex = parseNonNegativeSafeInteger(row.next_index, 'intake next index');
    const recordCount = parseNonNegativeSafeInteger(row.record_count, 'intake record count');
    const digest = digestHex(row.digest_hex);
    switch (row.state) {
      case 'receiving':
        return { state: 'receiving', manifest, nextIndex, recordCount, digestHex: digest };
      case 'verified':
        if (
          nextIndex !== manifest.chunkCount ||
          recordCount !== manifest.recordCount ||
          digest !== manifest.digestHex
        )
          throw new Error('Authorization intake verified state conflicts');
        return { state: 'verified', manifest, nextIndex, recordCount, digestHex: digest };
      default:
        throw new Error('Authorization intake state is invalid');
    }
  }

  private async readChunk(
    source: WalletRelocationSessionSource,
    index: number,
  ): Promise<Record<string, unknown> | null> {
    return prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      SELECT chunk_json, digest_hex FROM wallet_relocation_authorization_intake_chunks
      WHERE ${SCOPE} AND chunk_index = ?6`,
      [source.walletId, index],
    ).first<Record<string, unknown>>();
  }
}

function parseManifest(raw: unknown): Manifest {
  const value = requireRecord(raw, 'authorization manifest');
  if (Object.keys(value).length !== 4) throw new Error('Authorization manifest fields conflict');
  const schemaJson = requireCanonicalString(value.schemaJson, 'authorization schema');
  AuthorizationSnapshotLayout.parse(JSON.parse(schemaJson));
  return {
    schemaJson,
    chunkCount: parseNonNegativeSafeInteger(value.chunkCount, 'manifest chunk count'),
    recordCount: parseNonNegativeSafeInteger(value.recordCount, 'manifest record count'),
    digestHex: digestHex(value.digestHex),
  };
}

function digestHex(raw: unknown): string {
  const value = requireCanonicalString(raw, 'authorization digest');
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error('Authorization digest is invalid');
  return value;
}

function parseChunk(raw: unknown, layouts: readonly AuthorizationSnapshotLayout[]): Chunk {
  const value = requireRecord(raw, 'authorization chunk');
  if (Object.keys(value).length !== 3) throw new Error('Authorization chunk fields conflict');
  const chunkJson = requireCanonicalString(value.chunkJson, 'authorization chunk JSON');
  if (new TextEncoder().encode(chunkJson).byteLength > 131072)
    throw new Error('Authorization chunk exceeds its bound');
  const payload = requireRecord(JSON.parse(chunkJson), 'authorization chunk payload');
  if (Object.keys(payload).length !== 5)
    throw new Error('Authorization chunk payload fields conflict');
  let table: AuthorizationSnapshotLayout | null = null;
  for (const layout of layouts) if (layout.table === payload.table) table = layout;
  if (!table) throw new Error('Authorization chunk table conflicts');
  const segmentIndex = parseNonNegativeSafeInteger(payload.segmentIndex, 'segment index');
  const segmentCount = parseNonNegativeSafeInteger(payload.segmentCount, 'segment count');
  if (segmentIndex >= segmentCount) throw new Error('Authorization segment index conflicts');
  const hex = requireCanonicalString(payload.bytesHex, 'segment bytes');
  if (
    !/^(?:[A-F0-9]{2})+$/u.test(hex) ||
    hex.length > 65536 ||
    (segmentIndex + 1 < segmentCount && hex.length !== 65536)
  )
    throw new Error('Authorization segment size conflicts');
  return {
    index: parseNonNegativeSafeInteger(value.index, 'chunk index'),
    chunkJson,
    digestHex: digestHex(value.digestHex),
    table,
    recordKey: requireCanonicalString(payload.recordKey, 'record key'),
    segmentIndex,
    segmentCount,
  };
}
