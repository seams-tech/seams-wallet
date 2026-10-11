import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  buildDelegatedWalletAuthorityV1,
  buildFullOwnerPermissionsV1,
  sameDelegatedWalletAuthorityV1,
} from '@shared/authorization/delegatedAuthority';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import type { D1TenantScope } from '../../../../core/d1TenantStore';
import { D1WalletAuthMethodStore } from '../../../../core/d1WalletAuthMethodStore';
import { D1WalletAuthorityStore } from './d1WalletAuthorityStore';
import type { WalletRelocationChallengeBinding } from './d1WalletRelocationChallenges';

export type WalletRelocationFactorVerification =
  | {
      readonly kind: 'verified';
      readonly authorityDigestB64u: DigestB64u;
      readonly authorityRevocationEpoch: number;
      readonly commitPrerequisites: readonly D1PreparedStatementLike[];
    }
  | {
      readonly kind: 'denied';
      readonly authorityDigestB64u?: never;
      readonly authorityRevocationEpoch?: never;
      readonly commitPrerequisites?: never;
    };

export async function readWalletRelocationOwner(
  database: D1DatabaseLike,
  scope: D1TenantScope,
  binding: WalletRelocationChallengeBinding,
) {
  const methods = new D1WalletAuthMethodStore({ database, ...scope, ensureSchema: false });
  const method = await methods.readByIdV2({ walletAuthMethodId: binding.walletAuthMethodId });
  if (
    !method ||
    method.status !== 'active' ||
    method.walletId !== binding.walletId ||
    method.walletAuthorityId !== binding.authorityId
  )
    return null;
  const authorities = new D1WalletAuthorityStore({ database, scope });
  const authority = await authorities.readById(method.walletAuthorityId);
  if (
    !authority ||
    authority.state !== 'active' ||
    authority.walletId !== binding.walletId ||
    !sameDelegatedWalletAuthorityV1(
      buildDelegatedWalletAuthorityV1({ permissions: authority.permissions }),
      buildDelegatedWalletAuthorityV1({ permissions: buildFullOwnerPermissionsV1() }),
    )
  )
    return null;
  return {
    method,
    authority,
    commitPrerequisites: methods.prepareActiveV2SourceGuardStatements({
      walletId: binding.walletId,
      walletAuthMethodId: method.walletAuthMethodId,
      walletAuthorityId: method.walletAuthorityId,
      authorityDigestB64u: authority.authorityDigestB64u,
      authorityRevocationEpoch: authority.revocationEpoch,
    }),
  };
}
