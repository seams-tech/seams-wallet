import type {
  VoiceEnrollment,
  VoiceOwnerGuard,
  VoiceActivationGuard,
  VoiceChangeGuard,
  VoiceEnrollmentConfirmationRequest,
  VoiceTemplateAccess,
} from '../../packages/wallet/src/core/authMethods/voiceId/contracts';
import type { Variant } from '../../packages/shared-ts/src/utils/variant';
import {
  commitVoiceEnrollment,
  type VoiceEnrollmentChange,
} from '../../packages/voiceid/src/browser/enrollmentStore';
import { enrollBrowserVoice } from '../../packages/voiceid/src/browser/enrollment';
import { manageVoiceEnrollment } from '../../packages/voiceid/src/activation/manageEnrollment';

declare const samples: readonly (readonly number[])[];

const baseline: VoiceEnrollment['adaptation'] = { kind: 'baseline' };
const adapted: VoiceEnrollment['adaptation'] = { kind: 'adapted', samples };

// @ts-expect-error An improved enrollment requires its samples.
const missingSamples: VoiceEnrollment['adaptation'] = { kind: 'adapted' };

// @ts-expect-error The original-only branch cannot contain supplemental samples.
const mixedLiteral: VoiceEnrollment['adaptation'] = { kind: 'baseline', samples };

const mixedSpread = { ...baseline, samples };
// @ts-expect-error Spreading the original-only state cannot add supplemental samples.
const mixedState: VoiceEnrollment['adaptation'] = mixedSpread;

// @ts-expect-error Expiry metadata is accepted only at the persistence boundary.
const timed: VoiceEnrollment['adaptation'] = { ...adapted, expiresAtMs: 1 };

// @ts-expect-error Verification cannot consume a stored sample budget.
const counted: VoiceEnrollment['adaptation'] = { ...adapted, remainingUses: 1 };

void [baseline, adapted, missingSamples, mixedLiteral, mixedState, timed, counted];

declare const activationGuard: VoiceActivationGuard;
declare const changeGuard: VoiceChangeGuard;

// @ts-expect-error Enrollment changes require a confirming passkey identity.
const missingConfirmer: VoiceOwnerGuard = { ...activationGuard, target: 'enrolled' };

// @ts-expect-error Activation cannot retain enrollment-change authorization through a spread.
const mixedGuard: VoiceOwnerGuard = { ...changeGuard, target: 'activating' };

// @ts-expect-error A direct activation literal cannot name a confirming passkey.
const invalidActivation: VoiceOwnerGuard = {
  target: 'activating',
  sessionMethodId: activationGuard.sessionMethodId,
  walletSessionId: activationGuard.walletSessionId,
  lockGeneration: 0,
  expiresAtMs: 1,
  availabilityRevision: '',
  confirmationMethodId: changeGuard.confirmationMethodId,
};

void [missingConfirmer, mixedGuard, invalidActivation];

declare const activation: Variant<VoiceEnrollmentChange, 'kind', 'activate'>;
declare const improvement: Variant<VoiceEnrollmentChange, 'kind', 'improve'>;
declare const reset: Variant<VoiceEnrollmentChange, 'kind', 'reset'>;
declare const importRequest: Variant<VoiceEnrollmentConfirmationRequest, 'kind', 'import'>;

// @ts-expect-error Activation requires its activation guard, including direct construction.
const crossedActivation: VoiceEnrollmentChange = {
  kind: 'activate',
  scope: activation.scope,
  signal: activation.signal,
  baseline: activation.baseline,
  snapshot: activation.snapshot,
  guard: changeGuard,
};
// @ts-expect-error An activation cannot replace an existing enrollment through a broad spread.
const activationOverExisting: VoiceEnrollmentChange = {
  ...activation,
  snapshot: improvement.snapshot,
};
// @ts-expect-error A confirmation is required even with valid change guard and existing enrollment.
const unconfirmedReset: VoiceEnrollmentChange = {
  kind: 'reset',
  scope: reset.scope,
  signal: reset.signal,
  guard: reset.guard,
  snapshot: reset.snapshot,
};
// @ts-expect-error Reset cannot acquire replacement samples through a broad spread.
const resetWithSamples: VoiceEnrollmentChange = { ...reset, samples };
// @ts-expect-error Import confirmation requires a missing enrollment.
const importOverExisting: VoiceEnrollmentConfirmationRequest = {
  ...importRequest,
  snapshot: improvement.snapshot,
};
// @ts-expect-error Improvement cannot be cast into a new activation.
const castActivation = improvement as typeof activation;
const crossedAccess: VoiceTemplateAccess = {
  kind: 'activation',
  scope: activation.scope,
  // @ts-expect-error Activation matching cannot use a later enrollment-change guard.
  owner: changeGuard,
};
void commitVoiceEnrollment(
  activation.scope,
  // @ts-expect-error Independent lifecycle arguments are no longer accepted.
  activation.guard,
  activation.snapshot,
  activation,
  activation.signal,
);

type CapturePlan = Parameters<typeof enrollBrowserVoice>[1];
declare const capture: Variant<CapturePlan, 'kind', 'activate'>;
declare const model: Parameters<typeof enrollBrowserVoice>[3];
declare const confirmChange: Parameters<typeof manageVoiceEnrollment>[1];
// @ts-expect-error Capture uses the same action-specific guard as persistence.
const crossedCapture: CapturePlan = { ...capture, guard: changeGuard };
// @ts-expect-error Enrollment requires its explicit container.
void enrollBrowserVoice(capture, activation.signal, model);
// @ts-expect-error Management requires its explicit container.
void manageVoiceEnrollment(confirmChange, activation.scope, activation.signal, model);

void [
  crossedActivation,
  activationOverExisting,
  unconfirmedReset,
  resetWithSamples,
  importOverExisting,
  castActivation,
  crossedAccess,
  crossedCapture,
];
