import {
  SigningOperationCancellationPhase,
  SigningOperationReviewApproval,
  SigningOperationStateKind,
  type SigningOperationConfirmationStateKind,
  type SigningOperationState,
  type SigningOperationStateRef,
} from './signingStateMachine';
import type { SigningSessionPlan } from '../../session/operationState/types';

declare const signingSessionPlan: SigningSessionPlan;

const createdState: SigningOperationState = {
  kind: SigningOperationStateKind.Created,
};

const createdStateWithPlan: SigningOperationState = {
  kind: SigningOperationStateKind.Created,
  // @ts-expect-error A created operation has no session plan yet.
  plan: null,
};

// @ts-expect-error Approval always retains the exact session plan it approved.
const approvedStateWithoutPlan: SigningOperationState = {
  kind: SigningOperationStateKind.ConfirmationApproved,
};

// @ts-expect-error Operation state cannot exist without its stable operation identity.
const stateWithoutOperationId: SigningOperationStateRef = {
  current: createdState,
};

// @ts-expect-error A completed operation cannot be sent back through confirmation.
const completedConfirmationState: SigningOperationConfirmationStateKind =
  SigningOperationStateKind.Completed;

const authenticationCancelledState: SigningOperationState = {
  kind: SigningOperationStateKind.Cancelled,
  plan: signingSessionPlan,
  phase: SigningOperationCancellationPhase.Authentication,
};

const authenticationInProgressState: SigningOperationState = {
  kind: SigningOperationStateKind.AuthenticationInProgress,
  plan: signingSessionPlan,
  reviewApproval: SigningOperationReviewApproval.Pending,
};

// @ts-expect-error Authentication progress must retain whether review was approved.
const authenticationInProgressWithoutReview: SigningOperationState = {
  kind: SigningOperationStateKind.AuthenticationInProgress,
  plan: signingSessionPlan,
};

const cancelledStateWithoutPhase: SigningOperationState = {
  kind: SigningOperationStateKind.Cancelled,
  plan: signingSessionPlan,
  // @ts-expect-error A cancelled operation identifies the phase that accepted cancellation.
  phase: undefined,
};

void createdState;
void createdStateWithPlan;
void approvedStateWithoutPlan;
void stateWithoutOperationId;
void completedConfirmationState;
void authenticationCancelledState;
void authenticationInProgressState;
void authenticationInProgressWithoutReview;
void cancelledStateWithoutPhase;
