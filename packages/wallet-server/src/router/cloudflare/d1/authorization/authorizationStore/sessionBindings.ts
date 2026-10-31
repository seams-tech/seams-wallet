import type { WalletSessionAuthorizationV2 } from '../../../../../authorization/domain';
import type { D1WalletStoreScope } from '../../../../../core/d1WalletStore';

export const ACTIVE_V2_AUTHORITY_METHOD_EXISTS_SQL = `
  EXISTS (
    SELECT 1
      FROM wallet_authorities AS authority
      JOIN wallet_auth_methods AS auth_method
        ON auth_method.namespace = authority.namespace
       AND auth_method.org_id = authority.org_id
       AND auth_method.project_id = authority.project_id
       AND auth_method.env_id = authority.env_id
       AND auth_method.wallet_authority_id = authority.authority_id
       AND auth_method.wallet_id = authority.wallet_id
       AND auth_method.wallet_auth_method_id = ?
       AND auth_method.status = 'active'
     WHERE authority.namespace = ?
       AND authority.org_id = ?
       AND authority.project_id = ?
       AND authority.env_id = ?
       AND authority.authority_id = ?
       AND authority.wallet_id = ?
       AND authority.lifecycle_state = 'active'
       AND authority.authority_digest_b64u = ?
       AND authority.revocation_epoch = ?
  )`;

export const ACTIVE_V2_HOSTED_PARENT_PROVENANCE_SQL = `
  EXISTS (
    SELECT 1
      FROM wallet_authorities AS authority
      JOIN wallet_auth_methods AS auth_method
        ON auth_method.namespace = authority.namespace
       AND auth_method.org_id = authority.org_id
       AND auth_method.project_id = authority.project_id
       AND auth_method.env_id = authority.env_id
       AND auth_method.wallet_authority_id = authority.authority_id
       AND auth_method.wallet_id = authority.wallet_id
       AND auth_method.wallet_auth_method_id = session.wallet_auth_method_id
       AND auth_method.status = 'active'
     WHERE authority.namespace = session.namespace
       AND authority.org_id = session.org_id
       AND authority.project_id = session.project_id
       AND authority.env_id = session.env_id
       AND authority.authority_id = session.authority_id
       AND authority.wallet_id = session.wallet_id
       AND authority.lifecycle_state = 'active'
       AND authority.authority_digest_b64u = session.authority_digest_b64u
       AND authority.revocation_epoch = session.authority_revocation_epoch
  )`;

export function activeV2AuthorityMethodBindings(
  scope: D1WalletStoreScope,
  session: WalletSessionAuthorizationV2,
): readonly unknown[] {
  return [
    String(session.walletAuthMethodId),
    scope.namespace,
    scope.orgId,
    scope.projectId,
    scope.envId,
    String(session.authorityId),
    String(session.walletId),
    String(session.authorityDigestB64u),
    session.authorityRevocationEpoch,
  ];
}
