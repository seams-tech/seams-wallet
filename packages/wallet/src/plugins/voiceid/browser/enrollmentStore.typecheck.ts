import type { VoiceEnrollment } from './enrollmentStore';

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
