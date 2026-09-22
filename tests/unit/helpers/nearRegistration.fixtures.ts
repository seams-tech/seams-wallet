import {
  parseWalletAuthMethodId,
  parseWalletId,
  parseWebAuthnRpId,
  type DomainIdParseResult,
} from '@shared/utils/domainIds';
import { routerAbMpcMaterialActivationRefToWire } from '@shared/utils/routerAbNormalSigningIdentity';
import { parseRouterAbEd25519YaoRegistrationAdmissionRequestV1 } from '@shared/utils/routerAbEd25519Yao';
import {
  registrationIntentGrantFromString,
  type RegistrationIntentV1,
} from '@shared/utils/registrationIntent';
import { buildMpcMaterialActivationRefFixture } from './ecdsaMaterialRef.fixtures';
import { InMemoryRouterAbEd25519YaoRegistrationIntentAuthorizationAdapter } from '../../../packages/wallet-server/src/router/domains/ed25519Yao/registration/routerAbEd25519YaoRegistrationIntentAuthorization';

function required<T>(parsed: DomainIdParseResult<T>): T {
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

export async function buildNearRegistrationAuthorityFixture(label: string) {
  const walletId = required(parseWalletId(`wallet-${label}`));
  const admission = parseRouterAbEd25519YaoRegistrationAdmissionRequestV1({
    scope: {
      lifecycle_id: `ceremony-${label}`,
      root_share_epoch: 'v1',
      account_id: walletId,
      threshold_session_id: `ceremony-${label}`,
      signer_set_id: 'near',
      signing_worker_id: 'worker',
      material_activation: routerAbMpcMaterialActivationRefToWire(
        buildMpcMaterialActivationRefFixture(label, walletId, 'worker'),
      ),
    },
    application_binding: {
      wallet_id: walletId,
      near_ed25519_signing_key_id: `near-key-${label}`,
      signing_root_id: 'project:dev',
      key_creation_signer_slot: 1,
    },
    participant_ids: [1, 2],
  });
  if (!admission.ok) throw new Error(admission.message);
  const intent: RegistrationIntentV1 = {
    version: 'registration_intent_v1',
    walletId,
    authMethod: { kind: 'passkey', rpId: required(parseWebAuthnRpId('localhost')) },
    signerSelection: {
      kind: 'signer_set',
      signers: [
        {
          kind: 'near_ed25519',
          accountProvisioning: { kind: 'implicit_account', accountIdSource: 'ed25519_public_key' },
          signerSlot: 1,
          participantIds: [1, 2],
          derivationVersion: 1,
        },
      ],
    },
    foundingWalletAuthMethodId: required(parseWalletAuthMethodId(`method-${label}`)),
    runtimePolicyScope: { projectId: 'project', envId: 'dev', signingRootVersion: 'v1' },
    nonceB64u: 'AQ',
  };
  const adapter = new InMemoryRouterAbEd25519YaoRegistrationIntentAuthorizationAdapter();
  const credential = `original-grant-${label}`;
  const expiresAtMs = Date.now() + 60_000;
  const bound = await adapter.bindVerifiedIntent({
    kind: 'verified_registration_intent',
    registrationIntentGrant: registrationIntentGrantFromString(credential),
    intent,
    admissionRequest: admission.value,
    expiresAtMs,
  });
  if (!bound.ok) throw new Error(bound.message);
  return { adapter, admission: admission.value, credential, intent, expiresAtMs };
}

export async function replaceNearFixtureAuthority(
  authority: import('@shared/authorization/walletAuthority').ActiveCombinedWalletAuthorityV1,
  change: 'revocation_epoch' | 'ecdsa_material',
) {
  const {
    buildActiveWalletAuthorityV1,
    buildWalletSignerActivationSetV1,
    computeWalletAuthorityDigestB64u,
    computeWalletSignerActivationSetDigestB64u,
  } = await import('@shared/authorization/walletAuthority');
  const { parseExactAdministeredSignerManifestV1 } =
    await import('@shared/device-linking/delegatedActivationPlan');
  const manifest = parseExactAdministeredSignerManifestV1({
    kind: 'exact_administered_signer_manifest_v1',
    keyFamilies: ['ed25519', 'ecdsa_secp256k1'],
    signers: [authority.signerActivations.ed25519.signer, authority.signerActivations.ecdsa.signer],
  });
  const signerActivations = buildWalletSignerActivationSetV1({
    manifest,
    materialActivations: {
      keyFamilies: ['ed25519', 'ecdsa_secp256k1'],
      ed25519: authority.signerActivations.ed25519.materialActivation,
      ecdsa:
        change === 'ecdsa_material'
          ? buildMpcMaterialActivationRefFixture('replacement', authority.walletId, 'worker')
          : authority.signerActivations.ecdsa.materialActivation,
    },
  });
  const fields = {
    kind: authority.kind,
    authorityId: authority.authorityId,
    walletId: authority.walletId,
    principal: authority.principal,
    provenance: authority.provenance,
    permissions: authority.permissions,
    signerActivations,
    signerActivationSetDigestB64u:
      await computeWalletSignerActivationSetDigestB64u(signerActivations),
    revocationEpoch: authority.revocationEpoch + (change === 'revocation_epoch' ? 1 : 0),
    createdAtMs: authority.createdAtMs,
    updatedAtMs: authority.updatedAtMs + 1,
    state: authority.state,
    activatedAtMs: authority.activatedAtMs,
  };
  const draft = buildActiveWalletAuthorityV1({
    kind: fields.kind,
    authorityId: fields.authorityId,
    walletId: fields.walletId,
    principal: fields.principal,
    provenance: fields.provenance,
    permissions: fields.permissions,
    signerActivations: fields.signerActivations,
    signerActivationSetDigestB64u: fields.signerActivationSetDigestB64u,
    authorityDigestB64u: authority.authorityDigestB64u,
    revocationEpoch: fields.revocationEpoch,
    createdAtMs: fields.createdAtMs,
    updatedAtMs: fields.updatedAtMs,
    state: fields.state,
    activatedAtMs: fields.activatedAtMs,
  });
  return buildActiveWalletAuthorityV1({
    kind: draft.kind,
    authorityId: draft.authorityId,
    walletId: draft.walletId,
    principal: draft.principal,
    provenance: draft.provenance,
    permissions: draft.permissions,
    signerActivations: draft.signerActivations,
    signerActivationSetDigestB64u: draft.signerActivationSetDigestB64u,
    authorityDigestB64u: await computeWalletAuthorityDigestB64u(draft),
    revocationEpoch: draft.revocationEpoch,
    createdAtMs: draft.createdAtMs,
    updatedAtMs: draft.updatedAtMs,
    state: draft.state,
    activatedAtMs: draft.activatedAtMs,
  });
}
