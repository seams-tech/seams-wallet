import { createHash } from 'node:crypto';
import { normalizeRuntimePolicyScope } from '@shared/threshold/signingRootScope';
import { buildRouterAbEd25519YaoRegistrationCapabilityRecordV1 } from '../../../packages/mpc-wallet-server/src/router/domains/ed25519Yao/recovery/routerAbEd25519YaoRecovery';
import {
  buildYaoEd25519WalletSignerRecord,
  ed25519NearPublicKeyFromBytes,
  implicitNearAccountIdFromEd25519PublicKeyBytes,
} from '../../../packages/mpc-wallet-server/src/router/cloudflare/d1/ed25519Yao/d1Ed25519YaoWalletSigner';
import {
  buildNearRegistrationActivationFixture,
  buildNearRegistrationAuthorityFixture,
} from './nearRegistration.fixtures';

export async function buildNearRegistrationSignerFixture(label: string, now: number) {
  const fixture = await buildNearRegistrationAuthorityFixture(label);
  const runtimePolicyScope = normalizeRuntimePolicyScope(fixture.intent.runtimePolicyScope);
  const request = fixture.admission;
  const scope = request.scope;
  const publicKey = Array.from(createHash('sha256').update(label).digest());
  const { receipt, result } = buildNearRegistrationActivationFixture(request, publicKey);
  const nearAccountId = implicitNearAccountIdFromEd25519PublicKeyBytes(publicKey);
  const capability = buildRouterAbEd25519YaoRegistrationCapabilityRecordV1({
    kind: 'router_ab_ed25519_yao_registration_finalize_capability_v1',
    activeCapabilityBinding: publicKey,
    nearAccountId,
    registrationAdmissionRequest: request,
    registrationAdmissionReceipt: receipt,
    registrationResult: result,
    runtimePolicyScope,
  });
  if (!capability.ok) throw new Error(capability.message);
  return buildYaoEd25519WalletSignerRecord({
    walletId: fixture.intent.walletId,
    nearAccountId,
    nearEd25519SigningKeyId: request.application_binding.near_ed25519_signing_key_id,
    thresholdSessionId: scope.threshold_session_id,
    signerSlot: request.application_binding.key_creation_signer_slot,
    publicKey: ed25519NearPublicKeyFromBytes(publicKey),
    signingWorkerId: scope.signing_worker_id,
    keyVersion: scope.root_share_epoch,
    participantIds: request.participant_ids,
    signingRootId: request.application_binding.signing_root_id,
    signingRootVersion: scope.root_share_epoch,
    runtimePolicyScope,
    activeYaoCapability: capability.record,
    custodyKeyManifestDigestB64u: createHash('sha256')
      .update(`manifest-${label}`)
      .digest('base64url'),
    now,
  });
}
