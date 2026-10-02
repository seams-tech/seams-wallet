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
