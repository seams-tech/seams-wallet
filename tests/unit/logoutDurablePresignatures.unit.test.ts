import { expect, test } from '@playwright/test';
import { SIGNER_AUTH_METHODS } from '@shared/utils/signerDomain';
import { logout, type LogoutOperationContext } from '@/SeamsWeb/operations/auth/login';
import { toWalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { EcdsaClientPresignCleanupTarget } from '@/core/signingEngine/workerManager/ecdsaPresignLifecycle';
import type { WalletAuthenticationState } from '@/core/types/seams';

function buildLogoutContext(input?: {
  readonly lockFailure?: Error;
  readonly deletedTargets?: EcdsaClientPresignCleanupTarget[];
  readonly retiredWalletIds?: string[];
  readonly authenticationAfterAdvance?: WalletAuthenticationState;
  readonly authenticationAtConditionalClear?: WalletAuthenticationState[];
  readonly signedOut?: boolean;
}): LogoutOperationContext {
  const walletId = toWalletId('wallet-1');
  let authentication: WalletAuthenticationState = input?.signedOut
    ? { kind: 'signed_out' }
    : {
        kind: 'authenticated',
        walletId,
        authMethod: SIGNER_AUTH_METHODS.passkey,
      };
  return {
    signingEngine: {
      readWalletAuthenticationState: () => authentication,
      advanceWalletLockGeneration: async () => {
        if (input?.authenticationAfterAdvance) {
          authentication = input.authenticationAfterAdvance;
        }
        if (input?.lockFailure) throw input.lockFailure;
        return 1;
      },
      retireActiveWalletSessionAuthorizationForLock: async (walletId) => {
        input?.retiredWalletIds?.push(walletId);
      },
      clearWalletAuthenticationIfCurrent: (expected) => {
        input?.authenticationAtConditionalClear?.push(authentication);
        if (authentication !== expected) return false;
        authentication = { kind: 'signed_out' };
        return true;
      },
      getNonceCoordinator: () => ({ clearAll: () => {} }),
      clearThresholdEcdsaSigningQueue: () => {},
      clearVolatileWarmSigningMaterial: async () => {},
      deleteDurableEcdsaPresignatures: async (target) => {
        input?.deletedTargets?.push(target);
        return 1;
      },
    },
  };
}

test('logout deletes the authenticated wallet durable presignature cache', async () => {
  const deletedTargets: EcdsaClientPresignCleanupTarget[] = [];
  await logout(buildLogoutContext({ deletedTargets }));
  expect(deletedTargets).toEqual([{ kind: 'wallet', walletId: 'wallet-1' }]);
});

test('logout retires the Wallet Session and deletes the durable cache when lock generation fails', async () => {
  const deletedTargets: EcdsaClientPresignCleanupTarget[] = [];
  const retiredWalletIds: string[] = [];
  const lockFailure = new Error('lock generation failed');
  await expect(
    logout(buildLogoutContext({ lockFailure, deletedTargets, retiredWalletIds })),
  ).rejects.toThrow(lockFailure);
  expect(retiredWalletIds).toEqual(['wallet-1']);
  expect(deletedTargets).toEqual([{ kind: 'wallet', walletId: 'wallet-1' }]);
});

test('logout leaves durable presignatures unchanged when authentication is already signed out', async () => {
  const deletedTargets: EcdsaClientPresignCleanupTarget[] = [];
  await logout(buildLogoutContext({ deletedTargets, signedOut: true }));
  expect(deletedTargets).toEqual([]);
});

test('logout does not clear authentication installed while the captured wallet is locking', async () => {
  const deletedTargets: EcdsaClientPresignCleanupTarget[] = [];
  const retiredWalletIds: string[] = [];
  const authenticationAtConditionalClear: WalletAuthenticationState[] = [];
  const replacementAuthentication: WalletAuthenticationState = {
    kind: 'authenticated',
    walletId: toWalletId('wallet-2'),
    authMethod: SIGNER_AUTH_METHODS.emailOtp,
  };

  await logout(
    buildLogoutContext({
      authenticationAfterAdvance: replacementAuthentication,
      authenticationAtConditionalClear,
      deletedTargets,
      retiredWalletIds,
    }),
  );

  expect(retiredWalletIds).toEqual(['wallet-1']);
  expect(authenticationAtConditionalClear).toEqual([replacementAuthentication]);
  expect(deletedTargets).toEqual([{ kind: 'wallet', walletId: 'wallet-1' }]);
});
