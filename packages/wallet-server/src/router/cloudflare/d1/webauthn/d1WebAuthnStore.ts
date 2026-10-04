import type { WebAuthnSyncChallengeStore } from '../../../../core/WebAuthnSyncChallengeStore';
import {
  reservePasskeyCredential,
  type PasskeyCredentialClaims,
} from '../../../../core/passkeyCredentialClaims';
import { toOptionalTrimmedString } from '@shared/utils/validation';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import { prepareD1TenantStatement, type D1TenantScope } from '../../../../core/d1TenantStore';
import {
  prepareD1WebAuthnCredentialBindingInsertStatement,
  type WebAuthnCredentialBindingRecord,
} from '../../../../core/WebAuthnCredentialBindingStore';
import {
  parseWebAuthnAuthenticator,
  parseWebAuthnBinding,
  parseWebAuthnRecoveryRegistrationChallengeRecord,
  parseWebAuthnLoginChallengeRecord,
  parseWebAuthnSyncChallengeRecord,
  type D1AuthenticatorRow,
  type D1RecordJsonRow,
  type WebAuthnAuthenticatorRecord,
  type WebAuthnRecoveryRegistrationChallengeRecord,
  type WebAuthnLoginChallengeRecord,
  type WebAuthnSyncChallengeRecord,
} from './d1WebAuthnRecords';
import {
  INSERT_WEBAUTHN_AUTHENTICATOR_SQL,
  UPSERT_WEBAUTHN_AUTHENTICATOR_SQL,
  webAuthnAuthenticatorRows,
  webAuthnChallengeRows,
  webAuthnCredentialBindingRows,
} from '../../../../core/webAuthnD1Statements';
import type { ScopedD1Prepare } from '../../../../core/emailOtpD1Statements';

type WebAuthnChallengeKind = 'login' | 'sync' | 'recovery_registration';

type WebAuthnChallengeWrite = {
  readonly challengeId: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
} & (
  | { readonly challengeKind: 'login'; readonly record: WebAuthnLoginChallengeRecord }
  | { readonly challengeKind: 'sync'; readonly record: WebAuthnSyncChallengeRecord }
  | {
      readonly challengeKind: 'recovery_registration';
      readonly record: WebAuthnRecoveryRegistrationChallengeRecord;
    }
);

export type D1WebAuthnStoreScope = D1TenantScope;

type AuthenticatorStatementInput = {
  readonly database: D1DatabaseLike;
  readonly scope: D1WebAuthnStoreScope;
  readonly userId: string;
  readonly record: WebAuthnAuthenticatorRecord;
};

function prepareAuthenticatorStatement(
  sql: string,
  input: AuthenticatorStatementInput,
): D1PreparedStatementLike {
  return input.database
    .prepare(sql)
    .bind(
      input.scope.namespace,
      input.scope.orgId,
      input.scope.projectId,
      input.scope.envId,
      input.userId,
      input.record.credentialIdB64u,
      input.record.credentialPublicKeyB64u,
      input.record.counter,
      input.record.createdAtMs,
      input.record.updatedAtMs,
      JSON.stringify(input.record.deviceInfo),
    );
}

export function prepareD1WebAuthnAuthenticatorPutStatement(
  input: AuthenticatorStatementInput,
): D1PreparedStatementLike {
  return prepareAuthenticatorStatement(UPSERT_WEBAUTHN_AUTHENTICATOR_SQL, input);
}

/** Insert-only variant used by recovery promotion. A credential collision must
 * abort the surrounding envelope/code transaction instead of reassigning an
 * existing authenticator's public key. */
export function prepareD1WebAuthnAuthenticatorInsertStatement(
  input: AuthenticatorStatementInput,
): D1PreparedStatementLike {
  return prepareAuthenticatorStatement(INSERT_WEBAUTHN_AUTHENTICATOR_SQL, input);
}

export class CloudflareD1WebAuthnStore {
  private readonly syncChallenges: WebAuthnSyncChallengeStore | undefined;
  private readonly database: D1DatabaseLike;
  private readonly scope: D1TenantScope;
  private readonly credentialClaims: PasskeyCredentialClaims | undefined;

  constructor(input: {
    readonly syncChallenges?: WebAuthnSyncChallengeStore;
    readonly credentialClaims?: PasskeyCredentialClaims;
    readonly database: D1DatabaseLike;
    readonly namespace: string;
    readonly orgId: string;
    readonly projectId: string;
    readonly envId: string;
  }) {
    this.credentialClaims = input.credentialClaims;
    this.syncChallenges = input.syncChallenges;
    this.database = input.database;
    this.scope = {
      namespace: input.namespace,
      orgId: input.orgId,
      projectId: input.projectId,
      envId: input.envId,
    };
  }

  async writeChallenge(
    input: WebAuthnChallengeWrite,
  ): ReturnType<WebAuthnSyncChallengeStore['create']> {
    if (input.challengeKind === 'sync' && this.syncChallenges) {
      return this.syncChallenges.create(input.record);
    }
    await webAuthnChallengeRows.upsert(this.prepare, input).run();
    return { ok: true };
  }

  async consumeLoginChallenge(challengeId: string): Promise<WebAuthnLoginChallengeRecord | null> {
    const row = await this.consumeChallenge({
      challengeId,
      challengeKind: 'login',
    });
    return parseWebAuthnLoginChallengeRecord(row?.record_json);
  }

  async consumeSyncChallenge(
    challengeId: string,
    credentialIdB64u: string,
  ): ReturnType<WebAuthnSyncChallengeStore['consume']> {
    if (this.syncChallenges) return this.syncChallenges.consume({ challengeId, credentialIdB64u });
    const row = await this.consumeChallenge({
      challengeId,
      challengeKind: 'sync',
    });
    return { ok: true, record: parseWebAuthnSyncChallengeRecord(row?.record_json) };
  }

  async readRecoveryRegistrationChallenge(
    challengeId: string,
    nowMs: number,
  ): Promise<WebAuthnRecoveryRegistrationChallengeRecord | null> {
    const row = await this.prepare(
      `SELECT record_json
         FROM webauthn_challenges
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND challenge_id = ?
          AND challenge_kind = 'recovery_registration'
          AND expires_at_ms > ?
        LIMIT 1`,
      [challengeId, nowMs],
    ).first<D1RecordJsonRow>();
    return parseWebAuthnRecoveryRegistrationChallengeRecord(row?.record_json);
  }

  /** Delete is paired with a CAS guard in the recovery commit batch. */
  prepareRecoveryRegistrationChallengeDeleteStatement(input: {
    readonly challengeId: string;
    readonly record: WebAuthnRecoveryRegistrationChallengeRecord;
    readonly nowMs: number;
  }): D1PreparedStatementLike {
    return this.prepare(
      `DELETE FROM webauthn_challenges
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND challenge_id = ?
          AND challenge_kind = 'recovery_registration'
          AND record_json = ?
          AND expires_at_ms > ?`,
      [input.challengeId, JSON.stringify(input.record), input.nowMs],
    );
  }

  async readAuthenticator(input: {
    readonly userId: string;
    readonly credentialIdB64u: string;
  }): Promise<WebAuthnAuthenticatorRecord | null> {
    const row = await webAuthnAuthenticatorRows
      .select(this.prepare, input.userId, input.credentialIdB64u)
      .first<D1AuthenticatorRow>();
    return parseWebAuthnAuthenticator(row);
  }

  async writeAuthenticator(input: {
    readonly userId: string;
    readonly record: WebAuthnAuthenticatorRecord;
  }): Promise<void> {
    await prepareD1WebAuthnAuthenticatorPutStatement({
      database: this.database,
      scope: this.scope,
      userId: input.userId,
      record: input.record,
    }).run();
  }

  prepareAuthenticatorInsertStatement(input: {
    readonly userId: string;
    readonly record: WebAuthnAuthenticatorRecord;
  }): D1PreparedStatementLike {
    return prepareD1WebAuthnAuthenticatorInsertStatement({
      database: this.database,
      scope: this.scope,
      userId: input.userId,
      record: input.record,
    });
  }

  async prepareCredentialBindingInsertStatement(
    record: WebAuthnCredentialBindingRecord,
  ): Promise<D1PreparedStatementLike> {
    await reservePasskeyCredential(this.credentialClaims, {
      walletId: record.userId,
      rpId: record.rpId,
      credentialIdB64u: record.credentialIdB64u,
    });
    return prepareD1WebAuthnCredentialBindingInsertStatement({
      database: this.database,
      scope: this.scope,
      record,
    });
  }

  async updateAuthenticatorCounter(input: {
    readonly userId: string;
    readonly credentialIdB64u: string;
    readonly newCounter: number;
    readonly updatedAtMs: number;
  }): Promise<void> {
    await this.database
      .prepare(
        `UPDATE webauthn_authenticators
          SET counter = ?,
              updated_at_ms = ?
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND user_id = ?
          AND credential_id_b64u = ?
          AND counter < ?`,
      )
      .bind(
        input.newCounter,
        input.updatedAtMs,
        this.scope.namespace,
        this.scope.orgId,
        this.scope.projectId,
        this.scope.envId,
        input.userId,
        input.credentialIdB64u,
        input.newCounter,
      )
      .run();
  }

  async readBindingByCredential(input: {
    readonly rpId: string;
    readonly credentialIdB64u: string;
  }): Promise<WebAuthnCredentialBindingRecord | null> {
    const row = await webAuthnCredentialBindingRows
      .select(this.prepare, input.rpId, input.credentialIdB64u)
      .first<D1RecordJsonRow>();
    return parseWebAuthnBinding(row || {});
  }

  /** Resolves a credential without trusting a caller-supplied relying party. */
  async readBindingByCredentialId(
    credentialIdB64u: string,
  ): Promise<WebAuthnCredentialBindingRecord | null> {
    const row = await this.prepare(
      `SELECT record_json
         FROM webauthn_credential_bindings
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND credential_id_b64u = ?
        LIMIT 1`,
      [credentialIdB64u],
    ).first<D1RecordJsonRow>();
    return parseWebAuthnBinding(row || {});
  }

  async readAuthenticatorRows(userId: string): Promise<D1AuthenticatorRow[]> {
    const result = await this.prepare(
      `SELECT credential_id_b64u, created_at_ms, updated_at_ms, device_info_json
         FROM webauthn_authenticators
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND user_id = ?
        ORDER BY created_at_ms ASC`,
      [userId],
    ).all<D1AuthenticatorRow>();
    return [...(result.results || [])];
  }

  async readBindingRows(input: {
    readonly userId: string;
    readonly rpId?: string;
  }): Promise<WebAuthnCredentialBindingRecord[]> {
    const rpId = toOptionalTrimmedString(input.rpId);
    const sql = rpId
      ? `SELECT record_json
           FROM webauthn_credential_bindings
          WHERE namespace = ?
            AND org_id = ?
            AND project_id = ?
            AND env_id = ?
            AND user_id = ?
            AND rp_id = ?
          ORDER BY signer_slot ASC`
      : `SELECT record_json
           FROM webauthn_credential_bindings
          WHERE namespace = ?
            AND org_id = ?
            AND project_id = ?
            AND env_id = ?
            AND user_id = ?
          ORDER BY signer_slot ASC`;
    const values = rpId ? [input.userId, rpId] : [input.userId];
    const result = await this.prepare(sql, values).all<D1RecordJsonRow>();
    const bindings: WebAuthnCredentialBindingRecord[] = [];
    for (const row of result.results || []) {
      const binding = parseWebAuthnBinding(row);
      if (binding) bindings.push(binding);
    }
    return bindings;
  }

  private async consumeChallenge(input: {
    readonly challengeId: string;
    readonly challengeKind: WebAuthnChallengeKind;
  }): Promise<D1RecordJsonRow | null> {
    return await webAuthnChallengeRows
      .consume(this.prepare, input.challengeId, input.challengeKind, Date.now())
      .first<D1RecordJsonRow>();
  }

  private readonly prepare: ScopedD1Prepare = (sql, values) =>
    prepareD1TenantStatement(this.database, this.scope, sql, values);
}
