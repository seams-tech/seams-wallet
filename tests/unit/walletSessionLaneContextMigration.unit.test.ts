import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { cleanupTemporaryD1Database, createTemporaryD1Database } from './helpers/sqliteD1.fixtures';

const migration = readFileSync(
  new URL(
    '../../packages/wallet-server/migrations/d1-signer/0036_r150_wallet_session_lane_context.sql',
    import.meta.url,
  ),
  'utf8',
);

test('retires pre-R150 Wallet Sessions and adds their original APAC lane context', async () => {
  const temporary = createTemporaryD1Database();
  try {
    await temporary.database.exec(`
      CREATE TABLE wallet_session_authorizations_v2 (
        wallet_id TEXT NOT NULL,
        issued_at_ms INTEGER NOT NULL,
        retired_at_ms INTEGER,
        record_json TEXT NOT NULL CHECK (json_valid(record_json))
      );
      INSERT INTO wallet_session_authorizations_v2 (
        wallet_id,
        issued_at_ms,
        retired_at_ms,
        record_json
      ) VALUES (
        'wallet:migration-fixture',
        1000,
        NULL,
        '{"kind":"wallet_session_authorization_v2","walletId":"wallet:migration-fixture"}'
      );
    `);

    await temporary.database.exec(migration);

    const row = await temporary.database
      .prepare(
        `SELECT retired_at_ms, json_extract(record_json, '$.laneContext') AS lane_context_json
           FROM wallet_session_authorizations_v2`,
      )
      .first<{ readonly retired_at_ms: number; readonly lane_context_json: string }>();
    expect(row).not.toBeNull();
    expect(row?.retired_at_ms).toBe(1_000);
    expect(JSON.parse(row?.lane_context_json ?? 'null')).toEqual({
      walletId: 'wallet:migration-fixture',
      laneId: 'managed-apac-v1',
      laneEpoch: 1,
      directoryRevision: 1,
    });
  } finally {
    cleanupTemporaryD1Database(temporary.tempDir);
  }
});

test('preserves sessions that already carry a lane context', async () => {
  const temporary = createTemporaryD1Database();
  try {
    await temporary.database.exec(`
      CREATE TABLE wallet_session_authorizations_v2 (
        wallet_id TEXT NOT NULL,
        issued_at_ms INTEGER NOT NULL,
        retired_at_ms INTEGER,
        record_json TEXT NOT NULL CHECK (json_valid(record_json))
      );
      INSERT INTO wallet_session_authorizations_v2 (
        wallet_id,
        issued_at_ms,
        retired_at_ms,
        record_json
      ) VALUES (
        'wallet:regional-fixture',
        2000,
        NULL,
        '{"kind":"wallet_session_authorization_v2","walletId":"wallet:regional-fixture","laneContext":{"walletId":"wallet:regional-fixture","laneId":"managed-eu-v1","laneEpoch":2,"directoryRevision":3}}'
      );
    `);

    await temporary.database.exec(migration);

    const row = await temporary.database
      .prepare(
        `SELECT retired_at_ms, json_extract(record_json, '$.laneContext') AS lane_context_json
           FROM wallet_session_authorizations_v2`,
      )
      .first<{ readonly retired_at_ms: number | null; readonly lane_context_json: string }>();
    expect(row).not.toBeNull();
    expect(row?.retired_at_ms).toBeNull();
    expect(JSON.parse(row?.lane_context_json ?? 'null')).toEqual({
      walletId: 'wallet:regional-fixture',
      laneId: 'managed-eu-v1',
      laneEpoch: 2,
      directoryRevision: 3,
    });
  } finally {
    cleanupTemporaryD1Database(temporary.tempDir);
  }
});
