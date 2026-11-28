import { isPlainObject } from '@shared/utils/validation';
import type { SpeakToSignEnrollmentResult } from '../hostPlugin';
import { SPEAK_TO_SIGN_VERIFIER_BACKEND } from '../verifiers/backend';
import { shortDetail, verifierUnavailable } from './result';

type EnrollmentRefusal = Extract<SpeakToSignEnrollmentResult, { kind: 'refused' }>['reason'];

/** Each refusal of the verifier's `enroll`. A new reason in the Wallet fails to compile here. */
const ENROLLMENT_REFUSALS: Readonly<Record<EnrollmentRefusal, true>> = {
  quality: true,
  speaker: true,
  audio_reused: true,
  audio_invalid: true,
  unsupported: true,
  speaker_unavailable: true,
  storage: true,
  template_exists: true,
  not_authorized: true,
  authorization_unavailable: true,
};

/**
 * Reads the verifier's `enroll` output that the Seams route passes through unchanged. Both
 * backends name the same fields; only the `kind` differs.
 */
export function readEnrollmentOutput(
  output: unknown,
  kind = SPEAK_TO_SIGN_VERIFIER_BACKEND.enrollmentKind,
): SpeakToSignEnrollmentResult {
  if (!isPlainObject(output) || output.kind !== kind) {
    return verifierUnavailable('invalid output');
  }
  const detail = typeof output.detail === 'string' ? shortDetail(output.detail) : undefined;
  if (output.outcome === 'accept') {
    const epoch = output.template_epoch;
    const agreement = output.agreement_milli;
    if (!isSafeInteger(epoch) || epoch < 1 || !isSafeInteger(agreement)) {
      return verifierUnavailable('invalid output');
    }
    return { kind: 'enrolled', templateEpoch: epoch, agreementMilli: agreement };
  }
  const reason = output.reason;
  if (output.outcome !== 'refuse' || !isEnrollmentRefusal(reason)) {
    return verifierUnavailable('invalid output');
  }
  return detail === undefined ? { kind: 'refused', reason } : { kind: 'refused', reason, detail };
}

function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function isEnrollmentRefusal(value: unknown): value is EnrollmentRefusal {
  return typeof value === 'string' && Object.hasOwn(ENROLLMENT_REFUSALS, value);
}
