// Wallet custody continuity: importing an ECDSA activation from custody facts, and copying
// one to another auth method on the same wallet authority.
import { base64UrlEncode } from '@shared/utils/base64';
import { parseDigestB64u, parseIsoTimestamp } from '@shared/utils/canonicalPrimitives';
import {
  mpcMaterialActivationRefsEqual,
  type WalletAuthMethodId,
  type WalletAuthorityId,
  type WalletId,
} from '@shared/utils/domainIds';
import { routerAbMpcMaterialActivationRefFromWire } from '@shared/utils/routerAbNormalSigningIdentity';
import {
  parseEcdsaCapabilityManifestId,
  parseEcdsaCapabilityManifestRevision,
  parseEvmFamilyEcdsaSignerId,
} from '@shared/utils/ecdsaCapabilityActivation';
import { secureRandomId } from '@shared/utils/secureRandomId';
import {
  normalizeRuntimePolicyScope,
  type RuntimePolicyScope,
} from '@shared/threshold/signingRootScope';
import {
  parseRouterAbEcdsaDerivationPublicCapabilityV1,
  parseRouterAbEcdsaRegistrationActivationReceiptV1,
  type RouterAbEcdsaDerivationNormalSigningStateV1,
  type RouterAbEcdsaDerivationPublicCapabilityV1,
  type RouterAbEcdsaRegistrationActivationReceiptV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import {
  parseSdkEcdsaDerivationSigningRootId,
  parseSdkEcdsaDerivationSigningRootVersion,
} from '@shared/threshold/ecdsaDerivationRoleLocalBootstrap';
import {
  parseWalletAuthAuthorityRef,
  type WalletAuthAuthorityRef,
} from '@shared/utils/walletAuthAuthority';
import { buildEcdsaRoleLocalPublicFacts } from '@/core/platform';
import {
  buildVerifiedEcdsaPublicFacts,
  toEvmFamilyEcdsaKeyHandle,
  toParticipantId,
} from '@/core/signingEngine/session/identity/evmFamilyEcdsaIdentity';
import {
  parseEcdsaClientVerifyingPublicKey33B64u,
  parseEcdsaKeyHandle,
  parseEcdsaRelayerKeyId,
  parseEcdsaRoleLocalBindingDigest,
  parseEcdsaRoleLocalDurableMaterialRef,
  parseEcdsaThresholdKeyId,
} from '@/core/signingEngine/session/keyMaterialBrands';
import {
  buildEcdsaActivationBinding,
  buildEcdsaCapabilityScope,
  buildEcdsaManifestIdentity,
  buildEcdsaRoleLocalMaterialBinding,
  buildPreparedEvmFamilySigner,
} from '@/core/signingEngine/session/material/ecdsaCapabilityManifest';
import type { ThresholdEcdsaChainTarget } from '@/core/platform/types';
import type { WalletCustodyEvmFamilyPublicFacts } from '@shared/passkey-custody';
import { seamsWalletDB } from '../singletons';
import { SeamsWalletRepositories } from './repositories';
import {
  ecdsaRoleLocalMaterialBindingsMatch,
  ecdsaRoleLocalPublicFactsMatch,
  ecdsaRegisteredPublicFactsMatch,
} from './ecdsaCapabilityManifestRecords';
import type { EcdsaCapabilityActivationFinalizationResult } from './ecdsaCapabilityManifestLookups';
import {
  type ImportCommittedWalletCustodyEcdsaActivationInput,
  type PreparedImportedWalletCustodyEcdsaContinuity,
  prepareImportedWalletCustodyEcdsaContinuity,
  importCommittedActivation,
  IndexedDbEcdsaCapabilityManifestStore,
} from './ecdsaCapabilityManifestStore';

export type ImportWalletCustodyEcdsaContinuityInput = {
  readonly store: IndexedDbEcdsaCapabilityManifestStore;
  readonly authority: WalletAuthAuthorityRef;
  readonly chainTargets: readonly [ThresholdEcdsaChainTarget, ...ThresholdEcdsaChainTarget[]];
  readonly walletId: string;
  readonly keyHandle: string;
  readonly ecdsaThresholdKeyId: string;
  readonly signingRootId: string;
  readonly signingRootVersion: string;
  readonly relayerKeyId: string;
  readonly participantIds: readonly [number, number];
  readonly publicCapability: RouterAbEcdsaDerivationPublicCapabilityV1;
  readonly activationReceipt: RouterAbEcdsaRegistrationActivationReceiptV1;
  readonly runtimePolicyScope: RuntimePolicyScope;
  readonly readyStateBlobB64u: string;
  readonly publicFacts: WalletCustodyEvmFamilyPublicFacts;
};

type WalletCustodyEcdsaContinuityInput = Omit<ImportWalletCustodyEcdsaContinuityInput, 'store'>;

function buildWalletCustodyEcdsaContinuityImportInput(
  input: WalletCustodyEcdsaContinuityInput,
): ImportCommittedWalletCustodyEcdsaActivationInput {
  const authority = parseWalletAuthAuthorityRef(input.authority);
  if (!authority || String(authority.walletId) !== String(input.walletId)) {
    throw new Error('ECDSA custody import authority is invalid');
  }
  const publicCapability = parseRouterAbEcdsaDerivationPublicCapabilityV1(input.publicCapability);
  const receipt = parseRouterAbEcdsaRegistrationActivationReceiptV1(input.activationReceipt);
  const materialActivation = routerAbMpcMaterialActivationRefFromWire(
    receipt.ecdsa_activation.material_activation,
  );
  if (
    !mpcMaterialActivationRefsEqual(
      materialActivation,
      routerAbMpcMaterialActivationRefFromWire(publicCapability.material_activation),
    )
  ) {
    throw new Error('ECDSA custody continuity changed the material activation');
  }
  const participantIds = [
    toParticipantId(input.participantIds[0]),
    toParticipantId(input.participantIds[1]),
  ] as const;
  const roleLocalBinding = buildEcdsaRoleLocalMaterialBinding({
    keyHandle: parseEcdsaKeyHandle(input.keyHandle),
    ecdsaThresholdKeyId: parseEcdsaThresholdKeyId(input.ecdsaThresholdKeyId),
    clientVerifyingPublicKey33B64u: parseEcdsaClientVerifyingPublicKey33B64u(
      input.publicFacts.derivationClientSharePublicKey33B64u,
    ),
    participantIds,
    relayerKeyId: parseEcdsaRelayerKeyId(input.relayerKeyId),
  });
  const signer = buildPreparedEvmFamilySigner({
    capability: materialActivation.capability,
    signerId: parseEvmFamilyEcdsaSignerId(
      secureRandomId('ecdsa-signer', 32, 'ECDSA custody signer identities'),
    ),
    authority,
    scope: buildEcdsaCapabilityScope({ targetMemberships: input.chainTargets }),
    materialOwner: materialActivation.materialOwner,
    signingRootId: parseSdkEcdsaDerivationSigningRootId(input.signingRootId),
    signingRootVersion: parseSdkEcdsaDerivationSigningRootVersion(input.signingRootVersion),
  });
  const activationBinding = buildEcdsaActivationBinding({
    targetManifest: buildEcdsaManifestIdentity({
      manifestId: parseEcdsaCapabilityManifestId(
        secureRandomId('ecdsa-manifest', 32, 'ECDSA custody manifest identities'),
      ),
      manifestRevision: parseEcdsaCapabilityManifestRevision(1),
    }),
    signer,
    roleLocalBinding,
    bindingDigest: parseEcdsaRoleLocalBindingDigest(input.publicFacts.contextBinding32B64u),
    durableMaterialRef: parseEcdsaRoleLocalDurableMaterialRef(
      secureRandomId('ecdsa-role-local-material', 32, 'ECDSA custody material identities'),
    ),
  });
  const ethereumAddress = input.publicFacts.ethereumAddress;
  const registeredPublicFacts = buildVerifiedEcdsaPublicFacts({
    keyHandle: toEvmFamilyEcdsaKeyHandle(input.keyHandle),
    publicKeyB64u: input.publicFacts.groupPublicKey33B64u,
    participantIds,
    thresholdOwnerAddress: ethereumAddress,
  });
  const roleLocalPublicFacts = buildEcdsaRoleLocalPublicFacts({
    walletId: authority.walletId,
    chainTarget: input.chainTargets[0],
    keyHandle: roleLocalBinding.keyHandle,
    ecdsaThresholdKeyId: roleLocalBinding.ecdsaThresholdKeyId,
    signingRootId: signer.signingRootId,
    signingRootVersion: signer.signingRootVersion,
    applicationBindingDigestB64u: publicCapability.context.application_binding_digest_b64u,
    clientParticipantId: participantIds[0],
    relayerParticipantId: participantIds[1],
    participantIds,
    contextBinding32B64u: input.publicFacts.contextBinding32B64u,
    derivationClientSharePublicKey33B64u: input.publicFacts.derivationClientSharePublicKey33B64u,
    relayerPublicKey33B64u: input.publicFacts.relayerPublicKey33B64u,
    groupPublicKey33B64u: input.publicFacts.groupPublicKey33B64u,
    ethereumAddress,
    publicCapability,
  });
  const normalSigning: RouterAbEcdsaDerivationNormalSigningStateV1 = {
    kind: 'router_ab_ecdsa_derivation_normal_signing_v1',
    scope: {
      wallet_id: String(authority.walletId),
      ecdsa_threshold_key_id: String(roleLocalBinding.ecdsaThresholdKeyId),
      signing_root_id: String(signer.signingRootId),
      signing_root_version: String(signer.signingRootVersion),
      context: receipt.ecdsa_activation.context,
      public_identity: receipt.ecdsa_activation.public_identity,
      material_activation: receipt.ecdsa_activation.material_activation,
      signing_worker: receipt.ecdsa_activation.signing_worker,
      activation_epoch: receipt.ecdsa_activation.activation_epoch,
    },
  };
  return {
    activationBinding,
    serverCommit: {
      correlationId: receipt.activation_correlation_id,
      activationRequestDigest: parseDigestB64u(
        base64UrlEncode(Uint8Array.from(receipt.activation_request_digest.bytes)),
      ),
      serverGeneration: receipt.server_generation,
      protocolReceipt: receipt,
    },
    readyStateBlobB64u: input.readyStateBlobB64u,
    registeredPublicFacts,
    roleLocalPublicFacts,
    routerAbEcdsaDerivationNormalSigning: normalSigning,
    runtimePolicyScope: normalizeRuntimePolicyScope(input.runtimePolicyScope),
    committedAt: parseIsoTimestamp(
      new Date(receipt.ecdsa_activation.activated_at_ms).toISOString(),
    ),
  };
}

export async function prepareWalletCustodyEcdsaContinuity(
  input: WalletCustodyEcdsaContinuityInput,
): Promise<PreparedImportedWalletCustodyEcdsaContinuity> {
  return prepareImportedWalletCustodyEcdsaContinuity(
    buildWalletCustodyEcdsaContinuityImportInput(input),
  );
}

export async function importWalletCustodyEcdsaContinuity(
  input: ImportWalletCustodyEcdsaContinuityInput,
): Promise<EcdsaCapabilityActivationFinalizationResult> {
  return await importCommittedActivation(
    input.store,
    buildWalletCustodyEcdsaContinuityImportInput(input),
    (prepared) => input.store.persistPreparedWalletCustodyEcdsaContinuity(prepared),
  );
}

async function assertSharedWalletAuthorityMembership(input: {
  readonly walletId: WalletId;
  readonly walletAuthorityId: WalletAuthorityId;
  readonly walletAuthMethodIds: readonly WalletAuthMethodId[];
}): Promise<void> {
  const repositories = new SeamsWalletRepositories(seamsWalletDB);
  for (const walletAuthMethodId of input.walletAuthMethodIds) {
    const authMethod = await repositories.getWalletAuthMethodV2(String(walletAuthMethodId));
    if (
      !authMethod ||
      authMethod.status !== 'active' ||
      authMethod.walletId !== input.walletId ||
      authMethod.walletAuthorityId !== input.walletAuthorityId
    ) {
      throw new Error(
        `ECDSA custody continuity method ${String(walletAuthMethodId)} is not an active member of the wallet authority`,
      );
    }
  }
}

/**
 * Give an added auth method its own encrypted access projection over the
 * activation the wallet already has. The activation is not re-created and the
 * source credential's authority is not widened; only a second method-bound
 * record over the same material appears.
 *
 * The membership check is the whole safety argument. Copying access to a method
 * on another wallet authority would hand that credential custody it was never
 * granted, so both methods are read back and required to be active members of
 * the exact same authority before anything is opened.
 */
export async function copyWalletCustodyEcdsaContinuityToAuthMethod(input: {
  readonly walletId: WalletId;
  readonly walletAuthorityId: WalletAuthorityId;
  readonly sourceWalletAuthMethodId: WalletAuthMethodId;
  readonly targetAuthority: WalletAuthAuthorityRef;
}): Promise<void> {
  if (
    input.targetAuthority.walletId !== input.walletId ||
    input.targetAuthority.walletAuthMethodId === input.sourceWalletAuthMethodId
  ) {
    throw new Error('ECDSA custody continuity target is invalid');
  }
  await assertSharedWalletAuthorityMembership({
    walletId: input.walletId,
    walletAuthorityId: input.walletAuthorityId,
    walletAuthMethodIds: [input.sourceWalletAuthMethodId, input.targetAuthority.walletAuthMethodId],
  });
  const store = new IndexedDbEcdsaCapabilityManifestStore();
  const listed = await store.listActiveWalletCapabilitySubjects(input.walletId);
  if (listed.kind !== 'resolved') {
    throw new Error(`ECDSA custody continuity inventory is ${listed.kind}`);
  }
  /* A wallet whose signer set never included ECDSA has nothing to carry
     forward, and saying so is not a failure - an Ed25519-only wallet must still
     be able to gain a second auth method. */
  if (listed.subjects.length === 0) return;
  const sources = listed.subjects.filter(
    (subject) => subject.authority.walletAuthMethodId === input.sourceWalletAuthMethodId,
  );
  // Copying nothing has to be loud when there was something to copy. If the
  // wallet holds ECDSA capabilities but none for the source method, the added
  // method silently ends up with no access and only surfaces later as a missing
  // lane at unlock, with nothing pointing back to here.
  if (sources.length === 0) {
    throw new Error(
      `ECDSA custody continuity found no active capability for source method ${String(
        input.sourceWalletAuthMethodId,
      )} among [${listed.subjects
        .map((subject) => String(subject.authority.walletAuthMethodId))
        .join(', ')}]`,
    );
  }
  for (const source of sources) {
    const sourceLookup = await store.lookup(source);
    if (sourceLookup.kind !== 'active') {
      throw new Error(`ECDSA custody continuity source is ${sourceLookup.kind}`);
    }
    const targetSelector = {
      capability: source.capability,
      authority: input.targetAuthority,
    };
    const targetLookup = await store.lookup(targetSelector);
    if (targetLookup.kind === 'active') {
      // Repeating a finished copy is a no-op, but only when the projection
      // already there describes the same activation, threshold key, public
      // facts, and role-local binding. Anything else is a different capability
      // wearing the target's key.
      const targetMaterial = targetLookup.manifest.durableMaterial;
      const sourceMaterial = sourceLookup.manifest.durableMaterial;
      if (
        targetMaterial.activationDigest !== sourceMaterial.activationDigest ||
        targetMaterial.bindingDigest !== sourceMaterial.bindingDigest ||
        targetMaterial.roleLocalBinding.ecdsaThresholdKeyId !==
          sourceMaterial.roleLocalBinding.ecdsaThresholdKeyId ||
        !ecdsaRoleLocalMaterialBindingsMatch(
          targetMaterial.roleLocalBinding,
          sourceMaterial.roleLocalBinding,
        ) ||
        !ecdsaRoleLocalPublicFactsMatch(
          targetMaterial.roleLocalPublicFacts,
          sourceMaterial.roleLocalPublicFacts,
        ) ||
        !ecdsaRegisteredPublicFactsMatch(
          targetLookup.manifest.signer.registeredPublicFacts,
          sourceLookup.manifest.signer.registeredPublicFacts,
        )
      ) {
        throw new Error('ECDSA custody continuity target conflicts with source material');
      }
      continue;
    }
    if (targetLookup.kind !== 'missing') {
      throw new Error(`ECDSA custody continuity target is ${targetLookup.kind}`);
    }
    const opened = await store.openActiveMaterialLookup(sourceLookup);
    if (opened.kind !== 'active') {
      throw new Error(`ECDSA custody continuity material is ${opened.kind}`);
    }
    const manifest = opened.manifest;
    const publicFacts = manifest.durableMaterial.roleLocalPublicFacts;
    const imported = await importWalletCustodyEcdsaContinuity({
      store,
      authority: input.targetAuthority,
      chainTargets: manifest.signer.scope.targetMemberships,
      walletId: String(input.walletId),
      keyHandle: publicFacts.keyHandle,
      ecdsaThresholdKeyId: String(publicFacts.ecdsaThresholdKeyId),
      signingRootId: String(publicFacts.signingRootId),
      signingRootVersion: String(publicFacts.signingRootVersion),
      relayerKeyId: String(manifest.durableMaterial.roleLocalBinding.relayerKeyId),
      participantIds: publicFacts.participantIds,
      publicCapability: publicFacts.publicCapability,
      activationReceipt:
        manifest.activation.serverActivation.serverActivationReceipt.protocolReceipt,
      runtimePolicyScope: manifest.durableMaterial.runtimePolicyScope,
      readyStateBlobB64u: opened.readyStateBlobB64u,
      publicFacts: {
        contextBinding32B64u: publicFacts.contextBinding32B64u,
        derivationClientSharePublicKey33B64u: publicFacts.derivationClientSharePublicKey33B64u,
        clientVerifyingShare33B64u:
          publicFacts.publicCapability.public_identity.derivation_client_share_public_key33_b64u,
        relayerPublicKey33B64u: publicFacts.relayerPublicKey33B64u,
        groupPublicKey33B64u: publicFacts.groupPublicKey33B64u,
        ethereumAddress: publicFacts.ethereumAddress,
        clientShareRetryCounter:
          publicFacts.publicCapability.public_identity.client_share_retry_counter,
        relayerShareRetryCounter:
          publicFacts.publicCapability.public_identity.server_share_retry_counter,
      },
    });
    if (imported.kind !== 'committed') {
      throw new Error(`ECDSA custody continuity import is ${imported.kind}`);
    }
  }
}
