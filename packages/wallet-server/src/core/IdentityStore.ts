import { isObject, toOptionalTrimmedString } from '@shared/utils/validation';
import { failure } from '@shared/utils/failure';
import { D1IdentityStore, IDENTITY_D1_STORE } from './d1IdentityStore';
import { resolveStorePrefix } from './d1TenantStore';
import {
  createKeyValueStore,
  type KeyValueRecords,
  type KeyValueStoreSpec,
  type StoreFactoryInput,
} from './storeBackends';

export {
  D1IdentityStore,
  IDENTITY_STORE_D1_SCHEMA_SQL,
  ensureIdentityStoreD1Schema,
} from './d1IdentityStore';
export type { D1IdentityStoreOptions, D1IdentityStoreSchemaOptions } from './d1IdentityStore';

export type IdentitySubjectRecord = {
  version: 'identity_subject_v1';
  subject: string;
  userId: string;
  createdAtMs: number;
  updatedAtMs: number;
};

export type IdentityUserRecord = {
  version: 'identity_user_v1';
  userId: string;
  subjects: string[];
  createdAtMs: number;
  updatedAtMs: number;
};

export type LinkIdentityResult =
  | { ok: true; movedFromUserId?: string }
  | { ok: false; code: string; message: string };

export type UnlinkIdentityResult = { ok: true } | { ok: false; code: string; message: string };

export interface IdentityStore {
  getUserIdBySubject(subject: string): Promise<string | null>;
  listSubjectsByUserId(userId: string): Promise<string[]>;
  linkSubjectToUserId(input: {
    userId: string;
    subject: string;
    allowMoveIfSoleIdentity?: boolean;
  }): Promise<LinkIdentityResult>;
  unlinkSubjectFromUserId(input: {
    userId: string;
    subject: string;
  }): Promise<UnlinkIdentityResult>;
  deleteSubjectLinkForDevCleanup(input: {
    userId: string;
    subject: string;
  }): Promise<UnlinkIdentityResult>;

}

export function resolveIdentityStoreNamespace(config: Record<string, unknown>): string {
  return resolveStorePrefix(config, ['IDENTITY_PREFIX', 'IDENTITY_MAP_PREFIX'], 'identity:');
}

function parseIdentitySubjectRecord(raw: unknown): IdentitySubjectRecord | null {
  if (!isObject(raw)) return null;
  const version = toOptionalTrimmedString(raw.version);
  const subject = toOptionalTrimmedString(raw.subject);
  const userId = toOptionalTrimmedString(raw.userId);
  const createdAtMsRaw = (raw as { createdAtMs?: unknown }).createdAtMs;
  const updatedAtMsRaw = (raw as { updatedAtMs?: unknown }).updatedAtMs;
  const createdAtMs = typeof createdAtMsRaw === 'number' ? createdAtMsRaw : Number(createdAtMsRaw);
  const updatedAtMs = typeof updatedAtMsRaw === 'number' ? updatedAtMsRaw : Number(updatedAtMsRaw);
  if (version !== 'identity_subject_v1') return null;
  if (!subject || !userId) return null;
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return null;
  if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) return null;
  return {
    version: 'identity_subject_v1',
    subject,
    userId,
    createdAtMs: Math.floor(createdAtMs),
    updatedAtMs: Math.floor(updatedAtMs),
  };
}

function parseIdentityUserRecord(raw: unknown): IdentityUserRecord | null {
  if (!isObject(raw)) return null;
  const version = toOptionalTrimmedString(raw.version);
  const userId = toOptionalTrimmedString(raw.userId);
  const subjectsRaw = (raw as { subjects?: unknown }).subjects;
  const subjects = Array.isArray(subjectsRaw)
    ? subjectsRaw.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean)
    : null;
  const createdAtMsRaw = (raw as { createdAtMs?: unknown }).createdAtMs;
  const updatedAtMsRaw = (raw as { updatedAtMs?: unknown }).updatedAtMs;
  const createdAtMs = typeof createdAtMsRaw === 'number' ? createdAtMsRaw : Number(createdAtMsRaw);
  const updatedAtMs = typeof updatedAtMsRaw === 'number' ? updatedAtMsRaw : Number(updatedAtMsRaw);
  if (version !== 'identity_user_v1') return null;
  if (!userId || !subjects) return null;
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return null;
  if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) return null;
  const uniqueSubjects = Array.from(new Set(subjects));
  uniqueSubjects.sort();
  return {
    version: 'identity_user_v1',
    userId,
    subjects: uniqueSubjects,
    createdAtMs: Math.floor(createdAtMs),
    updatedAtMs: Math.floor(updatedAtMs),
  };
}

class InMemoryIdentityStore implements IdentityStore {
  private readonly prefix: string;
  private readonly subjectToUser = new Map<string, IdentitySubjectRecord>();
  private readonly userToSubjects = new Map<string, IdentityUserRecord>();

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  private subjectKey(subject: string): string {
    return `${this.prefix}subject:${subject}`;
  }

  private userKey(userId: string): string {
    return `${this.prefix}user:${userId}`;
  }

  async getUserIdBySubject(subject: string): Promise<string | null> {
    const s = toOptionalTrimmedString(subject);
    if (!s) return null;
    return this.subjectToUser.get(this.subjectKey(s))?.userId || null;
  }

  async listSubjectsByUserId(userId: string): Promise<string[]> {
    const uid = toOptionalTrimmedString(userId);
    if (!uid) return [];
    return this.userToSubjects.get(this.userKey(uid))?.subjects || [];
  }

  async linkSubjectToUserId(input: {
    userId: string;
    subject: string;
    allowMoveIfSoleIdentity?: boolean;
  }): Promise<LinkIdentityResult> {
    const userId = toOptionalTrimmedString(input.userId);
    const subject = toOptionalTrimmedString(input.subject);
    if (!userId) return failure('invalid_args', 'Missing userId');
    if (!subject) return failure('invalid_args', 'Missing subject');

    const now = Date.now();
    const existing = this.subjectToUser.get(this.subjectKey(subject)) || null;
    if (existing && existing.userId !== userId) {
      if (!input.allowMoveIfSoleIdentity) {
        return failure('already_linked', 'Subject is already linked to a different user');
      }
      const sourceUser = existing.userId;
      const source = this.userToSubjects.get(this.userKey(sourceUser)) || null;
      const sourceSubjects = source?.subjects || [];
      if (sourceSubjects.length !== 1 || sourceSubjects[0] !== subject) {
        return failure(
          'already_linked',
          'Subject is linked to a different user with other identities; merge is not allowed',
        );
      }
      this.userToSubjects.set(this.userKey(sourceUser), {
        version: 'identity_user_v1',
        userId: sourceUser,
        subjects: [],
        createdAtMs: source?.createdAtMs || now,
        updatedAtMs: now,
      });
      this.subjectToUser.set(this.subjectKey(subject), {
        version: 'identity_subject_v1',
        subject,
        userId,
        createdAtMs: existing.createdAtMs,
        updatedAtMs: now,
      });

      const dest = this.userToSubjects.get(this.userKey(userId)) || null;
      const destSubjects = Array.from(new Set([...(dest?.subjects || []), subject]));
      destSubjects.sort();
      this.userToSubjects.set(this.userKey(userId), {
        version: 'identity_user_v1',
        userId,
        subjects: destSubjects,
        createdAtMs: dest?.createdAtMs || now,
        updatedAtMs: now,
      });
      return { ok: true, movedFromUserId: sourceUser };
    }

    if (!existing) {
      this.subjectToUser.set(this.subjectKey(subject), {
        version: 'identity_subject_v1',
        subject,
        userId,
        createdAtMs: now,
        updatedAtMs: now,
      });
    } else {
      this.subjectToUser.set(this.subjectKey(subject), { ...existing, updatedAtMs: now });
    }

    const existingUser = this.userToSubjects.get(this.userKey(userId)) || null;
    const nextSubjects = Array.from(new Set([...(existingUser?.subjects || []), subject]));
    nextSubjects.sort();
    this.userToSubjects.set(this.userKey(userId), {
      version: 'identity_user_v1',
      userId,
      subjects: nextSubjects,
      createdAtMs: existingUser?.createdAtMs || now,
      updatedAtMs: now,
    });
    return { ok: true };
  }

  async unlinkSubjectFromUserId(input: {
    userId: string;
    subject: string;
  }): Promise<UnlinkIdentityResult> {
    const userId = toOptionalTrimmedString(input.userId);
    const subject = toOptionalTrimmedString(input.subject);
    if (!userId) return failure('invalid_args', 'Missing userId');
    if (!subject) return failure('invalid_args', 'Missing subject');

    const existing = this.subjectToUser.get(this.subjectKey(subject)) || null;
    if (!existing || existing.userId !== userId) {
      return failure('not_found', 'Subject is not linked to this user');
    }

    const userRec = this.userToSubjects.get(this.userKey(userId)) || null;
    const subjects = userRec?.subjects || [];
    if (subjects.length <= 1) {
      return failure(
        'cannot_unlink_last_identity',
        'Refusing to remove the last remaining identity',
      );
    }

    this.subjectToUser.delete(this.subjectKey(subject));
    const now = Date.now();
    const nextSubjects = subjects.filter((s) => s !== subject);
    nextSubjects.sort();
    this.userToSubjects.set(this.userKey(userId), {
      version: 'identity_user_v1',
      userId,
      subjects: nextSubjects,
      createdAtMs: userRec?.createdAtMs || now,
      updatedAtMs: now,
    });

    return { ok: true };
  }

  async deleteSubjectLinkForDevCleanup(input: {
    userId: string;
    subject: string;
  }): Promise<UnlinkIdentityResult> {
    const userId = toOptionalTrimmedString(input.userId);
    const subject = toOptionalTrimmedString(input.subject);
    if (!userId) return failure('invalid_args', 'Missing userId');
    if (!subject) return failure('invalid_args', 'Missing subject');

    const existing = this.subjectToUser.get(this.subjectKey(subject)) || null;
    if (!existing || existing.userId !== userId) {
      return failure('not_found', 'Subject is not linked to this user');
    }

    this.subjectToUser.delete(this.subjectKey(subject));
    const now = Date.now();
    const userRec = this.userToSubjects.get(this.userKey(userId)) || null;
    const nextSubjects = (userRec?.subjects || []).filter((s) => s !== subject);
    if (nextSubjects.length > 0) {
      nextSubjects.sort();
      this.userToSubjects.set(this.userKey(userId), {
        version: 'identity_user_v1',
        userId,
        subjects: nextSubjects,
        createdAtMs: userRec?.createdAtMs || now,
        updatedAtMs: now,
      });
    } else {
      this.userToSubjects.delete(this.userKey(userId));
    }

    return { ok: true };
  }

}

/** Upstash REST, Redis TCP and Durable Object backends, which hold records unparsed. */
class KeyValueIdentityStore implements IdentityStore {
  constructor(
    private readonly records: KeyValueRecords<unknown>,
    private readonly prefix: string,
  ) {}

  private subjectKey(subject: string): string {
    return `${this.prefix}subject:${subject}`;
  }

  private userKey(userId: string): string {
    return `${this.prefix}user:${userId}`;
  }

  async getUserIdBySubject(subject: string): Promise<string | null> {
    const s = toOptionalTrimmedString(subject);
    if (!s) return null;
    const raw = await this.records.get(this.subjectKey(s));
    const parsed = parseIdentitySubjectRecord(raw);
    return parsed?.userId || null;
  }

  async listSubjectsByUserId(userId: string): Promise<string[]> {
    const uid = toOptionalTrimmedString(userId);
    if (!uid) return [];
    const raw = await this.records.get(this.userKey(uid));
    const parsed = parseIdentityUserRecord(raw);
    return parsed?.subjects || [];
  }

  async linkSubjectToUserId(input: {
    userId: string;
    subject: string;
    allowMoveIfSoleIdentity?: boolean;
  }): Promise<LinkIdentityResult> {
    const userId = toOptionalTrimmedString(input.userId);
    const subject = toOptionalTrimmedString(input.subject);
    if (!userId) return failure('invalid_args', 'Missing userId');
    if (!subject) return failure('invalid_args', 'Missing subject');

    const now = Date.now();
    const existingSubject = parseIdentitySubjectRecord(
      await this.records.get(this.subjectKey(subject)),
    );
    if (existingSubject && existingSubject.userId !== userId) {
      if (!input.allowMoveIfSoleIdentity) {
        return failure('already_linked', 'Subject is already linked to a different user');
      }
      const sourceUser = existingSubject.userId;
      const sourceUserRec = parseIdentityUserRecord(
        await this.records.get(this.userKey(sourceUser)),
      );
      const sourceSubjects = sourceUserRec?.subjects || [];
      if (sourceSubjects.length !== 1 || sourceSubjects[0] !== subject) {
        return failure(
          'already_linked',
          'Subject is linked to a different user with other identities; merge is not allowed',
        );
      }

      const destUserRec = parseIdentityUserRecord(await this.records.get(this.userKey(userId)));
      const destSubjects = Array.from(new Set([...(destUserRec?.subjects || []), subject]));
      destSubjects.sort();
      await this.records.set(this.userKey(userId), {
        version: 'identity_user_v1',
        userId,
        subjects: destSubjects,
        createdAtMs: destUserRec?.createdAtMs || now,
        updatedAtMs: now,
      } satisfies IdentityUserRecord);

      await this.records.set(this.userKey(sourceUser), {
        version: 'identity_user_v1',
        userId: sourceUser,
        subjects: [],
        createdAtMs: sourceUserRec?.createdAtMs || existingSubject.createdAtMs || now,
        updatedAtMs: now,
      } satisfies IdentityUserRecord);

      await this.records.set(this.subjectKey(subject), {
        version: 'identity_subject_v1',
        subject,
        userId,
        createdAtMs: existingSubject.createdAtMs || now,
        updatedAtMs: now,
      } satisfies IdentitySubjectRecord);

      return { ok: true, movedFromUserId: sourceUser };
    }

    await this.records.set(this.subjectKey(subject), {
      version: 'identity_subject_v1',
      subject,
      userId,
      createdAtMs: existingSubject?.createdAtMs || now,
      updatedAtMs: now,
    } satisfies IdentitySubjectRecord);

    const userRec = parseIdentityUserRecord(await this.records.get(this.userKey(userId)));
    const subjects = Array.from(new Set([...(userRec?.subjects || []), subject]));
    subjects.sort();
    await this.records.set(this.userKey(userId), {
      version: 'identity_user_v1',
      userId,
      subjects,
      createdAtMs: userRec?.createdAtMs || now,
      updatedAtMs: now,
    } satisfies IdentityUserRecord);
    return { ok: true };
  }

  async unlinkSubjectFromUserId(input: {
    userId: string;
    subject: string;
  }): Promise<UnlinkIdentityResult> {
    const userId = toOptionalTrimmedString(input.userId);
    const subject = toOptionalTrimmedString(input.subject);
    if (!userId) return failure('invalid_args', 'Missing userId');
    if (!subject) return failure('invalid_args', 'Missing subject');

    const subjectRec = parseIdentitySubjectRecord(await this.records.get(this.subjectKey(subject)));
    if (!subjectRec || subjectRec.userId !== userId) {
      return failure('not_found', 'Subject is not linked to this user');
    }

    const userRec = parseIdentityUserRecord(await this.records.get(this.userKey(userId)));
    const subjects = userRec?.subjects || [];
    if (subjects.length <= 1) {
      return failure(
        'cannot_unlink_last_identity',
        'Refusing to remove the last remaining identity',
      );
    }

    const nextSubjects = subjects.filter((s) => s !== subject);
    nextSubjects.sort();
    await this.records.set(this.userKey(userId), {
      version: 'identity_user_v1',
      userId,
      subjects: nextSubjects,
      createdAtMs: userRec?.createdAtMs || Date.now(),
      updatedAtMs: Date.now(),
    } satisfies IdentityUserRecord);
    await this.records.del(this.subjectKey(subject));
    return { ok: true };
  }

  async deleteSubjectLinkForDevCleanup(input: {
    userId: string;
    subject: string;
  }): Promise<UnlinkIdentityResult> {
    const userId = toOptionalTrimmedString(input.userId);
    const subject = toOptionalTrimmedString(input.subject);
    if (!userId) return failure('invalid_args', 'Missing userId');
    if (!subject) return failure('invalid_args', 'Missing subject');

    const subjectRec = parseIdentitySubjectRecord(await this.records.get(this.subjectKey(subject)));
    if (!subjectRec || subjectRec.userId !== userId) {
      return failure('not_found', 'Subject is not linked to this user');
    }

    const userRec = parseIdentityUserRecord(await this.records.get(this.userKey(userId)));
    const nextSubjects = (userRec?.subjects || []).filter((s) => s !== subject);
    if (nextSubjects.length > 0) {
      nextSubjects.sort();
      await this.records.set(this.userKey(userId), {
        version: 'identity_user_v1',
        userId,
        subjects: nextSubjects,
        createdAtMs: userRec?.createdAtMs || Date.now(),
        updatedAtMs: Date.now(),
      } satisfies IdentityUserRecord);
    } else {
      await this.records.del(this.userKey(userId));
    }
    await this.records.del(this.subjectKey(subject));
    return { ok: true };
  }

}

const IDENTITY_STORE: KeyValueStoreSpec<unknown> = {
  tag: 'identity',
  label: 'identity',
  connectionErrorSubject: 'identity store',
  durableObjectLog: 'identity store',
  durableObjectErrorName: 'Identity',
  unconfiguredNote: 'non-persistent',
  d1StoreName: IDENTITY_D1_STORE,
  resolvePrefix: resolveIdentityStoreNamespace,
  parse: (raw) => raw,
};

export function createIdentityStore(input: StoreFactoryInput): IdentityStore {
  return createKeyValueStore(input, IDENTITY_STORE, {
    d1: (options) => new D1IdentityStore(options),
    keyValue: (records, prefix) => new KeyValueIdentityStore(records, prefix),
    inMemory: (prefix) => new InMemoryIdentityStore(prefix),
  });
}
