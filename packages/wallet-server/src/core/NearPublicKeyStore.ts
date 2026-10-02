import { type WebAuthnRpId } from '@shared/utils/domainIds';

export type NearPublicKeyKind = 'threshold' | 'local' | 'backup' | 'ephemeral';

export type NearPublicKeyAuthBinding = {
  readonly kind: 'passkey';
  readonly rpId: WebAuthnRpId;
  readonly credentialIdB64u: string;
};

/** A user's NEAR public keys, in signer-slot order; binds the scope, then the user. */
export const NEAR_PUBLIC_KEYS_BY_USER_SQL = `SELECT record_json
         FROM near_public_keys
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND user_id = ?
        ORDER BY COALESCE(signer_slot, 0) ASC, created_at_ms ASC, public_key ASC`;
