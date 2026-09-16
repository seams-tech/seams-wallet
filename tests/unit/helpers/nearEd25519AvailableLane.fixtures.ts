import { toAccountId } from '@/core/types/accountIds';
import { toWalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { toRpId } from '@/core/signingEngine/session/identity/evmFamilyEcdsaIdentity';
import type { ConcreteAvailableEd25519SigningLane } from '@/core/signingEngine/session/availability/availableSigningLanes';
import type { SigningLaneAuthBinding } from '@/core/signingEngine/session/identity/signingLaneAuthBinding';
import { nearEd25519SigningKeyIdFromString } from '@shared/utils/registrationIntent';
import { buildMpcMaterialActivationRefFixture } from './ecdsaMaterialRef.fixtures';

export function buildDeferredNearEd25519AvailableLaneFixture(args: {
  readonly label: string;
  readonly auth: SigningLaneAuthBinding;
  readonly thresholdSessionId: string;
}): ConcreteAvailableEd25519SigningLane {
  return {
    auth: args.auth,
    curve: 'ed25519',
    chain: 'near',
    materialActivation: buildMpcMaterialActivationRefFixture(args.label),
    walletId: toWalletId('wallet:near-rehydration'),
    nearAccountId: toAccountId('near-rehydration.testnet'),
    nearEd25519SigningKeyId: nearEd25519SigningKeyIdFromString(
      'near-key:near-rehydration',
    ),
    signerSlot: 1,
    thresholdSessionId: args.thresholdSessionId,
    authorizationState: 'authorization_required',
    state: 'deferred',
    source: 'public_capability_reference',
  };
}

export function buildNearEd25519PasskeyAuthFixture(): Extract<
  SigningLaneAuthBinding,
  { readonly kind: 'passkey' }
> {
  return {
    kind: 'passkey',
    rpId: toRpId('wallet.example.test'),
    credentialIdB64u: 'credential:near-rehydration',
  };
}
