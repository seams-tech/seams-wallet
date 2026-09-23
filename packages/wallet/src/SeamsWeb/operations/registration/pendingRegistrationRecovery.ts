import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking/contracts';
import type { JoinedWalletCustodyNearEd25519KeySetV1 } from '@/SeamsWeb/signingSurface/ports';
import {
  ROUTER_AB_ED25519_YAO_WARM_RECOVERY_BOOTSTRAP_PATH_V1,
  parseRouterAbEd25519YaoWarmRecoveryBootstrapRequestV1,
} from '@shared/utils/routerAbEd25519Yao';
import { parseEd25519YaoRecoveryCapabilityV1 } from '@/core/signingEngine/session/passkey/ed25519YaoRecoveryCapability';
import { walletCustodyActiveClientMetadataV1 } from '@/core/signingEngine/walletCustody/openCustodyCache';
import { base64UrlEncode } from '@shared/utils/base64';
import { assertPendingWalletRegistrationIdentity, IndexedDBManager } from '@/core/indexedDB';
import type { PendingWalletRegistrationCommitV1 } from '@/core/indexedDB';
import type {
  PublishPendingWalletRegistrationCommitInputV1,
  StoreWalletRegistrationPublicationInputV1,
  StoreWalletRegistrationFinalizeBatchResult,
} from '@/core/indexedDB/seamsWalletDB/repositories';
import {
  prepareWalletEmailOtpEd25519RegistrationPublication,
  prepareWalletEd25519RegistrationProjectionPublication,
} from '@/core/signingEngine/flows/registration/accountLifecycle';
import {
  WALLET_CUSTODY_ED25519_MATERIAL_KEY_KIND,
  type LoadedWalletCustodyEd25519MaterialV1,
} from '@/core/signingEngine/walletCustody/ed25519SeedMaterial';
import {
  completeWalletRegistrationNearProvisioning,
  activateWalletRegistration,
  type WalletRegistrationActivateResponseV2,
  type WalletRegistrationNearProvisioningResponseV2,
} from '@/core/rpcClients/relayer/walletRegistration';
import {
  requireEd25519YaoRegistrationPublicResultMatches,
  requireEmailOtpEd25519YaoRegistrationPublicResultMatches,
} from './registrationEd25519Yao';
import { base58Encode } from '@shared/utils/base58';
import { base64UrlDecode } from '@shared/utils/base64';
import { mpcMaterialActivationRefsEqual, type WalletId } from '@shared/utils/domainIds';
import { toAccountId } from '@/core/types/accountIds';
import type { RegistrationEstablishedSessionResultV2 } from '@shared/utils/registrationEstablishedSession';
import { parseEmailOtpWalletAuthAuthority } from '@shared/utils/walletAuthAuthority';
import type {
  PendingEcdsaRegistrationCommit,
  PendingEcdsaRegistrationKeyFamilies,
  PendingEcdsaRegistrationRecoveryPorts,
  PendingRegistrationExactMethod,
  PendingRegistrationRecoverySigningSurface,
} from './pendingEcdsaRegistrationRecoveryValidation';
import {
  isEcdsaRegistrationCommit,
  isMixedEcdsaRegistrationCommit,
} from './pendingEcdsaRegistrationRecoveryValidation';
import {
  resumePendingEcdsaRegistration as resumePendingEcdsaRegistrationWithPorts,
  type ResumePendingEcdsaRegistrationResult,
} from './pendingEcdsaRegistrationRecovery';
import { unlockPendingEcdsaRegistration } from './pendingEcdsaRegistrationRecoveryUnlock';

export type PendingNearProvisioningCommit = Extract<
  PendingWalletRegistrationCommitV1,
  { readonly operation: 'near_provisioning'; readonly phase: 'joined' }
>;

type PendingEd25519RegistrationCommit = PendingNearProvisioningCommit;

type FinalizedNearProvisioningResponse = Extract<
  WalletRegistrationNearProvisioningResponseV2,
  { readonly ok: true; readonly kind: 'near_ed25519' }
>;

export type PendingRegistrationRecoveryPorts = {
  readonly listPendingWalletRegistrationCommits: () => Promise<PendingWalletRegistrationCommitV1[]>;
  readonly completeWalletRegistrationNearProvisioning: (
    input: Parameters<typeof completeWalletRegistrationNearProvisioning>[0],
  ) => Promise<WalletRegistrationNearProvisioningResponseV2>;
  readonly publishPendingWalletRegistrationCommit: (
    input: PublishPendingWalletRegistrationCommitInputV1,
  ) => Promise<StoreWalletRegistrationFinalizeBatchResult>;
};

export type PendingRegistrationRecoveryResult =
  | {
      readonly kind: 'published';
      readonly registrationCeremonyId: string;
      readonly walletId: WalletId;
      readonly sessionResult: RegistrationEstablishedSessionResultV2['kind'];
    }
  | {
      readonly kind: 'unlock_required';
      readonly registrationCeremonyId: string;
      readonly walletId: WalletId;
      readonly keyFamilies: PendingEcdsaRegistrationKeyFamilies;
      readonly activationJournalId: PendingEcdsaRegistrationCommit['localMaterial']['ecdsa']['activationJournalId'];
      readonly activationRequestDigestB64u: PendingEcdsaRegistrationCommit['localMaterial']['ecdsa']['activationRequestDigestB64u'];
      readonly clientActivation: PendingEcdsaRegistrationCommit['localMaterial']['ecdsa']['clientActivation'];
      readonly walletAuthMethodId: PendingEcdsaRegistrationCommit['walletAuthMethodId'];
      readonly next: 'unlock_exact_method';
      readonly reason: 'ecdsa_local_finalization';
    }
  | {
      readonly kind: 'unlock_required';
      readonly reason: 'near_provisioning';
      readonly registrationCeremonyId: string;
      readonly walletId: WalletId;
      readonly walletAuthMethodId: PendingWalletRegistrationCommitV1['walletAuthMethodId'];
      readonly next: 'unlock_exact_method';
    }
  | {
      readonly kind: 'failed';
      readonly registrationCeremonyId: string;
      readonly error: Error;
    };

const defaultPendingRegistrationRecoveryPorts: PendingRegistrationRecoveryPorts = {
  listPendingWalletRegistrationCommits: listPendingWalletRegistrationCommits,
  completeWalletRegistrationNearProvisioning: completePendingWalletRegistrationNearProvisioning,
  publishPendingWalletRegistrationCommit: publishPendingWalletRegistrationCommit,
};

async function listPendingWalletRegistrationCommits(): Promise<
  PendingWalletRegistrationCommitV1[]
> {
  await IndexedDBManager.initialize();
  return await IndexedDBManager.listPendingWalletRegistrationCommits();
}

async function completePendingWalletRegistrationNearProvisioning(
  input: Parameters<typeof completeWalletRegistrationNearProvisioning>[0],
): Promise<WalletRegistrationNearProvisioningResponseV2> {
  return await completeWalletRegistrationNearProvisioning(input);
}

async function activatePendingWalletRegistration(
  input: Parameters<typeof activateWalletRegistration>[0],
): ReturnType<typeof activateWalletRegistration> {
  return await activateWalletRegistration(input);
}

async function publishPendingWalletRegistrationCommit(
  input: PublishPendingWalletRegistrationCommitInputV1,
): Promise<StoreWalletRegistrationFinalizeBatchResult> {
  return await IndexedDBManager.publishPendingWalletRegistrationCommit(input);
}

function asError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error(String(error || 'pending registration replay failed'));
}

function isNearProvisioningEd25519Commit(
  pending: PendingWalletRegistrationCommitV1,
): pending is PendingNearProvisioningCommit {
  return pending.operation === 'near_provisioning' && pending.phase === 'joined';
}

function pendingCustodyMaterial(
  pending: PendingEd25519RegistrationCommit,
  finalized: FinalizedNearProvisioningResponse,
): LoadedWalletCustodyEd25519MaterialV1 {
  const metadata = pending.localMaterial.ed25519.metadata;
  const localMaterial = pending.localMaterial.ed25519.localMaterial;
  return {
    binding: {
      kind: WALLET_CUSTODY_ED25519_MATERIAL_KEY_KIND,
      applicationBindingDigestB64u: localMaterial.applicationBindingDigestB64u,
      registeredPublicKeyB64u: metadata.registeredPublicKeyB64u,
      participantIds: metadata.participantIds,
      stateEpoch: metadata.stateEpoch,
      walletId: String(finalized.walletId),
      nearAccountId: finalized.ed25519.nearAccountId,
      nearEd25519SigningKeyId: finalized.ed25519.nearEd25519SigningKeyId,
      signerSlot: finalized.ed25519.signerSlot,
      signingWorkerId: metadata.signingWorkerId,
      signingWorkerVerifyingShareB64u: metadata.signingWorkerVerifyingShareB64u,
    },
    sealed: {
      ciphertextB64u: localMaterial.b64u,
      nonceB64u: localMaterial.nonceB64u,
    },
  };
}

function registeredPublicKeyFromPending(pending: PendingEd25519RegistrationCommit): string {
  const publicKey = base64UrlDecode(pending.localMaterial.ed25519.metadata.registeredPublicKeyB64u);
  if (publicKey.length !== 32) {
    throw new Error('pending registration has an invalid Ed25519 registered public key');
  }
  return `ed25519:${base58Encode(publicKey)}`;
}

function assertFinalizedSignerMatchesPending(
  pending: PendingEd25519RegistrationCommit,
  finalized: FinalizedNearProvisioningResponse,
  clientPublicKey: string,
): void {
  const metadata = pending.localMaterial.ed25519.metadata;
  const commit = pending.localMaterial.custodyCommit;
  if (pending.auth.kind === 'passkey') {
    const passkey = requireEd25519YaoRegistrationPublicResultMatches({
      clientPublicKey,
      finalized,
      expectedRpId: pending.auth.rpId,
      expectedWalletId: pending.walletId,
    });
    if (passkey.credentialIdB64u !== pending.auth.credentialIdB64u) {
      throw new Error('pending registration returned a different Passkey credential');
    }
  } else {
    requireEmailOtpEd25519YaoRegistrationPublicResultMatches({
      clientPublicKey,
      finalized,
      expectedRegistrationAuthorityId: pending.auth.registrationAuthorityId,
      expectedWalletId: pending.walletId,
    });
  }
  if (
    finalized.foundingAuthMethod.walletAuthMethodId !== pending.walletAuthMethodId ||
    finalized.foundingAuthMethod.walletId !== pending.walletId ||
    finalized.foundingAuthority.walletId !== pending.walletId ||
    finalized.ed25519.signerSlot !== metadata.signerSlot ||
    finalized.ed25519.nearEd25519SigningKeyId !== metadata.nearEd25519SigningKeyId ||
    finalized.ed25519.participantIds[0] !== metadata.participantIds[0] ||
    finalized.ed25519.participantIds[1] !== metadata.participantIds[1] ||
    finalized.ed25519.routerAbNormalSigning.signingWorkerId !== metadata.signingWorkerId ||
    finalized.ed25519.relayerKeyId !== finalized.ed25519.routerAbNormalSigning.signingWorkerId ||
    finalized.custodyKeyManifestDigestB64u !== commit.keyManifestDigestB64u ||
    (commit.registeredPublicKeyB64u !== undefined &&
      commit.registeredPublicKeyB64u !== metadata.registeredPublicKeyB64u)
  ) {
    throw new Error('pending registration does not match the committed NEAR projection');
  }
  assertPendingWalletRegistrationIdentity(pending, {
    operation: pending.operation,
    walletId: finalized.walletId,
    walletAuthMethodId: finalized.foundingAuthMethod.walletAuthMethodId,
    authority: finalized.authority,
  });
}

function assertEd25519SessionProjectionMatchesPending(
  pending: PendingEd25519RegistrationCommit,
  finalized: FinalizedNearProvisioningResponse,
): void {
  const sessionResult = finalized.registrationEstablishedSession;
  const session = sessionResult.session;
  const ed25519 =
    session.tokens.kind === 'near_ed25519' ||
    session.tokens.kind === 'near_ed25519_and_evm_family_ecdsa'
      ? session.tokens.ed25519
      : null;
  const metadata = pending.localMaterial.ed25519.metadata;
  if (
    session.walletId !== pending.walletId ||
    !ed25519 ||
    ed25519.nearAccountId !== finalized.ed25519.nearAccountId ||
    ed25519.nearEd25519SigningKeyId !== finalized.ed25519.nearEd25519SigningKeyId ||
    ed25519.routerAbNormalSigning.signingWorkerId !== metadata.signingWorkerId ||
    !mpcMaterialActivationRefsEqual(ed25519.materialActivation, metadata.materialActivation)
  ) {
    throw new Error('pending registration does not match the committed Wallet Session projection');
  }
}

function assertNearRegistrationSessionMatchesPending(
  pending: PendingNearProvisioningCommit,
  finalized: FinalizedNearProvisioningResponse,
): void {
  assertEd25519SessionProjectionMatchesPending(pending, finalized);
  const sessionResult = finalized.registrationEstablishedSession;
  if (sessionResult.kind === 'issued') {
    if (
      sessionResult.session.walletSession.walletId !== pending.walletId ||
      sessionResult.session.walletSession.authMethodId !== pending.walletAuthMethodId
    ) {
      throw new Error('pending registration issued a Wallet Session for another auth method');
    }
    return;
  }
  if (sessionResult.next !== 'unlock_exact_method') {
    throw new Error('pending registration replay has an invalid continuation');
  }
}

function requireFinalizedEd25519Response(
  pending: PendingEd25519RegistrationCommit,
  response: WalletRegistrationNearProvisioningResponseV2,
  expectedCustodyStatus: 'committed' | 'joined',
): FinalizedNearProvisioningResponse {
  if (!response.ok || response.kind !== 'near_ed25519') {
    throw new Error(
      response.ok
        ? 'pending registration replay returned a different signer branch'
        : `pending registration replay failed: ${response.code}`,
    );
  }
  if (response.walletCustody?.status !== expectedCustodyStatus) {
    throw new Error('pending registration replay did not commit the expected wallet custody');
  }
  const clientPublicKey = registeredPublicKeyFromPending(pending);
  assertFinalizedSignerMatchesPending(pending, response, clientPublicKey);
  return response;
}

function requireFinalizedNearProvisioningResponse(
  pending: PendingNearProvisioningCommit,
  response: WalletRegistrationNearProvisioningResponseV2,
): FinalizedNearProvisioningResponse {
  const finalized = requireFinalizedEd25519Response(
    pending,
    response,
    pending.signerPlanKind === 'near_ed25519' ? 'committed' : 'joined',
  );
  if (
    pending.signerPlanKind === 'near_ed25519_and_evm_family_ecdsa' &&
    (finalized.registrationEstablishedSession.kind !== 'already_committed' ||
      finalized.registrationEstablishedSession.session.tokens.kind !==
        'near_ed25519_and_evm_family_ecdsa')
  ) {
    throw new Error('NEAR completion must extend the committed ECDSA session');
  }
  assertNearRegistrationSessionMatchesPending(pending, finalized);
  return finalized;
}

export async function registrationProjectionFromPending(
  pending: PendingEd25519RegistrationCommit,
  finalized: FinalizedNearProvisioningResponse,
): Promise<StoreWalletRegistrationPublicationInputV1> {
  const clientPublicKey = registeredPublicKeyFromPending(pending);
  const common = {
    walletId: pending.walletId,
    nearAccountId: toAccountId(finalized.ed25519.nearAccountId),
    nearEd25519SigningKeyId: finalized.ed25519.nearEd25519SigningKeyId,
    signerSlot: finalized.ed25519.signerSlot,
    operationalPublicKey: clientPublicKey,
    relayerKeyId: finalized.ed25519.relayerKeyId,
    keyVersion: finalized.ed25519.keyVersion,
    participantIds: finalized.ed25519.participantIds,
    custodyMaterial: pendingCustodyMaterial(pending, finalized),
  } as const;
  if (pending.auth.kind === 'passkey') {
    if (finalized.authMethod.kind !== 'passkey') {
      throw new Error('pending Passkey registration replay returned a non-Passkey auth method');
    }
    return prepareWalletEd25519RegistrationProjectionPublication({
      ...common,
      rpId: pending.auth.rpId,
      credentialIdB64u: pending.auth.credentialIdB64u,
      credentialPublicKeyB64u: finalized.authMethod.credentialPublicKeyB64u,
      transports: pending.auth.transports,
    });
  }
  if (finalized.authMethod.kind !== 'email_otp') {
    throw new Error('pending Email OTP registration replay returned a non-Email OTP auth method');
  }
  const authority = parseEmailOtpWalletAuthAuthority(finalized.authority);
  if (!authority) {
    throw new Error('pending Email OTP registration replay returned an invalid authority');
  }
  return await prepareWalletEmailOtpEd25519RegistrationPublication({
    ...common,
    email: pending.auth.email,
    registrationAuthorityId: pending.auth.registrationAuthorityId,
    authority,
  });
}

function publicationInputFromPending(
  pending: PendingEd25519RegistrationCommit,
  finalized: FinalizedNearProvisioningResponse,
  registration: StoreWalletRegistrationPublicationInputV1,
): PublishPendingWalletRegistrationCommitInputV1 {
  return {
    pending,
    authority: finalized.authority,
    foundingAuthority: {
      authority: finalized.foundingAuthority,
      authMethod: finalized.foundingAuthMethod,
    },
    request: {
      operation: pending.operation,
      registrationCeremonyId: pending.registrationCeremonyId,
      idempotencyKey: pending.idempotencyKey,
      walletId: pending.walletId,
      walletAuthMethodId: pending.walletAuthMethodId,
    },
    ecdsaContinuity: [],
    walletSessionPublication:
      finalized.registrationEstablishedSession.kind === 'issued'
        ? {
            kind: 'issued',
            walletSession: finalized.registrationEstablishedSession.session.walletSession,
            operationCredential:
              finalized.registrationEstablishedSession.session.operationCredential,
          }
        : {
            kind: 'credential_free_projection',
            walletSession: finalized.registrationEstablishedSession.session.walletSession,
          },
    registration,
  };
}

function pendingNearProvisioningAuth(
  pending: PendingEd25519RegistrationCommit,
): Parameters<typeof completeWalletRegistrationNearProvisioning>[0]['auth'] {
  switch (pending.auth.kind) {
    case 'passkey':
      return { kind: 'passkey' };
    case 'email_otp':
      return { kind: 'email_otp', enrollment: pending.auth.enrollment };
    default:
      pending.auth satisfies never;
      throw new Error('pending registration has an unsupported auth method');
  }
}

function pendingNearProvisioningRequest(
  relayerUrl: string,
  pending: PendingNearProvisioningCommit,
): Parameters<typeof completeWalletRegistrationNearProvisioning>[0] {
  return {
    relayerUrl,
    registrationCeremonyId: pending.registrationCeremonyId,
    signedSetup: pending.signedSetup,
    idempotencyKey: pending.idempotencyKey,
    ed25519: { activationReference: pending.localMaterial.ed25519.activationReference },
    auth: pendingNearProvisioningAuth(pending),
    walletCustodyCommit: pending.localMaterial.custodyCommit,
  };
}

async function completeCredentialFreePendingNearProvisioning(args: {
  readonly relayerUrl: string;
  readonly pending: PendingNearProvisioningCommit;
  readonly ports: PendingRegistrationRecoveryPorts;
}): Promise<FinalizedNearProvisioningResponse> {
  const request = pendingNearProvisioningRequest(args.relayerUrl, args.pending);
  const response = await args.ports.completeWalletRegistrationNearProvisioning(request);
  return requireFinalizedNearProvisioningResponse(args.pending, response);
}

/** Converts persisted joined material into the current continuation input. */
export async function restorePendingNearRegistrationMaterial(args: {
  readonly relayerUrl: string;
  readonly pending: PendingNearProvisioningCommit;
  readonly operationCredential: WalletSessionOperationCredentialV1;
}) {
  const request = pendingNearProvisioningRequest(args.relayerUrl, args.pending);
  const response = await completeWalletRegistrationNearProvisioning({
    ...request,
    headers: { Authorization: `Bearer ${args.operationCredential.token}` },
  });
  const finalized = requireFinalizedNearProvisioningResponse(args.pending, response);
  const session = finalized.registrationEstablishedSession.session;
  if (session.tokens.kind !== 'near_ed25519_and_evm_family_ecdsa') {
    throw new Error('Persisted mixed registration has no NEAR session');
  }
  const ed25519 = session.tokens.ed25519;
  const bootstrapRequest = parseRouterAbEd25519YaoWarmRecoveryBootstrapRequestV1({
    kind: 'router_ab_ed25519_yao_warm_recovery_bootstrap_request_v1',
    walletId: args.pending.walletId,
    nearAccountId: finalized.ed25519.nearAccountId,
    nearEd25519SigningKeyId: finalized.ed25519.nearEd25519SigningKeyId,
    signerSlot: finalized.ed25519.signerSlot,
    thresholdSessionId: ed25519.thresholdSessionId,
    signingWorkerId: finalized.ed25519.routerAbNormalSigning.signingWorkerId,
    participantIds: finalized.ed25519.participantIds,
  });
  if (!bootstrapRequest.ok) throw new Error(bootstrapRequest.message);
  const bootstrap = await fetch(
    `${args.relayerUrl.replace(/\/$/, '')}${ROUTER_AB_ED25519_YAO_WARM_RECOVERY_BOOTSTRAP_PATH_V1}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.operationCredential.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bootstrapRequest.value),
    },
  );
  const raw: unknown = await bootstrap.json();
  if (!bootstrap.ok || !raw || typeof raw !== 'object') {
    throw new Error('Persisted NEAR registration activation is unavailable');
  }
  const capability = parseEd25519YaoRecoveryCapabilityV1(Reflect.get(raw, 'capability'));
  const pendingMetadata = args.pending.localMaterial.ed25519.metadata;
  if (
    capability.registrationContinuity.kind !== 'registration' ||
    capability.applicationBinding.wallet_id !== args.pending.walletId ||
    capability.applicationBinding.near_ed25519_signing_key_id !==
      pendingMetadata.nearEd25519SigningKeyId ||
    capability.lifecycle.lifecycleId !==
      args.pending.localMaterial.ed25519.activationReference.lifecycle_id ||
    capability.lifecycle.thresholdSessionId !== ed25519.thresholdSessionId ||
    capability.lifecycle.signingWorkerId !== pendingMetadata.signingWorkerId ||
    capability.applicationBinding.key_creation_signer_slot !== pendingMetadata.signerSlot ||
    base64UrlEncode(Uint8Array.from(capability.registeredPublicKey)) !==
      pendingMetadata.registeredPublicKeyB64u ||
    !mpcMaterialActivationRefsEqual(
      capability.materialActivation,
      pendingMetadata.materialActivation,
    )
  )
    throw new Error('Persisted NEAR registration activation changed identity');
  const continuity = capability.registrationContinuity;
  const joined: JoinedWalletCustodyNearEd25519KeySetV1 = {
    commitPayload: args.pending.localMaterial.custodyCommit,
    activationReference: args.pending.localMaterial.ed25519.activationReference,
    localMaterial: args.pending.localMaterial.ed25519.localMaterial,
    metadata: walletCustodyActiveClientMetadataV1({
      material: pendingCustodyMaterial(args.pending, finalized),
      activation: {
        materialActivation: capability.materialActivation,
        lifecycleId: capability.lifecycle.lifecycleId,
        signingRootVersion: capability.lifecycle.rootShareEpoch,
        signingRootId: capability.applicationBinding.signing_root_id,
        signerSetId: capability.lifecycle.signerSetId,
        thresholdSessionId: capability.lifecycle.thresholdSessionId,
        activationTranscriptB64u: base64UrlEncode(Uint8Array.from(continuity.activationTranscript)),
        activationCapabilityBindingB64u: base64UrlEncode(
          Uint8Array.from(capability.activeCapabilityBinding),
        ),
      },
    }),
  };
  return {
    joined,
    admissionRequest: continuity.admissionRequest,
    admissionReceipt: continuity.admissionReceipt,
  };
}

export async function replayPendingNearProvisioning(args: {
  readonly relayerUrl: string;
  readonly pending: PendingNearProvisioningCommit;
  readonly ports: PendingRegistrationRecoveryPorts;
}): Promise<PendingRegistrationRecoveryResult> {
  const finalized = await completeCredentialFreePendingNearProvisioning(args);
  const registration = await registrationProjectionFromPending(args.pending, finalized);
  await args.ports.publishPendingWalletRegistrationCommit(
    publicationInputFromPending(args.pending, finalized, registration),
  );
  return {
    kind: 'published',
    registrationCeremonyId: args.pending.registrationCeremonyId,
    walletId: args.pending.walletId,
    sessionResult: finalized.registrationEstablishedSession.kind,
  };
}

export async function resumePendingNearRegistrations(args: {
  readonly relayerUrl: string;
  readonly ports?: PendingRegistrationRecoveryPorts;
}): Promise<PendingRegistrationRecoveryResult[]> {
  const ports = args.ports || defaultPendingRegistrationRecoveryPorts;
  const pendingRows = await ports.listPendingWalletRegistrationCommits();
  const results: PendingRegistrationRecoveryResult[] = [];
  for (const pending of pendingRows) {
    if (isEcdsaRegistrationCommit(pending) || isMixedEcdsaRegistrationCommit(pending)) {
      results.push({
        kind: 'unlock_required',
        registrationCeremonyId: pending.registrationCeremonyId,
        walletId: pending.walletId,
        keyFamilies: pending.localMaterial.keyFamilies,
        activationJournalId: pending.localMaterial.ecdsa.activationJournalId,
        activationRequestDigestB64u: pending.localMaterial.ecdsa.activationRequestDigestB64u,
        clientActivation: pending.localMaterial.ecdsa.clientActivation,
        walletAuthMethodId: pending.walletAuthMethodId,
        next: 'unlock_exact_method',
        reason: 'ecdsa_local_finalization',
      });
      continue;
    }
    if (
      pending.operation === 'near_provisioning' &&
      pending.signerPlanKind === 'near_ed25519_and_evm_family_ecdsa'
    ) {
      results.push({
        kind: 'unlock_required',
        reason: 'near_provisioning',
        registrationCeremonyId: pending.registrationCeremonyId,
        walletId: pending.walletId,
        walletAuthMethodId: pending.walletAuthMethodId,
        next: 'unlock_exact_method',
      });
      continue;
    }
    if (!isNearProvisioningEd25519Commit(pending)) continue;
    try {
      results.push(
        await replayPendingNearProvisioning({
          relayerUrl: args.relayerUrl,
          pending,
          ports,
        }),
      );
    } catch (error: unknown) {
      results.push({
        kind: 'failed',
        registrationCeremonyId: pending.registrationCeremonyId,
        error: asError(error),
      });
    }
  }
  return results;
}

export type {
  PendingEcdsaRegistrationCommit,
  PendingRegistrationExactMethod,
  PendingRegistrationRecoverySigningSurface,
} from './pendingEcdsaRegistrationRecoveryValidation';
export { isEcdsaRegistrationCommit } from './pendingEcdsaRegistrationRecoveryValidation';
export type { ResumePendingEcdsaRegistrationResult } from './pendingEcdsaRegistrationRecovery';

const defaultPendingEcdsaRegistrationRecoveryPorts: PendingEcdsaRegistrationRecoveryPorts = {
  activateWalletRegistration: activatePendingWalletRegistration,
  publishPendingWalletRegistrationCommit,
  unlockPendingEcdsaRegistration,
};

export type PendingEcdsaRegistrationResumeInput = {
  readonly relayerUrl: string;
  readonly pending: PendingEcdsaRegistrationCommit;
  readonly exactMethod: PendingRegistrationExactMethod;
  readonly signingSurface: PendingRegistrationRecoverySigningSurface;
  readonly ports?: PendingEcdsaRegistrationRecoveryPorts;
};

export type PendingEcdsaRegistrationResumeRequest = {
  readonly walletId: WalletId | string;
  readonly registrationCeremonyId: string;
  readonly exactMethod: PendingRegistrationExactMethod;
};

export async function resumePendingEcdsaRegistration(
  args: PendingEcdsaRegistrationResumeInput,
): Promise<ResumePendingEcdsaRegistrationResult> {
  const ports = args.ports ?? defaultPendingEcdsaRegistrationRecoveryPorts;
  switch (args.exactMethod.kind) {
    case 'passkey':
      return await resumePendingEcdsaRegistrationWithPorts({
        relayerUrl: args.relayerUrl,
        pending: args.pending,
        signingSurface: args.signingSurface,
        exactMethod: args.exactMethod,
        ports,
      });
    case 'email_otp':
      return await resumePendingEcdsaRegistrationWithPorts({
        relayerUrl: args.relayerUrl,
        pending: args.pending,
        signingSurface: args.signingSurface,
        exactMethod: args.exactMethod,
        ports,
      });
    default:
      args.exactMethod satisfies never;
      throw new Error('pending ECDSA registration has an unsupported exact method');
  }
}

export async function resumePendingEcdsaRegistrationFromStoredCommit(args: {
  readonly relayerUrl: string;
  readonly request: PendingEcdsaRegistrationResumeRequest;
  readonly signingSurface: PendingRegistrationRecoverySigningSurface;
}): Promise<ResumePendingEcdsaRegistrationResult> {
  await IndexedDBManager.initialize();
  const pending = (await IndexedDBManager.listPendingWalletRegistrationCommits()).find(
    (candidate) =>
      candidate.operation === 'registration_activate' &&
      String(candidate.walletId) === String(args.request.walletId) &&
      candidate.registrationCeremonyId === args.request.registrationCeremonyId,
  );
  if (!pending) {
    throw new Error('pending ECDSA registration commit was not found');
  }
  if (!isEcdsaRegistrationCommit(pending) && !isMixedEcdsaRegistrationCommit(pending)) {
    throw new Error('pending registration commit is not ECDSA-enabled');
  }
  return await resumePendingEcdsaRegistration({
    relayerUrl: args.relayerUrl,
    pending,
    exactMethod: args.request.exactMethod,
    signingSurface: args.signingSurface,
  });
}
