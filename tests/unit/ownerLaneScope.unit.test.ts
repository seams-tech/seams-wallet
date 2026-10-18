import { expect, test } from '@playwright/test';
import {
  resolveExactOwnerLaneScope,
  type OwnerLaneScopeStores,
} from '@/core/signingEngine/session/identity/ownerLaneScope';
import {
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  parseWalletId,
  parseWebAuthnCredentialIdB64u,
  parseWebAuthnRpId,
} from '@shared/utils/domainIds';
import type { ActiveWalletAuthMethodRecordV2 } from '@shared/utils/walletAuthMethodRecord';

function required<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(String(result.error));
  return result.value;
}

const AUTH_METHOD: ActiveWalletAuthMethodRecordV2 = {
  version: 'wallet_auth_method_v2',
  walletAuthMethodId: required(parseWalletAuthMethodId('wallet-auth-method:owner-scope')),
  walletId: required(parseWalletId('owner-lane-scope-wallet')),
  walletAuthorityId: required(parseWalletAuthorityId('wallet-authority:owner-scope')),
  kind: 'passkey',
  status: 'active',
  rpId: required(parseWebAuthnRpId('localhost')),
  credentialIdB64u: required(parseWebAuthnCredentialIdB64u('credential-owner-scope')),
  credentialPublicKeyB64u: 'AQID',
  counter: 0,
  createdAtMs: 1,
  updatedAtMs: 1,
  activatedAtMs: 1,
};

test('a passkey owner without its exact local authenticator fails closed', async () => {
  const stores: OwnerLaneScopeStores = {
    getWalletAuthMethodV2: async () => AUTH_METHOD,
    listWalletAuthMethodsForWallet: async () => [],
    getWalletPasskeyAuthenticator: async () => null,
  };
  const error = await resolveExactOwnerLaneScope({ authMethod: AUTH_METHOD, stores }).then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect((error as Error).name).toBe('OwnerLaneScopeIntegrityError');
  expect((error as Error).message).toContain('no exact local authenticator');
});
