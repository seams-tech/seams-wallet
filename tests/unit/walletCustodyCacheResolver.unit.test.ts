import { expect, test } from '@playwright/test';
import { prepareAuthMethodNearSession } from '@/core/authMethods/prepareNearSession';
import { openOrRebindWalletCustodyEd25519V1 } from '@/core/signingEngine/walletCustody/openCustodyCache';
import type { LoadedWalletCustodyEd25519MaterialV1 } from '@/core/signingEngine/walletCustody/ed25519SeedMaterial';

type ResolverInput = Parameters<typeof openOrRebindWalletCustodyEd25519V1>[0];

function cachedRow(stateEpoch: string, signingWorkerId = 'router-ab-signing-worker-staging') {
  return {
    kind: 'found' as const,
    material: {
      binding: {
        walletId: 'wallet-1',
        nearEd25519SigningKeyId: 'ed25519ks_key',
        signingWorkerId,
        stateEpoch,
      },
      sealed: { ciphertextB64u: 'c', nonceB64u: 'n' },
    } as unknown as LoadedWalletCustodyEd25519MaterialV1,
  };
}

function resolverInput(
  loaded: Awaited<ReturnType<ResolverInput['loadCachedMaterial']>>,
  factor: Uint8Array,
): ResolverInput {
  return {
    loadCachedMaterial: async () => loaded,
    activation: {} as ResolverInput['activation'],
    envelope: {} as ResolverInput['envelope'],
    ownedFactorSecret: factor,
    current: { stateEpoch: 2, signingWorkerVerifyingShare: new Array(32).fill(1) },
  };
}

test('a missing cache row needs a reissue, and the factor secret is zeroed', async () => {
  const factor = new Uint8Array(32).fill(9);
  const result = await openOrRebindWalletCustodyEd25519V1(
    resolverInput({ kind: 'absent' }, factor),
  );
  expect(result.kind).toBe('reissue_required');
  expect([...factor].every((byte) => byte === 0)).toBe(true);
});

test('a cache row newer than the server needs a reissue, not a re-bind', async () => {
  const factor = new Uint8Array(32).fill(9);
  const result = await openOrRebindWalletCustodyEd25519V1(resolverInput(cachedRow('3'), factor));
  expect(result.kind).toBe('reissue_required');
  expect([...factor].every((byte) => byte === 0)).toBe(true);
});

test('a VoiceID unlock still refuses cached NEAR custody for another signing worker', async () => {
  const MATERIAL_ACTIVATION = { activation_id: 'activation-2' };
  const capability = {
    nearAccountId: 'near-account',
    materialActivation: MATERIAL_ACTIVATION,
    applicationBinding: {
      wallet_id: 'wallet-1',
      near_ed25519_signing_key_id: 'ed25519ks_key',
      key_creation_signer_slot: 1,
    },
    lifecycle: { signingWorkerId: 'router-ab-signing-worker-staging' },
    registeredPublicKey: new Array(32).fill(7),
    stateEpoch: 2,
  };
  const input = {
    unlocked: {
      walletSession: { walletId: 'wallet-1' },
      near: { kind: 'ready', capability, remainingUses: 3 },
      signal: new AbortController().signal,
    },
    identity: {
      authority: { signerActivations: { ed25519: { materialActivation: MATERIAL_ACTIVATION } } },
    },
    relayerUrl: 'https://relayer.example',
    loadMaterial: async () => cachedRow('2', 'another-worker'),
    persistMaterial: async () => {
      throw new Error('a refused row is never written');
    },
  } as unknown as Parameters<typeof prepareAuthMethodNearSession>[0];
  await expect(prepareAuthMethodNearSession(input)).rejects.toThrow(
    'Cached NEAR custody belongs to another material activation.',
  );
});
