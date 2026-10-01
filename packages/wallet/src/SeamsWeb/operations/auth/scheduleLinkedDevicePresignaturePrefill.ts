import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking';
import { routerAbMpcMaterialActivationRefToWire } from '@shared/utils/routerAbNormalSigningIdentity';
import { createLinkedHolderClientSigningMaterialSource } from '@/core/signingEngine/flows/signEvmFamily/signers/ecdsaDerivationClientSigningMaterialSource';
import { scheduleRouterAbEcdsaDerivationClientPresignaturePoolRefill } from '@/core/signingEngine/routerAb/ecdsaDerivation/presignaturePool';
import { buildRouterAbEcdsaDerivationSigningMaterialRef } from '@/core/signingEngine/routerAb/ecdsaDerivation/signingMaterialRef';
import { deriveEvmFamilyEcdsaKeyHandle } from '@/core/signingEngine/session/identity/evmFamilyEcdsaIdentity';
import { parseEcdsaKeyHandle } from '@/core/signingEngine/session/keyMaterialBrands';
import {
  resolveLinkedEcdsaHolderRuntimeV1,
  type LinkedEcdsaHolderRuntimeV1,
} from '@/core/signingEngine/session/material/linkedEcdsaHolderRuntime';
import { emitSigningSessionFlowTrace } from '@/core/signingEngine/session/operationState/trace';
import { MAX_DURABLE_CLIENT_PRESIGNATURE_LIFETIME_MS } from '@/core/signingEngine/workerManager/ecdsaPresignLifecycle';
import type { WorkerOperationContext } from '@/core/signingEngine/workerManager/executeWorkerOperation';

export async function scheduleLinkedDevicePresignaturePrefill(args: {
  runtime: LinkedEcdsaHolderRuntimeV1;
  operationCredential: WalletSessionOperationCredentialV1;
  expiresAtMs: number;
  relayerUrl: string;
  workerCtx: WorkerOperationContext;
}): Promise<void> {
  try {
    const scope = args.runtime.activationReceipt.normalSigning.scope;
    const material = buildRouterAbEcdsaDerivationSigningMaterialRef({
      routerAbState: args.runtime.activationReceipt.normalSigning,
    });
    const keyHandle = await deriveEvmFamilyEcdsaKeyHandle({
      ecdsaThresholdKeyId: scope.ecdsa_threshold_key_id,
      signingRootId: scope.signing_root_id,
      signingRootVersion: scope.signing_root_version,
    });
    if (resolveLinkedEcdsaHolderRuntimeV1(args.runtime) !== args.runtime) return;
    const result = scheduleRouterAbEcdsaDerivationClientPresignaturePoolRefill({
      relayerUrl: args.relayerUrl,
      keyHandle: parseEcdsaKeyHandle(keyHandle),
      ecdsaThresholdKeyId: material.ecdsaThresholdKeyId,
      clientVerifyingShareB64u: material.clientVerifier33B64u,
      clientSigningMaterial: createLinkedHolderClientSigningMaterialSource(
        args.runtime.holderHandleId,
      ),
      thresholdEcdsaPublicKeyB64u: material.thresholdVerifier33B64u,
      relayerVerifyingShareB64u: material.serverVerifier33B64u,
      credential: {
        kind: 'wallet_session_opaque',
        walletSessionToken: args.operationCredential.token,
      },
      authorization: {
        kind: 'reusable_wallet_session',
        wallet_session_id: args.operationCredential.walletSessionId,
      },
      materialActivation: routerAbMpcMaterialActivationRefToWire(args.runtime.materialActivation),
      routerAbEcdsaDerivationPoolFill: {
        kind: 'router_ab_ecdsa_derivation_signing_worker_pool',
        scope,
        ceremonyExpiresAtMs: args.expiresAtMs,
        materialExpiresAtMs: Date.now() + MAX_DURABLE_CLIENT_PRESIGNATURE_LIFETIME_MS,
      },
      workerCtx: args.workerCtx,
    });
    emitSigningSessionFlowTrace('evm-family', {
      event: 'ecdsa_linked_device_prefill',
      scheduled: result.scheduled,
      reason: result.reason,
      depth: result.depth,
      targetDepth: result.targetDepth,
    });
  } catch {
    emitSigningSessionFlowTrace('evm-family', {
      event: 'ecdsa_linked_device_prefill',
      scheduled: false,
      reason: 'unexpected_error',
    });
  }
}
