import type { ThresholdEd25519KeyMaterial } from '@/core/accountData/near/nearAccountData.types';
import type { SigningFlowEvent } from '@/core/types/sdkSentEvents';
import type { ConfirmationConfig } from '@/core/types/signer-worker';
import type { SigningAuthPlan } from '@/core/signingEngine/stepUpConfirmation/types';
import type {
  NearCommandSubject,
  WalletId,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type {
  NearAdHocEd25519Selection,
  NearEd25519StepUpAuthorization,
  NearEd25519YaoMaterialExecutor,
  NearEmailOtpEd25519StepUpHook,
  NearPasskeyEd25519OperationStepUpHook,
} from '@/core/signingEngine/interfaces/near';
import type { NearOperationStepUpPreparationRef } from '@/core/signingEngine/interfaces/operationStepUpPreparation';
import type { NearSigningRuntimeDeps } from '@/core/signingEngine/interfaces/runtime';
import type { SigningLaneAuthBinding } from '@/core/signingEngine/session/identity/signingLaneAuthBinding';
import type { NearEd25519YaoSigningPreparation } from '@/core/signingEngine/session/material/nearEd25519YaoSigningPreparation';
import type { SigningSessionCoordinator } from '@/core/signingEngine/session/SigningSessionCoordinator';
import type { AuthorizedRouterAbEd25519WalletSessionState } from '@/core/signingEngine/session/warmCapabilities/routerAbEd25519WalletSessionState';
import type { Ed25519OperationStepUpProof } from '@/core/signingEngine/threshold/ed25519/walletSession';
import type { ThresholdEd25519SessionId } from '@shared/utils/domainIds';
import { nearEd25519SignerBindingFromBoundaryFields } from '@/core/signingEngine/session/identity/exactSigningLaneIdentity';
import { planSigningSession } from '@/core/signingEngine/session/planning/planner';
import { parseSigningOperationFingerprintDigest } from '@/core/signingEngine/session/planning/operationFingerprint';
import {
  SigningSessionIds,
  SigningSessionPlanKind,
  type DeferredEd25519MaterialIdentity,
  type SigningOperationContext,
  type SigningSessionPlan,
} from '@/core/signingEngine/session/operationState/types';
import {
  buildSigningConfirmationAuthParams,
  confirmationConfigForSigningAuthPlan,
  runSigningConfirmationCommand,
  type ConfirmSignatureOnlySigningOperationRequest,
  type ConfirmSignatureOnlySigningOperationResult,
} from '../../shared/signingConfirmation';
import {
  SigningOperationCommandKind,
  runSigningOperationCommand,
} from '../../shared/signingStateMachine';
import {
  requireNearStepUpAuth,
  signingAuthPlanForNearMaterialRequirement,
  type NearPreparedStepUpAuth,
} from '../requireNearStepUpAuth';
import { buildNearEd25519StepUpAuthorization } from '../stepUpAuthorization';
import { emitNearSigningConfirmationProgress } from './confirmationProgress';
import {
  buildNearSigningSessionAuthPlan,
  resolveNearSigningSessionAuthContext,
} from './signingSessionAuthMode';
import {
  clearNearOperationStepUpBuilder,
  consumePreparedNearOperationStepUp,
  registerNearOperationStepUpBuilder,
  type PreparedNearOperationStepUp,
} from './operationStepUpPreparation';
import {
  nearOperationStepUpMaterialFacts,
  prepareNearOperationStepUpMaterial,
  resolveConfirmedNearEd25519YaoCapability,
  resolveNearOperationStepUpMaterial,
  type NearOperationStepUpMaterial,
  type ResolvedNearOperationStepUpMaterial,
} from './ed25519YaoCapabilityResolution';
import {
  buildNearEd25519OperationStepUpProof,
  prepareRouterAbEd25519SignatureOnlyOperationStepUp,
  requireIssuedNearEd25519OperationStepUpAuthorization,
  tryFinalizeRouterAbEd25519SignatureOnlyNormalSigning,
  type RouterAbEd25519SignatureOnlyIntentWire,
} from './ed25519YaoNormalSigning';

// A delegate action or a NEP-413 message is exactly one signature.
const REQUIRED_SIGNATURE_USES = 1;

/** One delegate-action or NEP-413 signing operation, fixed before its step-up starts. */
export type NearSignatureOnlyOperation = {
  /** Names the operation in error messages. */
  label: 'delegate' | 'NEP-413';
  ctx: NearSigningRuntimeDeps;
  walletId: WalletId;
  nearAccountId: string;
  auth: SigningLaneAuthBinding;
  signingSessionPlan: SigningSessionPlan;
  signingOperation: SigningOperationContext;
  thresholdKeyMaterial: ThresholdEd25519KeyMaterial;
  preparation: NearEd25519YaoSigningPreparation;
  executor: NearEd25519YaoMaterialExecutor;
  intent: RouterAbEd25519SignatureOnlyIntentWire;
  computeSigningDigestB64u: () => Promise<string>;
};

type PreparedSignatureOnlyStepUp = Extract<
  PreparedNearOperationStepUp,
  { kind: 'near_signature_only' }
>;

type OperationStepUpMaterialAndDigest = {
  material: NearOperationStepUpMaterial;
  signingDigestB64u: string;
};

type NearSignatureOnlyStepUp = {
  preparedStepUp: NearPreparedStepUpAuth;
  operationStepUp: OperationStepUpMaterialAndDigest | null;
};

type NearSignatureOnlyAuthorization =
  | {
      kind: 'warm_session';
      displayDigest: string;
      stepUpAuthorization: Extract<NearEd25519StepUpAuthorization, { kind: 'warm_session' }>;
    }
  | ({
      kind: 'operation_step_up';
      displayDigest: string;
      stepUpAuthorization: Exclude<NearEd25519StepUpAuthorization, { kind: 'warm_session' }>;
      proof: Ed25519OperationStepUpProof;
      prepared: PreparedSignatureOnlyStepUp;
    } & OperationStepUpMaterialAndDigest);

type NearSignatureOnlySigningMaterial =
  | {
      kind: 'warm_session';
      thresholdSessionId: ThresholdEd25519SessionId;
      displayDigest: string;
      resolved: Awaited<ReturnType<typeof resolveConfirmedNearEd25519YaoCapability>>;
    }
  | {
      kind: 'operation_step_up';
      thresholdSessionId: ThresholdEd25519SessionId;
      displayDigest: string;
      resolved: ResolvedNearOperationStepUpMaterial;
      proof: Ed25519OperationStepUpProof;
      prepared: PreparedSignatureOnlyStepUp;
      signingDigestB64u: string;
    };

type SignatureOnlyConfirmationRequest =
  | Pick<
      Extract<ConfirmSignatureOnlySigningOperationRequest, { kind: 'delegate' }>,
      'kind' | 'delegate' | 'rpcCall'
    >
  | Pick<
      Extract<ConfirmSignatureOnlySigningOperationRequest, { kind: 'nep413' }>,
      'kind' | 'message' | 'recipient'
    >;

function requireOperationStepUpPreparationRef(
  label: NearSignatureOnlyOperation['label'],
  value: NearOperationStepUpPreparationRef | undefined,
): NearOperationStepUpPreparationRef {
  if (!value) {
    throw new Error(`[SigningEngine][near] ${label} operation step-up preparation is missing`);
  }
  return value;
}

function requirePreparedSignatureOnlyStepUp(
  label: NearSignatureOnlyOperation['label'],
  value: PreparedNearOperationStepUp | null,
): PreparedSignatureOnlyStepUp {
  if (!value || value.kind !== 'near_signature_only') {
    throw new Error(`[SigningEngine][near] ${label} operation step-up preparation kind changed`);
  }
  return value;
}

function requireOperationStepUpMaterial(
  label: NearSignatureOnlyOperation['label'],
  value: OperationStepUpMaterialAndDigest | null,
): OperationStepUpMaterialAndDigest {
  if (!value) {
    throw new Error(`[SigningEngine][near] ${label} operation step-up material is missing`);
  }
  return value;
}

function requireSigningDigest(label: NearSignatureOnlyOperation['label'], value: string): string {
  if (!value) {
    throw new Error(`[SigningEngine][near] ${label} operation signing digest is missing`);
  }
  return value;
}

function requireAuthorizedWalletSessionState(
  value: AuthorizedRouterAbEd25519WalletSessionState | null,
): AuthorizedRouterAbEd25519WalletSessionState {
  if (!value) {
    throw new Error('[SigningEngine][near] reusable Wallet Session authorization is unavailable');
  }
  return value;
}

async function resolveSignatureOnlyOperationStepUpCapability(args: {
  label: NearSignatureOnlyOperation['label'];
  material: NearOperationStepUpMaterial;
  prepared: PreparedSignatureOnlyStepUp;
  displayDigest: string;
  authorization: Exclude<NearEd25519StepUpAuthorization, { kind: 'warm_session' }>;
  emailOtpProof: Extract<Ed25519OperationStepUpProof, { kind: 'email_otp' }> | null;
}): Promise<ResolvedNearOperationStepUpMaterial> {
  if (args.authorization.kind === 'passkey') {
    if (args.material.kind !== 'passkey_live' && args.material.kind !== 'passkey_sealed') {
      throw new Error(`[SigningEngine][near] passkey ${args.label} material changed factor`);
    }
    return await resolveNearOperationStepUpMaterial({
      kind: 'passkey',
      material: args.material,
      expectedActivation: args.prepared.materialActivation,
      credential: args.authorization.credential,
    });
  }
  if (args.material.kind !== 'email_otp_live' && args.material.kind !== 'email_otp_sealed') {
    throw new Error(`[SigningEngine][near] Email OTP ${args.label} material changed factor`);
  }
  if (!args.emailOtpProof) {
    throw new Error(`[SigningEngine][near] Email OTP ${args.label} proof is missing`);
  }
  if (args.material.kind === 'email_otp_live') {
    return await resolveNearOperationStepUpMaterial({
      kind: 'email_otp_live',
      material: args.material,
      expectedActivation: args.prepared.materialActivation,
    });
  }
  return await resolveNearOperationStepUpMaterial({
    kind: 'email_otp_sealed',
    material: args.material,
    expectedActivation: args.prepared.materialActivation,
    normalSigningRequest: args.prepared.prepare.request,
    displayDigest: args.displayDigest,
    proof: args.emailOtpProof,
  });
}

/**
 * Plans the signing session for the selected lane. A lane still awaiting authorization signs
 * once, through an operation step-up on its deferred material.
 */
export function resolveNearSignatureOnlySigningPlans(args: {
  selection: NearAdHocEd25519Selection;
  commandSubject: NearCommandSubject;
  forceFreshAuth: boolean;
  preparation: NearEd25519YaoSigningPreparation;
}): { signingAuthPlan: SigningAuthPlan; signingSessionPlan: SigningSessionPlan } {
  if (args.selection.kind === 'authorized') {
    const context = resolveNearSigningSessionAuthContext({
      requiredSignatureUses: REQUIRED_SIGNATURE_USES,
      commandSubject: args.commandSubject,
      forceFreshAuth: args.forceFreshAuth,
      selectedLane: args.selection.selectedLane,
      preparation: args.preparation,
    });
    const resolvedSigningSession = {
      signingSessionPlan: planSigningSession({
        lane: context.coordinatorInput.lane,
        readiness: context.coordinatorInput.readiness,
        forceFreshAuth: context.coordinatorInput.forceFreshAuth,
      }),
      readiness: context.coordinatorInput.readiness,
      expiresAtMs: context.coordinatorInput.expiresAtMs || 0,
      remainingUses: context.coordinatorInput.remainingUses || 0,
    };
    return {
      signingAuthPlan: buildNearSigningSessionAuthPlan({ context, resolvedSigningSession })
        .signingAuthPlan,
      signingSessionPlan: resolvedSigningSession.signingSessionPlan,
    };
  }
  const candidate = args.selection.candidate;
  const signingAuthPlan = signingAuthPlanForNearMaterialRequirement(candidate.auth);
  const deferredIdentity: DeferredEd25519MaterialIdentity = {
    kind: 'deferred_ed25519_material_identity',
    signer: nearEd25519SignerBindingFromBoundaryFields({
      walletId: candidate.walletId,
      nearAccountId: candidate.nearAccountId,
      nearEd25519SigningKeyId: candidate.nearEd25519SigningKeyId,
      signerSlot: candidate.signerSlot,
    }),
    materialActivation: candidate.materialActivation,
    thresholdSessionId: SigningSessionIds.thresholdEd25519Session(candidate.thresholdSessionId),
  };
  return {
    signingAuthPlan,
    signingSessionPlan: {
      kind: SigningSessionPlanKind.OperationStepUp,
      lane: {
        identity: deferredIdentity,
        auth: candidate.auth,
        curve: 'ed25519',
        keyKind: 'threshold_ed25519',
        chainFamily: 'near',
        sessionOrigin: 'per_operation',
        storageSource: 'sealed_restore',
        retention: 'single_use',
        materialActivation: deferredIdentity.materialActivation,
        thresholdSessionId: deferredIdentity.thresholdSessionId,
      },
    },
  };
}

/**
 * Prepares the step-up. Unless a warm session covers the operation, this also prepares the
 * operation material and registers the builder the confirmation calls to prepare the
 * Router A/B request.
 */
export async function prepareNearSignatureOnlyStepUp(
  operation: NearSignatureOnlyOperation,
  args: {
    signingAuthPlan: SigningAuthPlan;
    passkeyEd25519OperationStepUp: NearPasskeyEd25519OperationStepUpHook | null;
    emailOtpEd25519StepUp: NearEmailOtpEd25519StepUpHook | null;
  },
): Promise<NearSignatureOnlyStepUp> {
  const preparedStepUp = await requireNearStepUpAuth({
    signingAuthPlan: args.signingAuthPlan,
    signingLaneAuth: operation.auth,
    requiredSignatureUses: REQUIRED_SIGNATURE_USES,
    operationFingerprintDigest: parseSigningOperationFingerprintDigest(
      operation.signingOperation.operationFingerprint,
    ),
    passkeyEd25519OperationStepUp: args.passkeyEd25519OperationStepUp,
    emailOtpEd25519StepUp: args.emailOtpEd25519StepUp,
  });
  if (preparedStepUp.kind === 'warm_session') {
    return { preparedStepUp, operationStepUp: null };
  }
  const material = await prepareNearOperationStepUpMaterial({
    method: preparedStepUp.kind,
    preparation: operation.preparation,
    executor: operation.executor,
  });
  const materialFacts = nearOperationStepUpMaterialFacts(material);
  const signingDigestB64u = await operation.computeSigningDigestB64u();
  registerNearOperationStepUpBuilder({
    requestId: String(operation.signingOperation.operationId),
    build: async (preparation) => {
      if (preparation.kind !== 'near_signature_only') {
        throw new Error(
          `[SigningEngine][near] ${operation.label} operation step-up preparation kind changed`,
        );
      }
      return await prepareRouterAbEd25519SignatureOnlyOperationStepUp({
        ctx: operation.ctx,
        thresholdSessionId: materialFacts.thresholdSessionId,
        materialFacts,
        thresholdKeyMaterial: operation.thresholdKeyMaterial,
        walletId: operation.walletId,
        nearAccountId: operation.nearAccountId,
        materialActivation: material.materialActivation,
        operationId: operation.signingOperation.operationId,
        operationFingerprint: operation.signingOperation.operationFingerprint!,
        displayDigest: preparation.displayDigest,
        signingDigestB64u,
        intent: operation.intent,
      });
    },
  });
  return { preparedStepUp, operationStepUp: { material, signingDigestB64u } };
}

/** Shows the confirmation, then drops the step-up builder whether or not it was used. */
export async function confirmNearSignatureOnlyOperation(
  operation: NearSignatureOnlyOperation,
  args: {
    touchConfirm: NonNullable<NearSigningRuntimeDeps['touchConfirm']>;
    signingAuthPlan: SigningAuthPlan;
    nearPublicKeyStr: string;
    onEvent: ((event: SigningFlowEvent) => void) | undefined;
    title: string | undefined;
    body: string | undefined;
    confirmationConfigOverride: Partial<ConfirmationConfig> | undefined;
    request: SignatureOnlyConfirmationRequest;
  },
): Promise<ConfirmSignatureOnlySigningOperationResult> {
  const requestId = String(operation.signingOperation.operationId);
  try {
    return await runSigningConfirmationCommand({
      signingSessionPlan: operation.signingSessionPlan,
      signingOperation: operation.signingOperation,
      runtime: args.touchConfirm,
      request: {
        ctx: { touchConfirm: args.touchConfirm },
        sessionId: requestId,
        chain: 'near',
        ...args.request,
        ...buildSigningConfirmationAuthParams({ signingAuthPlan: args.signingAuthPlan }),
        walletId: String(operation.walletId),
        nearAccountId: operation.nearAccountId,
        nearPublicKeyStr: args.nearPublicKeyStr,
        title: args.title,
        body: args.body,
        confirmationConfigOverride: confirmationConfigForSigningAuthPlan({
          signingAuthPlan: args.signingAuthPlan,
          override: args.confirmationConfigOverride,
        }),
        onProgress: emitNearSigningConfirmationProgress.bind(undefined, {
          onEvent: args.onEvent,
          nearAccountId: operation.nearAccountId,
          signingAuthPlan: args.signingAuthPlan,
        }),
      },
    });
  } finally {
    clearNearOperationStepUpBuilder(requestId);
  }
}

/** Turns the confirmation into the authorization that the signing step presents. */
export function authorizeNearSignatureOnlyOperation(
  operation: NearSignatureOnlyOperation,
  stepUp: NearSignatureOnlyStepUp,
  confirmation: ConfirmSignatureOnlySigningOperationResult,
): NearSignatureOnlyAuthorization {
  const stepUpAuthorization = buildNearEd25519StepUpAuthorization({
    prepared: stepUp.preparedStepUp,
    confirmation,
  });
  if (stepUpAuthorization.kind === 'warm_session') {
    return { kind: 'warm_session', displayDigest: confirmation.intentDigest, stepUpAuthorization };
  }
  const proof = buildNearEd25519OperationStepUpProof({
    authorization: stepUpAuthorization,
    preparation: operation.preparation,
    auth: operation.auth,
    walletId: operation.walletId,
  });
  const prepared = requirePreparedSignatureOnlyStepUp(
    operation.label,
    consumePreparedNearOperationStepUp({
      requestId: String(operation.signingOperation.operationId),
      ref: requireOperationStepUpPreparationRef(
        operation.label,
        confirmation.operationStepUpPreparation,
      ),
    }),
  );
  return {
    kind: 'operation_step_up',
    displayDigest: confirmation.intentDigest,
    stepUpAuthorization,
    proof,
    prepared,
    // Only a warm-session step-up skips preparing operation material.
    ...requireOperationStepUpMaterial(operation.label, stepUp.operationStepUp),
  };
}

export async function resolveNearSignatureOnlySigningMaterial(
  operation: NearSignatureOnlyOperation,
  authorization: NearSignatureOnlyAuthorization,
): Promise<NearSignatureOnlySigningMaterial> {
  if (authorization.kind === 'warm_session') {
    const resolved = await resolveConfirmedNearEd25519YaoCapability({
      authorization: authorization.stepUpAuthorization,
      preparation: operation.preparation,
      executor: operation.executor,
    });
    return {
      kind: 'warm_session',
      thresholdSessionId: resolved.thresholdSessionId,
      displayDigest: authorization.displayDigest,
      resolved,
    };
  }
  return {
    kind: 'operation_step_up',
    thresholdSessionId: nearOperationStepUpMaterialFacts(authorization.material).thresholdSessionId,
    displayDigest: authorization.displayDigest,
    resolved: await resolveSignatureOnlyOperationStepUpCapability({
      label: operation.label,
      material: authorization.material,
      prepared: authorization.prepared,
      displayDigest: authorization.displayDigest,
      authorization: authorization.stepUpAuthorization,
      emailOtpProof: authorization.proof.kind === 'email_otp' ? authorization.proof : null,
    }),
    proof: authorization.proof,
    prepared: authorization.prepared,
    signingDigestB64u: authorization.signingDigestB64u,
  };
}

/** Signs through Router A/B with the reusable Wallet Session or the operation step-up. */
export async function signNearSignatureOnlyOperation(
  operation: NearSignatureOnlyOperation,
  material: NearSignatureOnlySigningMaterial,
  signingSessionCoordinator: SigningSessionCoordinator,
): Promise<{ signingDigestB64u: string; signatureB64u: string; signerPublicKey: string }> {
  const signingDigestB64u =
    material.kind === 'warm_session'
      ? await operation.computeSigningDigestB64u()
      : requireSigningDigest(operation.label, material.signingDigestB64u);
  const result =
    material.kind === 'warm_session'
      ? await tryFinalizeRouterAbEd25519SignatureOnlyNormalSigning({
          ctx: operation.ctx,
          thresholdSessionId: material.thresholdSessionId,
          activeClient: material.resolved.material.activeClient,
          walletSessionState: requireAuthorizedWalletSessionState(
            await signingSessionCoordinator.resolveActiveAuthorizedRouterAbEd25519WalletSessionState(
              {
                state: material.resolved.walletSessionState,
                nowMs: Date.now(),
              },
            ),
          ),
          walletId: operation.walletId,
          thresholdKeyMaterial: operation.thresholdKeyMaterial,
          nearAccountId: operation.nearAccountId,
          operationId: operation.signingOperation.operationId,
          operationFingerprint: operation.signingOperation.operationFingerprint!,
          displayDigest: material.displayDigest,
          signingDigestB64u,
          intent: operation.intent,
          authorization: { kind: 'reusable_wallet_session' },
        })
      : await tryFinalizeRouterAbEd25519SignatureOnlyNormalSigning({
          ctx: operation.ctx,
          thresholdSessionId: material.thresholdSessionId,
          activeClient: material.resolved.material.activeClient,
          materialFacts: material.resolved.material.facts,
          walletId: operation.walletId,
          thresholdKeyMaterial: operation.thresholdKeyMaterial,
          nearAccountId: operation.nearAccountId,
          operationId: operation.signingOperation.operationId,
          operationFingerprint: operation.signingOperation.operationFingerprint!,
          displayDigest: material.displayDigest,
          signingDigestB64u,
          intent: operation.intent,
          authorization: {
            kind: 'operation_step_up',
            prepared: material.prepared,
            proof: material.proof,
            issuedAuthorization: material.resolved.issuedAuthorization,
          },
        });
  if (!result) {
    throw new Error(
      `[SigningEngine][near] Router A/B Ed25519 ${operation.label} signing is unavailable`,
    );
  }
  if (material.kind === 'operation_step_up' && result.authorization === 'operation_step_up') {
    requireIssuedNearEd25519OperationStepUpAuthorization({
      prepared: material.prepared,
      issuedAuthorization: result.issuedAuthorization,
    });
  }
  return {
    signingDigestB64u,
    signatureB64u: result.signatureB64u,
    signerPublicKey: result.signerPublicKey,
  };
}

/** Runs the Sign command, rethrowing a thrown non-Error value as an Error. */
export async function runNearSignatureOnlySignCommand<T>(
  operation: NearSignatureOnlyOperation,
  execute: () => Promise<T>,
): Promise<T> {
  return await runSigningOperationCommand({
    signingSessionPlan: operation.signingSessionPlan,
    signingOperation: operation.signingOperation,
    commandKind: SigningOperationCommandKind.Sign,
    execute: async () => {
      try {
        return await execute();
      } catch (e: unknown) {
        throw e instanceof Error ? e : new Error(String(e));
      }
    },
  });
}
