import { parseNonNegativeSafeInteger } from '@shared/device-linking/wireFields';
import { parseUnixMs } from '@shared/passkey-custody/primitives';
import { D1_BATCH_CAS_GUARD_SQL } from '../../../../storage/d1Sql';
import { sha256HexUtf8 } from '@shared/utils/digests';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import { prepareD1TenantStatement, type D1TenantScope } from '../../../../core/d1TenantStore';
import type { D1DatabaseLike } from '../../../../storage/tenantRoute';
import { AuthorizationSnapshotLayout } from './authorizationSnapshotLayout';
import { AUTHORIZATION_SNAPSHOT_MAX_BYTES, AUTHORIZATION_SNAPSHOT_MAX_CHUNKS } from './d1WalletAuthorizationSnapshot';
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
type IntakeProgress =
  | {
      readonly state: 'receiving';
      readonly nextIndex: number;
      readonly chunkCount: number;
      readonly digestHex?: never;
    }
  | {
      readonly state: 'verified';
      readonly digestHex: string;
      readonly nextIndex?: never;
      readonly chunkCount?: never;
    };
type Chunk = {
  index: number;
  chunkJson: string;
  digestHex: string;
  table: AuthorizationSnapshotLayout;
  recordKey: string;
  segmentIndex: number;
  segmentCount: number;
  bytesHex: string;
};

// The authenticated participant supplies the admitted identity and pinned manifest.
// Staging survives a failed restore. Progress advances only after its durable receipt.
export class D1WalletAuthorizationIntake {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: D1TenantScope,
  ) {}

  async prepare(
    source: WalletRelocationSessionSource,
    rawManifest: unknown,
  ): Promise<IntakeProgress> {
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
      return intakeProgress(existing);
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
    return intakeProgress(saved);
  }

  async acceptSnapshot(source: WalletRelocationSessionSource, raw: unknown): Promise<string> {
    if (!Array.isArray(raw) || raw.length > AUTHORIZATION_SNAPSHOT_MAX_CHUNKS ||
        new TextEncoder().encode(JSON.stringify(raw)).byteLength > AUTHORIZATION_SNAPSHOT_MAX_BYTES)
      throw new Error('Authorization snapshot exceeds supported capacity');
    const state = await this.read(source);
    if (!state) throw new Error('Authorization intake is absent');
    const manifest = state.manifest;
    if (raw.length !== manifest.chunkCount) throw new Error('Authorization snapshot count conflicts');
    const layouts = AuthorizationSnapshotLayout.parse(JSON.parse(manifest.schemaJson));
    let digest = await sha256HexUtf8(JSON.stringify([
      'seams/wallet-authorization-snapshot/v1', this.scope.namespace, this.scope.orgId,
      this.scope.projectId, this.scope.envId, source.walletId, source.moveId,
      source.requestDigestHex, source.sourceGeneration, manifest.schemaJson,
    ]));
    const records = [];
    const completion = [];
    let previous: Chunk | null = null;
    let recordHex = '';
    for (const [index, value] of raw.entries()) {
      const chunk = parseChunk(value, layouts);
      const firstSegment = previous === null || previous.segmentIndex + 1 === previous.segmentCount;
      if (chunk.index !== index || (firstSegment ? chunk.segmentIndex !== 0 :
          previous === null || chunk.segmentIndex !== previous.segmentIndex + 1 ||
          chunk.segmentCount !== previous.segmentCount || chunk.recordKey !== previous.recordKey ||
          chunk.table.table !== previous.table.table))
        throw new Error('Authorization snapshot segments conflict');
      digest = await sha256HexUtf8(JSON.stringify([digest, index, chunk.chunkJson]));
      if (digest !== chunk.digestHex) throw new Error('Authorization snapshot digest conflicts');
      recordHex += chunk.bytesHex;
      const completed = chunk.segmentIndex + 1 === chunk.segmentCount;
      if (completed) {
        const bytes = new Uint8Array(recordHex.length / 2);
        for (let offset = 0; offset < bytes.length; offset += 1)
          bytes[offset] = Number.parseInt(recordHex.slice(offset * 2, offset * 2 + 2), 16);
        records.push({ table: chunk.table, recordKey: chunk.recordKey,
          recordJson: new TextDecoder('utf-8', { fatal: true }).decode(bytes) });
        recordHex = '';
      }
      completion.push(prepareD1TenantStatement(this.database, this.scope, `
        INSERT INTO wallet_relocation_authorization_intake_chunks
        (namespace, org_id, project_id, env_id, wallet_id, chunk_index, chunk_json, digest_hex)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
        [source.walletId, index, chunk.chunkJson, chunk.digestHex]),
        prepareD1TenantStatement(this.database, this.scope, `
        UPDATE wallet_relocation_authorization_intakes SET next_index = next_index + 1,
          record_count = record_count + ?8, digest_hex = ?7
        WHERE ${SCOPE} AND next_index = ?6 AND state = 'receiving'`,
        [source.walletId, index, chunk.digestHex, completed ? 1 : 0]),
        this.database.prepare(D1_BATCH_CAS_GUARD_SQL));
      previous = chunk;
    }
    if (recordHex !== '' || records.length !== manifest.recordCount || digest !== manifest.digestHex)
      throw new Error('Authorization snapshot is incomplete');
    if (state.state === 'verified') return digest;
    if (state.nextIndex !== 0) throw new Error('Authorization snapshot intake is not empty');
    completion.push(prepareD1TenantStatement(this.database, this.scope, `
      UPDATE wallet_relocation_authorization_intakes SET state = 'verified'
      WHERE ${SCOPE} AND state = 'receiving' AND next_index = ?6 AND record_count = ?7 AND digest_hex = ?8`,
      [source.walletId, manifest.chunkCount, manifest.recordCount, digest]),
      this.database.prepare(D1_BATCH_CAS_GUARD_SQL));
    try {
      await new D1WalletAuthorizationHistory(this.database, this.scope).restoreSnapshot(source, records, completion);
    } catch (error) {
      const concurrent = await this.read(source);
      if (concurrent?.state === 'verified' && concurrent.manifest.digestHex === digest) return digest;
      throw error;
    }
    return digest;
  }

  async activate(
    source: WalletRelocationSessionSource,
    rawManifest: unknown,
    commandDigest: string,
    nowMs: number,
  ): Promise<{ readonly digestHex: string; readonly activatedAtMs: number }> {
    const manifest = parseManifest(rawManifest);
    const manifestJson = JSON.stringify(manifest);
    parseUnixMs(nowMs, 'authorization activation time');
    const existing = await this.readActivation(source, manifestJson, commandDigest);
    if (existing !== null) return { digestHex: manifest.digestHex, activatedAtMs: existing };
    const identity = [
      source.walletId,
      source.moveId,
      source.requestDigestHex,
      source.sourceGeneration,
    ];
    await this.database.batch([
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        INSERT INTO wallet_relocation_authorization_activations
          (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex,
           source_generation, command_digest, manifest_json, activated_at_ms)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
        WHERE NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_activations
          WHERE ${SCOPE} AND move_id = ?6)
        ON CONFLICT DO NOTHING`,
        [...identity, commandDigest, manifestJson, nowMs],
      ),
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        UPDATE wallet_relocation_authorization_imports SET state = 'activated'
        WHERE ${SCOPE} AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8
          AND state IN ('closed', 'activated')
          AND EXISTS (SELECT 1 FROM wallet_relocation_authorization_activations AS receipt
            WHERE receipt.namespace = ?1 AND receipt.org_id = ?2 AND receipt.project_id = ?3
              AND receipt.env_id = ?4 AND receipt.wallet_id = ?5 AND receipt.move_id = ?6
              AND receipt.command_digest = ?9 AND receipt.manifest_json = ?10)`,
        [...identity, commandDigest, manifestJson],
      ),
      this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
    ]);
    const activatedAtMs = await this.readActivation(source, manifestJson, commandDigest);
    if (activatedAtMs === null) throw new Error('Authorization activation receipt disappeared');
    return { digestHex: manifest.digestHex, activatedAtMs };
  }

  private async readActivation(
    source: WalletRelocationSessionSource,
    manifestJson: string,
    commandDigest: string,
  ): Promise<number | null> {
    const row = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      SELECT * FROM wallet_relocation_authorization_activations
      WHERE ${SCOPE} AND move_id = ?6`,
      [source.walletId, source.moveId],
    ).first<Record<string, unknown>>();
    if (!row) return null;
    if (
      !source.matches(row) ||
      row.command_digest !== commandDigest ||
      row.manifest_json !== manifestJson
    )
      throw new Error('Authorization activation identity conflicts');
    return parseUnixMs(row.activated_at_ms, 'stored authorization activation time');
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
    bytesHex: hex,
  };
}

function intakeProgress(state: IntakeState): IntakeProgress {
  switch (state.state) {
    case 'receiving':
      return {
        state: 'receiving',
        nextIndex: state.nextIndex,
        chunkCount: state.manifest.chunkCount,
      };
    case 'verified':
      return { state: 'verified', digestHex: state.digestHex };
  }
}
