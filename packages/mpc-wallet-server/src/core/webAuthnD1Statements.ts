// The WebAuthn statements the Cloudflare D1 store runs
// (router/cloudflare/d1/webauthn/d1WebAuthnStore.ts). Each binds the tenant scope first.
import type { ScopedD1Prepare } from './emailOtpD1Statements';

/** Binds the scope, then the user and the record's seven columns. */
export const INSERT_WEBAUTHN_AUTHENTICATOR_SQL = `INSERT INTO webauthn_authenticators (
        namespace,
        org_id,
        project_id,
        env_id,
        user_id,
        credential_id_b64u,
        credential_public_key_b64u,
        counter,
        created_at_ms,
        updated_at_ms,
        device_info_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * The insert, which on a credential collision keeps the lowest creation time and the highest
 * counter and update time. Binds as the insert does.
 */
export const UPSERT_WEBAUTHN_AUTHENTICATOR_SQL = `${INSERT_WEBAUTHN_AUTHENTICATOR_SQL}
      ON CONFLICT (namespace, org_id, project_id, env_id, user_id, credential_id_b64u)
      DO UPDATE SET
        credential_public_key_b64u = EXCLUDED.credential_public_key_b64u,
        counter = MAX(webauthn_authenticators.counter, EXCLUDED.counter),
        created_at_ms = MIN(webauthn_authenticators.created_at_ms, EXCLUDED.created_at_ms),
        updated_at_ms = MAX(webauthn_authenticators.updated_at_ms, EXCLUDED.updated_at_ms),
        device_info_json = EXCLUDED.device_info_json`;

/** Statements on `webauthn_authenticators`. */
export const webAuthnAuthenticatorRows = {
  select: (prepare: ScopedD1Prepare, userId: string, credentialIdB64u: string) =>
    prepare(
      `SELECT credential_id_b64u, credential_public_key_b64u, counter, created_at_ms, updated_at_ms, device_info_json
         FROM webauthn_authenticators
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND user_id = ?
          AND credential_id_b64u = ?
        LIMIT 1`,
      [userId, credentialIdB64u],
    ),
};

/** Statements on `webauthn_credential_bindings`. */
export const webAuthnCredentialBindingRows = {
  select: (prepare: ScopedD1Prepare, rpId: string, credentialIdB64u: string) =>
    prepare(
      `SELECT record_json
         FROM webauthn_credential_bindings
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND rp_id = ?
          AND credential_id_b64u = ?
        LIMIT 1`,
      [rpId, credentialIdB64u],
    ),
};

/** Statements on `webauthn_challenges`. */
export const webAuthnChallengeRows = {
  upsert: (
    prepare: ScopedD1Prepare,
    input: {
      readonly challengeId: string;
      readonly challengeKind: string;
      readonly record: unknown;
      readonly createdAtMs: number;
      readonly expiresAtMs: number;
    },
  ) =>
    prepare(
      `INSERT INTO webauthn_challenges (
        namespace,
        org_id,
        project_id,
        env_id,
        challenge_id,
        challenge_kind,
        record_json,
        created_at_ms,
        expires_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (namespace, org_id, project_id, env_id, challenge_id)
      DO UPDATE SET
        challenge_kind = EXCLUDED.challenge_kind,
        record_json = EXCLUDED.record_json,
        created_at_ms = EXCLUDED.created_at_ms,
        expires_at_ms = EXCLUDED.expires_at_ms`,
      [
        input.challengeId,
        input.challengeKind,
        JSON.stringify(input.record),
        input.createdAtMs,
        input.expiresAtMs,
      ],
    ),

  /** Deletes the live challenge of the kind and returns its record, so it is used at most once. */
  consume: (prepare: ScopedD1Prepare, challengeId: string, challengeKind: string, nowMs: number) =>
    prepare(
      `DELETE FROM webauthn_challenges
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND challenge_id = ?
          AND challenge_kind = ?
          AND expires_at_ms > ?
        RETURNING record_json`,
      [challengeId, challengeKind, nowMs],
    ),
};
