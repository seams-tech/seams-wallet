import type {
  ExternalWalletAuthentication,
  ExternalAuthConfiguration,
  ExternalIdentity,
  ExternalAuthPurpose,
} from '@shared/auth/externalAuth';
import {
  parseExternalWalletAuthentication,
  parseStoredExternalIdentity,
  serializeExternalIdentity,
} from '@shared/auth/externalAuth';
import type { WalletId, WalletAuthorityId } from '@shared/utils/domainIds';
import { requireCanonicalString } from '@shared/utils/validation';
import { parseUnixMs } from '@shared/passkey-custody/primitives';
import { prepareD1TenantStatement, type D1TenantScope } from '../core/d1TenantStore';
import { d1ChangedRows, type D1Row } from '../storage/d1Sql';
import type { D1DatabaseLike, D1PreparedStatementLike, D1ResultLike } from '../storage/tenantRoute';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';
import type { ActiveWalletAuthorityV1 } from '@shared/authorization/walletAuthority';

const SCOPE = 'namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4';
const ACTIVE_HOME = `EXISTS (SELECT 1 FROM wallet_execution_generations home
  WHERE home.namespace = a.namespace AND home.org_id = a.org_id
    AND home.project_id = a.project_id AND home.env_id = a.env_id
    AND home.wallet_id = a.wallet_id AND home.state = 'active'
    AND NOT EXISTS (SELECT 1 FROM wallet_relocation_write_blocks block
      WHERE block.namespace = home.namespace AND block.org_id = home.org_id
        AND block.project_id = home.project_id AND block.env_id = home.env_id
        AND block.wallet_id = home.wallet_id AND block.source_generation = home.generation
        AND block.state != 'released'))`;
const LIVE_ASSOCIATION = `EXISTS (
  SELECT 1 FROM external_auth_associations a
  JOIN wallet_authorities w ON w.namespace = a.namespace AND w.org_id = a.org_id
    AND w.project_id = a.project_id AND w.env_id = a.env_id
    AND w.authority_id = a.authority_id AND w.wallet_id = a.wallet_id
  WHERE a.namespace = external_auth_attempts.namespace
    AND a.org_id = external_auth_attempts.org_id
    AND a.project_id = external_auth_attempts.project_id
    AND a.env_id = external_auth_attempts.env_id
    AND a.association_id = external_auth_attempts.association_id
    AND a.wallet_id = external_auth_attempts.wallet_id AND a.status = 'active'
    AND w.lifecycle_state = 'active' AND w.revocation_epoch = a.authority_epoch
    AND ${ACTIVE_HOME}
)`;
const AUTHENTICATION_COLUMNS = `attempt_id, association_id, wallet_id, session_expires_at_ms,
  (SELECT a.provider_subject FROM external_auth_associations a
   WHERE a.namespace = external_auth_attempts.namespace AND a.org_id = external_auth_attempts.org_id
     AND a.project_id = external_auth_attempts.project_id AND a.env_id = external_auth_attempts.env_id
     AND a.association_id = external_auth_attempts.association_id) AS provider_subject`;

export type ExternalAuthTrust = Exclude<ExternalAuthConfiguration, { kind: 'disabled' }>;
type ExternalAuthPreparedAttempt = Readonly<{
  purpose: ExternalAuthPurpose;
  attemptId: string;
  walletId: WalletId;
  originBinding: string;
  bindingHash: string;
  sessionTokenHash: string;
  expiresAtMs: number;
}>;

export type ExternalOwnerAttemptBinding = Readonly<{
  walletId: WalletId;
  attemptId: string;
  originBinding: string;
  bindingHash: string;
  sessionTokenHash: string;
  codeHash: string;
  trustRevision: number;
  nowMs: number;
}>;

export type ExternalOwnerAttempt = Readonly<{
  walletId: WalletId;
  attemptId: string;
  identity: ExternalIdentity;
  originBinding: string;
  trustRevision: number;
  expiresAtMs: number;
  status: 'verified' | 'consumed';
  challenge: { kind: 'unprepared' } | { kind: 'ready'; expiresAtMs: number };
}> & ReadonlyExclusiveUnion<
  { purpose: 'associate' } | { purpose: 'unlink'; associationId: string }
>;

export class ExternalAuthStore {
  constructor(
    private readonly database: D1DatabaseLike,
    readonly scope: D1TenantScope,
  ) {}

  private prepare(sql: string, values: readonly unknown[] = []): D1PreparedStatementLike {
    return prepareD1TenantStatement(this.database, this.scope, sql, values);
  }

  async consumeAuthenticationAllowance(rateKey: string, nowMs: number): Promise<boolean> {
    const result = await this.prepare(
      `INSERT INTO external_auth_rate_limits
       (namespace, org_id, project_id, env_id, rate_key, consumed_count, reset_at_ms)
       VALUES (?1, ?2, ?3, ?4, ?5, 1, ?7)
       ON CONFLICT(namespace, org_id, project_id, env_id, rate_key) DO UPDATE SET
         consumed_count = CASE WHEN reset_at_ms <= ?6 THEN 1 ELSE consumed_count + 1 END,
         reset_at_ms = CASE WHEN reset_at_ms <= ?6 THEN ?7 ELSE reset_at_ms END
       WHERE reset_at_ms <= ?6 OR consumed_count < 120`,
      [rateKey, nowMs, nowMs + 60_000],
    ).run();
    return d1ChangedRows(result) === 1;
  }

  async associate(input: {
    walletId: WalletId;
    identity: ExternalIdentity;
    authorityId: WalletAuthorityId;
    authorityEpoch: number;
  }): Promise<boolean> {
    const subject = serializeExternalIdentity(input.identity);
    const revokePriorAuthority = this.prepare(
      `UPDATE external_auth_associations SET status = 'revoked'
       WHERE ${SCOPE} AND wallet_id = ?5 AND provider_subject = ?6 AND status = 'active'
         AND (authority_id != ?7 OR authority_epoch != ?8)
         AND EXISTS (SELECT 1 FROM wallet_authorities WHERE ${SCOPE}
           AND wallet_id = ?5 AND authority_id = ?7 AND lifecycle_state = 'active'
           AND revocation_epoch = ?8)`,
      [input.walletId, subject, input.authorityId, input.authorityEpoch],
    );
    const createAssociation = this.prepare(
      `INSERT INTO external_auth_associations
        (namespace, org_id, project_id, env_id, association_id, wallet_id,
         provider_subject, authority_id, authority_epoch, status)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'active'
       WHERE EXISTS (SELECT 1 FROM wallet_authorities WHERE ${SCOPE}
         AND authority_id = ?8 AND wallet_id = ?6 AND lifecycle_state = 'active'
         AND revocation_epoch = ?9)
       ON CONFLICT(namespace, org_id, project_id, env_id, wallet_id, provider_subject)
         WHERE status = 'active' DO NOTHING`,
      [crypto.randomUUID(), input.walletId, subject, input.authorityId, input.authorityEpoch],
    );
    const [revoked, inserted] = await this.database.batch<D1ResultLike>([
      revokePriorAuthority,
      createAssociation,
    ]);
    if (!revoked?.success || !inserted?.success) throw new Error('Association update failed');
    if (d1ChangedRows(inserted) === 1) return true;
    const existing = await this.prepare(
      `SELECT association_id FROM external_auth_associations WHERE ${SCOPE}
       AND wallet_id = ?5 AND provider_subject = ?6 AND authority_id = ?7
       AND authority_epoch = ?8 AND status = 'active'
       AND EXISTS (SELECT 1 FROM wallet_authorities WHERE ${SCOPE}
         AND wallet_id = ?5 AND authority_id = ?7 AND lifecycle_state = 'active'
         AND revocation_epoch = ?8)`,
      [input.walletId, subject, input.authorityId, input.authorityEpoch],
    ).first<D1Row>();
    return existing !== null;
  }

  async revokeAssociation(input: {
    walletId: WalletId;
    associationId: string;
    owner: ActiveWalletAuthorityV1;
  }): Promise<void> {
    await this.prepare(
      `UPDATE external_auth_associations SET status = 'revoked'
       WHERE ${SCOPE} AND wallet_id = ?5 AND association_id = ?6
         AND EXISTS (SELECT 1 FROM wallet_authorities WHERE ${SCOPE}
           AND wallet_id = ?5 AND authority_id = ?7 AND revocation_epoch = ?8 AND lifecycle_state = 'active')`,
      [input.walletId, input.associationId, input.owner.authorityId, input.owner.revocationEpoch],
    ).run();
  }

  async prepareUnlink(input: {
    walletId: WalletId;
    associationId: string;
    attemptId: string;
    originBinding: string;
    bindingHash: string;
    sessionTokenHash: string;
    codeHash: string;
    expiresAtMs: number;
    trustRevision: number;
  }): Promise<boolean> {
    const result = await this.prepare(
      `INSERT INTO external_auth_attempts
       (namespace, org_id, project_id, env_id, attempt_id, wallet_id, origin, binding_hash,
        session_token_hash, expires_at_ms, status, purpose, association_id, identity_subject, code_hash, trust_revision)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'verified', 'unlink', ?11, provider_subject, ?12, ?13
       FROM external_auth_associations WHERE ${SCOPE} AND wallet_id = ?6 AND association_id = ?11`,
      [
        input.attemptId, input.walletId, input.originBinding, input.bindingHash, input.sessionTokenHash,
        input.expiresAtMs, input.associationId, input.codeHash, input.trustRevision,
      ],
    ).run();
    return d1ChangedRows(result) === 1;
  }

  async readOwnerAttempt(input: ExternalOwnerAttemptBinding): Promise<ExternalOwnerAttempt | null> {
    const row = await this.prepare(
      `SELECT purpose, status, identity_subject, association_id, expires_at_ms, owner_challenge_expires_at_ms
       FROM external_auth_attempts WHERE ${SCOPE} AND wallet_id = ?5 AND attempt_id = ?6
         AND origin = ?7 AND binding_hash = ?8 AND session_token_hash = ?9 AND code_hash = ?10
         AND trust_revision = ?11 AND expires_at_ms > ?12 AND status IN ('verified', 'consumed')
         AND purpose IN ('associate', 'unlink')`,
      [
        input.walletId, input.attemptId, input.originBinding, input.bindingHash,
        input.sessionTokenHash, input.codeHash, input.trustRevision, input.nowMs,
      ],
    ).first<D1Row>();
    if (!row) return null;
    if (row.status !== 'verified' && row.status !== 'consumed') throw new Error('Invalid owner attempt state');
    const status = row.status;
    const identity = parseStoredExternalIdentity(requireCanonicalString(row.identity_subject, 'identity_subject'));
    const expiresAtMs = parseUnixMs(row.expires_at_ms, 'attempt expiry');
    const challenge: ExternalOwnerAttempt['challenge'] = row.owner_challenge_expires_at_ms === null
      ? { kind: 'unprepared' }
      : { kind: 'ready', expiresAtMs: parseUnixMs(row.owner_challenge_expires_at_ms, 'owner challenge expiry') };
    switch (row.purpose) {
      case 'associate':
        return {
          purpose: 'associate', walletId: input.walletId, attemptId: input.attemptId, identity,
          originBinding: input.originBinding, trustRevision: input.trustRevision, expiresAtMs, status, challenge,
        };
      case 'unlink':
        return {
          purpose: 'unlink', walletId: input.walletId, attemptId: input.attemptId, identity,
          originBinding: input.originBinding, trustRevision: input.trustRevision, expiresAtMs, status, challenge,
          associationId: requireCanonicalString(row.association_id, 'association_id'),
        };
      default:
        throw new Error('Invalid owner attempt purpose');
    }
  }

  async prepareOwnerChallenge(input: ExternalOwnerAttemptBinding): Promise<ExternalOwnerAttempt | null> {
    await this.prepare(
      `UPDATE external_auth_attempts
       SET owner_challenge_expires_at_ms = COALESCE(owner_challenge_expires_at_ms, MIN(expires_at_ms, ?13))
       WHERE ${SCOPE} AND wallet_id = ?5 AND attempt_id = ?6 AND origin = ?7
         AND binding_hash = ?8 AND session_token_hash = ?9 AND code_hash = ?10
         AND trust_revision = ?11 AND expires_at_ms > ?12 AND status = 'verified'
         AND purpose IN ('associate', 'unlink')`,
      [
        input.walletId, input.attemptId, input.originBinding, input.bindingHash,
        input.sessionTokenHash, input.codeHash, input.trustRevision, input.nowMs, input.nowMs + 60_000,
      ],
    ).run();
    return this.readOwnerAttempt(input);
  }

  async consumeOwnerAttempt(input: ExternalOwnerAttemptBinding, owner: ActiveWalletAuthorityV1): Promise<boolean> {
    const result = await this.prepare(
      `UPDATE external_auth_attempts SET status = 'consumed'
       WHERE ${SCOPE} AND wallet_id = ?5 AND attempt_id = ?6 AND origin = ?7
         AND binding_hash = ?8 AND session_token_hash = ?9 AND code_hash = ?10
         AND trust_revision = ?11 AND expires_at_ms > ?12 AND owner_challenge_expires_at_ms > ?12
         AND status = 'verified' AND purpose IN ('associate', 'unlink')
         AND EXISTS (SELECT 1 FROM wallet_authorities WHERE ${SCOPE}
           AND wallet_id = ?5 AND authority_id = ?13 AND revocation_epoch = ?14 AND lifecycle_state = 'active')`,
      [
        input.walletId, input.attemptId, input.originBinding, input.bindingHash,
        input.sessionTokenHash, input.codeHash, input.trustRevision, input.nowMs,
        owner.authorityId, owner.revocationEpoch,
      ],
    ).run();
    return d1ChangedRows(result) === 1;
  }

  async prepareAttempt(input: ExternalAuthPreparedAttempt): Promise<void> {
    const nowMs = Date.now();
    await this.database.batch([
      this.database
        .prepare(
          `DELETE FROM external_auth_attempts WHERE rowid IN (
        SELECT rowid FROM external_auth_attempts
        WHERE expires_at_ms <= ? AND (session_expires_at_ms IS NULL OR session_expires_at_ms <= ?) LIMIT 100
      )`,
        )
        .bind(nowMs, nowMs),
      this.database
        .prepare(
          `DELETE FROM external_auth_rate_limits WHERE rowid IN (
        SELECT rowid FROM external_auth_rate_limits WHERE reset_at_ms <= ? LIMIT 100
      )`,
        )
        .bind(nowMs),
    ]);
    await this.prepare(
      `INSERT INTO external_auth_attempts
        (namespace, org_id, project_id, env_id, attempt_id, wallet_id, origin,
         binding_hash, session_token_hash, expires_at_ms, status, purpose)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'prepared', ?11)`,
      [
        input.attemptId,
        input.walletId,
        input.originBinding,
        input.bindingHash,
        input.sessionTokenHash,
        input.expiresAtMs,
        input.purpose,
      ],
    ).run();
  }

  async readPreparedPurpose(walletId: WalletId, attemptId: string, nowMs: number): Promise<ExternalAuthPurpose | null> {
    const row = await this.prepare(
      `SELECT purpose FROM external_auth_attempts WHERE ${SCOPE} AND wallet_id = ?5
         AND attempt_id = ?6 AND status = 'prepared' AND expires_at_ms > ?7`,
      [walletId, attemptId, nowMs],
    ).first<D1Row>();
    if (!row) return null;
    switch (row.purpose) {
      case 'authenticate':
      case 'associate':
        return row.purpose;
      default:
        return null;
    }
  }

  async verifyAttempt(input: {
    attemptId: string;
    walletId: WalletId;
    identity: ExternalIdentity;
    trust: ExternalAuthTrust;
    codeHash: string;
    nowMs: number;
    sessionExpiresAtMs: number;
    purpose: ExternalAuthPurpose;
  }): Promise<boolean> {
    const result = await this.prepare(
      `UPDATE external_auth_attempts SET status = 'verified',
         association_id = (SELECT a.association_id FROM external_auth_associations a
           JOIN wallet_authorities w ON w.namespace = a.namespace AND w.org_id = a.org_id
             AND w.project_id = a.project_id AND w.env_id = a.env_id
             AND w.authority_id = a.authority_id AND w.wallet_id = a.wallet_id
           WHERE a.namespace = ?1 AND a.org_id = ?2 AND a.project_id = ?3 AND a.env_id = ?4
             AND a.wallet_id = ?6 AND a.provider_subject = ?7 AND a.status = 'active'
             AND w.lifecycle_state = 'active' AND w.revocation_epoch = a.authority_epoch
             AND ${ACTIVE_HOME}),
         trust_revision = ?8, code_hash = ?9, session_expires_at_ms = ?11, identity_subject = ?7
       WHERE ${SCOPE} AND attempt_id = ?5 AND wallet_id = ?6
         AND status = 'prepared' AND expires_at_ms > ?10 AND purpose = ?12
         AND (purpose = 'associate' OR EXISTS (SELECT 1 FROM external_auth_associations a
           JOIN wallet_authorities w ON w.namespace = a.namespace AND w.org_id = a.org_id
             AND w.project_id = a.project_id AND w.env_id = a.env_id
             AND w.authority_id = a.authority_id AND w.wallet_id = a.wallet_id
           WHERE a.namespace = ?1 AND a.org_id = ?2 AND a.project_id = ?3 AND a.env_id = ?4
             AND a.wallet_id = ?6 AND a.provider_subject = ?7 AND a.status = 'active'
             AND w.lifecycle_state = 'active' AND w.revocation_epoch = a.authority_epoch
             AND ${ACTIVE_HOME}))`,
      [
        input.attemptId,
        input.walletId,
        serializeExternalIdentity(input.identity),
        input.trust.revision,
        input.codeHash,
        input.nowMs,
        input.sessionExpiresAtMs,
        input.purpose,
      ],
    ).run();
    return d1ChangedRows(result) === 1;
  }

  async redeem(input: {
    attemptId: string;
    walletId: WalletId;
    originBinding: string;
    bindingHash: string;
    sessionTokenHash: string;
    codeHash: string;
    nowMs: number;
    trustRevision: number;
  }): Promise<ExternalWalletAuthentication | null> {
    await this.prepare(
      `UPDATE external_auth_attempts SET status = 'consumed'
       WHERE ${SCOPE} AND attempt_id = ?5 AND wallet_id = ?6 AND origin = ?7
         AND binding_hash = ?8 AND session_token_hash = ?9 AND code_hash = ?10
         AND purpose = 'authenticate' AND status = 'verified' AND expires_at_ms > ?11 AND session_expires_at_ms > ?11
         AND trust_revision = ?12 AND ${LIVE_ASSOCIATION}`,
      [
        input.attemptId,
        input.walletId,
        input.originBinding,
        input.bindingHash,
        input.sessionTokenHash,
        input.codeHash,
        input.nowMs,
        input.trustRevision,
      ],
    ).run();
    // The same bound attempt can recover a lost response without a new credential or deadline.
    const row = await this.prepare(
      `SELECT ${AUTHENTICATION_COLUMNS}
       FROM external_auth_attempts WHERE ${SCOPE} AND attempt_id = ?5 AND wallet_id = ?6
         AND origin = ?7 AND binding_hash = ?8 AND session_token_hash = ?9 AND code_hash = ?10
         AND purpose = 'authenticate' AND status = 'consumed' AND session_expires_at_ms > ?11 AND trust_revision = ?12 AND ${LIVE_ASSOCIATION}`,
      [
        input.attemptId,
        input.walletId,
        input.originBinding,
        input.bindingHash,
        input.sessionTokenHash,
        input.codeHash,
        input.nowMs,
        input.trustRevision,
      ],
    ).first<D1Row>();
    return row ? this.authentication(row) : null;
  }

  async readSession(input: {
    tokenHash: string;
    originBinding: string;
    nowMs: number;
    trustRevision: number;
  }): Promise<ExternalWalletAuthentication | null> {
    const row = await this.prepare(
      `SELECT ${AUTHENTICATION_COLUMNS}
       FROM external_auth_attempts WHERE ${SCOPE} AND session_token_hash = ?5 AND origin = ?6
         AND purpose = 'authenticate' AND status = 'consumed' AND session_expires_at_ms > ?7
         AND trust_revision = ?8 AND ${LIVE_ASSOCIATION}`,
      [input.tokenHash, input.originBinding, input.nowMs, input.trustRevision],
    ).first<D1Row>();
    return row ? this.authentication(row) : null;
  }

  async revokeSession(tokenHash: string, originBinding: string): Promise<void> {
    await this.prepare(
      `UPDATE external_auth_attempts SET status = 'revoked'
       WHERE ${SCOPE} AND session_token_hash = ?5 AND origin = ?6`,
      [tokenHash, originBinding],
    ).run();
  }

  async devices(walletId: WalletId): Promise<readonly { id: string }[]> {
    const result = await this.prepare(
      `SELECT DISTINCT device_id FROM wallet_authorities WHERE ${SCOPE}
       AND wallet_id = ?5 AND lifecycle_state = 'active' ORDER BY device_id`,
      [walletId],
    ).all<D1Row>();
    const devices: { id: string }[] = [];
    for (const row of result.results || []) {
      devices.push({ id: requireCanonicalString(row.device_id, 'device_id') });
    }
    return devices;
  }

  private authentication(row: D1Row): ExternalWalletAuthentication {
    return parseExternalWalletAuthentication({
      kind: 'external_authenticated',
      walletId: row.wallet_id,
      sessionId: row.attempt_id,
      associationId: row.association_id,
      environmentId: this.scope.envId,
      provider: parseStoredExternalIdentity(requireCanonicalString(row.provider_subject, 'provider_subject')).provider,
      permission: 'wallet_settings_read',
      expiresAtMs: parseUnixMs(row.session_expires_at_ms, 'session expiry'),
    });
  }
}
