import type { NormalizedLogger } from './logger';
import type { ThresholdRuntimePolicyScope, ThresholdStoreConfigInput } from './types';
import { d1ChangedRows, resolveD1DatabaseFromConfig } from '../storage/d1Sql';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../storage/tenantRoute';
import {
  D1TenantTable,
  d1TenantScopeFromConfig,
  resolveStorePrefix,
  type D1TenantScope,
} from './d1TenantStore';
import { isPlainObject, toOptionalTrimmedString } from '@shared/utils/validation';
import {
  parseCurrentEmailOtpAuthStateRecord,
  parseCurrentEmailOtpChallengeRow,
  parseCurrentEmailOtpChallengeRecord,
  parseCurrentEmailOtpAuthStateRow,
  parseCurrentEmailOtpGrantRecord,
  parseCurrentEmailOtpGrantRow,
  parseCurrentEmailOtpUnlockChallengeRecord,
  parseCurrentEmailOtpUnlockChallengeRow,
  parseCurrentEmailOtpWalletEnrollmentRecord,
  parseCurrentEmailOtpWalletEnrollmentRow,
  parseCurrentGoogleEmailOtpRegistrationAttemptRecord,
  parseCurrentGoogleEmailOtpRegistrationAttemptRow,
  parseJsonRecord,
  registrationAttemptMatchesReplacementScope,
  registrationAttemptMatchesStartedScope,
} from './EmailOtpRecords';
import {
  emailOtpAuthStateRows,
  emailOtpChallengeRows,
  emailOtpGrantRows,
  emailOtpRegistrationAttemptRows,
  emailOtpUnlockChallengeRows,
  emailOtpWalletEnrollmentRows,
  type ScopedD1Prepare,
} from './emailOtpD1Statements';
import type {
  WalletEmailOtpChannel,
  WalletEmailOtpLoginOperation,
  WalletEmailOtpOperation,
} from '@shared/utils/emailOtpDomain';
import { WALLET_EMAIL_OTP_ACTIONS } from '@shared/utils/emailOtpDomain';
export type EmailOtpChannel = WalletEmailOtpChannel;
export type EmailOtpGrantAction =
  | typeof WALLET_EMAIL_OTP_ACTIONS.unseal
  | typeof WALLET_EMAIL_OTP_ACTIONS.recoveryBootstrap;
export type EmailOtpChallengeAction =
  | typeof WALLET_EMAIL_OTP_ACTIONS.login
  | typeof WALLET_EMAIL_OTP_ACTIONS.registration
  | typeof WALLET_EMAIL_OTP_ACTIONS.recoveryBootstrap
  | typeof WALLET_EMAIL_OTP_ACTIONS.deviceLink;
export type EmailOtpChallengeOperation = WalletEmailOtpOperation;
export type EmailOtpLoginChallengeOperation = WalletEmailOtpLoginOperation;

export type EmailOtpChallengeRecord = {
  version: 'email_otp_challenge_v1';
  challengeId: string;
  /**
   * Subject that owns the OTP challenge.
   * For Google registration this is the OIDC provider subject. For existing-wallet
   * Email OTP flows this is the enrolled provider subject.
   */
  challengeSubjectId: string;
  /** Wallet being registered or unlocked. Registration rerolls may change this after issuance. */
  walletId: string;
  /** Tenant scope that prevents cross-org challenge reuse. */
  orgId?: string;
  otpChannel: EmailOtpChannel;
  /** Normalized email address that received the OTP code. */
  email: string;
  otpCode: string;
  /** Exact wallet, owner, operation, origin, and audience binding digest. */
  ownerProofBindingDigest: string;
  action: EmailOtpChallengeAction;
  operation: EmailOtpChallengeOperation;
  createdAtMs: number;
  expiresAtMs: number;
  attemptCount: number;
  maxAttempts: number;
};

export type EmailOtpChallengeContextInput = {
  challengeSubjectId: string;
  walletId: string;
  orgId?: string;
  otpChannel: EmailOtpChannel;
  ownerProofBindingDigest: string;
  action: EmailOtpChallengeAction;
  operation: EmailOtpChallengeOperation;
  nowMs: number;
};

export interface EmailOtpChallengeStore {
  put(record: EmailOtpChallengeRecord): Promise<void>;
  get(challengeId: string): Promise<EmailOtpChallengeRecord | null>;
  deleteExpired(nowMs: number): Promise<EmailOtpChallengeRecord[]>;
  countActiveByContext(input: EmailOtpChallengeContextInput): Promise<number>;
  findLatestActiveByContext(
    input: EmailOtpChallengeContextInput,
  ): Promise<EmailOtpChallengeRecord | null>;
  deleteOldestActiveByContext(
    input: EmailOtpChallengeContextInput,
  ): Promise<EmailOtpChallengeRecord | null>;
  findActiveByContext(
    input: EmailOtpChallengeContextInput & {
      otpCode: string;
    },
  ): Promise<EmailOtpChallengeRecord | null>;
  del(challengeId: string): Promise<void>;
}

export type EmailOtpGrantRecord = {
  version: 'email_otp_grant_v1';
  grantToken: string;
  userId: string;
  walletId: string;
  orgId?: string;
  challengeId: string;
  otpChannel: EmailOtpChannel;
  ownerProofBindingDigest: string;
  action: EmailOtpGrantAction;
  issuedAtMs: number;
  expiresAtMs: number;
};

export interface EmailOtpGrantStore {
  put(record: EmailOtpGrantRecord): Promise<void>;
  get(grantToken: string): Promise<EmailOtpGrantRecord | null>;
  consume(grantToken: string): Promise<EmailOtpGrantRecord | null>;
  del(grantToken: string): Promise<void>;
}

export type EmailOtpWalletEnrollmentRecord = {
  version: 'email_otp_wallet_enrollment_v1';
  walletId: string;
  providerUserId: string;
  orgId: string;
  verifiedEmail: string;
  enrollmentId: string;
  enrollmentVersion: string;
  enrollmentSealKeyVersion: string;
  clientUnlockPublicKeyB64u: string;
  unlockKeyVersion: string;
  serverSealedFactorCiphertextB64u: string;
  createdAtMs: number;
  updatedAtMs: number;
};

export interface EmailOtpWalletEnrollmentStore {
  get(walletId: string): Promise<EmailOtpWalletEnrollmentRecord | null>;
  getByProviderUserId(input: {
    providerUserId: string;
    orgId: string;
  }): Promise<EmailOtpWalletEnrollmentRecord | null>;
  put(record: EmailOtpWalletEnrollmentRecord): Promise<void>;
  del(walletId: string): Promise<void>;
}

export type EmailOtpAuthStateRecord = {
  version: 'email_otp_auth_state_v1';
  walletId: string;
  providerUserId: string;
  orgId: string;
  createdAtMs: number;
  updatedAtMs: number;
  otpFailureCount?: number;
  lastOtpFailureAtMs?: number;
  otpLockedUntilMs?: number;
  lastEmailOtpLoginAtMs?: number;
  lastStrongAuthAtMs?: number;
};

export interface EmailOtpAuthStateStore {
  get(walletId: string): Promise<EmailOtpAuthStateRecord | null>;
  put(record: EmailOtpAuthStateRecord): Promise<void>;
  del(walletId: string): Promise<void>;
}

export type EmailOtpUnlockChallengeRecord = {
  version: 'email_otp_unlock_challenge_v1';
  challengeId: string;
  walletId: string;
  userId: string;
  orgId?: string;
  challengeB64u: string;
  createdAtMs: number;
  expiresAtMs: number;
};

export interface EmailOtpUnlockChallengeStore {
  put(record: EmailOtpUnlockChallengeRecord): Promise<void>;
  consume(challengeId: string): Promise<EmailOtpUnlockChallengeRecord | null>;
  del(challengeId: string): Promise<void>;
}

export type GoogleEmailOtpRegistrationOfferCandidateRecord = {
  candidateId: string;
  walletId: string;
  collisionCounter: number;
};

export type NonEmptyGoogleEmailOtpRegistrationOfferCandidates = readonly [
  GoogleEmailOtpRegistrationOfferCandidateRecord,
  ...GoogleEmailOtpRegistrationOfferCandidateRecord[],
];

type GoogleEmailOtpRegistrationOfferBinding = {
  offerId: string;
  offerCandidates: NonEmptyGoogleEmailOtpRegistrationOfferCandidates;
  selectedCandidateId: string;
};

type GoogleEmailOtpRegistrationAttemptBaseRecord = {
  version: 'google_email_otp_registration_attempt_v1';
  attemptId: string;
  providerSubject: string;
  email: string;
  walletId: string;
  ownerProofBindingDigest: string;
  authProvider: string;
  accountIdSlugVersion: 'hmac_readable_v1';
  walletIdDerivationNonce: string;
  collisionCounter: number;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
  runtimePolicyScope?: ThresholdRuntimePolicyScope;
};

type StartedGoogleEmailOtpRegistrationAttemptRecord = GoogleEmailOtpRegistrationAttemptBaseRecord &
  GoogleEmailOtpRegistrationOfferBinding & {
    state: 'started';
    finalizedPublicKey?: never;
    failureCode?: never;
  };

type KeyFinalizedGoogleEmailOtpRegistrationAttemptRecord =
  GoogleEmailOtpRegistrationAttemptBaseRecord &
    GoogleEmailOtpRegistrationOfferBinding & {
      state: 'key_finalized';
      finalizedPublicKey: string;
      failureCode?: never;
    };

type ActiveGoogleEmailOtpRegistrationAttemptRecord = GoogleEmailOtpRegistrationAttemptBaseRecord &
  GoogleEmailOtpRegistrationOfferBinding & {
    state: 'active';
    finalizedPublicKey?: string;
    failureCode?: never;
  };

type AbandonedGoogleEmailOtpRegistrationAttemptRecord =
  GoogleEmailOtpRegistrationAttemptBaseRecord &
    GoogleEmailOtpRegistrationOfferBinding & {
      state: 'abandoned';
      finalizedPublicKey?: string;
      failureCode: string;
    };

type FailedGoogleEmailOtpRegistrationAttemptRecord = GoogleEmailOtpRegistrationAttemptBaseRecord &
  GoogleEmailOtpRegistrationOfferBinding & {
    state: 'failed';
    finalizedPublicKey?: string;
    failureCode: string;
  };

type ExpiredGoogleEmailOtpRegistrationAttemptRecord = GoogleEmailOtpRegistrationAttemptBaseRecord &
  GoogleEmailOtpRegistrationOfferBinding & {
    state: 'expired';
    finalizedPublicKey?: string;
    failureCode?: string;
  };

export type GoogleEmailOtpRegistrationAttemptRecord =
  | StartedGoogleEmailOtpRegistrationAttemptRecord
  | KeyFinalizedGoogleEmailOtpRegistrationAttemptRecord
  | ActiveGoogleEmailOtpRegistrationAttemptRecord
  | AbandonedGoogleEmailOtpRegistrationAttemptRecord
  | FailedGoogleEmailOtpRegistrationAttemptRecord
  | ExpiredGoogleEmailOtpRegistrationAttemptRecord;

export type PendingGoogleEmailOtpRegistrationAttemptRecord =
  | StartedGoogleEmailOtpRegistrationAttemptRecord
  | KeyFinalizedGoogleEmailOtpRegistrationAttemptRecord;

/** A registration's subject, email, owner binding and runtime scope, as of `nowMs`. */
export type GoogleEmailOtpRegistrationAttemptScopeInput = {
  providerSubject: string;
  email: string;
  orgId: string;
  ownerProofBindingDigest: string;
  runtimePolicyScope?: ThresholdRuntimePolicyScope;
  nowMs: number;
};

export interface EmailOtpRegistrationAttemptStore {
  put(record: GoogleEmailOtpRegistrationAttemptRecord): Promise<void>;
  get(attemptId: string): Promise<GoogleEmailOtpRegistrationAttemptRecord | null>;
  findStartedBySubjectEmail(
    input: GoogleEmailOtpRegistrationAttemptScopeInput,
  ): Promise<PendingGoogleEmailOtpRegistrationAttemptRecord | null>;
  abandonStartedBySubjectEmailExceptBinding(input: {
    providerSubject: string;
    email: string;
    orgId: string;
    ownerProofBindingDigest: string;
    runtimePolicyScope?: ThresholdRuntimePolicyScope;
    nowMs: number;
    failureCode: 'owner_proof_binding_replaced';
  }): Promise<number>;
  hasLiveStartedWalletAttempt(input: { walletId: string; nowMs: number }): Promise<boolean>;
  deleteExpired(nowMs: number): Promise<number>;
}

type EmailOtpStoreFactoryInput = {
  config?: ThresholdStoreConfigInput | null;
  logger?: NormalizedLogger;
  isNode?: boolean;
};

/** Names the Email OTP stores in D1 scope errors. */
const EMAIL_OTP_D1_STORE = 'Email OTP store';

type D1EmailOtpRecordRow = {
  readonly record_json?: unknown;
  readonly expires_at_ms?: unknown;
  readonly updated_at_ms?: unknown;
  readonly challenge_id?: unknown;
  readonly wallet_id?: unknown;
  readonly attempt_id?: unknown;
};

const EMAIL_OTP_STORE_D1_SCHEMA_SQL = Object.freeze([
  `
    CREATE TABLE IF NOT EXISTS email_otp_challenges (
      namespace TEXT NOT NULL,
      org_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      env_id TEXT NOT NULL,
      challenge_id TEXT NOT NULL,
      challenge_subject_id TEXT NOT NULL,
      wallet_id TEXT NOT NULL,
      record_org_id TEXT NOT NULL,
      otp_channel TEXT NOT NULL,
      owner_proof_binding_digest TEXT NOT NULL,
      action TEXT NOT NULL,
      operation TEXT NOT NULL,
      otp_code TEXT NOT NULL,
      record_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      PRIMARY KEY (namespace, org_id, project_id, env_id, challenge_id),
      CHECK (length(challenge_id) > 0),
      CHECK (length(challenge_subject_id) > 0),
      CHECK (length(wallet_id) > 0),
      CHECK (otp_channel = 'email_otp'),
      CHECK (length(owner_proof_binding_digest) > 0),
      CHECK (length(action) > 0),
      CHECK (length(operation) > 0),
      CHECK (length(otp_code) > 0),
      CHECK (json_valid(record_json)),
      CHECK (created_at_ms > 0),
      CHECK (expires_at_ms > created_at_ms)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS email_otp_challenges_context_idx
      ON email_otp_challenges (
        namespace,
        org_id,
        project_id,
        env_id,
        challenge_subject_id,
        wallet_id,
        record_org_id,
        otp_channel,
        owner_proof_binding_digest,
        action,
        operation,
        expires_at_ms
      )
  `,
  `
    CREATE INDEX IF NOT EXISTS email_otp_challenges_expires_idx
      ON email_otp_challenges (
        namespace,
        org_id,
        project_id,
        env_id,
        expires_at_ms
      )
  `,
  `
    CREATE TABLE IF NOT EXISTS email_otp_grants (
      namespace TEXT NOT NULL,
      org_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      env_id TEXT NOT NULL,
      grant_token TEXT NOT NULL,
      user_id TEXT NOT NULL,
      wallet_id TEXT NOT NULL,
      record_org_id TEXT NOT NULL,
      challenge_id TEXT NOT NULL,
      action TEXT NOT NULL,
      record_json TEXT NOT NULL,
      issued_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      PRIMARY KEY (namespace, org_id, project_id, env_id, grant_token),
      CHECK (length(grant_token) > 0),
      CHECK (length(user_id) > 0),
      CHECK (length(wallet_id) > 0),
      CHECK (length(challenge_id) > 0),
      CHECK (length(action) > 0),
      CHECK (json_valid(record_json)),
      CHECK (issued_at_ms > 0),
      CHECK (expires_at_ms > issued_at_ms)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS email_otp_grants_expires_idx
      ON email_otp_grants (
        namespace,
        org_id,
        project_id,
        env_id,
        expires_at_ms
      )
  `,
  `
    CREATE TABLE IF NOT EXISTS email_otp_wallet_enrollments (
      namespace TEXT NOT NULL,
      org_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      env_id TEXT NOT NULL,
      wallet_id TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      record_org_id TEXT NOT NULL,
      verified_email TEXT NOT NULL,
      record_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id),
      CHECK (length(wallet_id) > 0),
      CHECK (length(provider_user_id) > 0),
      CHECK (length(record_org_id) > 0),
      CHECK (length(verified_email) > 0),
      CHECK (json_valid(record_json)),
      CHECK (created_at_ms > 0),
      CHECK (updated_at_ms > 0)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS email_otp_wallet_enrollments_provider_idx
      ON email_otp_wallet_enrollments (
        namespace,
        org_id,
        project_id,
        env_id,
        record_org_id,
        provider_user_id,
        updated_at_ms
      )
  `,
  `
    CREATE TABLE IF NOT EXISTS email_otp_auth_states (
      namespace TEXT NOT NULL,
      org_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      env_id TEXT NOT NULL,
      wallet_id TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      record_org_id TEXT NOT NULL,
      record_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id),
      CHECK (length(wallet_id) > 0),
      CHECK (length(provider_user_id) > 0),
      CHECK (length(record_org_id) > 0),
      CHECK (json_valid(record_json)),
      CHECK (created_at_ms > 0),
      CHECK (updated_at_ms > 0)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS email_otp_unlock_challenges (
      namespace TEXT NOT NULL,
      org_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      env_id TEXT NOT NULL,
      challenge_id TEXT NOT NULL,
      wallet_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      record_org_id TEXT NOT NULL,
      record_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      PRIMARY KEY (namespace, org_id, project_id, env_id, challenge_id),
      CHECK (length(challenge_id) > 0),
      CHECK (length(wallet_id) > 0),
      CHECK (length(user_id) > 0),
      CHECK (json_valid(record_json)),
      CHECK (created_at_ms > 0),
      CHECK (expires_at_ms > created_at_ms)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS email_otp_unlock_challenges_expires_idx
      ON email_otp_unlock_challenges (
        namespace,
        org_id,
        project_id,
        env_id,
        expires_at_ms
      )
  `,
  `
    CREATE TABLE IF NOT EXISTS email_otp_registration_attempts (
      namespace TEXT NOT NULL,
      org_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      env_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      provider_subject TEXT NOT NULL,
      email TEXT NOT NULL,
      wallet_id TEXT NOT NULL,
      state TEXT NOT NULL,
      owner_proof_binding_digest TEXT NOT NULL,
      runtime_org_id TEXT NOT NULL,
      runtime_policy_key TEXT NOT NULL,
      offer_wallet_ids_json TEXT NOT NULL,
      record_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      PRIMARY KEY (namespace, org_id, project_id, env_id, attempt_id),
      CHECK (length(attempt_id) > 0),
      CHECK (length(provider_subject) > 0),
      CHECK (length(email) > 0),
      CHECK (length(wallet_id) > 0),
      CHECK (state IN ('started', 'key_finalized', 'active', 'abandoned', 'failed', 'expired')),
      CHECK (length(owner_proof_binding_digest) > 0),
      CHECK (json_valid(offer_wallet_ids_json)),
      CHECK (json_valid(record_json)),
      CHECK (created_at_ms > 0),
      CHECK (updated_at_ms > 0),
      CHECK (expires_at_ms > 0)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS email_otp_registration_attempts_subject_idx
      ON email_otp_registration_attempts (
        namespace,
        org_id,
        project_id,
        env_id,
        provider_subject,
        email,
        state,
        expires_at_ms,
        owner_proof_binding_digest,
        runtime_org_id,
        runtime_policy_key,
        updated_at_ms
      )
  `,
  `
    CREATE INDEX IF NOT EXISTS email_otp_registration_attempts_wallet_idx
      ON email_otp_registration_attempts (
        namespace,
        org_id,
        project_id,
        env_id,
        wallet_id,
        state,
        expires_at_ms
      )
  `,
] as const);

/**
 * Selects a store's backend: D1 when the config's `kind` is `d1`, else in memory; any other
 * `kind` is an error. `label` names the store in log lines and errors; the unknown-kind error
 * uses `kindLabel`, which the wallet enrollment store shortens to `enrollment`. The store type
 * `S` comes from the caller's return type.
 */
function createEmailOtpStore<S>(
  input: EmailOtpStoreFactoryInput | undefined,
  label: string,
  build: {
    readonly d1: (database: D1DatabaseLike, scope: D1TenantScope) => NoInfer<S>;
    readonly inMemory: () => NoInfer<S>;
  },
  kindLabel = label,
): S {
  const config = (isPlainObject(input?.config) ? input.config : {}) as Record<string, unknown>;
  const kind = toOptionalTrimmedString(config.kind);
  if (kind === 'd1') {
    const database = resolveD1DatabaseFromConfig(config);
    if (!database) {
      throw new Error(`[email-otp] D1 ${label} store selected but no D1 database was provided`);
    }
    const namespace = resolveStorePrefix(
      config,
      ['EMAIL_OTP_PREFIX', 'EMAIL_OTP_STORE_PREFIX'],
      'email-otp:',
    );
    const scope = d1TenantScopeFromConfig(config, namespace, EMAIL_OTP_D1_STORE);
    input?.logger?.info(`[email-otp] Using D1 ${label} store`);
    return build.d1(database, scope);
  }
  if (kind && kind !== 'in-memory') {
    throw new Error(`[email-otp] Unknown ${kindLabel} store kind: ${kind}`);
  }
  input?.logger?.info(`[email-otp] Using in-memory ${label} store (non-persistent)`);
  return build.inMemory();
}

/** What sets one Email OTP record apart, in either backend. */
type EmailOtpRecordSpec<R> = {
  /** Names the record in errors, e.g. `Email OTP grant`. */
  readonly label: string;
  /** Validates a record being written; null when it is invalid. */
  readonly parse: (raw: unknown) => R | null;
  /** The id that keys the record in memory. */
  readonly id: (record: R) => string;
  /** The org the record names, which must match a D1 store's org when set. */
  readonly orgId: (record: R) => string | undefined;
};

const CHALLENGE_RECORD: EmailOtpRecordSpec<EmailOtpChallengeRecord> = {
  label: 'Email OTP challenge',
  parse: parseCurrentEmailOtpChallengeRecord,
  id: (record) => record.challengeId,
  orgId: (record) => record.orgId,
};

const GRANT_RECORD: EmailOtpRecordSpec<EmailOtpGrantRecord> = {
  label: 'Email OTP grant',
  parse: parseCurrentEmailOtpGrantRecord,
  id: (record) => record.grantToken,
  orgId: (record) => record.orgId,
};

const WALLET_ENROLLMENT_RECORD: EmailOtpRecordSpec<EmailOtpWalletEnrollmentRecord> = {
  label: 'Email OTP wallet enrollment',
  parse: parseCurrentEmailOtpWalletEnrollmentRecord,
  id: (record) => record.walletId,
  orgId: (record) => record.orgId,
};

const AUTH_STATE_RECORD: EmailOtpRecordSpec<EmailOtpAuthStateRecord> = {
  label: 'Email OTP auth state',
  parse: parseCurrentEmailOtpAuthStateRecord,
  id: (record) => record.walletId,
  orgId: (record) => record.orgId,
};

const UNLOCK_CHALLENGE_RECORD: EmailOtpRecordSpec<EmailOtpUnlockChallengeRecord> = {
  label: 'Email OTP unlock challenge',
  parse: parseCurrentEmailOtpUnlockChallengeRecord,
  id: (record) => record.challengeId,
  orgId: (record) => record.orgId,
};

const REGISTRATION_ATTEMPT_RECORD: EmailOtpRecordSpec<GoogleEmailOtpRegistrationAttemptRecord> = {
  label: 'Google Email OTP registration attempt',
  parse: parseCurrentGoogleEmailOtpRegistrationAttemptRecord,
  id: (record) => record.attemptId,
  orgId: (record) => record.runtimePolicyScope?.orgId,
};

function parseEmailOtpRecord<R>(spec: EmailOtpRecordSpec<R>, record: R): R {
  const parsed = spec.parse(record);
  if (!parsed) throw new Error(`Invalid ${spec.label} record`);
  return parsed;
}

function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function challengeContextMatches(
  record: EmailOtpChallengeRecord,
  input: EmailOtpChallengeContextInput,
): boolean {
  return (
    record.expiresAtMs > input.nowMs &&
    record.challengeSubjectId === input.challengeSubjectId &&
    record.walletId === input.walletId &&
    String(record.orgId || '') === String(input.orgId || '') &&
    record.otpChannel === input.otpChannel &&
    record.ownerProofBindingDigest === input.ownerProofBindingDigest &&
    record.action === input.action &&
    record.operation === input.operation
  );
}

/** Keeps copies of parsed records by id, so no caller shares a stored object. */
class InMemoryEmailOtpStore<R> {
  protected readonly map = new Map<string, R>();

  constructor(protected readonly spec: EmailOtpRecordSpec<R>) {}

  async put(record: R): Promise<void> {
    this.set(parseEmailOtpRecord(this.spec, record));
  }

  protected set(record: R): void {
    this.map.set(this.spec.id(record), cloneRecord(record));
  }

  async get(id: string): Promise<R | null> {
    const key = toOptionalTrimmedString(id);
    if (!key) return null;
    const record = this.map.get(key);
    return record ? cloneRecord(record) : null;
  }

  /** Reads and deletes, so a one-time record is used at most once. */
  async consume(id: string): Promise<R | null> {
    const key = toOptionalTrimmedString(id);
    if (!key) return null;
    const record = this.map.get(key);
    this.map.delete(key);
    return record ? cloneRecord(record) : null;
  }

  async del(id: string): Promise<void> {
    const key = toOptionalTrimmedString(id);
    if (!key) return;
    this.map.delete(key);
  }
}

class InMemoryEmailOtpChallengeStore
  extends InMemoryEmailOtpStore<EmailOtpChallengeRecord>
  implements EmailOtpChallengeStore
{
  constructor() {
    super(CHALLENGE_RECORD);
  }

  async deleteExpired(nowMs: number): Promise<EmailOtpChallengeRecord[]> {
    const deleted: EmailOtpChallengeRecord[] = [];
    for (const [challengeId, record] of this.map.entries()) {
      if (record.expiresAtMs > nowMs) continue;
      this.map.delete(challengeId);
      deleted.push(cloneRecord(record));
    }
    return deleted;
  }

  async countActiveByContext(input: EmailOtpChallengeContextInput): Promise<number> {
    let count = 0;
    for (const record of this.map.values()) {
      if (!challengeContextMatches(record, input)) continue;
      count += 1;
    }
    return count;
  }

  async findLatestActiveByContext(
    input: EmailOtpChallengeContextInput,
  ): Promise<EmailOtpChallengeRecord | null> {
    let latest: EmailOtpChallengeRecord | null = null;
    for (const record of this.map.values()) {
      if (!challengeContextMatches(record, input)) continue;
      if (!latest || record.expiresAtMs > latest.expiresAtMs) latest = record;
    }
    return latest ? cloneRecord(latest) : null;
  }

  async deleteOldestActiveByContext(
    input: EmailOtpChallengeContextInput,
  ): Promise<EmailOtpChallengeRecord | null> {
    let oldest: EmailOtpChallengeRecord | null = null;
    for (const record of this.map.values()) {
      if (!challengeContextMatches(record, input)) continue;
      if (!oldest || record.createdAtMs < oldest.createdAtMs) oldest = record;
    }
    if (!oldest) return null;
    this.map.delete(oldest.challengeId);
    return cloneRecord(oldest);
  }

  async findActiveByContext(
    input: EmailOtpChallengeContextInput & { otpCode: string },
  ): Promise<EmailOtpChallengeRecord | null> {
    for (const record of this.map.values()) {
      if (!challengeContextMatches(record, input)) continue;
      if (record.otpCode !== input.otpCode) continue;
      return cloneRecord(record);
    }
    return null;
  }
}

class InMemoryEmailOtpWalletEnrollmentStore
  extends InMemoryEmailOtpStore<EmailOtpWalletEnrollmentRecord>
  implements EmailOtpWalletEnrollmentStore
{
  constructor() {
    super(WALLET_ENROLLMENT_RECORD);
  }

  async getByProviderUserId(input: {
    providerUserId: string;
    orgId: string;
  }): Promise<EmailOtpWalletEnrollmentRecord | null> {
    const providerUserId = toOptionalTrimmedString(input.providerUserId);
    const orgId = toOptionalTrimmedString(input.orgId);
    if (!providerUserId || !orgId) return null;
    const record =
      Array.from(this.map.values()).find(
        (candidate) => candidate.providerUserId === providerUserId && candidate.orgId === orgId,
      ) || null;
    return record ? cloneRecord(record) : null;
  }

  async put(record: EmailOtpWalletEnrollmentRecord): Promise<void> {
    const parsed = parseEmailOtpRecord(this.spec, record);
    const duplicate = Array.from(this.map.values()).find(
      (existing) =>
        existing.walletId !== parsed.walletId &&
        existing.orgId === parsed.orgId &&
        existing.providerUserId === parsed.providerUserId,
    );
    if (duplicate) {
      throw new Error('Email OTP wallet enrollment already exists for this provider user in org');
    }
    this.set(parsed);
  }
}

class InMemoryEmailOtpRegistrationAttemptStore
  extends InMemoryEmailOtpStore<GoogleEmailOtpRegistrationAttemptRecord>
  implements EmailOtpRegistrationAttemptStore
{
  constructor() {
    super(REGISTRATION_ATTEMPT_RECORD);
  }

  async findStartedBySubjectEmail(
    input: GoogleEmailOtpRegistrationAttemptScopeInput,
  ): Promise<PendingGoogleEmailOtpRegistrationAttemptRecord | null> {
    for (const record of this.map.values()) {
      if (registrationAttemptMatchesStartedScope(record, input)) {
        return cloneRecord(record);
      }
    }
    return null;
  }

  async abandonStartedBySubjectEmailExceptBinding(
    input: GoogleEmailOtpRegistrationAttemptScopeInput & {
      failureCode: 'owner_proof_binding_replaced';
    },
  ): Promise<number> {
    let abandoned = 0;
    for (const record of this.map.values()) {
      if (!registrationAttemptMatchesReplacementScope(record, input)) continue;
      this.map.set(record.attemptId, {
        ...cloneRecord(record),
        state: 'abandoned',
        failureCode: input.failureCode,
        updatedAtMs: input.nowMs,
      });
      abandoned += 1;
    }
    return abandoned;
  }

  async hasLiveStartedWalletAttempt(input: { walletId: string; nowMs: number }): Promise<boolean> {
    for (const record of this.map.values()) {
      if (
        (record.state === 'started' || record.state === 'key_finalized') &&
        record.expiresAtMs > input.nowMs &&
        (record.walletId === input.walletId ||
          record.offerCandidates.some((candidate) => candidate.walletId === input.walletId))
      ) {
        return true;
      }
    }
    return false;
  }

  async deleteExpired(nowMs: number): Promise<number> {
    let deleted = 0;
    for (const [attemptId, record] of this.map.entries()) {
      if (record.expiresAtMs <= nowMs || record.state === 'expired') {
        this.map.delete(attemptId);
        deleted += 1;
      }
    }
    return deleted;
  }
}

// Rows are read back through the record parsers; record_json is decoded once here and again by
// the parser, so a record stored as a JSON string of JSON text still reads.
function challengeFromRow(row: D1EmailOtpRecordRow | null): EmailOtpChallengeRecord | null {
  return parseCurrentEmailOtpChallengeRow({
    recordJson: parseJsonRecord(row?.record_json),
    expiresAtMs: row?.expires_at_ms,
  });
}

function grantFromRow(row: D1EmailOtpRecordRow | null): EmailOtpGrantRecord | null {
  return parseCurrentEmailOtpGrantRow({
    recordJson: parseJsonRecord(row?.record_json),
    expiresAtMs: row?.expires_at_ms,
  });
}

function walletEnrollmentFromRow(
  row: D1EmailOtpRecordRow | null,
): EmailOtpWalletEnrollmentRecord | null {
  return parseCurrentEmailOtpWalletEnrollmentRow({
    recordJson: parseJsonRecord(row?.record_json),
    updatedAtMs: row?.updated_at_ms,
  });
}

function authStateFromRow(row: D1EmailOtpRecordRow | null): EmailOtpAuthStateRecord | null {
  return parseCurrentEmailOtpAuthStateRow({
    recordJson: parseJsonRecord(row?.record_json),
    updatedAtMs: row?.updated_at_ms,
  });
}

function unlockChallengeFromRow(
  row: D1EmailOtpRecordRow | null,
): EmailOtpUnlockChallengeRecord | null {
  return parseCurrentEmailOtpUnlockChallengeRow({
    recordJson: parseJsonRecord(row?.record_json),
    expiresAtMs: row?.expires_at_ms,
  });
}

function registrationAttemptFromRow(
  row: D1EmailOtpRecordRow | null,
): GoogleEmailOtpRegistrationAttemptRecord | null {
  return parseCurrentGoogleEmailOtpRegistrationAttemptRow({
    recordJson: parseJsonRecord(row?.record_json),
    expiresAtMs: row?.expires_at_ms,
    updatedAtMs: row?.updated_at_ms,
  });
}

type ScopedD1Statement = (prepare: ScopedD1Prepare, id: string) => D1PreparedStatementLike;

/**
 * A record's store in one D1 tenant scope. The core schema is created on first use, and a row
 * that no longer parses is deleted when it is read.
 */
abstract class D1EmailOtpStore<R> {
  readonly adapterKind = 'd1';
  protected readonly table: D1TenantTable;

  constructor(
    database: D1DatabaseLike,
    scope: D1TenantScope,
    private readonly spec: EmailOtpRecordSpec<R>,
    private readonly rows: {
      readonly fromRow: (row: D1EmailOtpRecordRow | null) => R | null;
      readonly upsert: (prepare: ScopedD1Prepare, record: R) => D1PreparedStatementLike;
    },
  ) {
    this.table = new D1TenantTable(
      { database, ...scope },
      EMAIL_OTP_D1_STORE,
      EMAIL_OTP_STORE_D1_SCHEMA_SQL,
    );
  }

  abstract del(id: string): Promise<void>;

  protected readonly prepare: ScopedD1Prepare = (sql, values) => this.table.prepare(sql, values);

  protected ensureSchema(): Promise<void> {
    return this.table.ensureSchema();
  }

  async put(record: R): Promise<void> {
    await this.ensureSchema();
    const parsed = parseEmailOtpRecord(this.spec, record);
    const recordOrgId = this.spec.orgId(parsed);
    if (recordOrgId && recordOrgId !== this.table.scope.orgId) {
      throw new Error(`${this.spec.label} orgId must match D1 Email OTP store orgId`);
    }
    await this.rows.upsert(this.prepare, parsed).run();
  }

  protected async getById(id: string, select: ScopedD1Statement): Promise<R | null> {
    await this.ensureSchema();
    const key = toOptionalTrimmedString(id);
    if (!key) return null;
    const row = await select(this.prepare, key).first<D1EmailOtpRecordRow>();
    return row ? this.recordOrDiscard(row, key) : null;
  }

  /** Reads and deletes, so a one-time record is used at most once. */
  protected async consumeById(id: string, consume: ScopedD1Statement): Promise<R | null> {
    await this.ensureSchema();
    const key = toOptionalTrimmedString(id);
    if (!key) return null;
    const row = await consume(this.prepare, key).first<D1EmailOtpRecordRow>();
    const parsed = this.rows.fromRow(row);
    return parsed ? cloneRecord(parsed) : null;
  }

  protected async deleteById(id: string, remove: ScopedD1Statement): Promise<void> {
    await this.ensureSchema();
    const key = toOptionalTrimmedString(id);
    if (!key) return;
    await remove(this.prepare, key).run();
  }

  /** The row's record; a row that does not parse is deleted by `malformedId` and reads as null. */
  protected async recordOrDiscard(
    row: D1EmailOtpRecordRow | null,
    malformedId: unknown,
  ): Promise<R | null> {
    const parsed = this.rows.fromRow(row);
    if (parsed) return cloneRecord(parsed);
    const id = toOptionalTrimmedString(malformedId);
    if (id) await this.del(id);
    return null;
  }
}

// Scopes a challenge query to one live challenge context; binds challengeContextValues.
const ACTIVE_CHALLENGE_CONTEXT_SQL = `WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND expires_at_ms > ?
          AND challenge_subject_id = ?
          AND wallet_id = ?
          AND record_org_id = ?
          AND otp_channel = ?
          AND owner_proof_binding_digest = ?
          AND action = ?
          AND operation = ?`;

function challengeContextValues(input: EmailOtpChallengeContextInput): unknown[] {
  return [
    input.nowMs,
    input.challengeSubjectId,
    input.walletId,
    String(input.orgId || ''),
    input.otpChannel,
    input.ownerProofBindingDigest,
    input.action,
    input.operation,
  ];
}

class D1EmailOtpChallengeStore
  extends D1EmailOtpStore<EmailOtpChallengeRecord>
  implements EmailOtpChallengeStore
{
  constructor(database: D1DatabaseLike, scope: D1TenantScope) {
    super(database, scope, CHALLENGE_RECORD, {
      fromRow: challengeFromRow,
      upsert: emailOtpChallengeRows.upsert,
    });
  }

  async get(challengeId: string): Promise<EmailOtpChallengeRecord | null> {
    await this.ensureSchema();
    const id = toOptionalTrimmedString(challengeId);
    if (!id) return null;
    const row = await this.prepare(
      `SELECT record_json, expires_at_ms, challenge_id
         FROM email_otp_challenges
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND challenge_id = ?
        LIMIT 1`,
      [id],
    ).first<D1EmailOtpRecordRow>();
    return row ? this.recordOrDiscard(row, id) : null;
  }

  async deleteExpired(nowMs: number): Promise<EmailOtpChallengeRecord[]> {
    await this.ensureSchema();
    const result = await this.prepare(
      `DELETE FROM email_otp_challenges
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND expires_at_ms <= ?
        RETURNING record_json, expires_at_ms`,
      [nowMs],
    ).all<D1EmailOtpRecordRow>();
    return (result.results || [])
      .map((row) => challengeFromRow(row))
      .filter((record): record is EmailOtpChallengeRecord => Boolean(record))
      .map((record) => cloneRecord(record));
  }

  async countActiveByContext(input: EmailOtpChallengeContextInput): Promise<number> {
    await this.ensureSchema();
    const row = await this.prepare(
      `SELECT COUNT(*) AS count
         FROM email_otp_challenges
        ${ACTIVE_CHALLENGE_CONTEXT_SQL}`,
      challengeContextValues(input),
    ).first<{ count?: unknown }>();
    return Number(row?.count || 0);
  }

  async findLatestActiveByContext(
    input: EmailOtpChallengeContextInput,
  ): Promise<EmailOtpChallengeRecord | null> {
    await this.ensureSchema();
    const row = await this.prepare(
      `SELECT record_json, expires_at_ms, challenge_id
         FROM email_otp_challenges
        ${ACTIVE_CHALLENGE_CONTEXT_SQL}
        ORDER BY expires_at_ms DESC, created_at_ms DESC
        LIMIT 1`,
      challengeContextValues(input),
    ).first<D1EmailOtpRecordRow>();
    return this.recordOrDiscard(row, row?.challenge_id);
  }

  async deleteOldestActiveByContext(
    input: EmailOtpChallengeContextInput,
  ): Promise<EmailOtpChallengeRecord | null> {
    await this.ensureSchema();
    const row = await this.prepare(
      `WITH oldest AS (
        SELECT challenge_id
          FROM email_otp_challenges
         WHERE namespace = ?
           AND org_id = ?
           AND project_id = ?
           AND env_id = ?
           AND expires_at_ms > ?
           AND challenge_subject_id = ?
           AND wallet_id = ?
           AND record_org_id = ?
           AND otp_channel = ?
           AND owner_proof_binding_digest = ?
           AND action = ?
           AND operation = ?
         ORDER BY created_at_ms ASC, expires_at_ms ASC
         LIMIT 1
      )
      DELETE FROM email_otp_challenges
       WHERE namespace = ?
         AND org_id = ?
         AND project_id = ?
         AND env_id = ?
         AND challenge_id IN (SELECT challenge_id FROM oldest)
      RETURNING record_json, expires_at_ms, challenge_id`,
      [
        ...challengeContextValues(input),
        this.table.scope.namespace,
        this.table.scope.orgId,
        this.table.scope.projectId,
        this.table.scope.envId,
      ],
    ).first<D1EmailOtpRecordRow>();
    return this.recordOrDiscard(row, row?.challenge_id);
  }

  async findActiveByContext(
    input: EmailOtpChallengeContextInput & { otpCode: string },
  ): Promise<EmailOtpChallengeRecord | null> {
    await this.ensureSchema();
    const row = await this.prepare(
      `SELECT record_json, expires_at_ms, challenge_id
         FROM email_otp_challenges
        ${ACTIVE_CHALLENGE_CONTEXT_SQL}
          AND otp_code = ?
        ORDER BY expires_at_ms DESC
        LIMIT 1`,
      [...challengeContextValues(input), input.otpCode],
    ).first<D1EmailOtpRecordRow>();
    return this.recordOrDiscard(row, row?.challenge_id);
  }

  del(challengeId: string): Promise<void> {
    return this.deleteById(challengeId, emailOtpChallengeRows.delete);
  }
}

class D1EmailOtpGrantStore
  extends D1EmailOtpStore<EmailOtpGrantRecord>
  implements EmailOtpGrantStore
{
  constructor(database: D1DatabaseLike, scope: D1TenantScope) {
    super(database, scope, GRANT_RECORD, {
      fromRow: grantFromRow,
      upsert: emailOtpGrantRows.upsert,
    });
  }

  get(grantToken: string): Promise<EmailOtpGrantRecord | null> {
    return this.getById(grantToken, emailOtpGrantRows.select);
  }

  consume(grantToken: string): Promise<EmailOtpGrantRecord | null> {
    return this.consumeById(grantToken, emailOtpGrantRows.consume);
  }

  del(grantToken: string): Promise<void> {
    return this.deleteById(grantToken, emailOtpGrantRows.delete);
  }
}

class D1EmailOtpWalletEnrollmentStore
  extends D1EmailOtpStore<EmailOtpWalletEnrollmentRecord>
  implements EmailOtpWalletEnrollmentStore
{
  constructor(database: D1DatabaseLike, scope: D1TenantScope) {
    super(database, scope, WALLET_ENROLLMENT_RECORD, {
      fromRow: walletEnrollmentFromRow,
      upsert: emailOtpWalletEnrollmentRows.upsert,
    });
  }

  async get(walletId: string): Promise<EmailOtpWalletEnrollmentRecord | null> {
    await this.ensureSchema();
    const key = toOptionalTrimmedString(walletId);
    if (!key) return null;
    const row = await this.prepare(
      `SELECT record_json, updated_at_ms, wallet_id
         FROM email_otp_wallet_enrollments
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND wallet_id = ?
        LIMIT 1`,
      [key],
    ).first<D1EmailOtpRecordRow>();
    return row ? this.recordOrDiscard(row, key) : null;
  }

  async getByProviderUserId(input: {
    providerUserId: string;
    orgId: string;
  }): Promise<EmailOtpWalletEnrollmentRecord | null> {
    await this.ensureSchema();
    const providerUserId = toOptionalTrimmedString(input.providerUserId);
    const orgId = toOptionalTrimmedString(input.orgId);
    if (!providerUserId || !orgId) return null;
    const row = await this.prepare(
      `SELECT record_json, updated_at_ms, wallet_id
         FROM email_otp_wallet_enrollments
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND record_org_id = ?
          AND provider_user_id = ?
        ORDER BY updated_at_ms DESC
        LIMIT 1`,
      [orgId, providerUserId],
    ).first<D1EmailOtpRecordRow>();
    return this.recordOrDiscard(row, row?.wallet_id);
  }

  del(walletId: string): Promise<void> {
    return this.deleteById(walletId, emailOtpWalletEnrollmentRows.delete);
  }
}

class D1EmailOtpAuthStateStore
  extends D1EmailOtpStore<EmailOtpAuthStateRecord>
  implements EmailOtpAuthStateStore
{
  constructor(database: D1DatabaseLike, scope: D1TenantScope) {
    super(database, scope, AUTH_STATE_RECORD, {
      fromRow: authStateFromRow,
      upsert: emailOtpAuthStateRows.upsert,
    });
  }

  get(walletId: string): Promise<EmailOtpAuthStateRecord | null> {
    return this.getById(walletId, emailOtpAuthStateRows.select);
  }

  async del(walletId: string): Promise<void> {
    await this.ensureSchema();
    const key = toOptionalTrimmedString(walletId);
    if (!key) return;
    await this.prepare(
      `DELETE FROM email_otp_auth_states
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND wallet_id = ?`,
      [key],
    ).run();
  }
}

class D1EmailOtpUnlockChallengeStore
  extends D1EmailOtpStore<EmailOtpUnlockChallengeRecord>
  implements EmailOtpUnlockChallengeStore
{
  constructor(database: D1DatabaseLike, scope: D1TenantScope) {
    super(database, scope, UNLOCK_CHALLENGE_RECORD, {
      fromRow: unlockChallengeFromRow,
      upsert: emailOtpUnlockChallengeRows.upsert,
    });
  }

  consume(challengeId: string): Promise<EmailOtpUnlockChallengeRecord | null> {
    return this.consumeById(challengeId, emailOtpUnlockChallengeRows.consume);
  }

  async del(challengeId: string): Promise<void> {
    await this.ensureSchema();
    const id = toOptionalTrimmedString(challengeId);
    if (!id) return;
    await this.prepare(
      `DELETE FROM email_otp_unlock_challenges
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND challenge_id = ?`,
      [id],
    ).run();
  }
}

class D1EmailOtpRegistrationAttemptStore
  extends D1EmailOtpStore<GoogleEmailOtpRegistrationAttemptRecord>
  implements EmailOtpRegistrationAttemptStore
{
  constructor(database: D1DatabaseLike, scope: D1TenantScope) {
    super(database, scope, REGISTRATION_ATTEMPT_RECORD, {
      fromRow: registrationAttemptFromRow,
      upsert: emailOtpRegistrationAttemptRows.upsert,
    });
  }

  get(attemptId: string): Promise<GoogleEmailOtpRegistrationAttemptRecord | null> {
    return this.getById(attemptId, emailOtpRegistrationAttemptRows.select);
  }

  async findStartedBySubjectEmail(
    input: GoogleEmailOtpRegistrationAttemptScopeInput,
  ): Promise<PendingGoogleEmailOtpRegistrationAttemptRecord | null> {
    await this.ensureSchema();
    const row = await emailOtpRegistrationAttemptRows
      .selectStarted(this.prepare, input)
      .first<D1EmailOtpRecordRow>();
    const record = await this.recordOrDiscard(row, row?.attempt_id);
    return record && registrationAttemptMatchesStartedScope(record, input) ? record : null;
  }

  async abandonStartedBySubjectEmailExceptBinding(
    input: GoogleEmailOtpRegistrationAttemptScopeInput & {
      failureCode: 'owner_proof_binding_replaced';
    },
  ): Promise<number> {
    await this.ensureSchema();
    const result = await emailOtpRegistrationAttemptRows
      .selectPending(this.prepare, input)
      .all<D1EmailOtpRecordRow>();
    let abandoned = 0;
    for (const row of result.results || []) {
      const record = await this.recordOrDiscard(row, row.attempt_id);
      if (!record || !registrationAttemptMatchesReplacementScope(record, input)) continue;
      await this.put({
        ...record,
        state: 'abandoned',
        failureCode: input.failureCode,
        updatedAtMs: input.nowMs,
      });
      abandoned += 1;
    }
    return abandoned;
  }

  async hasLiveStartedWalletAttempt(input: { walletId: string; nowMs: number }): Promise<boolean> {
    await this.ensureSchema();
    const walletId = toOptionalTrimmedString(input.walletId);
    if (!walletId) return false;
    const row = await emailOtpRegistrationAttemptRows
      .selectLiveForWallet(this.prepare, walletId, input.nowMs)
      .first<{ found?: unknown }>();
    return Boolean(row);
  }

  async deleteExpired(nowMs: number): Promise<number> {
    await this.ensureSchema();
    const result = await this.prepare(
      `DELETE FROM email_otp_registration_attempts
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND (expires_at_ms <= ? OR state = 'expired')`,
      [nowMs],
    ).run();
    return d1ChangedRows(result);
  }

  del(attemptId: string): Promise<void> {
    return this.deleteById(attemptId, emailOtpRegistrationAttemptRows.delete);
  }
}

export function createEmailOtpChallengeStore(
  input?: EmailOtpStoreFactoryInput,
): EmailOtpChallengeStore {
  return createEmailOtpStore(input, 'challenge', {
    d1: (database, scope) => new D1EmailOtpChallengeStore(database, scope),
    inMemory: () => new InMemoryEmailOtpChallengeStore(),
  });
}

export function createEmailOtpGrantStore(input?: EmailOtpStoreFactoryInput): EmailOtpGrantStore {
  return createEmailOtpStore(input, 'grant', {
    d1: (database, scope) => new D1EmailOtpGrantStore(database, scope),
    inMemory: () => new InMemoryEmailOtpStore(GRANT_RECORD),
  });
}

export function createEmailOtpWalletEnrollmentStore(
  input?: EmailOtpStoreFactoryInput,
): EmailOtpWalletEnrollmentStore {
  return createEmailOtpStore(
    input,
    'wallet enrollment',
    {
      d1: (database, scope) => new D1EmailOtpWalletEnrollmentStore(database, scope),
      inMemory: () => new InMemoryEmailOtpWalletEnrollmentStore(),
    },
    'enrollment',
  );
}

export function createEmailOtpAuthStateStore(
  input?: EmailOtpStoreFactoryInput,
): EmailOtpAuthStateStore {
  return createEmailOtpStore(input, 'auth state', {
    d1: (database, scope) => new D1EmailOtpAuthStateStore(database, scope),
    inMemory: () => new InMemoryEmailOtpStore(AUTH_STATE_RECORD),
  });
}

export function createEmailOtpUnlockChallengeStore(
  input?: EmailOtpStoreFactoryInput,
): EmailOtpUnlockChallengeStore {
  return createEmailOtpStore(input, 'unlock challenge', {
    d1: (database, scope) => new D1EmailOtpUnlockChallengeStore(database, scope),
    inMemory: () => new InMemoryEmailOtpStore(UNLOCK_CHALLENGE_RECORD),
  });
}

export function createEmailOtpRegistrationAttemptStore(
  input?: EmailOtpStoreFactoryInput,
): EmailOtpRegistrationAttemptStore {
  return createEmailOtpStore(input, 'registration attempt', {
    d1: (database, scope) => new D1EmailOtpRegistrationAttemptStore(database, scope),
    inMemory: () => new InMemoryEmailOtpRegistrationAttemptStore(),
  });
}
