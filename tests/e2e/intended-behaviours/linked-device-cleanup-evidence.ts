import { expect, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isolatedGatewayDatabasePath, type NodeSqliteModule } from './local-gateway-database';

export async function verifyLinkedDeviceCleanup(testInfo: TestInfo): Promise<void> {
  const sqliteModule: string = 'node:sqlite';
  const { DatabaseSync } = (await import(sqliteModule)) as NodeSqliteModule;
  const database = new DatabaseSync(await isolatedGatewayDatabasePath(), { readOnly: true });
  try {
    const deliveries = database.prepare(`
      SELECT link_session_id, lifecycle_kind, cleanup_state,
             sealed_envelope_json IS NULL AS envelope_removed,
             cleanup_receipt_json IS NOT NULL AS receipt_retained,
             acknowledgement_receipt_json IS NOT NULL AS acknowledgement_retained
        FROM linked_device_wallet_session_credential_deliveries_v1
    `).all();
    expect(deliveries).toHaveLength(1);
    const delivery = deliveries[0];
    const linkSessionId = delivery.link_session_id;
    if (typeof linkSessionId !== 'string') throw new Error('Cleanup evidence requires a session id');
    expect(delivery.lifecycle_kind).toBe('cleanup_complete');
    expect(delivery.cleanup_state).toBe('complete');
    expect(delivery.envelope_removed).toBe(1);
    expect(delivery.receipt_retained).toBe(1);
    expect(delivery.acknowledgement_retained).toBe(1);
    const remaining: Record<string, number> = {};
    for (const table of [
      'linked_device_sessions',
      'linked_device_session_transcripts',
      'linked_device_target_credentials',
      'linked_device_target_commit_reservations',
      'linked_device_email_otp_grants',
      'linked_device_ed25519_export_root_transfers',
      'linked_device_request_proof_nonces',
      'linked_device_authority_allocations',
    ]) {
      const rows = database.prepare(
        `SELECT count(*) AS count FROM ${table} WHERE link_session_id = ?`,
      ).all(linkSessionId);
      const count = rows[0]?.count;
      if (typeof count !== 'number') throw new Error(`Invalid cleanup count for ${table}`);
      remaining[table] = count;
      expect(count, table).toBe(0);
    }
    const installations = database.prepare(
      'SELECT count(*) AS count FROM linked_device_authority_installations WHERE link_session_id = ?',
    ).all(linkSessionId);
    expect(installations[0]?.count).toBe(1);
    const evidence = JSON.stringify({
      kind: 'linked_device_cleanup_evidence_v1',
      host: process.env.SEAMS_INTENDED_WALLET_HOST ?? 'cloudflare',
      delivery,
      remaining,
      retainedInstallations: 1,
      scope: 'Fresh local real-protocol installation after lost execution/activation responses and both-curve signing; regional isolation remains a separate gate.',
    }, null, 2);
    await testInfo.attach('linked-device-cleanup', { body: evidence, contentType: 'application/json' });
    const traceDirectory = process.env.SEAMS_INTENDED_TRACE_DIR;
    if (traceDirectory) {
      await mkdir(traceDirectory, { recursive: true });
      await writeFile(path.join(traceDirectory, 'linked-device-cleanup.json'), `${evidence}\n`);
    }
  } finally {
    database.close();
  }
}
