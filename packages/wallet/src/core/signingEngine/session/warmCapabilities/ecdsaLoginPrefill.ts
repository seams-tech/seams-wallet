import type {
  RouterAbEcdsaDerivationPresignaturePoolPolicy,
  RouterAbEcdsaDerivationPresignaturePoolPolicyInput,
} from '@/core/types/seams';
import {
  getRouterAbEcdsaDerivationClientPresignaturePoolDepth,
  resolveRouterAbEcdsaDerivationPresignaturePoolPolicy,
  scheduleRouterAbEcdsaDerivationClientPresignaturePoolRefill,
  waitForRouterAbEcdsaDerivationClientPresignaturePoolReady,
  type RouterAbEcdsaDerivationClientSigningMaterialSource,
  type RouterAbEcdsaDerivationClientPresignatureRefillScheduleResult,
} from '../../routerAb/ecdsaDerivation/presignaturePool';
import { MAX_DURABLE_CLIENT_PRESIGNATURE_LIFETIME_MS } from '../../workerManager/ecdsaPresignLifecycle';
import type { SignerWorkerManagerContext } from '../../workerManager/SignerWorkerManager';
import {
  LOGIN_PREFILL_MIN_REMAINING_USES,
  LOGIN_PREFILL_TARGET_DEPTH,
  LOGIN_PREFILL_TRIGGER_DEPTH,
} from '@/core/config/defaultConfigs';
import type { ActiveEcdsaCapabilityManifest } from '../material/ecdsaCapabilityManifest';
import type { AuthorizedEvmFamilyEcdsaSigningCapability } from '../material/ecdsaSigningCapability';
import type { WalletSessionId } from '@shared/authorization/capabilityKinds';
import {
  parseEcdsaClientVerifyingShareB64u,
  parseEcdsaKeyHandle,
  parseEcdsaThresholdKeyId,
} from '../keyMaterialBrands';
import { routerAbMpcMaterialActivationRefToWire } from '@shared/utils/routerAbNormalSigningIdentity';

export type RouterAbEcdsaDerivationLoginPresignaturePrefillResult =
  | {
      status: 'scheduled';
      reason: 'scheduled';
      walletSessionId: WalletSessionId;
      remainingUses: number;
      schedule: RouterAbEcdsaDerivationClientPresignatureRefillScheduleResult;
    }
  | {
      status: 'skipped';
      reason: 'exact_wallet_session_unavailable';
      walletSessionId: null;
    }
  | {
      status: 'skipped';
      reason: 'pool_disabled' | 'pool_already_warm' | 'session_expired';
      walletSessionId: WalletSessionId;
    }
  | {
      status: 'skipped';
      reason: 'low_remaining_uses';
      walletSessionId: WalletSessionId;
      remainingUses: number;
    }
  | {
      status: 'skipped';
      reason: 'refill_not_scheduled';
      walletSessionId: WalletSessionId;
      remainingUses: number;
      schedule: RouterAbEcdsaDerivationClientPresignatureRefillScheduleResult;
    }
  | {
      status: 'failed';
      reason: 'unexpected_error';
      walletSessionId: WalletSessionId;
      error: string;
    };

export type RouterAbEcdsaDerivationLoginPresignaturePrefillDeps = {
  getSignerWorkerContext: () => SignerWorkerManagerContext;
  resolveClientSigningMaterialSource: (args: {
    manifest: ActiveEcdsaCapabilityManifest;
  }) => RouterAbEcdsaDerivationClientSigningMaterialSource;
  routerAbEcdsaDerivationPresignaturePoolPolicy?:
    | RouterAbEcdsaDerivationPresignaturePoolPolicyInput
    | RouterAbEcdsaDerivationPresignaturePoolPolicy;
};

export type EcdsaSessionPresignaturePrefillInput = {
  capability: AuthorizedEvmFamilyEcdsaSigningCapability;
  minRemainingUsesBeforePrefill?: number;
  waitForPoolReady?: boolean;
};

export async function scheduleRouterAbEcdsaDerivationLoginPresignaturePrefill(
  deps: RouterAbEcdsaDerivationLoginPresignaturePrefillDeps,
  args: EcdsaSessionPresignaturePrefillInput,
): Promise<RouterAbEcdsaDerivationLoginPresignaturePrefillResult> {
  const { runtime, session, operationCredential } = args.capability.authorization;
  const walletSessionId = operationCredential.walletSessionId;
  try {
    const relayerUrl = runtime.relayerUrl;
    const clientVerifyingPublicKey33B64u = runtime.clientVerifyingPublicKey33B64u;
    const nowMs = Date.now();
    const routerAbPoolFillExpiresAtMs = Math.min(
      runtime.expiresAtMs,
      session.expiresAtMs,
      nowMs + 60_000,
    );
    if (routerAbPoolFillExpiresAtMs <= nowMs) {
      return { status: 'skipped', reason: 'session_expired', walletSessionId };
    }
    const policy = resolveRouterAbEcdsaDerivationPresignaturePoolPolicy(
      deps.routerAbEcdsaDerivationPresignaturePoolPolicy,
    );
    if (!policy.enabled) {
      return { status: 'skipped', reason: 'pool_disabled', walletSessionId };
    }
    const existingDepth = getRouterAbEcdsaDerivationClientPresignaturePoolDepth({
      relayerUrl,
      scope: runtime.normalSigning.scope,
      materialActivation: routerAbMpcMaterialActivationRefToWire(runtime.materialActivation),
    });
    if (existingDepth >= LOGIN_PREFILL_TARGET_DEPTH) {
      return {
        status: 'skipped',
        reason: 'pool_already_warm',
        walletSessionId,
      };
    }

    const minimumUses = Math.max(
      LOGIN_PREFILL_MIN_REMAINING_USES,
      Math.floor(Number(args.minRemainingUsesBeforePrefill ?? LOGIN_PREFILL_MIN_REMAINING_USES)),
    );
    const remainingUsesBefore = runtime.remainingUses;
    if (remainingUsesBefore < minimumUses) {
      return {
        status: 'skipped',
        reason: 'low_remaining_uses',
        walletSessionId,
        remainingUses: remainingUsesBefore,
      };
    }

    const routerAbEcdsaDerivationPoolFill = {
      kind: 'router_ab_ecdsa_derivation_signing_worker_pool' as const,
      scope: runtime.normalSigning.scope,
      ceremonyExpiresAtMs: routerAbPoolFillExpiresAtMs,
      materialExpiresAtMs: nowMs + MAX_DURABLE_CLIENT_PRESIGNATURE_LIFETIME_MS,
    };

    const clientSigningMaterial = deps.resolveClientSigningMaterialSource({
      manifest: args.capability.capability.manifest,
    });

    const schedule = scheduleRouterAbEcdsaDerivationClientPresignaturePoolRefill({
      relayerUrl,
      keyHandle: parseEcdsaKeyHandle(runtime.keyHandle),
      ecdsaThresholdKeyId: parseEcdsaThresholdKeyId(runtime.ecdsaThresholdKeyId),
      clientVerifyingShareB64u: parseEcdsaClientVerifyingShareB64u(clientVerifyingPublicKey33B64u),
      clientSigningMaterial,
      thresholdEcdsaPublicKeyB64u: runtime.thresholdEcdsaPublicKeyB64u,
      relayerVerifyingShareB64u:
        runtime.normalSigning.scope.public_identity.server_public_key33_b64u,
      credential: {
        kind: 'wallet_session_opaque',
        walletSessionToken: operationCredential.token,
      },
      authorization: {
        kind: 'reusable_wallet_session',
        wallet_session_id: operationCredential.walletSessionId,
      },
      materialActivation: routerAbMpcMaterialActivationRefToWire(runtime.materialActivation),
      routerAbEcdsaDerivationPoolFill,
      workerCtx: deps.getSignerWorkerContext(),
      poolPolicy: policy,
      targetDepth: LOGIN_PREFILL_TARGET_DEPTH,
      triggerIfDepthAtOrBelow: LOGIN_PREFILL_TRIGGER_DEPTH,
    });

    if (!schedule.scheduled) {
      if (args.waitForPoolReady && schedule.reason === 'in_flight_for_pool_key') {
        await waitForRouterAbEcdsaDerivationClientPresignaturePoolReady({
          relayerUrl,
          scope: runtime.normalSigning.scope,
          materialActivation: routerAbMpcMaterialActivationRefToWire(runtime.materialActivation),
        });
      }
      return {
        status: 'skipped',
        reason: 'refill_not_scheduled',
        walletSessionId,
        remainingUses: remainingUsesBefore,
        schedule,
      };
    }

    if (args.waitForPoolReady) {
      await waitForRouterAbEcdsaDerivationClientPresignaturePoolReady({
        relayerUrl,
        scope: runtime.normalSigning.scope,
        materialActivation: routerAbMpcMaterialActivationRefToWire(runtime.materialActivation),
      });
    }

    return {
      status: 'scheduled',
      reason: 'scheduled',
      walletSessionId,
      remainingUses: remainingUsesBefore,
      schedule,
    };
  } catch (error: unknown) {
    return {
      status: 'failed',
      reason: 'unexpected_error',
      walletSessionId,
      error: error instanceof Error ? error.message : 'unexpected error',
    };
  }
}
