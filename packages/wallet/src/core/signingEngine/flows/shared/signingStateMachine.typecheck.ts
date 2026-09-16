import {
  SigningOperationStateKind,
  type SigningOperationConfirmationStateKind,
  type SigningOperationState,
  type SigningOperationStateRef,
} from './signingStateMachine';

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

void createdState;
void createdStateWithPlan;
void approvedStateWithoutPlan;
void stateWithoutOperationId;
void completedConfirmationState;
