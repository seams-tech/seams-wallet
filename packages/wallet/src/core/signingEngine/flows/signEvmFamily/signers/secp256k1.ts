import type { SignRequest, SignatureBytes } from '../../../interfaces/signing';
import type { WorkerOperationContext } from '../../../workerManager/executeWorkerOperation';
import {
  scheduleRouterAbEcdsaDerivationClientPresignaturePoolRefill,
  signRouterAbEcdsaDerivationDigestWithPool,
} from '../../../routerAb/ecdsaDerivation/presignaturePool';
import { MAX_DURABLE_CLIENT_PRESIGNATURE_LIFETIME_MS } from '@/core/config/presignatures';
import {
  loadRouterAbEcdsaDerivationSigningMaterialSource,
  type LoadedRouterAbEcdsaDerivationSigningMaterialSource,
} from './ecdsaDerivationClientSigningMaterialSource';
import { parseEcdsaKeyHandle } from '../../../session/keyMaterialBrands';
import type { EvmFamilyThresholdEcdsaOperation } from '../thresholdAdmission';
import type {
  ReadySecp256k1SigningMaterial,
  ReusableEcdsaSigningAuthorization,
} from '../readySecp256k1Material';
import { routerAbMpcMaterialActivationRefToWire } from '@shared/utils/routerAbNormalSigningIdentity';
import type { OperationDigestSet } from '@shared/authorization/operationFingerprint';
import type { RouterAbOwnerNormalSigningCredential } from '@/core/rpcClients/relayer/routerAbNormalSigning';
import {
  emitEcdsaSigningTiming,
  emitSigningSessionFlowTrace,
} from '../../../session/operationState/trace';

type Secp256k1DigestSignRequest = Extract<SignRequest, { kind: 'digest' }> & {
  algorithm: 'secp256k1';
};

function isSecp256k1DigestSignRequest(req: SignRequest): req is Secp256k1DigestSignRequest {
  return req.kind === 'digest' && req.algorithm === 'secp256k1';
}

function requireEvmSigningOperationId(operation: EvmFamilyThresholdEcdsaOperation): string {
  const operationId = String(operation.intent.operationId || '').trim();
  if (!operationId) {
    throw new Error('[multichain] exact EVM signing operation id is required');
  }
  return operationId;
}

function routerAbTransportCredential(
  credential: ReadySecp256k1SigningMaterial['credential'],
): RouterAbOwnerNormalSigningCredential {
  switch (credential.kind) {
    case 'reusable_wallet_session':
      return { kind: 'wallet_session_opaque', walletSessionToken: credential.walletSessionToken };
    case 'operation_step_up':
      return {
        kind: 'wallet_session_opaque',
        walletSessionToken: credential.walletSessionToken,
      };
  }
  credential satisfies never;
  throw new Error('[multichain] unsupported ECDSA signing credential');
}

function scheduleRouterAbEcdsaDerivationSigningRefill(args: {
  operationId: string;
  loadedMaterial: LoadedRouterAbEcdsaDerivationSigningMaterialSource;
  workerCtx: WorkerOperationContext;
  credential: RouterAbOwnerNormalSigningCredential;
  expiresAtMs: number;
  authorization: ReusableEcdsaSigningAuthorization;
}): void {
  const signerSession = args.loadedMaterial.signerSession;
  const publicFacts = signerSession.publicFacts;
  const signingMaterial = signerSession.transport.signingMaterial;
  const result = scheduleRouterAbEcdsaDerivationClientPresignaturePoolRefill({
    relayerUrl: signerSession.transport.relayerUrl,
    keyHandle: parseEcdsaKeyHandle(publicFacts.keyHandle),
    ecdsaThresholdKeyId: signingMaterial.ecdsaThresholdKeyId,
    clientVerifyingShareB64u: signingMaterial.clientVerifier33B64u,
    clientSigningMaterial: args.loadedMaterial.clientSigningMaterial,
    thresholdEcdsaPublicKeyB64u: publicFacts.publicKeyB64u,
    relayerVerifyingShareB64u: signerSession.transport.relayerVerifyingShareB64u,
    credential: args.credential,
    materialActivation: routerAbMpcMaterialActivationRefToWire(signerSession.materialActivation),
    routerAbEcdsaDerivationPoolFill: {
      kind: 'router_ab_ecdsa_derivation_signing_worker_pool',
      scope: signerSession.routerAbEcdsaDerivationNormalSigning.state.scope,
      ceremonyExpiresAtMs: args.expiresAtMs,
      materialExpiresAtMs: Date.now() + MAX_DURABLE_CLIENT_PRESIGNATURE_LIFETIME_MS,
    },
    workerCtx: args.workerCtx,
    authorization: args.authorization,
  });
  emitSigningSessionFlowTrace('evm-family', {
    event: 'ecdsa_signing_refill',
    operationId: args.operationId,
    scheduled: result.scheduled,
    reason: result.reason,
    depth: result.depth,
    targetDepth: result.targetDepth,
  });
}

export class Secp256k1Engine {
  readonly algorithm = 'secp256k1' as const;

  private readonly beforeSigning?: () => void;
  private readonly shouldAbort?: () => boolean;
  private readonly workerCtx: WorkerOperationContext;

  constructor(opts: {
    beforeSigning?: () => void;
    getRpId?: () => string | null;
    shouldAbort?: () => boolean;
    workerCtx: WorkerOperationContext;
  }) {
    this.beforeSigning = opts.beforeSigning;
    this.shouldAbort = opts.shouldAbort;
    this.workerCtx = opts.workerCtx;
  }

  private async signReadySecp256k1Digest(
    req: Secp256k1DigestSignRequest,
    material: ReadySecp256k1SigningMaterial,
    operation: EvmFamilyThresholdEcdsaOperation,
    operationDigests: OperationDigestSet,
  ): Promise<SignatureBytes> {
    const operationId = requireEvmSigningOperationId(operation);
    const signStartedAt = performance.now();
    const loadedMaterial = await loadRouterAbEcdsaDerivationSigningMaterialSource({
      signerSession: material.signerSession,
      workerCtx: this.workerCtx,
    });
    emitEcdsaSigningTiming(operationId, 'material_load', signStartedAt);
    const signerSession = loadedMaterial.signerSession;
    const publicFacts = signerSession.publicFacts;
    const signerTransport = signerSession.transport;
    const transportCredential = routerAbTransportCredential(material.credential);
    let signatureCreated = false;

    try {
      const signingInput = {
        relayerUrl: signerTransport.relayerUrl,
        scope: signerSession.routerAbEcdsaDerivationNormalSigning.state.scope,
        operationId,
        operationDigests: {
          lane_digest_b64u: operationDigests.laneDigest,
          intent_digest_b64u: operationDigests.intentDigest,
          display_digest_b64u: operationDigests.displayDigest,
        },
        materialActivation: routerAbMpcMaterialActivationRefToWire(
          signerSession.materialActivation,
        ),
        credential: transportCredential,
        keyHandle: parseEcdsaKeyHandle(publicFacts.keyHandle),
        signingDigest32: req.digest32,
        clientSigningMaterial: loadedMaterial.clientSigningMaterial,
        expiresAtMs: material.expiresAtMs,
        workerCtx: this.workerCtx,
      } as const;
      this.beforeSigning?.();
      if (material.authorization.kind === 'reusable_wallet_session') {
        scheduleRouterAbEcdsaDerivationSigningRefill({
          operationId,
          loadedMaterial,
          workerCtx: this.workerCtx,
          credential: transportCredential,
          expiresAtMs: material.expiresAtMs,
          authorization: material.authorization,
        });
      } else {
        emitSigningSessionFlowTrace('evm-family', {
          event: 'ecdsa_signing_refill',
          operationId,
          scheduled: false,
          reason: 'operation_step_up',
        });
      }
      let signed;
      if (material.authorization.kind === 'reusable_wallet_session') {
        signed = await signRouterAbEcdsaDerivationDigestWithPool({
          ...signingInput,
          authorization: material.authorization,
        });
      } else {
        const operationStepUpPreparation = material.operationStepUpPreparation;
        if (!operationStepUpPreparation) {
          throw new Error('[multichain] operation step-up preparation is required for signing');
        }
        signed = await signRouterAbEcdsaDerivationDigestWithPool({
          ...signingInput,
          authorization: material.authorization,
          operation: operationStepUpPreparation,
        });
      }
      if (!signed.ok) {
        throw new Error(
          signed.message ||
            signed.code ||
            '[multichain] Router A/B ECDSA derivation signing failed',
        );
      }

      signatureCreated = true;
      return signed.signature65;
    } finally {
      await loadedMaterial.cleanupAfterSign({
        singleUseEmailOtpSession: material.singleUseEmailOtpSession,
      });
      emitEcdsaSigningTiming(
        operationId,
        'sign_total',
        signStartedAt,
        signatureCreated ? 'succeeded' : 'failed',
      );
    }
  }

  async signReady(
    req: SignRequest,
    material: ReadySecp256k1SigningMaterial,
    operation: EvmFamilyThresholdEcdsaOperation,
    operationDigests: OperationDigestSet,
  ): Promise<SignatureBytes> {
    if (!isSecp256k1DigestSignRequest(req)) {
      throw new Error('[Secp256k1Engine] unsupported sign request');
    }
    if (req.digest32.length !== 32) {
      throw new Error('[Secp256k1Engine] digest32 must be 32 bytes');
    }
    if (this.shouldAbort?.()) {
      const aborted = new Error('Request cancelled') as Error & { code: 'cancelled' };
      aborted.code = 'cancelled';
      throw aborted;
    }
    return await this.signReadySecp256k1Digest(req, material, operation, operationDigests);
  }
}
