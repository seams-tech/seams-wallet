import type { WorkerOperationContext } from '../../../workerManager/executeWorkerOperation';
import type {
  HydratedEcdsaSignerMaterial,
  ThresholdEcdsaRoleLocalWorkerShare,
} from '../../../session/identity/evmFamilyEcdsaIdentity';
import {
  storeEcdsaRoleLocalSigningMaterialWasm,
  thresholdEcdsaRoleLocalAdmitPresignatureWasm,
  thresholdEcdsaRoleLocalDestroyPresignatureWasm,
  thresholdEcdsaRoleLocalReservePresignatureWasm,
  thresholdEcdsaRoleLocalCommitPresignatureWasm,
  thresholdEcdsaListAvailablePresignaturesWasm,
  thresholdEcdsaRoleLocalComputeSignatureShareFromPresignatureHandleWasm,
  thresholdEcdsaRoleLocalPresignSessionAbortWasm,
  thresholdEcdsaRoleLocalPresignSessionInitFromMaterialHandleWasm,
  thresholdEcdsaRoleLocalPresignSessionStepWasm,
  thresholdEcdsaLinkedHolderPresignSessionInitWasm,
} from '../../../threshold/crypto/ecdsaDerivationClientWasm';
import type { RouterAbEcdsaDerivationClientSigningMaterialSource } from '../../../routerAb/ecdsaDerivation/presignaturePool';

export type LoadedRouterAbEcdsaDerivationSigningMaterialSource = {
  signerSession: HydratedEcdsaSignerMaterial;
  clientSigningMaterial: RouterAbEcdsaDerivationClientSigningMaterialSource;
  cleanupAfterSign: (args: { singleUseEmailOtpSession: boolean }) => Promise<void>;
};

async function ensureRoleLocalSigningMaterialLoaded(args: {
  workerCtx: WorkerOperationContext;
  clientShare: ThresholdEcdsaRoleLocalWorkerShare;
}): Promise<void> {
  const material = args.clientShare.material;
  if (material.kind === 'worker_loaded') return;
  const stored = await storeEcdsaRoleLocalSigningMaterialWasm({
    materialHandle: args.clientShare.handle.materialHandle,
    bindingDigest: args.clientShare.handle.bindingDigest,
    stateBlob: material.stateBlob,
    workerCtx: args.workerCtx,
  });
  if (
    stored.materialHandle !== args.clientShare.handle.materialHandle ||
    stored.bindingDigest !== args.clientShare.handle.bindingDigest
  ) {
    throw new Error('[multichain] ECDSA role-local worker material handle mismatch');
  }
}

export async function loadRouterAbEcdsaDerivationSigningMaterialSource(args: {
  signerSession: HydratedEcdsaSignerMaterial;
  workerCtx: WorkerOperationContext;
}): Promise<LoadedRouterAbEcdsaDerivationSigningMaterialSource> {
  const signerSession = args.signerSession;
  const clientShare = signerSession.clientShare;

  if (clientShare.kind === 'linked_holder_worker_share') {
    const holderHandleId = clientShare.holderHandleId;
    return {
      signerSession,
      clientSigningMaterial: createLinkedHolderClientSigningMaterialSource(holderHandleId),
      cleanupAfterSign: async () => undefined,
    };
  }
  const roleLocalClientShare = clientShare;

  return {
    signerSession,
    clientSigningMaterial: {
      kind: 'router_ab_ecdsa_derivation_client_signing_material_source_v1',
      initClientPresignSession: async (input) => {
        await ensureRoleLocalSigningMaterialLoaded({
          workerCtx: args.workerCtx,
          clientShare: roleLocalClientShare,
        });
        return await thresholdEcdsaRoleLocalPresignSessionInitFromMaterialHandleWasm({
          materialHandle: roleLocalClientShare.handle.materialHandle,
          material:
            roleLocalClientShare.material.kind === 'worker_loaded'
              ? {
                  kind: 'persisted',
                  materialRef: roleLocalClientShare.material.materialRef,
                }
              : {
                  kind: 'runtime_loaded',
                  expectedBindingDigest: roleLocalClientShare.handle.bindingDigest,
                },
          ...input,
        });
      },
      stepClientPresignSession: thresholdEcdsaRoleLocalPresignSessionStepWasm,
      abortClientPresignSession: thresholdEcdsaRoleLocalPresignSessionAbortWasm,
      admitClientPresignature: thresholdEcdsaRoleLocalAdmitPresignatureWasm,
      destroyClientPresignature: thresholdEcdsaRoleLocalDestroyPresignatureWasm,
      reserveClientPresignature: thresholdEcdsaRoleLocalReservePresignatureWasm,
      commitClientPresignature: thresholdEcdsaRoleLocalCommitPresignatureWasm,
      listAvailableClientPresignatures: thresholdEcdsaListAvailablePresignaturesWasm.bind(
        undefined,
        'role_local_derivation_handle',
      ),
      computeSignatureShareFromPresignatureHandle:
        thresholdEcdsaRoleLocalComputeSignatureShareFromPresignatureHandleWasm,
    },
    cleanupAfterSign: async () => undefined,
  };
}

async function initLinkedHolderPresignSession(
  holderHandleId: string,
  input: Parameters<
    RouterAbEcdsaDerivationClientSigningMaterialSource['initClientPresignSession']
  >[0],
) {
  return await thresholdEcdsaLinkedHolderPresignSessionInitWasm({ holderHandleId, ...input });
}

export function createLinkedHolderClientSigningMaterialSource(
  holderHandleId: string,
): RouterAbEcdsaDerivationClientSigningMaterialSource {
  return {
    kind: 'router_ab_ecdsa_derivation_client_signing_material_source_v1',
    initClientPresignSession: initLinkedHolderPresignSession.bind(undefined, holderHandleId),
    stepClientPresignSession: thresholdEcdsaRoleLocalPresignSessionStepWasm,
    abortClientPresignSession: thresholdEcdsaRoleLocalPresignSessionAbortWasm,
    admitClientPresignature: thresholdEcdsaRoleLocalAdmitPresignatureWasm,
    destroyClientPresignature: thresholdEcdsaRoleLocalDestroyPresignatureWasm,
    reserveClientPresignature: thresholdEcdsaRoleLocalReservePresignatureWasm,
    commitClientPresignature: thresholdEcdsaRoleLocalCommitPresignatureWasm,
    listAvailableClientPresignatures: thresholdEcdsaListAvailablePresignaturesWasm.bind(
      undefined,
      'linked_holder_signing_material',
    ),
    computeSignatureShareFromPresignatureHandle:
      thresholdEcdsaRoleLocalComputeSignatureShareFromPresignatureHandleWasm,
  };
}
