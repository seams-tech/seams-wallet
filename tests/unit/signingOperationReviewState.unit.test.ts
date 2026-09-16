import { expect, test } from '@playwright/test';
import { toAccountId } from '@/core/types/accountIds';
import { toWalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { toRpId } from '@/core/signingEngine/session/identity/evmFamilyEcdsaIdentity';
import { buildEd25519PasskeySigningLane } from '@/core/signingEngine/session/operationState/lanes';
import {
  SigningSessionIds,
  SigningSessionPlanKind,
  type SigningSessionPlan,
} from '@/core/signingEngine/session/operationState/types';
import { planSigningSession } from '@/core/signingEngine/session/planning/planner';
import {
  SigningOperationCancellationPhase,
  SigningOperationInteractionEventKind,
  SigningOperationStateKind,
  applySigningOperationInteractionEvent,
  approveSigningOperationConfirmation,
  cancelSigningOperation,
  createSigningOperationStateRef,
  isSigningOperationReviewApprovedStateKind,
  planSigningOperationAttempt,
} from '@/core/signingEngine/flows/shared/signingStateMachine';
import { shouldRenderNearTransactionReview } from '@/core/signingEngine/uiConfirm/handlers/flows/signing';
import { parseNearEd25519SigningKeyId } from '@shared/utils/registrationIntent';

function buildPasskeySigningPlans(): {
  warm: SigningSessionPlan;
  fresh: SigningSessionPlan;
} {
  const thresholdSessionId = SigningSessionIds.thresholdEd25519Session('threshold-session');
  const lane = buildEd25519PasskeySigningLane({
    walletSessionId: SigningSessionIds.walletSession('wallet-session'),
    quotaId: SigningSessionIds.walletSessionQuota('wallet-quota'),
    walletId: toWalletId('wallet'),
    nearAccountId: toAccountId('alice.testnet'),
    nearEd25519SigningKeyId: parseNearEd25519SigningKeyId('ed25519ks_fixture'),
    signerSlot: 1,
    thresholdSessionId,
    storageSource: 'login',
    auth: {
      kind: 'passkey',
      rpId: toRpId('wallet.example.test'),
      credentialIdB64u: 'credential',
    },
  });
  const readiness = {
    status: 'ready' as const,
    curve: 'ed25519' as const,
    thresholdSessionId,
    remainingUses: 2,
    expiresAtMs: Date.now() + 60_000,
  };
  return {
    warm: planSigningSession({ lane, readiness }),
    fresh: planSigningSession({ lane, readiness, forceFreshAuth: true }),
  };
}

test('a fresh-auth retry retains the operation review approval', () => {
  const plans = buildPasskeySigningPlans();
  expect(plans.warm.kind).toBe(SigningSessionPlanKind.WarmSession);
  expect(plans.fresh.kind).toBe(SigningSessionPlanKind.PasskeyReauth);

  const operationId = SigningSessionIds.signingOperation('operation');
  const state = createSigningOperationStateRef({ operationId });
  planSigningOperationAttempt(state, plans.warm);
  expect(state.current.kind).toBe(SigningOperationStateKind.Planned);

  approveSigningOperationConfirmation(state);
  expect(state.current.kind).toBe(SigningOperationStateKind.ConfirmationApproved);

  planSigningOperationAttempt(state, plans.fresh);
  expect(state.current.kind).toBe(SigningOperationStateKind.ConfirmationApproved);
  expect('plan' in state.current ? state.current.plan.kind : null).toBe(
    SigningSessionPlanKind.PasskeyReauth,
  );
  expect(state.operationId).toBe(operationId);
});

test('unapproved retries remain planned and render transaction review again', () => {
  const plans = buildPasskeySigningPlans();
  const state = createSigningOperationStateRef({
    operationId: SigningSessionIds.signingOperation('unapproved-operation'),
  });

  planSigningOperationAttempt(state, plans.warm);
  planSigningOperationAttempt(state, plans.fresh);

  expect(state.current.kind).toBe(SigningOperationStateKind.Planned);
  expect(
    shouldRenderNearTransactionReview({
      signingOperationStateKind: SigningOperationStateKind.Planned,
      signingAuthMode: 'webauthn',
    }),
  ).toBe(true);
});

test('approved passkey retries continue without rendering transaction review again', () => {
  expect(
    shouldRenderNearTransactionReview({
      signingOperationStateKind: SigningOperationStateKind.Planned,
      signingAuthMode: 'warmSession',
    }),
  ).toBe(true);
  expect(
    shouldRenderNearTransactionReview({
      signingOperationStateKind: SigningOperationStateKind.ConfirmationApproved,
      signingAuthMode: 'webauthn',
    }),
  ).toBe(false);
  expect(
    isSigningOperationReviewApprovedStateKind(
      SigningOperationStateKind.ConfirmationApproved,
    ),
  ).toBe(true);
  expect(
    shouldRenderNearTransactionReview({
      signingOperationStateKind: SigningOperationStateKind.ConfirmationApproved,
      signingAuthMode: 'emailOtp',
    }),
  ).toBe(true);
});

test('cancelling transaction review records a review cancellation', () => {
  const plans = buildPasskeySigningPlans();
  const state = createSigningOperationStateRef({
    operationId: SigningSessionIds.signingOperation('review-cancelled-operation'),
  });

  planSigningOperationAttempt(state, plans.fresh);
  const cancelled = cancelSigningOperation(state);

  expect(cancelled).toEqual({
    kind: SigningOperationStateKind.Cancelled,
    plan: plans.fresh,
    phase: SigningOperationCancellationPhase.Review,
  });
});

test('cancelling the passkey prompt records an authentication cancellation', () => {
  const plans = buildPasskeySigningPlans();
  const state = createSigningOperationStateRef({
    operationId: SigningSessionIds.signingOperation('authentication-cancelled-operation'),
  });

  planSigningOperationAttempt(state, plans.fresh);
  applySigningOperationInteractionEvent(state, {
    kind: SigningOperationInteractionEventKind.ReviewApproved,
  });
  applySigningOperationInteractionEvent(state, {
    kind: SigningOperationInteractionEventKind.AuthenticationStarted,
  });
  const cancelled = cancelSigningOperation(state);

  expect(cancelled).toEqual({
    kind: SigningOperationStateKind.Cancelled,
    plan: plans.fresh,
    phase: SigningOperationCancellationPhase.Authentication,
  });
});

test('cancelling a combined Email OTP review records an authentication cancellation', () => {
  const plans = buildPasskeySigningPlans();
  const state = createSigningOperationStateRef({
    operationId: SigningSessionIds.signingOperation('email-otp-cancelled-operation'),
  });

  planSigningOperationAttempt(state, plans.fresh);
  applySigningOperationInteractionEvent(state, {
    kind: SigningOperationInteractionEventKind.AuthenticationStarted,
  });
  const cancelled = cancelSigningOperation(state);

  expect(cancelled).toEqual({
    kind: SigningOperationStateKind.Cancelled,
    plan: plans.fresh,
    phase: SigningOperationCancellationPhase.Authentication,
  });
});

test('a combined Email OTP prompt retains whether review was approved', () => {
  const plans = buildPasskeySigningPlans();
  const pendingReview = createSigningOperationStateRef({
    operationId: SigningSessionIds.signingOperation('email-otp-pending-review'),
  });

  planSigningOperationAttempt(pendingReview, plans.fresh);
  applySigningOperationInteractionEvent(pendingReview, {
    kind: SigningOperationInteractionEventKind.AuthenticationStarted,
  });
  planSigningOperationAttempt(pendingReview, plans.fresh);
  expect(pendingReview.current.kind).toBe(SigningOperationStateKind.Planned);

  applySigningOperationInteractionEvent(pendingReview, {
    kind: SigningOperationInteractionEventKind.AuthenticationStarted,
  });
  applySigningOperationInteractionEvent(pendingReview, {
    kind: SigningOperationInteractionEventKind.ReviewApproved,
  });
  applySigningOperationInteractionEvent(pendingReview, {
    kind: SigningOperationInteractionEventKind.AuthenticationCompleted,
  });
  planSigningOperationAttempt(pendingReview, plans.fresh);
  expect(pendingReview.current.kind).toBe(SigningOperationStateKind.ConfirmationApproved);
});

test('cancelling after passkey authentication records an execution cancellation', () => {
  const plans = buildPasskeySigningPlans();
  const state = createSigningOperationStateRef({
    operationId: SigningSessionIds.signingOperation('execution-cancelled-operation'),
  });

  planSigningOperationAttempt(state, plans.fresh);
  applySigningOperationInteractionEvent(state, {
    kind: SigningOperationInteractionEventKind.ReviewApproved,
  });
  applySigningOperationInteractionEvent(state, {
    kind: SigningOperationInteractionEventKind.AuthenticationStarted,
  });
  applySigningOperationInteractionEvent(state, {
    kind: SigningOperationInteractionEventKind.AuthenticationCompleted,
  });
  const cancelled = cancelSigningOperation(state);

  expect(cancelled).toEqual({
    kind: SigningOperationStateKind.Cancelled,
    plan: plans.fresh,
    phase: SigningOperationCancellationPhase.Execution,
  });
});
