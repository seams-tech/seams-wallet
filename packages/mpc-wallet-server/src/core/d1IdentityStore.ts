import { toOptionalTrimmedString } from '@shared/utils/validation';
import { failure } from '@shared/utils/failure';
import { d1ChangedRows } from '../storage/d1Sql';
import {
  D1TenantTable,
  ensureD1Schema,
  type D1SchemaOptions,
  type D1TenantStoreOptions,
} from './d1TenantStore';
import type {
  IdentityStore,
  IdentitySubjectRecord,
  LinkIdentityResult,
  UnlinkIdentityResult,
} from './IdentityStore';

export interface D1IdentityStoreSchemaOptions extends D1SchemaOptions {}

export interface D1IdentityStoreOptions extends D1TenantStoreOptions {
  readonly now?: () => Date;
}

/** Names the identity store in D1 scope errors. */
const IDENTITY_D1_STORE = 'identity store';

type D1IdentityLinkRow = {
  readonly subject?: unknown;
  readonly user_id?: unknown;
  readonly created_at_ms?: unknown;
  readonly subject_count?: unknown;
};

/** How many subjects the user has; binds the scope, then the user. */
const SUBJECT_COUNT_SQL = `SELECT COUNT(*) AS subject_count
         FROM identity_links
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND user_id = ?`;

export const IDENTITY_STORE_D1_SCHEMA_SQL = Object.freeze([
  `
    CREATE TABLE IF NOT EXISTS identity_links (
      namespace TEXT NOT NULL,
      org_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      env_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      user_id TEXT NOT NULL,
      record_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (namespace, org_id, project_id, env_id, subject),
      CHECK (length(namespace) > 0),
      CHECK (length(org_id) > 0),
      CHECK (length(project_id) > 0),
      CHECK (length(env_id) > 0),
      CHECK (length(subject) > 0),
      CHECK (length(user_id) > 0),
      CHECK (json_valid(record_json)),
      CHECK (created_at_ms > 0),
      CHECK (updated_at_ms >= created_at_ms),
      CHECK (COALESCE(json_extract(record_json, '$.version') = 'identity_subject_v1', 0)),
      CHECK (COALESCE(json_extract(record_json, '$.subject') = subject, 0)),
      CHECK (COALESCE(json_extract(record_json, '$.userId') = user_id, 0)),
      CHECK (COALESCE(json_extract(record_json, '$.createdAtMs') = created_at_ms, 0)),
      CHECK (COALESCE(json_extract(record_json, '$.updatedAtMs') = updated_at_ms, 0))
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS identity_links_user_idx
      ON identity_links (
        namespace,
        org_id,
        project_id,
        env_id,
        user_id,
        created_at_ms
      )
  `,
] as const);

export async function ensureIdentityStoreD1Schema(
  options: D1IdentityStoreSchemaOptions,
): Promise<void> {
  await ensureD1Schema(options.database, IDENTITY_STORE_D1_SCHEMA_SQL);
}

function defaultNow(): Date {
  return new Date();
}

function parseSubjectCount(raw: unknown): number {
  const count = Number(raw);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
}

function subjectFromIdentityLinkRow(row: D1IdentityLinkRow): string | null {
  return toOptionalTrimmedString(row.subject) || null;
}

function isPresentString(value: string | null): value is string {
  return Boolean(value);
}

function buildIdentitySubjectRecord(input: {
  readonly subject: string;
  readonly userId: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}): IdentitySubjectRecord {
  return {
    version: 'identity_subject_v1',
    subject: input.subject,
    userId: input.userId,
    createdAtMs: input.createdAtMs,
    updatedAtMs: input.updatedAtMs,
  };
}

export class D1IdentityStore implements IdentityStore {
  readonly adapterKind = 'd1';
  private readonly table: D1TenantTable;
  private readonly now: () => Date;

  constructor(input: D1IdentityStoreOptions) {
    this.table = new D1TenantTable(input, IDENTITY_D1_STORE, IDENTITY_STORE_D1_SCHEMA_SQL);
    this.now = input.now || defaultNow;
  }

  async getUserIdBySubject(subject: string): Promise<string | null> {
    await this.table.ensureSchema();
    const normalizedSubject = toOptionalTrimmedString(subject);
    if (!normalizedSubject) return null;
    const row = await this.table
      .prepare(
        `SELECT user_id
         FROM identity_links
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND subject = ?
        LIMIT 1`,
        [normalizedSubject],
      )
      .first<D1IdentityLinkRow>();
    return toOptionalTrimmedString(row?.user_id) || null;
  }

  async listSubjectsByUserId(userId: string): Promise<string[]> {
    await this.table.ensureSchema();
    const normalizedUserId = toOptionalTrimmedString(userId);
    if (!normalizedUserId) return [];
    const result = await this.table
      .prepare(
        `SELECT subject
         FROM identity_links
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND user_id = ?
        ORDER BY created_at_ms ASC`,
        [normalizedUserId],
      )
      .all<D1IdentityLinkRow>();
    return (result.results || [])
      .map(subjectFromIdentityLinkRow)
      .filter(isPresentString);
  }

  async linkSubjectToUserId(input: {
    userId: string;
    subject: string;
    allowMoveIfSoleIdentity?: boolean;
  }): Promise<LinkIdentityResult> {
    await this.table.ensureSchema();
    const userId = toOptionalTrimmedString(input.userId);
    const subject = toOptionalTrimmedString(input.subject);
    if (!userId) return failure('invalid_args', 'Missing userId');
    if (!subject) return failure('invalid_args', 'Missing subject');

    const now = this.now().getTime();
    const existing = await this.table
      .prepare(
        `SELECT user_id, created_at_ms
         FROM identity_links
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND subject = ?
        LIMIT 1`,
        [subject],
      )
      .first<D1IdentityLinkRow>();
    const existingUserId = toOptionalTrimmedString(existing?.user_id);
    const existingCreatedAtMs = Number(existing?.created_at_ms);
    const createdAtMs =
      Number.isFinite(existingCreatedAtMs) && existingCreatedAtMs > 0
        ? Math.floor(existingCreatedAtMs)
        : now;

    if (existingUserId && existingUserId !== userId) {
      if (!input.allowMoveIfSoleIdentity) {
        return failure('already_linked', 'Subject is already linked to a different user');
      }
      const moved = d1ChangedRows(
        await this.table.database
          .prepare(
            `UPDATE identity_links
            SET user_id = ?,
                record_json = ?,
                updated_at_ms = ?
          WHERE namespace = ?
            AND org_id = ?
            AND project_id = ?
            AND env_id = ?
            AND subject = ?
            AND user_id = ?
            AND (
              SELECT COUNT(*)
                FROM identity_links
               WHERE namespace = ?
                 AND org_id = ?
                 AND project_id = ?
                 AND env_id = ?
                 AND user_id = ?
            ) = 1`,
          )
          .bind(
            userId,
            JSON.stringify(
              buildIdentitySubjectRecord({ subject, userId, createdAtMs, updatedAtMs: now }),
            ),
            now,
            this.table.scope.namespace,
            this.table.scope.orgId,
            this.table.scope.projectId,
            this.table.scope.envId,
            subject,
            existingUserId,
            this.table.scope.namespace,
            this.table.scope.orgId,
            this.table.scope.projectId,
            this.table.scope.envId,
            existingUserId,
          )
          .run(),
      );
      if (moved > 0) return { ok: true, movedFromUserId: existingUserId };
      const countRow = await this.table
        .prepare(SUBJECT_COUNT_SQL, [existingUserId])
        .first<D1IdentityLinkRow>();
      if (parseSubjectCount(countRow?.subject_count) !== 1) {
        return failure(
          'already_linked',
          'Subject is linked to a different user with other identities; merge is not allowed',
        );
      }
      return failure('already_linked', 'Subject is already linked to a different user');
    }

    await this.table
      .prepare(
        `INSERT INTO identity_links (
        namespace,
        org_id,
        project_id,
        env_id,
        subject,
        user_id,
        record_json,
        created_at_ms,
        updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (namespace, org_id, project_id, env_id, subject)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        record_json = EXCLUDED.record_json,
        updated_at_ms = EXCLUDED.updated_at_ms
      WHERE identity_links.user_id = EXCLUDED.user_id`,
        [
          subject,
          userId,
          JSON.stringify(
            buildIdentitySubjectRecord({ subject, userId, createdAtMs, updatedAtMs: now }),
          ),
          createdAtMs,
          now,
        ],
      )
      .run();
    const finalUserId = await this.getUserIdBySubject(subject);
    if (finalUserId === userId) return { ok: true };
    if (finalUserId) {
      return failure('already_linked', 'Subject is already linked to a different user');
    }
    return failure('internal', 'Failed to link identity');
  }

  async unlinkSubjectFromUserId(input: {
    userId: string;
    subject: string;
  }): Promise<UnlinkIdentityResult> {
    await this.table.ensureSchema();
    const userId = toOptionalTrimmedString(input.userId);
    const subject = toOptionalTrimmedString(input.subject);
    if (!userId) return failure('invalid_args', 'Missing userId');
    if (!subject) return failure('invalid_args', 'Missing subject');

    const deleted = d1ChangedRows(
      await this.table.database
        .prepare(
          `DELETE FROM identity_links
            WHERE namespace = ?
              AND org_id = ?
              AND project_id = ?
              AND env_id = ?
              AND subject = ?
              AND user_id = ?
              AND (
                SELECT COUNT(*)
                  FROM identity_links
                 WHERE namespace = ?
                   AND org_id = ?
                   AND project_id = ?
                   AND env_id = ?
                   AND user_id = ?
              ) > 1`,
        )
        .bind(
          this.table.scope.namespace,
          this.table.scope.orgId,
          this.table.scope.projectId,
          this.table.scope.envId,
          subject,
          userId,
          this.table.scope.namespace,
          this.table.scope.orgId,
          this.table.scope.projectId,
          this.table.scope.envId,
          userId,
        )
        .run(),
    );
    if (deleted > 0) return { ok: true };

    const existingUserId = await this.getUserIdBySubject(subject);
    if (existingUserId !== userId) {
      return failure('not_found', 'Subject is not linked to this user');
    }
    const countRow = await this.table
      .prepare(SUBJECT_COUNT_SQL, [userId])
      .first<D1IdentityLinkRow>();
    if (parseSubjectCount(countRow?.subject_count) <= 1) {
      return failure(
        'cannot_unlink_last_identity',
        'Refusing to remove the last remaining identity',
      );
    }
    return failure('internal', 'Failed to unlink identity');
  }

  async deleteSubjectLinkForDevCleanup(input: {
    userId: string;
    subject: string;
  }): Promise<UnlinkIdentityResult> {
    await this.table.ensureSchema();
    const userId = toOptionalTrimmedString(input.userId);
    const subject = toOptionalTrimmedString(input.subject);
    if (!userId) return failure('invalid_args', 'Missing userId');
    if (!subject) return failure('invalid_args', 'Missing subject');
    const deleted = await this.deleteIdentityLink({ userId, subject });
    if (deleted === 0) {
      return failure('not_found', 'Subject is not linked to this user');
    }
    return { ok: true };
  }

  private async deleteIdentityLink(input: {
    readonly userId: string;
    readonly subject: string;
  }): Promise<number> {
    const result = await this.table
      .prepare(
        `DELETE FROM identity_links
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND subject = ?
          AND user_id = ?`,
        [input.subject, input.userId],
      )
      .run();
    return d1ChangedRows(result);
  }
}
