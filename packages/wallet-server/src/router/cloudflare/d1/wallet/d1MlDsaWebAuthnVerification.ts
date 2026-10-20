import type { CloudflareD1WebAuthnStore } from '../webauthn/d1WebAuthnStore';
import type {
  WebAuthnAuthenticatorRecord,
  WebAuthnAuthenticatorStore,
} from '../../../../core/WebAuthnAuthenticatorStore';
import { prepareD1TenantStatement, type D1TenantScope } from '../../../../core/d1TenantStore';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import { D1_BATCH_CAS_GUARD_SQL } from '../../../../storage/d1Sql';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';

type CounterState = ReadonlyExclusiveUnion<
  | { readonly kind: 'unread' }
  | { readonly kind: 'read'; readonly userId: string; readonly before: WebAuthnAuthenticatorRecord }
  | {
      readonly kind: 'verified';
      readonly userId: string;
      readonly before: WebAuthnAuthenticatorRecord;
      readonly after: WebAuthnAuthenticatorRecord;
    }
>;

/** Commit authenticator counter advancement with the operation claim, so lost replies can replay. */
export class D1MlDsaWebAuthnVerification implements WebAuthnAuthenticatorStore {
  private state: CounterState = { kind: 'unread' };
  constructor(private readonly store: Pick<CloudflareD1WebAuthnStore, 'readAuthenticator'>) {}
  async get(userId: string, credentialIdB64u: string) {
    if (this.state.kind !== 'unread') {
      if (this.state.userId !== userId || this.state.before.credentialIdB64u !== credentialIdB64u)
        throw new Error('WebAuthn verification changed its credential');
      return this.state.before;
    }
    const raw = await this.store.readAuthenticator({ userId, credentialIdB64u });
    const record: WebAuthnAuthenticatorRecord | null = raw
      ? {
          version: 'webauthn_authenticator_v1',
          credentialIdB64u: raw.credentialIdB64u,
          credentialPublicKeyB64u: raw.credentialPublicKeyB64u,
          counter: raw.counter,
          createdAtMs: raw.createdAtMs,
          updatedAtMs: raw.updatedAtMs,
          deviceInfo: raw.deviceInfo,
        }
      : null;
    if (record) this.state = { kind: 'read', userId, before: record };
    return record;
  }
  async put(userId: string, after: WebAuthnAuthenticatorRecord): Promise<void> {
    const state = this.state;
    if (
      state.kind !== 'read' ||
      state.userId !== userId ||
      state.before.credentialIdB64u !== after.credentialIdB64u ||
      state.before.credentialPublicKeyB64u !== after.credentialPublicKeyB64u ||
      after.counter < state.before.counter
    )
      throw new Error('WebAuthn verification changed its authenticator');
    this.state = { kind: 'verified', userId, before: state.before, after };
  }
  async del(): Promise<void> {
    throw new Error('Verification cannot remove authenticators');
  }
  statements(database: D1DatabaseLike, scope: D1TenantScope): readonly D1PreparedStatementLike[] {
    const state = this.state;
    if (state.kind === 'unread') throw new Error('Authenticator verification is incomplete');
    const after = state.kind === 'verified' ? state.after : state.before;
    return [
      prepareD1TenantStatement(
        database,
        scope,
        `UPDATE webauthn_authenticators
      SET counter=?8, updated_at_ms=?9 WHERE namespace=?1 AND org_id=?2 AND project_id=?3 AND env_id=?4
      AND user_id=?5 AND credential_id_b64u=?6 AND credential_public_key_b64u=?7 AND counter=?10`,
        [
          state.userId,
          state.before.credentialIdB64u,
          state.before.credentialPublicKeyB64u,
          after.counter,
          after.updatedAtMs,
          state.before.counter,
        ],
      ),
      database.prepare(D1_BATCH_CAS_GUARD_SQL),
    ];
  }
}
