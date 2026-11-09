import { expect, test } from '@playwright/test';
import { prepareAuthMethodNearSession } from '@/core/authMethods/prepareNearSession';
import { NEAR_CUSTODY_STALE_MESSAGE } from '@shared/utils/errors';

type Input = Parameters<typeof prepareAuthMethodNearSession>[0];

const MATERIAL_ACTIVATION = { activation_id: 'activation-2' };

function input(cached: { stateEpoch: string; signingWorkerId: string }): Input {
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
  return {
    unlocked: {
      walletSession: { walletId: 'wallet-1' },
      near: { kind: 'ready', capability, remainingUses: 3 },
      signal: new AbortController().signal,
    },
    identity: {
      authority: { signerActivations: { ed25519: { materialActivation: MATERIAL_ACTIVATION } } },
    },
    relayerUrl: 'https://relayer.example',
    loadMaterial: async () => ({
      kind: 'found',
      material: {
        binding: {
          walletId: 'wallet-1',
          nearEd25519SigningKeyId: 'ed25519ks_key',
          ...cached,
        },
        sealed: { ciphertextB64u: 'c', nonceB64u: 'n' },
      },
    }),
  } as unknown as Input;
}

test('a VoiceID unlock asks for one passkey unlock when the cached NEAR custody is from an older epoch', async () => {
  await expect(
    prepareAuthMethodNearSession(
      input({ stateEpoch: '1', signingWorkerId: 'router-ab-signing-worker-staging' }),
    ),
  ).rejects.toThrow(NEAR_CUSTODY_STALE_MESSAGE);
});

test('a VoiceID unlock still refuses cached NEAR custody for another signing worker', async () => {
  await expect(
    prepareAuthMethodNearSession(input({ stateEpoch: '2', signingWorkerId: 'another-worker' })),
  ).rejects.toThrow('Cached NEAR custody belongs to another material activation.');
});
