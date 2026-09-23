import type { SigningSessionStatus } from '@/core/types/seams';
import type { WarmSessionSealTransportState } from '@/core/types/secure-confirm-worker';
import type { WarmSessionMaterialWriteDiagnostics } from './types';
import type {
  ThresholdEcdsaChainTarget,
  WalletId,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import {
  buildWalletSessionStatusCheckForSession,
  getWalletSessionStatus as getWalletSessionStatusValue,
  mergeWalletSigningSessionStatus,
  type WalletSigningSessionStatusDeps,
} from '../lifecycle/walletSessionStatus';
import { ed25519WalletSessionStatusOwner } from '../lifecycle/walletSessionStatus';
import {
  scheduleRouterAbEcdsaDerivationLoginPresignaturePrefill as scheduleRouterAbEcdsaDerivationLoginPresignaturePrefillValue,
  type RouterAbEcdsaDerivationLoginPresignaturePrefillResult,
  type EcdsaSessionPresignaturePrefillInput,
} from './ecdsaLoginPrefill';
import type { ThresholdEcdsaSessionBootstrapResult } from '../../threshold/ecdsa/activation';
import type { ThresholdEcdsaBootstrapSignerAuth } from './ecdsaBootstrapPersistence';
import type { ThresholdWarmSessionStatusReader } from './types';
import type { ExactEd25519SealedSessionRuntime } from './ed25519SealedSessionRuntime';
import type { ExactNearEd25519WalletSessionAuthorization } from '../material/nearEd25519YaoSigningPreparation';

export type PersistThresholdEcdsaBootstrapForWalletTargetInput = {
  walletId: WalletId;
  chainTarget: ThresholdEcdsaChainTarget;
  bootstrap: ThresholdEcdsaSessionBootstrapResult;
  signerAuth: ThresholdEcdsaBootstrapSignerAuth;
};

export type HydrateSigningSessionInput = {
  readonly thresholdSessionId: string;
  readonly prfFirstB64u: string;
  readonly expiresAtMs: number;
  readonly remainingUses: number;
  readonly diagnostics?: WarmSessionMaterialWriteDiagnostics;
} & WarmSessionSealTransportState;

export type WarmCapabilitiesPublicDeps = {
  statusReader: Pick<ThresholdWarmSessionStatusReader, 'getEd25519SigningSessionStatus'>;
  persistThresholdEcdsaBootstrapForWalletTarget: (
    args: PersistThresholdEcdsaBootstrapForWalletTargetInput,
  ) => Promise<void>;
  hydrateSigningSession: (args: HydrateSigningSessionInput) => Promise<void>;
  clearVolatileWarmSigningMaterial: (walletId?: WalletId) => Promise<void>;
  getWalletSessionStatus: WalletSigningSessionStatusDeps['getAvailableStatus'];
  getSignerWorkerContext: Parameters<
    typeof scheduleRouterAbEcdsaDerivationLoginPresignaturePrefillValue
  >[0]['getSignerWorkerContext'];
  resolveClientSigningMaterialSource: Parameters<
    typeof scheduleRouterAbEcdsaDerivationLoginPresignaturePrefillValue
  >[0]['resolveClientSigningMaterialSource'];
  routerAbEcdsaDerivationPresignaturePoolPolicy?: Parameters<
    typeof scheduleRouterAbEcdsaDerivationLoginPresignaturePrefillValue
  >[0]['routerAbEcdsaDerivationPresignaturePoolPolicy'];
};

export async function persistThresholdEcdsaBootstrapForWalletTarget(
  deps: WarmCapabilitiesPublicDeps,
  args: PersistThresholdEcdsaBootstrapForWalletTargetInput,
): Promise<void> {
  await deps.persistThresholdEcdsaBootstrapForWalletTarget(args);
}

export async function getWarmThresholdEd25519SessionStatus(
  deps: WarmCapabilitiesPublicDeps,
  args: {
    runtime: ExactEd25519SealedSessionRuntime;
    authorization: ExactNearEd25519WalletSessionAuthorization | null;
    nowMs: number;
  },
): Promise<SigningSessionStatus> {
  const status = await deps.statusReader.getEd25519SigningSessionStatus(args);
  const sessionStatusCheck = args.authorization
    ? buildWalletSessionStatusCheckForSession({
        owner: ed25519WalletSessionStatusOwner(args.runtime.walletId),
        authorization: {
          walletSessionId: args.authorization.operationCredential.walletSessionId,
          quotaId: args.authorization.session.quotaId,
        },
      })
    : null;
  const walletSessionStatus = sessionStatusCheck
    ? await getWalletSessionStatusValue(
        {
          getAvailableStatus: deps.getWalletSessionStatus,
        },
        sessionStatusCheck,
      )
    : null;
  return mergeWalletSigningSessionStatus(status, walletSessionStatus);
}

export async function scheduleRouterAbEcdsaDerivationLoginPresignaturePrefill(
  deps: WarmCapabilitiesPublicDeps,
  args: EcdsaSessionPresignaturePrefillInput,
): Promise<RouterAbEcdsaDerivationLoginPresignaturePrefillResult> {
  return await scheduleRouterAbEcdsaDerivationLoginPresignaturePrefillValue(
    {
      getSignerWorkerContext: deps.getSignerWorkerContext,
      resolveClientSigningMaterialSource: deps.resolveClientSigningMaterialSource,
      routerAbEcdsaDerivationPresignaturePoolPolicy:
        deps.routerAbEcdsaDerivationPresignaturePoolPolicy,
    },
    args,
  );
}

export async function hydrateSigningSession(
  deps: WarmCapabilitiesPublicDeps,
  args: HydrateSigningSessionInput,
): Promise<void> {
  await deps.hydrateSigningSession(args);
}

export async function clearVolatileWarmSigningMaterial(
  deps: WarmCapabilitiesPublicDeps,
  walletId?: WalletId,
): Promise<void> {
  await deps.clearVolatileWarmSigningMaterial(walletId);
}

export type { RouterAbEcdsaDerivationLoginPresignaturePrefillResult };
