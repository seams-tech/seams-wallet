import { PASSKEY_MANAGER_DEFAULT_CONFIGS } from '@/core/config/defaultConfigs';
import { resolveNearNetwork } from '@/core/config/chains';
import { AccountId, toAccountId } from '@/core/types/accountIds';
import { DelegateActionInput } from '@/core/types/delegate';
import {
  createSigningFlowEvent,
  SigningEventPhase,
  type CreateSigningFlowEventInput,
  type SigningFlowEvent,
} from '@/core/types/sdkSentEvents';
import {
  RpcCallPayload,
  WorkerRequestType,
  WorkerResponseType,
  type WorkerSuccessResponse,
  WasmSignedDelegate,
} from '@/core/types/signer-worker';
import type { ThresholdEd25519KeyMaterial } from '@/core/accountData/near/nearAccountData.types';
import { normalizeThresholdEd25519ParticipantIds } from '@shared/threshold/participants';
import {
  ensureEd25519Prefix,
  toPublicKeyString,
} from '@/core/signingEngine/workerManager/validation';
import { resolvePrimaryNearRpcUrl } from '@/core/config/chains';
import { computeThresholdEd25519DelegateSigningDigestWasm } from '../../chains/near/nearSignerWasm';
import { resolveNearSigningMaterials } from './shared/signingMaterials';
import { buildNearDelegateSigningPayloads } from '../../chains/near/payloads';
import { isWarmSessionSigningAuthPlan } from '@/core/signingEngine/stepUpConfirmation/types';
import {
  SigningOperationIntent,
  SigningSessionIds,
  type SigningOperationContext,
} from '../../session/operationState/types';
import {
  parseThresholdEd25519NearAction,
  thresholdEd25519DelegateActionOperationFingerprint,
} from '@shared/threshold/ed25519OperationFingerprint';
import {
  SigningOperationCommandKind,
  runSigningOperationCommand,
} from '../shared/signingStateMachine';
import type { NearDelegateActionPayload } from '../../interfaces/near';
import { finalizeThresholdEd25519DelegateSignatureResult } from './shared/ed25519YaoNormalSigning';
import type { NearPreparedStepUpAuth } from './requireNearStepUpAuth';
import {
  authorizeNearSignatureOnlyOperation,
  confirmNearSignatureOnlyOperation,
  prepareNearSignatureOnlyStepUp,
  resolveNearSignatureOnlySigningMaterial,
  resolveNearSignatureOnlySigningPlans,
  runNearSignatureOnlySignCommand,
  signNearSignatureOnlyOperation,
  type NearSignatureOnlyOperation,
} from './shared/signatureOnlySigning';

function emitNearSigningEvent(
  onEvent: ((event: SigningFlowEvent) => void) | undefined,
  accountId: AccountId | string,
  event: Omit<CreateSigningFlowEventInput, 'flowId' | 'accountId'>,
): void {
  try {
    onEvent?.(
      createSigningFlowEvent({
        ...event,
        flowId: `signing:near:${String(accountId)}:${event.phase}`,
        accountId: String(accountId),
      }),
    );
  } catch {}
}

function nearPreparedStepUpEventAuthMethod(
  preparedStepUp: NearPreparedStepUpAuth,
): 'warm_session' | 'passkey' | 'email_otp' {
  switch (preparedStepUp.kind) {
    case 'warm_session':
      return 'warm_session';
    case 'passkey':
      return 'passkey';
    case 'email_otp':
      return 'email_otp';
    default:
      return assertNeverNearPreparedStepUp(preparedStepUp);
  }
}

function assertNeverNearPreparedStepUp(value: never): never {
  throw new Error(`[SigningEngine][near] unsupported prepared step-up: ${String(value)}`);
}

export async function runNearDelegateActionSigning({
  ctx,
  commandSubject,
  nearAccount,
  delegate,
  rpcCall,
  onEvent,
  confirmationConfigOverride,
  title,
  body,
  operationId,
  signerSlot,
  signingSessionCoordinator,
  forceFreshAuth,
  passkeyEd25519OperationStepUp,
  emailOtpEd25519StepUp,
  yaoSigningPreparation,
  yaoMaterialExecutor,
  selection,
}: NearDelegateActionPayload): Promise<{
  signedDelegate: WasmSignedDelegate;
  hash: string;
  nearAccountId: AccountId;
  logs?: string[];
}> {
  const selectionAuth =
    selection.kind === 'authorized' ? selection.selectedLane.auth : selection.candidate.auth;
  const selectedSignerSlot =
    selection.kind === 'authorized'
      ? selection.selectedLane.identity.signer.signerSlot
      : selection.candidate.signerSlot;
  const nearAccountId = toAccountId(nearAccount.accountId);
  const relayerUrl = ctx.relayerUrl;

  const resolvedRpcCall = {
    nearRpcUrl:
      rpcCall.nearRpcUrl ||
      resolvePrimaryNearRpcUrl(PASSKEY_MANAGER_DEFAULT_CONFIGS.network.chains),
    nearAccountId,
  } as RpcCallPayload;

  const warnings: string[] = [];
  const touchConfirm = ctx.touchConfirm;
  if (!touchConfirm) {
    throw new Error('UiConfirm bridge not available for delegate signing');
  }
  const { signingAuthPlan, signingSessionPlan } = resolveNearSignatureOnlySigningPlans({
    selection,
    commandSubject,
    forceFreshAuth,
    preparation: yaoSigningPreparation,
  });

  emitNearSigningEvent(onEvent, nearAccountId, {
    phase: SigningEventPhase.STEP_02_REQUEST_PREPARED,
    status: 'running',
    message: 'Loading threshold signing state',
    interaction: { kind: 'none', overlay: 'none' },
  });
  const { thresholdKeyMaterial } = await resolveNearSigningMaterials({
    materialExecutor: yaoMaterialExecutor,
    nearAccount,
    signerSlot: selectedSignerSlot,
    requestedSignerSlot: signerSlot,
    operationLabel: 'delegate signing',
    warnings,
  });
  const signingContext = validateAndPrepareDelegateSigningContext({
    nearAccountId,
    relayerUrl,
    thresholdKeyMaterial,
    providedDelegatePublicKey: delegate.publicKey,
    warnings,
  });
  const delegateSigningPayloads = buildNearDelegateSigningPayloads({
    nearAccountId,
    delegate,
    signingPublicKey: signingContext.delegatePublicKeyStr,
  });
  const delegateIntent = {
    ...delegateSigningPayloads.workerDelegate,
    actions: delegateSigningPayloads.workerDelegate.actions.map((action, index) =>
      parseThresholdEd25519NearAction(action, `delegate.actions[${index}]`),
    ),
  };

  const signingOperation: SigningOperationContext = {
    operationId,
    operationFingerprint: SigningSessionIds.signingOperationFingerprint(
      await thresholdEd25519DelegateActionOperationFingerprint({
        nearAccountId,
        nearNetworkId: resolveNearNetwork(
          ctx.chains || PASSKEY_MANAGER_DEFAULT_CONFIGS.network.chains,
        ),
        relayerKeyId: signingContext.threshold.thresholdKeyMaterial.relayerKeyId,
        signerPublicKey: signingContext.delegatePublicKeyStr,
        delegate: delegateIntent,
      }),
    ),
    intent: SigningOperationIntent.TransactionSign,
  };
  const operation: NearSignatureOnlyOperation = {
    label: 'delegate',
    ctx,
    walletId: commandSubject.walletSession.walletId,
    nearAccountId,
    auth: selectionAuth,
    signingSessionPlan,
    signingOperation,
    thresholdKeyMaterial: signingContext.threshold.thresholdKeyMaterial,
    preparation: yaoSigningPreparation,
    executor: yaoMaterialExecutor,
    intent: { kind: 'near_delegate_action_v1', delegate: delegateIntent },
    computeSigningDigestB64u: async () =>
      (
        await computeThresholdEd25519DelegateSigningDigestWasm({
          delegate: delegateSigningPayloads.workerDelegate,
          workerCtx: ctx,
        })
      ).signingDigestB64u,
  };
  const stepUp = await prepareNearSignatureOnlyStepUp(operation, {
    signingAuthPlan,
    passkeyEd25519OperationStepUp,
    emailOtpEd25519StepUp,
  });
  const confirmationAuthPayload = stepUp.preparedStepUp.confirmationAuthPayload;
  if (isWarmSessionSigningAuthPlan(confirmationAuthPayload.signingAuthPlan)) {
    emitNearSigningEvent(onEvent, nearAccountId, {
      phase: SigningEventPhase.STEP_06_AUTH_WARM_SESSION_CLAIMED,
      status: 'succeeded',
      interaction: { kind: 'none', overlay: 'none' },
      data: {
        thresholdSessionId: confirmationAuthPayload.signingAuthPlan.thresholdSessionId,
        expiresAtMs: confirmationAuthPayload.signingAuthPlan.expiresAtMs,
        remainingUses: confirmationAuthPayload.signingAuthPlan.remainingUses,
      },
    });
  }
  emitNearSigningEvent(onEvent, nearAccountId, {
    phase: SigningEventPhase.STEP_05_CONFIRMATION_DISPLAYED,
    status: 'waiting_for_user',
    message: 'Opening confirmation prompt',
    interaction: { kind: 'transaction_confirmation', overlay: 'show' },
  });
  const confirmation = await confirmNearSignatureOnlyOperation(operation, {
    touchConfirm,
    signingAuthPlan: confirmationAuthPayload.signingAuthPlan,
    nearPublicKeyStr: signingContext.signingNearPublicKeyStr,
    onEvent,
    title,
    body,
    confirmationConfigOverride,
    request: {
      kind: 'delegate',
      delegate: delegateSigningPayloads.confirmationDelegate,
      rpcCall: resolvedRpcCall,
    },
  });
  emitNearSigningEvent(onEvent, nearAccountId, {
    phase: SigningEventPhase.STEP_05_CONFIRMATION_APPROVED,
    status: 'succeeded',
    interaction: { kind: 'transaction_confirmation', overlay: 'hide' },
  });
  const authorization = authorizeNearSignatureOnlyOperation(operation, stepUp, confirmation);
  const signingMaterial = await runSigningOperationCommand({
    signingSessionPlan,
    signingOperation,
    commandKind: SigningOperationCommandKind.PreparePayload,
    execute: async () => {
      emitNearSigningEvent(onEvent, nearAccountId, {
        phase: SigningEventPhase.STEP_08_SIGNER_PREPARE_STARTED,
        status: 'running',
        message: 'Preparing NEAR signer',
        interaction: { kind: 'none', overlay: 'none' },
      });
      const material = await resolveNearSignatureOnlySigningMaterial(operation, authorization);
      emitNearSigningEvent(onEvent, nearAccountId, {
        phase: SigningEventPhase.STEP_07_AUTHENTICATION_COMPLETE,
        status: 'succeeded',
        interaction: { kind: 'none', overlay: 'none' },
        authMethod: nearPreparedStepUpEventAuthMethod(stepUp.preparedStepUp),
      });
      emitNearSigningEvent(onEvent, nearAccountId, {
        phase: SigningEventPhase.STEP_08_SIGNER_PREPARE_SUCCEEDED,
        status: 'succeeded',
        message: 'NEAR signer ready',
        interaction: { kind: 'none', overlay: 'none' },
        data: {
          signer: 'threshold-ed25519',
          thresholdSessionId: material.thresholdSessionId,
          clientBaseSource: 'yao_active_client',
        },
      });
      return material;
    },
  });

  const okResponse = await runNearSignatureOnlySignCommand(operation, async () => {
    emitNearSigningEvent(onEvent, nearAccountId, {
      phase: SigningEventPhase.STEP_10_COMMIT_STARTED,
      status: 'running',
      interaction: { kind: 'none', overlay: 'none' },
    });
    const signed = await signNearSignatureOnlyOperation(
      operation,
      signingMaterial,
      signingSessionCoordinator,
    );
    const delegateResult = await finalizeThresholdEd25519DelegateSignatureResult({
      ctx,
      delegate: delegateSigningPayloads.workerDelegate,
      signingDigestB64u: signed.signingDigestB64u,
      signatureB64u: signed.signatureB64u,
    });
    return {
      type: WorkerResponseType.SignDelegateActionSuccess,
      payload: {
        success: true,
        hash: delegateResult.hash,
        signedDelegate: delegateResult.signedDelegate,
        logs: ['Delegate action signed through Router A/B normal signing'],
        error: undefined,
      },
    } as WorkerSuccessResponse<typeof WorkerRequestType.SignDelegateAction>;
  });

  emitNearSigningEvent(onEvent, nearAccountId, {
    phase: SigningEventPhase.STEP_11_TRANSACTION_SIGNED,
    status: 'succeeded',
    interaction: { kind: 'none', overlay: 'hide' },
  });
  emitNearSigningEvent(onEvent, nearAccountId, {
    phase: SigningEventPhase.STEP_15_COMPLETED,
    status: 'succeeded',
    interaction: { kind: 'none', overlay: 'none' },
    data: { operation: 'sign_delegate', hash: okResponse.payload.hash },
  });

  return {
    signedDelegate: okResponse.payload.signedDelegate!,
    hash: okResponse.payload.hash!,
    nearAccountId: toAccountId(nearAccountId),
    logs: [...(okResponse.payload.logs || []), ...warnings],
  };
}

type ThresholdDelegateSigningContext = {
  signingNearPublicKeyStr: string;
  delegatePublicKeyStr: string;
  threshold: { thresholdKeyMaterial: ThresholdEd25519KeyMaterial };
};

function validateAndPrepareDelegateSigningContext(args: {
  nearAccountId: string;
  relayerUrl: string;
  thresholdKeyMaterial: ThresholdEd25519KeyMaterial | null;
  providedDelegatePublicKey: DelegateActionInput['publicKey'];
  warnings: string[];
}): ThresholdDelegateSigningContext {
  const providedDelegatePublicKeyStr = ensureEd25519Prefix(
    toPublicKeyString(args.providedDelegatePublicKey),
  );

  const thresholdKeyMaterial = args.thresholdKeyMaterial;
  if (!thresholdKeyMaterial) {
    throw new Error(`Missing threshold key material for ${args.nearAccountId}`);
  }

  const thresholdPublicKey = ensureEd25519Prefix(thresholdKeyMaterial.publicKey);
  if (!thresholdPublicKey) {
    throw new Error(`Missing threshold signing public key for ${args.nearAccountId}`);
  }

  if (providedDelegatePublicKeyStr && providedDelegatePublicKeyStr !== thresholdPublicKey) {
    args.warnings.push(
      `Delegate public key ${providedDelegatePublicKeyStr} does not match threshold signer key; using ${thresholdPublicKey}`,
    );
  }

  const relayerUrl = String(args.relayerUrl || '').trim();
  if (!relayerUrl) {
    throw new Error('Missing relayerUrl (required for threshold-signer)');
  }

  const participantIds = normalizeThresholdEd25519ParticipantIds(
    thresholdKeyMaterial.participants.map((p) => p.id),
  );
  if (!participantIds || participantIds.length < 2) {
    throw new Error(
      `Invalid threshold signing participantIds (expected >=2 participants, got [${(participantIds || []).join(',')}])`,
    );
  }

  return {
    signingNearPublicKeyStr: thresholdPublicKey,
    delegatePublicKeyStr: thresholdPublicKey,
    threshold: { thresholdKeyMaterial },
  };
}
