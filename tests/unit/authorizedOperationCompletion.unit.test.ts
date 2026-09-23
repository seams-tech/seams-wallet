import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { CloudflareD1AuthorizationStore } from '../../packages/wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore';
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from '../../packages/wallet-server/src/storage/tenantRoute';
import { buildClaimedSigningOperationFixture } from './helpers/authorizedOperation.fixtures';

class CompletionDatabase implements D1DatabaseLike {
  readonly sqlite = new DatabaseSync(':memory:');
  queryCount = 0;

  prepare(query: string): D1PreparedStatementLike {
    return new CompletionStatement(this, query, []);
  }

  async batch<T>(): Promise<readonly T[]> {
    throw new Error('Unexpected batch');
  }

  async exec(query: string): Promise<void> {
    this.sqlite.exec(query);
  }
}

class CompletionStatement implements D1PreparedStatementLike {
  constructor(
    readonly database: CompletionDatabase,
    readonly query: string,
    readonly values: SQLInputValue[],
  ) {}

  bind(...values: unknown[]): D1PreparedStatementLike {
    return new CompletionStatement(this.database, this.query, values.map(sqlValue));
  }

  async first<T>(): Promise<T | null> {
    this.database.queryCount += 1;
    // D1's generic result is untrusted; the production row parser validates it.
    return (this.database.sqlite.prepare(this.query).get(...this.values) as T) ?? null;
  }

  async all<T>(): Promise<D1ResultLike<T>> {
    throw new Error('Unexpected all query');
  }

  async run<T>(): Promise<D1ResultLike<T>> {
    this.database.queryCount += 1;
    const result = this.database.sqlite.prepare(this.query).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

function sqlValue(value: unknown): SQLInputValue {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  throw new Error('Unexpected SQL binding');
}

async function setupCompletion() {
  const database = new CompletionDatabase();
  const migration = readFileSync(
    new URL(
      '../../packages/wallet-server/migrations/d1-signer/0002_signer_post_103_canonical_upgrade.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const schema = migration.match(
    /CREATE TABLE "authorized_operations_post_103_upgrade" \([\s\S]*?\n\);/,
  );
  if (!schema) throw new Error('Canonical operation schema missing');
  database.sqlite.exec(schema[0]);
  database.sqlite.exec(
    'ALTER TABLE authorized_operations_post_103_upgrade RENAME TO authorized_operations',
  );
  const operation = await buildClaimedSigningOperationFixture();
  if (operation.authorization.kind !== 'verified_step_up')
    throw new Error('Expected step-up fixture');
  const envelope = operation.operation;
  database.sqlite
    .prepare(
      `INSERT INTO authorized_operations (
    namespace, tenant_id, authorized_operation_id, audit_event_id, principal_id,
    capability_id, capability_kind, operation_kind, operation_id,
    operation_fingerprint_digest, lane_digest, intent_digest, display_digest,
    authorization_source_kind, evidence_set_digest, quota_kind, lifecycle_kind,
    result_kind, claimed_at_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'completion-test',
      operation.tenantId,
      operation.authorizedOperationId,
      operation.auditEventId,
      envelope.principalId,
      envelope.capabilityId,
      envelope.operation.capabilityKind,
      envelope.operation.operationKind,
      envelope.operationId,
      operation.operationFingerprintDigest,
      envelope.digests.laneDigest,
      envelope.digests.intentDigest,
      envelope.digests.displayDigest,
      operation.authorization.kind,
      operation.authorization.evidenceSetDigest,
      operation.quota.kind,
      operation.lifecycle,
      'pending',
      operation.claimedAtMs,
    );
  const store = new CloudflareD1AuthorizationStore({
    database,
    namespace: 'completion-test',
    walletSignerScope: {
      namespace: 'completion-test',
      orgId: String(operation.tenantId),
      projectId: 'completion-test',
      envId: 'test',
    },
  });
  return { database, store, operation };
}

test('completion returns the durable canonical record in one query and preserves the first replay', async () => {
  const { database, store, operation } = await setupCompletion();
  try {
    const response = { status: 200, contentType: 'application/json', bodyText: '{"ok":true}' };
    const completed = await store.completeAuthorizedOperation({
      operation,
      result: 'succeeded',
      response,
      completedAtMs: 2000,
    });
    expect(database.queryCount).toBe(1);
    expect(completed.lifecycle).toBe('completed');
    expect(
      await store.readAuthorizedOperation({
        tenantId: operation.tenantId,
        operationFingerprintDigest: operation.operationFingerprintDigest,
      }),
    ).toEqual(completed);
    const replay = await store.completeAuthorizedOperation({
      operation,
      result: 'failed_after_side_effect',
      response: { status: 500, contentType: 'text/plain', bodyText: 'replacement' },
      completedAtMs: 3000,
    });
    expect(replay).toEqual(completed);
    expect(database.queryCount).toBe(4);
    database.sqlite.exec("UPDATE authorized_operations SET result_body_text = 'corrupt'");
    await expect(
      store.completeAuthorizedOperation({
        operation,
        result: 'succeeded',
        response,
        completedAtMs: 4000,
      }),
    ).rejects.toThrow('resultDigest does not match');
  } finally {
    database.sqlite.close();
  }
});

test('completion rejects a missing claim and validates the returned operation fingerprint', async () => {
  const { database, store, operation } = await setupCompletion();
  try {
    const input = {
      operation,
      result: 'succeeded' as const,
      response: { status: 200, contentType: 'application/json', bodyText: '{}' },
      completedAtMs: 2000,
    };
    database.sqlite.exec("UPDATE authorized_operations SET operation_id = 'changed-operation'");
    await expect(store.completeAuthorizedOperation(input)).rejects.toThrow(
      'operationFingerprintDigest does not match',
    );
    database.sqlite.exec('DELETE FROM authorized_operations');
    await expect(store.completeAuthorizedOperation(input)).rejects.toThrow(
      'completion claim is missing',
    );
  } finally {
    database.sqlite.close();
  }
});
