import {
  WorkerRequestType,
  WorkerResponseType,
  type WorkerSuccessResponse,
} from '@/core/types/signer-worker';
import { PASSKEY_MANAGER_DEFAULT_CONFIGS } from '@/core/config/defaultConfigs';
import { resolveNearNetwork } from '@/core/config/chains';
import type { ThresholdEd25519KeyMaterial } from '@/core/accountData/near/nearAccountData.types';
import { normalizeThresholdEd25519ParticipantIds } from '@shared/threshold/participants';
import { computeThresholdEd25519Nep413SigningDigestWasm } from '../../chains/near/nearSignerWasm';
import { resolveNearSigningMaterials } from './shared/signingMaterials';
import {
  SigningOperationIntent,
  SigningSessionIds,
  type SigningOperationContext,
} from '../../session/operationState/types';
import { thresholdEd25519Nep413OperationFingerprint } from '@shared/threshold/ed25519OperationFingerprint';
import {
  SigningOperationCommandKind,
  runSigningOperationCommand,
} from '../shared/signingStateMachine';
import type { NearNep413Payload } from '../../interfaces/near';
import { base64Encode, base64UrlDecode } from '@shared/utils/base64';
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
import type { ExclusiveUnion } from '@shared/utils/variant';

/**
 * Sign a NEP-413 message using the active threshold-controlled NEAR key.
 *
 * @param payload - NEP-413 signing parameters including message, recipient, nonce, and state
 * @returns Promise resolving to signing result with account ID, public key, and signature
 */
type InternalSignNep413MessageResult = ExclusiveUnion<
  | { success: true; accountId: string; publicKey: string; signature: string; state?: string }
  | { success: false; error: string }
>;

export async function signNep413Message({
  ctx,
  commandSubject,
  nearAccount,
  signingSessionCoordinator,
  payload,
  forceFreshAuth,
  passkeyEd25519OperationStepUp,
  emailOtpEd25519StepUp,
  yaoSigningPreparation,
  yaoMaterialExecutor,
  selection,
  onEvent,
}: NearNep413Payload): Promise<InternalSignNep413MessageResult> {
  const selectionAuth =
    selection.kind === 'authorized' ? selection.selectedLane.auth : selection.candidate.auth;
  const selectedSignerSlot =
    selection.kind === 'authorized'
      ? selection.selectedLane.identity.signer.signerSlot
      : selection.candidate.signerSlot;
  const operationId = payload.operationId;
  const relayerUrl = ctx.relayerUrl;
  const nearAccountId = nearAccount.accountId;
  const touchConfirm = ctx.touchConfirm;
  if (!touchConfirm) {
    throw new Error('UiConfirm bridge not available for NEP-413 signing');
  }
  const { signingAuthPlan, signingSessionPlan } = resolveNearSignatureOnlySigningPlans({
    selection,
    commandSubject,
    forceFreshAuth,
    preparation: yaoSigningPreparation,
  });
  const { thresholdKeyMaterial } = await resolveNearSigningMaterials({
    materialExecutor: yaoMaterialExecutor,
    nearAccount,
    signerSlot: selectedSignerSlot,
    requestedSignerSlot: payload.signerSlot,
    operationLabel: 'NEP-413 signing',
  });
  const signingContext = validateAndPrepareNep413SigningContext({
    nearAccountId,
    relayerUrl,
    thresholdKeyMaterial,
  });
  const signingOperation: SigningOperationContext = {
    operationId,
    operationFingerprint: SigningSessionIds.signingOperationFingerprint(
      await thresholdEd25519Nep413OperationFingerprint({
        nearAccountId,
        nearNetworkId: resolveNearNetwork(
          ctx.chains || PASSKEY_MANAGER_DEFAULT_CONFIGS.network.chains,
        ),
        relayerKeyId: signingContext.threshold.thresholdKeyMaterial.relayerKeyId,
        signerPublicKey: signingContext.threshold.thresholdKeyMaterial.publicKey,
        message: payload.message,
        recipient: payload.recipient,
        nonce: payload.nonce,
        state: payload.state || null,
      }),
    ),
    intent: SigningOperationIntent.TransactionSign,
  };
  const operation: NearSignatureOnlyOperation = {
    label: 'NEP-413',
    ctx,
    walletId: commandSubject.walletSession.walletId,
    nearAccountId,
    auth: selectionAuth,
    signingSessionPlan,
    signingOperation,
    thresholdKeyMaterial: signingContext.threshold.thresholdKeyMaterial,
    preparation: yaoSigningPreparation,
    executor: yaoMaterialExecutor,
    intent: {
      kind: 'nep413_message_v1',
      message: payload.message,
      recipient: payload.recipient,
      nonce: payload.nonce,
      ...(payload.state ? { state: payload.state } : {}),
    },
    computeSigningDigestB64u: async () =>
      (
        await computeThresholdEd25519Nep413SigningDigestWasm({
          message: payload.message,
          recipient: payload.recipient,
          nonce: payload.nonce,
          ...(payload.state ? { state: payload.state } : {}),
          workerCtx: ctx,
        })
      ).signingDigestB64u,
  };
  const stepUp = await prepareNearSignatureOnlyStepUp(operation, {
    signingAuthPlan,
    passkeyEd25519OperationStepUp,
    emailOtpEd25519StepUp,
  });
  const confirmation = await confirmNearSignatureOnlyOperation(operation, {
    touchConfirm,
    signingAuthPlan: stepUp.preparedStepUp.confirmationAuthPayload.signingAuthPlan,
    nearPublicKeyStr: signingContext.nearPublicKey,
    onEvent,
    title: payload.title,
    body: payload.body,
    confirmationConfigOverride: payload.confirmationConfigOverride,
    request: { kind: 'nep413', message: payload.message, recipient: payload.recipient },
  });
  const authorization = authorizeNearSignatureOnlyOperation(operation, stepUp, confirmation);
  const signingMaterial = await runSigningOperationCommand({
    signingSessionPlan,
    signingOperation,
    commandKind: SigningOperationCommandKind.PreparePayload,
    execute: async () => await resolveNearSignatureOnlySigningMaterial(operation, authorization),
  });

  const okResponse = await runNearSignatureOnlySignCommand(operation, async () => {
    const signed = await signNearSignatureOnlyOperation(
      operation,
      signingMaterial,
      signingSessionCoordinator,
    );
    return {
      type: WorkerResponseType.SignNep413MessageSuccess,
      payload: {
        accountId: nearAccountId,
        publicKey: signed.signerPublicKey,
        signature: base64Encode(base64UrlDecode(signed.signatureB64u)),
        state: payload.state || undefined,
      },
    } as WorkerSuccessResponse<typeof WorkerRequestType.SignNep413Message>;
  });

  return {
    success: true,
    accountId: okResponse.payload.accountId,
    publicKey: okResponse.payload.publicKey,
    signature: okResponse.payload.signature,
    state: okResponse.payload.state || undefined,
  };
}

type ThresholdNep413SigningContext = {
  nearPublicKey: string;
  threshold: { thresholdKeyMaterial: ThresholdEd25519KeyMaterial };
};

function validateAndPrepareNep413SigningContext(args: {
  nearAccountId: string;
  relayerUrl: string;
  thresholdKeyMaterial: ThresholdEd25519KeyMaterial | null;
}): ThresholdNep413SigningContext {
  const thresholdKeyMaterial = args.thresholdKeyMaterial;
  if (!thresholdKeyMaterial) {
    throw new Error(`Missing threshold key material for ${args.nearAccountId}`);
  }

  const thresholdPublicKey = String(thresholdKeyMaterial.publicKey || '').trim();
  if (!thresholdPublicKey) {
    throw new Error(`Missing threshold signing public key for ${args.nearAccountId}`);
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
    nearPublicKey: thresholdPublicKey,
    threshold: { thresholdKeyMaterial },
  };
}
