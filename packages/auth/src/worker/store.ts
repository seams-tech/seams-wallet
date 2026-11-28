import type { AuthMethodKind } from '../proofs/tokens';

// The records of the Auth Worker and their SQL. The database is a D1 database; this file names
// only the part of its interface that it uses, so a test can give another one.

export interface AuthStatement {
  bind(...values: unknown[]): AuthStatement;
  first<Row = Record<string, unknown>>(): Promise<Row | null>;
  all<Row = Record<string, unknown>>(): Promise<{ results: Row[] }>;
  run(): Promise<unknown>;
}

export interface AuthDatabase {
  prepare(sql: string): AuthStatement;
  batch(statements: AuthStatement[]): Promise<unknown>;
}

/** The project environment that a request belongs to. Each row is in one scope. */
export type AuthScope = {
  readonly orgId: string;
  readonly projectId: string;
  readonly envId: string;
};

export type AuthMethodRecord = {
  readonly methodId: string;
  readonly accountId: string;
  readonly kind: AuthMethodKind;
  readonly status: 'active' | 'revoked';
  /** The passkey credential ID, the email digest (hex) or the device key ID. */
  readonly identifier: string;
  readonly publicKeyB64u: string | null;
  readonly counter: number;
  readonly rpId: string;
  readonly email: string | null;
  readonly createdAtMs: number;
};

type MethodRow = {
  method_id: string;
  account_id: string;
  kind: AuthMethodKind;
  status: 'active' | 'revoked';
  identifier: string;
  public_key_b64u: string | null;
  counter: number;
  rp_id: string;
  email: string | null;
  created_at_ms: number;
};

const METHOD_COLUMNS =
  'method_id, account_id, kind, status, identifier, public_key_b64u, counter, rp_id, email, created_at_ms';

function methodRecord(row: MethodRow): AuthMethodRecord {
  return {
    methodId: row.method_id,
    accountId: row.account_id,
    kind: row.kind,
    status: row.status,
    identifier: row.identifier,
    publicKeyB64u: row.public_key_b64u,
    counter: row.counter,
    rpId: row.rp_id,
    email: row.email,
    createdAtMs: row.created_at_ms,
  };
}

export type NewAuthMethod = Omit<AuthMethodRecord, 'status' | 'createdAtMs'>;

export type AuthChallengeRecord = {
  readonly challengeId: string;
  readonly audience: string;
  readonly challenge: string;
  readonly accountId: string | null;
  readonly binding: string;
  readonly expiresAtMs: number;
};

export type EmailCodeRecord = {
  readonly codeId: string;
  readonly email: string;
  readonly emailHashHex: string;
  readonly audience: string;
  readonly challenge: string;
  readonly purpose: string;
  /** The method that the code proves. Null for a sign-in and for a new address. */
  readonly methodId: string | null;
  readonly codeMac: string;
  readonly attempts: number;
  readonly verifiedAtMs: number | null;
  readonly expiresAtMs: number;
};

export type AuthSessionRecord = {
  readonly sessionId: string;
  readonly accountId: string;
  readonly methodId: string | null;
  readonly methodKind: AuthMethodKind | null;
  readonly email: string | null;
  readonly expiresAtMs: number;
};

const SCOPE = 'org_id = ? AND project_id = ? AND env_id = ?';

export class AuthStore {
  constructor(
    private readonly database: AuthDatabase,
    readonly scope: AuthScope,
  ) {}

  /** A statement whose first three parameters are the scope. */
  private scoped(sql: string, ...values: unknown[]): AuthStatement {
    const { orgId, projectId, envId } = this.scope;
    return this.database.prepare(sql).bind(orgId, projectId, envId, ...values);
  }

  private insertAccount(accountId: string, nowMs: number): AuthStatement {
    return this.scoped(
      `INSERT INTO auth_accounts (org_id, project_id, env_id, account_id, created_at_ms)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      accountId,
      nowMs,
    );
  }

  private insertMethod(method: NewAuthMethod, nowMs: number): AuthStatement {
    return this.scoped(
      `INSERT INTO auth_methods (org_id, project_id, env_id, method_id, account_id, kind, status,
         identifier, public_key_b64u, counter, rp_id, email, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
      method.methodId,
      method.accountId,
      method.kind,
      method.identifier,
      method.publicKeyB64u,
      method.counter,
      method.rpId,
      method.email,
      nowMs,
      nowMs,
    );
  }

  /**
   * Adds a method, and its account when the account is new. Both rows are one batch, so an
   * account never exists with no method. False: an active method has this passkey or device key.
   */
  async addMethod(method: NewAuthMethod, nowMs: number): Promise<boolean> {
    try {
      await this.database.batch([
        this.insertAccount(method.accountId, nowMs),
        this.insertMethod(method, nowMs),
      ]);
      return true;
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed')) return false;
      throw error;
    }
  }

  /**
   * Copies accounts and methods from another store, with their times and their status. A
   * record that exists stays as it is, so a copy can run again.
   */
  async importRecords(
    accounts: readonly { accountId: string; createdAtMs: number }[],
    methods: readonly (AuthMethodRecord & { revokedAtMs: number | null })[],
  ): Promise<void> {
    const statements = accounts.map((account) =>
      this.insertAccount(account.accountId, account.createdAtMs),
    );
    for (const method of methods) {
      statements.push(
        this.scoped(
          `INSERT INTO auth_methods (org_id, project_id, env_id, method_id, account_id, kind,
             status, identifier, public_key_b64u, counter, rp_id, email, created_at_ms,
             updated_at_ms, revoked_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
          method.methodId,
          method.accountId,
          method.kind,
          method.status,
          method.identifier,
          method.publicKeyB64u,
          method.counter,
          method.rpId,
          method.email,
          method.createdAtMs,
          method.revokedAtMs ?? method.createdAtMs,
          method.revokedAtMs,
        ),
      );
    }
    if (statements.length > 0) await this.database.batch(statements);
  }

  /** How many accounts and methods this scope holds, for the check after a copy. */
  async recordCounts(): Promise<{
    accounts: number;
    activeMethods: number;
    revokedMethods: number;
  }> {
    const scope = 'org_id = ?1 AND project_id = ?2 AND env_id = ?3';
    const row = await this.scoped(
      `SELECT
         (SELECT COUNT(*) FROM auth_accounts WHERE ${scope}) AS accounts,
         (SELECT COUNT(*) FROM auth_methods WHERE ${scope} AND status = 'active') AS active,
         (SELECT COUNT(*) FROM auth_methods WHERE ${scope} AND status = 'revoked') AS revoked`,
    ).first<{ accounts: number; active: number; revoked: number }>();
    return {
      accounts: row?.accounts ?? 0,
      activeMethods: row?.active ?? 0,
      revokedMethods: row?.revoked ?? 0,
    };
  }

  async methodById(methodId: string): Promise<AuthMethodRecord | null> {
    const row = await this.scoped(
      `SELECT ${METHOD_COLUMNS} FROM auth_methods WHERE ${SCOPE} AND method_id = ?`,
      methodId,
    ).first<MethodRow>();
    return row ? methodRecord(row) : null;
  }

  /** The active methods with this credential ID, email digest or device key ID. */
  async activeMethodsByIdentifier(
    kind: AuthMethodKind,
    identifier: string,
  ): Promise<AuthMethodRecord[]> {
    const rows = await this.scoped(
      `SELECT ${METHOD_COLUMNS} FROM auth_methods
       WHERE ${SCOPE} AND kind = ? AND identifier = ? AND status = 'active'
       ORDER BY created_at_ms, method_id`,
      kind,
      identifier,
    ).all<MethodRow>();
    return rows.results.map(methodRecord);
  }

  async activeMethodsOfAccount(accountId: string): Promise<AuthMethodRecord[]> {
    const rows = await this.scoped(
      `SELECT ${METHOD_COLUMNS} FROM auth_methods
       WHERE ${SCOPE} AND account_id = ? AND status = 'active'
       ORDER BY created_at_ms, method_id`,
      accountId,
    ).all<MethodRow>();
    return rows.results.map(methodRecord);
  }

  /** Stores a higher signature counter. A lower or equal value changes nothing. */
  async advanceCounter(methodId: string, counter: number, nowMs: number): Promise<void> {
    await this.scoped(
      `UPDATE auth_methods SET counter = ?4, updated_at_ms = ?5
       WHERE org_id = ?1 AND project_id = ?2 AND env_id = ?3 AND method_id = ?6 AND counter < ?4`,
      counter,
      nowMs,
      methodId,
    ).run();
  }

  /** Revokes a method and ends the login sessions that it made. */
  async revokeMethod(methodId: string, nowMs: number): Promise<void> {
    await this.database.batch([
      this.scoped(
        `UPDATE auth_methods SET status = 'revoked', revoked_at_ms = ?4, updated_at_ms = ?4
         WHERE org_id = ?1 AND project_id = ?2 AND env_id = ?3 AND method_id = ?5
           AND status = 'active'`,
        nowMs,
        methodId,
      ),
      this.scoped(
        `UPDATE auth_sessions SET revoked_at_ms = ?4
         WHERE org_id = ?1 AND project_id = ?2 AND env_id = ?3 AND method_id = ?5
           AND revoked_at_ms IS NULL`,
        nowMs,
        methodId,
      ),
    ]);
  }

  async putChallenge(challenge: AuthChallengeRecord): Promise<void> {
    await this.scoped(
      `INSERT INTO auth_challenges (org_id, project_id, env_id, challenge_id, audience, challenge,
         account_id, binding, expires_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      challenge.challengeId,
      challenge.audience,
      challenge.challenge,
      challenge.accountId,
      challenge.binding,
      challenge.expiresAtMs,
    ).run();
  }

  /** Reads a challenge and deletes it in one statement, so two requests cannot both use it. */
  async takeChallenge(challengeId: string, nowMs: number): Promise<AuthChallengeRecord | null> {
    const row = await this.scoped(
      `DELETE FROM auth_challenges WHERE ${SCOPE} AND challenge_id = ?
       RETURNING challenge_id, audience, challenge, account_id, binding, expires_at_ms`,
      challengeId,
    ).first<{
      challenge_id: string;
      audience: string;
      challenge: string;
      account_id: string | null;
      binding: string;
      expires_at_ms: number;
    }>();
    if (!row || row.expires_at_ms <= nowMs) return null;
    return {
      challengeId: row.challenge_id,
      audience: row.audience,
      challenge: row.challenge,
      accountId: row.account_id,
      binding: row.binding,
      expiresAtMs: row.expires_at_ms,
    };
  }

  async putEmailCode(
    code: Omit<EmailCodeRecord, 'attempts' | 'verifiedAtMs'>,
    sourceHash: string,
    nowMs: number,
  ): Promise<void> {
    await this.scoped(
      `INSERT INTO auth_email_codes (org_id, project_id, env_id, code_id, email, email_hash_hex,
         audience, challenge, purpose, method_id, code_mac, source_hash, created_at_ms,
         expires_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      code.codeId,
      code.email,
      code.emailHashHex,
      code.audience,
      code.challenge,
      code.purpose,
      code.methodId,
      code.codeMac,
      sourceHash,
      nowMs,
      code.expiresAtMs,
    ).run();
  }

  /** How many codes were sent since `sinceMs` to one address, and from one source. */
  async emailCodeCounts(
    emailHashHex: string,
    sourceHash: string,
    sinceMs: number,
  ): Promise<{ toEmail: number; fromSource: number }> {
    const row = await this.scoped(
      `SELECT
         COALESCE(SUM(email_hash_hex = ?4), 0) AS to_email,
         COALESCE(SUM(source_hash = ?5 AND ?5 <> ''), 0) AS from_source
       FROM auth_email_codes
       WHERE org_id = ?1 AND project_id = ?2 AND env_id = ?3 AND created_at_ms > ?6`,
      emailHashHex,
      sourceHash,
      sinceMs,
    ).first<{ to_email: number; from_source: number }>();
    return { toEmail: row?.to_email ?? 0, fromSource: row?.from_source ?? 0 };
  }

  async emailCode(codeId: string): Promise<EmailCodeRecord | null> {
    const row = await this.scoped(
      `SELECT code_id, email, email_hash_hex, audience, challenge, purpose, method_id, code_mac,
         attempts, verified_at_ms, expires_at_ms
       FROM auth_email_codes WHERE ${SCOPE} AND code_id = ?`,
      codeId,
    ).first<{
      code_id: string;
      email: string;
      email_hash_hex: string;
      audience: string;
      challenge: string;
      purpose: string;
      method_id: string | null;
      code_mac: string;
      attempts: number;
      verified_at_ms: number | null;
      expires_at_ms: number;
    }>();
    if (!row) return null;
    return {
      codeId: row.code_id,
      email: row.email,
      emailHashHex: row.email_hash_hex,
      audience: row.audience,
      challenge: row.challenge,
      purpose: row.purpose,
      methodId: row.method_id,
      codeMac: row.code_mac,
      attempts: row.attempts,
      verifiedAtMs: row.verified_at_ms,
      expiresAtMs: row.expires_at_ms,
    };
  }

  /** Counts a wrong code. The answer is the number of wrong codes after this one. */
  async countWrongEmailCode(codeId: string): Promise<number> {
    const row = await this.scoped(
      `UPDATE auth_email_codes SET attempts = attempts + 1 WHERE ${SCOPE} AND code_id = ?
       RETURNING attempts`,
      codeId,
    ).first<{ attempts: number }>();
    return row?.attempts ?? 0;
  }

  async markEmailCodeVerified(codeId: string, nowMs: number): Promise<void> {
    await this.scoped(
      `UPDATE auth_email_codes SET verified_at_ms = COALESCE(verified_at_ms, ?4)
       WHERE org_id = ?1 AND project_id = ?2 AND env_id = ?3 AND code_id = ?5`,
      nowMs,
      codeId,
    ).run();
  }

  /** True for the one request that deletes the code. A used code is gone. */
  async takeEmailCode(codeId: string): Promise<boolean> {
    const row = await this.scoped(
      `DELETE FROM auth_email_codes WHERE ${SCOPE} AND code_id = ? RETURNING code_id`,
      codeId,
    ).first();
    return row !== null;
  }

  async putSession(
    session: AuthSessionRecord & { readonly tokenHash: string },
    nowMs: number,
  ): Promise<void> {
    await this.scoped(
      `INSERT INTO auth_sessions (org_id, project_id, env_id, session_id, token_hash, account_id,
         method_id, method_kind, email, created_at_ms, expires_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      session.sessionId,
      session.tokenHash,
      session.accountId,
      session.methodId,
      session.methodKind,
      session.email,
      nowMs,
      session.expiresAtMs,
    ).run();
  }

  /** The live session of a token digest: not expired and not revoked. */
  async sessionByTokenHash(tokenHash: string, nowMs: number): Promise<AuthSessionRecord | null> {
    const row = await this.scoped(
      `SELECT session_id, account_id, method_id, method_kind, email, expires_at_ms
       FROM auth_sessions
       WHERE ${SCOPE} AND token_hash = ? AND revoked_at_ms IS NULL AND expires_at_ms > ?`,
      tokenHash,
      nowMs,
    ).first<{
      session_id: string;
      account_id: string;
      method_id: string | null;
      method_kind: AuthMethodKind | null;
      email: string | null;
      expires_at_ms: number;
    }>();
    if (!row) return null;
    return {
      sessionId: row.session_id,
      accountId: row.account_id,
      methodId: row.method_id,
      methodKind: row.method_kind,
      email: row.email,
      expiresAtMs: row.expires_at_ms,
    };
  }

  async revokeSession(sessionId: string, nowMs: number): Promise<void> {
    await this.scoped(
      `UPDATE auth_sessions SET revoked_at_ms = COALESCE(revoked_at_ms, ?4)
       WHERE org_id = ?1 AND project_id = ?2 AND env_id = ?3 AND session_id = ?5`,
      nowMs,
      sessionId,
    ).run();
  }

  /** Deletes the challenges and the email codes that have expired. */
  async deleteExpired(nowMs: number): Promise<void> {
    await this.database.batch([
      this.scoped(`DELETE FROM auth_challenges WHERE ${SCOPE} AND expires_at_ms <= ?`, nowMs),
      this.scoped(
        `DELETE FROM auth_email_codes WHERE ${SCOPE} AND expires_at_ms <= ? - 3600000`,
        nowMs,
      ),
    ]);
  }
}
