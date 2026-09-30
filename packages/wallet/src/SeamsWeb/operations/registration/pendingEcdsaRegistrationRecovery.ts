import {
  prepareWalletEcdsaRegistrationPublication,
  type StoreWalletEcdsaWalletKey,
} from '@/core/signingEngine/flows/registration/accountLifecycle';
import {
  IndexedDbEcdsaCapabilityManifestStore,
  type PreparedImportedWalletCustodyEcdsaContinuity,
} from '@/core/indexedDB/seamsWalletDB/ecdsaCapabilityManifestStore';
import {
  ecdsaCapabilityScopesMatch,
  runtimePolicyScopesMatch,
} from '@/core/indexedDB/seamsWalletDB/ecdsaCapabilityManifestRecords';
import { buildEcdsaCapabilityScope } from '@/core/signingEngine/session/material/ecdsaCapabilityManifest';
import { prepareWalletCustodyEcdsaContinuity } from '@/core/indexedDB/seamsWalletDB/walletCustodyEcdsaContinuity';
import type { WalletRegistrationEcdsaWalletKey } from '@/core/rpcClients/relayer/walletRegistration';
import type {
  PublishPendingWalletRegistrationCommitInputV1,
  StoreWalletRegistrationPublicationInputV1,
} from '@/core/indexedDB/seamsWalletDB/repositories';
import {
  parseEmailOtpWalletAuthAuthority,
  walletAuthAuthorityRef,
} from '@shared/utils/walletAuthAuthority';
import {
  sameRouterAbEcdsaDerivationPublicCapabilityV1,
  sameRouterAbEcdsaRegistrationActivationReceiptV1,
  type RouterAbEcdsaPostRegistrationSessionActivationResponseV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import { routerAbMpcMaterialActivationRefFromWire } from '@shared/utils/routerAbNormalSigningIdentity';
import { parseEcdsaRoleLocalMaterialHandle } from '@/core/signingEngine/session/keyMaterialBrands';
import {
  pendingEcdsaActivateRequest,
  requireCommittedEcdsaRegistrationResponse,
  requireResponseWalletKeys,
  requireEcdsaProjection,
  type CommittedEcdsaRegistrationResponse,
  type PendingEcdsaRegistrationCommit,
  type PendingEcdsaRegistrationRecoveryPorts,
  type PendingEcdsaRegistrationUnlockInput,
  type PendingEcdsaRegistrationUnlockMaterial,
  type PendingRegistrationExactMethod,
  type PendingRegistrationRecoverySigningSurface,
} from './pendingEcdsaRegistrationRecoveryValidation';

type PendingEcdsaRecoveryCommon = {
  readonly relayerUrl: string;
  readonly pending: PendingEcdsaRegistrationCommit;
  readonly signingSurface: PendingRegistrationRecoverySigningSurface;
  readonly ports: PendingEcdsaRegistrationRecoveryPorts;
};

type ResumePendingEcdsaRegistrationInput =
  | (PendingEcdsaRecoveryCommon & {
      readonly exactMethod: Extract<PendingRegistrationExactMethod, { readonly kind: 'passkey' }>;
    })
  | (PendingEcdsaRecoveryCommon & {
      readonly exactMethod: Extract<PendingRegistrationExactMethod, { readonly kind: 'email_otp' }>;
    });

async function prepareRegistrationContinuity(
  input: Parameters<typeof prepareWalletCustodyEcdsaContinuity>[0],
): Promise<{
  readonly roleLocalMaterialRef: PreparedImportedWalletCustodyEcdsaContinuity['roleLocalMaterialRef'];
  readonly publication: readonly PreparedImportedWalletCustodyEcdsaContinuity[];
}> {
  const store = new IndexedDbEcdsaCapabilityManifestStore();
  const materialActivation = routerAbMpcMaterialActivationRefFromWire(
    input.activationReceipt.ecdsa_activation.material_activation,
  );
  const existing = await store.lookupByMaterialActivation({
    walletId: input.authority.walletId,
    authority: input.authority,
    materialActivation,
  });
  if (existing.kind === 'missing') {
    const prepared = await prepareWalletCustodyEcdsaContinuity(input);
    return { roleLocalMaterialRef: prepared.roleLocalMaterialRef, publication: [prepared] };
  }
  if (existing.kind !== 'active') {
    throw new Error(`Pending ECDSA registration continuity is ${existing.kind}`);
  }
  const manifest = existing.manifest;
  const material = manifest.durableMaterial;
  // Reload may already have finalized the original activation journal.
  if (
    !sameRouterAbEcdsaRegistrationActivationReceiptV1(
      manifest.activation.serverActivation.serverActivationReceipt.protocolReceipt,
      input.activationReceipt,
    ) ||
    !sameRouterAbEcdsaDerivationPublicCapabilityV1(
      material.roleLocalPublicFacts.publicCapability,
      input.publicCapability,
    ) ||
    !ecdsaCapabilityScopesMatch(
      manifest.signer.scope,
      buildEcdsaCapabilityScope({ targetMemberships: input.chainTargets }),
    ) ||
    material.roleLocalBinding.keyHandle !== input.keyHandle ||
    material.roleLocalBinding.ecdsaThresholdKeyId !== input.ecdsaThresholdKeyId ||
    material.roleLocalBinding.relayerKeyId !== input.relayerKeyId ||
    material.bindingDigest !== input.publicFacts.contextBinding32B64u ||
    manifest.signer.signingRootId !== input.signingRootId ||
    manifest.signer.signingRootVersion !== input.signingRootVersion ||
    !runtimePolicyScopesMatch(material.runtimePolicyScope, input.runtimePolicyScope)
  ) {
    throw new Error('Pending ECDSA registration conflicts with its restored activation');
  }
  return {
    roleLocalMaterialRef: {
      kind: 'ecdsa_role_local_persisted_material_ref_v1',
      durableMaterialRef: material.durableMaterialRef,
      bindingDigest: material.bindingDigest,
      materialActivation,
    },
    publication: [],
  };
}

export type ResumePendingEcdsaRegistrationResult = {
  readonly kind: 'published';
  readonly registrationCeremonyId: string;
  readonly walletId: CommittedEcdsaRegistrationResponse['walletId'];
  readonly sessionResult: 'already_committed';
};

function nonEmptyWalletKeys(
  walletKeys: readonly StoreWalletEcdsaWalletKey[],
): [StoreWalletEcdsaWalletKey, ...StoreWalletEcdsaWalletKey[]] {
  const first = walletKeys[0];
  if (!first) throw new Error('ECDSA registration finalization returned no wallet keys');
  return [first, ...walletKeys.slice(1)];
}

function nonEmptyChainTargets(
  walletKeys: readonly WalletRegistrationEcdsaWalletKey[],
): [
  WalletRegistrationEcdsaWalletKey['chainTarget'],
  ...WalletRegistrationEcdsaWalletKey['chainTarget'][],
] {
  const first = walletKeys[0];
  if (!first) throw new Error('ECDSA registration activation returned no chain targets');
  return [first.chainTarget, ...walletKeys.slice(1).map((walletKey) => walletKey.chainTarget)];
}

async function prepareEcdsaRegistrationPublication(args: {
  readonly pending: PendingEcdsaRegistrationCommit;
  readonly response: CommittedEcdsaRegistrationResponse;
  readonly walletKeys: readonly StoreWalletEcdsaWalletKey[];
}): Promise<StoreWalletRegistrationPublicationInputV1> {
  const walletKeys = nonEmptyWalletKeys(args.walletKeys);
  if (args.pending.auth.kind === 'passkey') {
    if (
      args.response.authMethod.kind !== 'passkey' ||
      !args.response.authMethod.credentialPublicKeyB64u
    ) {
      throw new Error('ECDSA registration publication has no exact Passkey credential');
    }
    return await prepareWalletEcdsaRegistrationPublication({
      kind: 'passkey',
      walletId: args.pending.walletId,
      rpId: args.pending.auth.rpId,
      credentialIdB64u: args.pending.auth.credentialIdB64u,
      credentialPublicKeyB64u: args.response.authMethod.credentialPublicKeyB64u,
      transports: args.pending.auth.transports,
      walletKeys,
    });
  }
  if (args.response.authMethod.kind !== 'email_otp') {
    throw new Error('ECDSA Email OTP registration publication has a different auth method');
  }
  const authority = parseEmailOtpWalletAuthAuthority(args.response.authority);
  if (!authority) throw new Error('ECDSA Email OTP registration authority is invalid');
  return await prepareWalletEcdsaRegistrationPublication({
    kind: 'email_otp',
    walletId: args.pending.walletId,
    email: args.pending.auth.email,
    registrationAuthorityId: args.pending.auth.registrationAuthorityId,
    authority,
    walletKeys,
  });
}

function publicationInput(args: {
  readonly pending: PendingEcdsaRegistrationCommit;
  readonly response: CommittedEcdsaRegistrationResponse;
  readonly registration: StoreWalletRegistrationPublicationInputV1;
  readonly session: RouterAbEcdsaPostRegistrationSessionActivationResponseV1;
  readonly ecdsaContinuity: readonly PreparedImportedWalletCustodyEcdsaContinuity[];
}): PublishPendingWalletRegistrationCommitInputV1 {
  return {
    pending: args.pending,
    authority: args.response.authority,
    foundingAuthority: {
      authority: args.response.foundingAuthority,
      authMethod: args.response.foundingAuthMethod,
    },
    request: {
      operation: args.pending.operation,
      registrationCeremonyId: args.pending.registrationCeremonyId,
      idempotencyKey: args.pending.idempotencyKey,
      walletId: args.pending.walletId,
      walletAuthMethodId: args.pending.walletAuthMethodId,
    },
    walletSessionPublication: {
      kind: 'issued',
      walletSession: args.session.session.wallet_session,
      operationCredential: args.session.session.operation_credential,
    },
    ecdsaContinuity: args.ecdsaContinuity,
    registration: args.registration,
  };
}

export async function resumePendingEcdsaRegistration(
  args: ResumePendingEcdsaRegistrationInput,
): Promise<ResumePendingEcdsaRegistrationResult> {
  const response = await args.ports.activateWalletRegistration(
    pendingEcdsaActivateRequest(args.relayerUrl, args.pending),
  );
  const committed = await requireCommittedEcdsaRegistrationResponse({
    pending: args.pending,
    response,
  });
  const responseWalletKeys = requireResponseWalletKeys(committed);
  const unlockInput: PendingEcdsaRegistrationUnlockInput = {
    relayerUrl: args.relayerUrl,
    pending: args.pending,
    response: committed,
    walletKeys: responseWalletKeys,
    exactMethod: args.exactMethod,
    signingSurface: args.signingSurface,
  };
  const unlocked: PendingEcdsaRegistrationUnlockMaterial =
    await args.ports.unlockPendingEcdsaRegistration(unlockInput);
  const primaryKey = responseWalletKeys[0];
  if (!primaryKey) throw new Error('ECDSA registration activation returned no primary key');
  const authority = await walletAuthAuthorityRef({ authority: committed.authority });
  const continuity = await prepareRegistrationContinuity({
    authority,
    chainTargets: nonEmptyChainTargets(responseWalletKeys),
    walletId: String(args.pending.walletId),
    keyHandle: primaryKey.keyHandle,
    ecdsaThresholdKeyId: primaryKey.ecdsaThresholdKeyId,
    signingRootId: primaryKey.signingRootId,
    signingRootVersion: primaryKey.signingRootVersion,
    relayerKeyId: primaryKey.relayerKeyId,
    participantIds: primaryKey.participantIds,
    publicCapability: primaryKey.publicCapability,
    activationReceipt: committed.ecdsa.activation,
    runtimePolicyScope: requireEcdsaProjection(committed).ecdsa.runtimePolicyScope,
    readyStateBlobB64u: unlocked.readyStateBlobB64u,
    publicFacts: unlocked.publicFacts,
  });
  const finalizedRoleLocalMaterial = {
    kind: 'ecdsa_role_local_worker_handle_v1' as const,
    materialHandle: parseEcdsaRoleLocalMaterialHandle(
      continuity.roleLocalMaterialRef.durableMaterialRef,
    ),
    bindingDigest: continuity.roleLocalMaterialRef.bindingDigest,
    durableMaterialRef: continuity.roleLocalMaterialRef.durableMaterialRef,
  };
  const walletKeys = await args.signingSurface.finalizeWalletRegistrationEcdsaSessions({
    walletId: String(args.pending.walletId),
    session: {
      chainTargets: nonEmptyChainTargets(responseWalletKeys),
      authority,
      bootstrap: {
        applicationBindingDigestB64u: committed.ecdsa.bootstrap.applicationBindingDigestB64u,
      },
      roleLocalMaterial: finalizedRoleLocalMaterial,
      materialActivation: continuity.roleLocalMaterialRef.materialActivation,
      clientPublicFacts: {
        contextBinding32B64u: unlocked.publicFacts.contextBinding32B64u,
        derivationClientSharePublicKey33B64u:
          unlocked.publicFacts.derivationClientSharePublicKey33B64u,
        clientVerifyingShareB64u: unlocked.publicFacts.clientVerifyingShare33B64u,
        relayerPublicKey33B64u: unlocked.publicFacts.relayerPublicKey33B64u,
        groupPublicKey33B64u: unlocked.publicFacts.groupPublicKey33B64u,
        ethereumAddress: unlocked.publicFacts.ethereumAddress,
      },
      publicCapability: primaryKey.publicCapability,
    },
    walletKeys: responseWalletKeys,
  });
  const registration = await prepareEcdsaRegistrationPublication({
    pending: args.pending,
    response: committed,
    walletKeys,
  });
  await args.ports.publishPendingWalletRegistrationCommit(
    publicationInput({
      pending: args.pending,
      response: committed,
      registration,
      session: unlocked.session,
      ecdsaContinuity: continuity.publication,
    }),
  );
  return {
    kind: 'published',
    registrationCeremonyId: args.pending.registrationCeremonyId,
    walletId: committed.walletId,
    sessionResult: 'already_committed',
  };
}
