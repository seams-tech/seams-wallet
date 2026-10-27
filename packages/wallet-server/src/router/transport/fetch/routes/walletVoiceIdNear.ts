import type { FetchRouterApiContext } from '../createFetchRouter';
import type { VoiceIdVerifyResult } from '../../../domains/voiceId/voiceIdSessions';
import type { RouterAbEd25519YaoActiveCapabilityDescriptorV1 } from '../../../domains/ed25519Yao/recovery/routerAbEd25519YaoRecovery';
import {
  routerAbMpcMaterialActivationRefToWire,
  sameRouterAbMpcMaterialActivationRef,
} from '@shared/utils/routerAbNormalSigningIdentity';
import type { WalletCapabilitySubjectV1 } from '@shared/device-linking/contracts';

export type VoiceIdNearInstallation =
  | { readonly kind: 'unavailable' }
  | {
      readonly kind: 'ready';
      readonly capability: RouterAbEd25519YaoActiveCapabilityDescriptorV1;
      readonly remainingUses: number;
    };

export async function prepareVoiceIdNearInstallation(
  ctx: FetchRouterApiContext,
  verified: Extract<VoiceIdVerifyResult, { kind: 'issued' }>,
): Promise<VoiceIdNearInstallation> {
  const session = verified.authorization.session;
  const activation = session.capabilitySubjects.find(isNearSignSubject);
  if (!activation || activation.kind !== 'sign') return { kind: 'unavailable' };
  const resolved = await ctx.service.walletRegistration.resolveEd25519MaterialActivation({
    walletId: session.walletId,
    materialActivation: routerAbMpcMaterialActivationRefToWire(activation.materialActivation),
  });
  if (!resolved.ok) throw new Error(resolved.message);
  const product = ctx.opts.routerAbEd25519YaoProduct;
  if (!product) throw new Error('NEAR signing is not configured');
  const capability = await product.resolveActiveCapability({
    kind: 'router_ab_ed25519_yao_active_capability_lookup_v1',
    walletId: session.walletId,
    nearEd25519SigningKeyId:
      resolved.exportIdentity.application_binding.near_ed25519_signing_key_id,
    signerSlot: resolved.signerSlot,
    signingWorkerId: resolved.signingWorkerId,
    participantIds: resolved.participantIds,
  });
  if (!capability.ok) throw new Error(capability.message);
  if (
    !sameRouterAbMpcMaterialActivationRef(
      capability.capability.materialActivation,
      resolved.materialActivation,
    )
  ) {
    throw new Error('NEAR capability does not belong to this Wallet Session');
  }
  return {
    kind: 'ready',
    capability: capability.capability,
    remainingUses: verified.authorization.quota.remainingUses,
  };
}

function isNearSignSubject(subject: WalletCapabilitySubjectV1): boolean {
  return subject.kind === 'sign' && subject.keyFamily === 'ed25519';
}
