import type { StoreWalletRegistrationPublicationInputV1 } from '@/core/indexedDB/seamsWalletDB/repositories';
import { nearEd25519YaoMaterialActivationFromMetadata } from '@/core/signingEngine/session/material/nearEd25519YaoMaterialActivation';
import {
  buildPasskeyEd25519YaoLocalMaterialRecordV1,
  type Ed25519YaoLocalMaterialIdentity,
} from '@/core/signingEngine/session/passkey/ed25519YaoLocalMaterial';
import {
  WALLET_CUSTODY_ED25519_MATERIAL_KEY_KIND,
  type LoadedWalletCustodyEd25519MaterialV1,
} from '@/core/signingEngine/walletCustody/ed25519SeedMaterial';
import {
  openWalletCustodyEd25519ActiveClientV1,
  type WalletCustodyCacheEnvelopeV1,
} from '@/core/signingEngine/walletCustody/openCustodyCache';
import type { JoinedWalletCustodyNearEd25519KeySetV1 } from '@/SeamsWeb/signingSurface/ports';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import type { registrationEd25519MaterialFacts } from './registrationEd25519Yao';

type PasskeyRegistrationMaterial = {
  metadata: JoinedWalletCustodyNearEd25519KeySetV1['metadata'];
  material: LoadedWalletCustodyEd25519MaterialV1;
  materialFacts: ReturnType<typeof registrationEd25519MaterialFacts>;
  envelope: WalletCustodyCacheEnvelopeV1;
  ownedFactorSecret: Uint8Array;
};

export async function openPasskeyRegistrationEd25519Material(args: PasskeyRegistrationMaterial) {
  const metadata = args.metadata;
  return await openWalletCustodyEd25519ActiveClientV1({
    material: args.material,
    activation: {
      materialActivation: nearEd25519YaoMaterialActivationFromMetadata(metadata),
      lifecycleId: metadata.scope.lifecycle_id,
      signingRootVersion: metadata.scope.root_share_epoch,
      signingRootId: metadata.applicationBinding.signing_root_id,
      signerSetId: metadata.scope.signer_set_id,
      thresholdSessionId: args.materialFacts.identity.thresholdSessionId,
      activationTranscriptB64u: base64UrlEncode(metadata.transcript),
      activationCapabilityBindingB64u: base64UrlEncode(
        Uint8Array.from(metadata.activeCapabilityBinding),
      ),
    },
    envelope: args.envelope,
    ownedFactorSecret: args.ownedFactorSecret,
  });
}

export function passkeyRegistrationLocalMaterialIdentity(
  materialFacts: ReturnType<typeof registrationEd25519MaterialFacts>,
  rpId: string,
  credentialIdB64u: string,
): Ed25519YaoLocalMaterialIdentity {
  return {
    walletId: materialFacts.identity.walletId,
    nearAccountId: materialFacts.identity.nearAccountId,
    nearEd25519SigningKeyId: materialFacts.identity.nearEd25519SigningKeyId,
    thresholdSessionId: materialFacts.identity.thresholdSessionId,
    signerSlot: materialFacts.identity.signerSlot,
    rpId,
    credentialIdB64u,
    signingRootId: materialFacts.identity.signingRootId,
    signingRootVersion: materialFacts.identity.signingRootVersion,
    signingWorkerId: materialFacts.stableServerScope.routerAbNormalSigning.signingWorkerId,
  };
}

/** Include sealed owner material in the registration transaction. No live client escapes this function. */
export async function prepareOwnerRegistrationPublication(
  args: PasskeyRegistrationMaterial & {
    registration: StoreWalletRegistrationPublicationInputV1;
    rpId: string;
    credentialIdB64u: string;
    passkeyPrfFirstB64u: string;
  },
): Promise<StoreWalletRegistrationPublicationInputV1> {
  const ownedPasskeyPrfFirst = base64UrlDecode(args.passkeyPrfFirstB64u);
  let activeClient: Awaited<ReturnType<typeof openPasskeyRegistrationEd25519Material>> | null = null;
  try {
    activeClient = await openPasskeyRegistrationEd25519Material(args);
    const target = args.registration.keyMaterials.find(nearRegistrationTarget);
    if (!target) throw new Error('The owner registration has no NEAR material target.');
    const sealed = buildPasskeyEd25519YaoLocalMaterialRecordV1({
      target: {
        profileId: target.profileId,
        chainIdKey: target.chainIdKey,
        accountAddress: target.accountAddress,
      },
      activeClient,
      identity: passkeyRegistrationLocalMaterialIdentity(
        args.materialFacts,
        args.rpId,
        args.credentialIdB64u,
      ),
      stableServerScope: args.materialFacts.stableServerScope,
      ownedPasskeyPrfFirst,
      lifecycle: { kind: 'registration_or_rehydration' },
    });
    return {
      profiles: args.registration.profiles,
      initialAuthMethod: args.registration.initialAuthMethod,
      authenticators: args.registration.authenticators,
      signerActivations: args.registration.signerActivations,
      keyMaterials: [...args.registration.keyMaterials, sealed],
      lastProfileState: args.registration.lastProfileState,
    };
  } finally {
    activeClient?.dispose();
    ownedPasskeyPrfFirst.fill(0);
    args.ownedFactorSecret.fill(0);
  }
}

function nearRegistrationTarget(
  material: StoreWalletRegistrationPublicationInputV1['keyMaterials'][number],
): boolean {
  return material.keyKind === WALLET_CUSTODY_ED25519_MATERIAL_KEY_KIND;
}
