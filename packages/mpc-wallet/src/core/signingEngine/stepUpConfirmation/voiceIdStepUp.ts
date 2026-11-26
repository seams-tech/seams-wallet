import { SENSITIVE_OPERATION_POLICIES } from '@shared/utils/signerDomain';

const VOICE_ID_STEP_UP_REQUIRED = 'voiceid_step_up_required';

/**
 * A VoiceID session needs fresh authentication before this operation can sign.
 * Every site throws it before a signature, so the signing surface can run the
 * VoiceID step-up and start the operation again.
 */
export class VoiceIdStepUpRequiredError extends Error {
  readonly code = VOICE_ID_STEP_UP_REQUIRED;

  constructor(message = 'Unlock with VoiceID again before signing.') {
    super(message);
    this.name = 'VoiceIdStepUpRequiredError';
  }
}

export function isVoiceIdStepUpRequired(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current !== 'object') return false;
    if (Reflect.get(current, 'code') === VOICE_ID_STEP_UP_REQUIRED) return true;
    current = Reflect.get(current, 'cause');
  }
  return false;
}

/**
 * The arguments of a signing attempt after a VoiceID step-up in the same call. The new VoiceID
 * unlock is the fresh approval with the session's own method, so `require_fresh_same_method`
 * is met and the attempt signs with the new session. Every other policy stays.
 */
export function afterVoiceIdStepUp<T extends object>(args: T): T {
  return 'sensitivePolicy' in args &&
    args.sensitivePolicy === SENSITIVE_OPERATION_POLICIES.requireFreshSameMethod
    ? { ...args, sensitivePolicy: undefined }
    : args;
}
