import type {
  TransactionReview,
  TransactionReviewValidity,
} from '@/react/transactionReview/contract';

const render = () => null;

const unbounded: TransactionReview = {
  title: 'Review purchase',
  validity: { kind: 'unbounded' },
  render,
};

const expiring: TransactionReview = {
  title: 'Review purchase',
  validity: { kind: 'expires_at', atMs: 1 },
  render,
};

// @ts-expect-error An expiring review requires a deadline.
const missingDeadline: TransactionReviewValidity = { kind: 'expires_at' };

// @ts-expect-error An unbounded review cannot have a deadline.
const contradictoryValidity: TransactionReviewValidity = { kind: 'unbounded', atMs: 1 };

// @ts-expect-error Reviewed calls require explicit validity.
const missingValidity: TransactionReview = { title: 'Review purchase', render };

void unbounded;
void expiring;
void missingDeadline;
void contradictoryValidity;
void missingValidity;

import type { BoundNearSigner, BoundEvmSigner, BoundTempoSigner } from '@/react/boundWallet';

type NearReviewInput = Parameters<BoundNearSigner['signAndSendTransaction']>[0];
const ordinaryDrawer: NearReviewInput = {
  receiverId: 'receiver.testnet',
  actions: [],
  options: { confirmationConfig: { uiMode: 'drawer' } },
};
const reviewedModal: NearReviewInput = {
  receiverId: 'receiver.testnet',
  actions: [],
  review: unbounded,
  options: { confirmationConfig: { uiMode: 'modal', behavior: 'requireClick' } },
};
// @ts-expect-error Reviewed calls cannot silently choose a drawer.
const reviewedDrawer: NearReviewInput = {
  receiverId: 'receiver.testnet',
  actions: [],
  review: unbounded,
  options: { confirmationConfig: { uiMode: 'drawer' } },
};
// @ts-expect-error Reviewed calls require wallet approval.
const reviewedAutomatic: NearReviewInput = {
  receiverId: 'receiver.testnet',
  actions: [],
  review: unbounded,
  options: { confirmationConfig: { behavior: 'skipClick' } },
};
const broadOptions = { confirmationConfig: { uiMode: 'drawer' as const } };
// @ts-expect-error Broad option spreads cannot introduce incompatible reviewed modes.
const reviewedSpread: NearReviewInput = {
  receiverId: 'receiver.testnet',
  actions: [],
  review: unbounded,
  options: { ...broadOptions },
};
type AllReviewed = [
  Parameters<BoundNearSigner['signAndSendTransaction']>[0]['review'],
  Parameters<BoundEvmSigner['signTransaction']>[0]['review'],
  Parameters<BoundEvmSigner['signAndSendTransaction']>[0]['review'],
  Parameters<BoundTempoSigner['signTransaction']>[0]['review'],
  Parameters<BoundTempoSigner['signAndSendTransaction']>[0]['review'],
];
const allReviewed: AllReviewed = [unbounded, unbounded, unbounded, unbounded, unbounded];
void ordinaryDrawer;
void reviewedModal;
void reviewedDrawer;
void reviewedAutomatic;
void reviewedSpread;
void allReviewed;

import type {
  TransactionDispatch,
  TransactionReviewReservation,
} from '@/SeamsWeb/walletIframe/client/transactionReviewReservation';
import type { UiConfirmSurfaceMeasurementBinding } from '@/core/signingEngine/uiConfirm/uiConfirm.types';
import type { TransactionReviewAdmission } from '@/core/signingEngine/uiConfirm/transactionReviewAdmission';
declare const reservation: TransactionReviewReservation;
declare const admission: TransactionReviewAdmission;
// @ts-expect-error An ordinary dispatch cannot carry a reviewed reservation.
const ordinaryWithReservation: TransactionDispatch = { kind: 'ordinary', reservation };
const reviewedFields = { reservation };
// @ts-expect-error Spreading a reservation cannot bypass the ordinary branch.
const ordinaryWithSpread: TransactionDispatch = { ...reviewedFields, kind: 'ordinary' };
// @ts-expect-error Disabled measurement cannot carry an active review gate.
const disabledReview: UiConfirmSurfaceMeasurementBinding = {
  kind: 'disabled',
  transactionReview: admission,
};
void ordinaryWithReservation;
void ordinaryWithSpread;
void disabledReview;

import type { VoiceIdApproval } from '@voiceid/capture/approval';
import type { AuthMethodReviewPolicy } from '@/core/authMethods/hostPlugin';
declare const voiceApproval: VoiceIdApproval;
const requiredVoice: AuthMethodReviewPolicy = { kind: 'required', approval: voiceApproval };
// @ts-expect-error A required voice policy must carry its operation-bound approval.
const missingVoiceApproval: AuthMethodReviewPolicy = { kind: 'required' };
// @ts-expect-error A disabled policy cannot carry an approval.
const disabledWithVoice: AuthMethodReviewPolicy = { kind: 'disabled', approval: voiceApproval };
const voiceFields = { approval: voiceApproval };
// @ts-expect-error A spread cannot carry approval into the disabled branch.
const disabledVoiceSpread: AuthMethodReviewPolicy = { kind: 'disabled', ...voiceFields };
// @ts-expect-error Object literals cannot construct a voice approval's private lifecycle.
const fabricatedVoice: VoiceIdApproval = { approve: async () => {}, consume: () => {} };
// @ts-expect-error A spread loses the private lifecycle and cannot construct a voice approval.
const copiedVoice: VoiceIdApproval = { ...voiceApproval };
// @ts-expect-error An approval label cannot be asserted into the private lifecycle.
const assertedVoice = 'approved' as VoiceIdApproval;
void requiredVoice;
void missingVoiceApproval;
void disabledWithVoice;
void disabledVoiceSpread;
void fabricatedVoice;
void copiedVoice;
void assertedVoice;

import type { ReviewCallState } from '@/react/transactionReview/controller';
import type { TransactionReviewReservationState } from '@/SeamsWeb/walletIframe/client/transactionReviewReservation';
const reviewing = { kind: 'reviewing', reservation } as const;
// @ts-expect-error A settled call cannot retain an active reservation through a spread.
const settledReservation: ReviewCallState = { ...reviewing, kind: 'settled' };
const prepared = { kind: 'preparing', prepared: true } as const;
// @ts-expect-error Preparation metadata cannot leak into the signing phase.
const signingPreparation: TransactionReviewReservationState = { ...prepared, kind: 'signing' };
void settledReservation;
void signingPreparation;

import type { TransactionReviewWire } from '@/SeamsWeb/walletIframe/shared/transactionReview';
declare const wire: TransactionReviewWire;
// @ts-expect-error A renderer cannot enter the serialized request through a spread.
const wireWithRenderer: TransactionReviewWire = { ...wire, ...unbounded };
// @ts-expect-error A wire request requires its connection identity.
const wireWithoutConnection: TransactionReviewWire = {
  kind: 'transaction_review_v1',
  requestId: 'request',
  surfaceId: 'surface',
  generation: 1,
  validity: { kind: 'unbounded' },
};
void wireWithRenderer;
void wireWithoutConnection;

// @ts-expect-error Returning to review cannot retain preparation metadata.
const returnedPreparation: TransactionReviewReservationState = {
  ...prepared,
  kind: 'reviewing_again',
};
void returnedPreparation;
