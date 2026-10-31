import type { ActionResult } from '../../packages/wallet/src/core/types/seams';
import type {
  OwnerNearOutcome,
  OwnerNearOperationState,
  PrepareOwnerNearTransaction,
} from '../../packages/wallet/src/SeamsWeb/publicApi/ownerNearOperation';
import type { ExternalWalletAuthentication } from '../../packages/shared-ts/src/auth/externalAuth';
import type { RegistrationEstablishedSessionResultV2 } from '../../packages/shared-ts/src/utils/registrationEstablishedSession';
import type { OwnerNearRecovery } from '../../packages/wallet/src/SeamsWeb/walletIframe/shared/ownerNearOperation';
import type { Variant } from '../../packages/shared-ts/src/utils/variant';

declare const completedResult: Extract<ActionResult, { success: true }>;
declare const authentication: ExternalWalletAuthentication;
declare const recovery: OwnerNearRecovery;
declare const submitting: Extract<OwnerNearOperationState, { kind: 'submitting' }>;
declare const reusableSession: Extract<RegistrationEstablishedSessionResultV2, { kind: 'issued' }>;

// @ts-expect-error The operation requires an external read capability.
const missingConnection: PrepareOwnerNearTransaction = {
  nearAccountId: 'owner.testnet',
  transaction: { receiverId: 'receiver.testnet', actions: [] },
};

const mixedReadCapability: ExternalWalletAuthentication = {
  ...authentication,
  // @ts-expect-error Read access does not contain reusable signing authority.
  authMethod: 'passkey',
};

// @ts-expect-error Submission cannot also claim a completed result.
const contradictoryState: OwnerNearOperationState = { ...submitting, result: completedResult };

// @ts-expect-error Cancellation cannot carry a live approval deadline.
const contradictoryCancellation: OwnerNearOperationState = {
  kind: 'cancelled',
  recovery,
  expiresAtMs: Date.now() + 60_000,
};

// @ts-expect-error Owner-only registration cannot carry a reusable session through a spread.
const ownerRegistrationWithSession: RegistrationEstablishedSessionResultV2 = {
  ...reusableSession,
  kind: 'owner_operations',
  walletId: authentication.walletId,
};

void [
  missingConnection,
  mixedReadCapability,
  contradictoryState,
  contradictoryCancellation,
  ownerRegistrationWithSession,
];

declare const failedResult: Extract<ActionResult, { success: false }>;
// @ts-expect-error A completed owner outcome cannot contain a failed transaction.
const completedWithFailure: OwnerNearOutcome = { kind: 'completed', result: failedResult };
void completedWithFailure;

declare const unresolved: Variant<OwnerNearOutcome, 'kind', 'unresolved'>;

// @ts-expect-error An unresolved transaction always retains its hash.
const unresolvedWithoutHash: OwnerNearOutcome = {
  kind: 'unresolved',
  recovery,
  error: 'RPC unavailable',
};

// @ts-expect-error Non-submission cannot carry a hash through an object spread.
const nonSubmissionWithHash: OwnerNearOutcome = { ...unresolved, kind: 'not_submitted' };

// @ts-expect-error Recovery failures require the exact operation to check again.
const recoveryWithoutIdentity: OwnerNearOutcome = {
  kind: 'recovery_unavailable',
  error: 'Storage unavailable',
};

// @ts-expect-error Submission always exposes its known transaction hash.
const submittingWithoutHash: OwnerNearOperationState = { kind: 'submitting', recovery };

// @ts-expect-error A direct assertion cannot make contradictory lifecycle branches overlap.
const unsafeNonSubmission = {
  kind: 'not_submitted',
  error: 'Cancelled',
  transactionId: 'hash',
} as Variant<OwnerNearOutcome, 'kind', 'not_submitted'>;

void [
  unresolvedWithoutHash,
  nonSubmissionWithHash,
  recoveryWithoutIdentity,
  submittingWithoutHash,
  unsafeNonSubmission,
];
