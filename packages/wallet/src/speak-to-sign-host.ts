// Scoped operations and data contracts for the trusted Speak-to-Sign plugin.
export {
  SPEAK_TO_SIGN_HOST_API_VERSION,
  type SpeakToSignEnrollmentResult,
  type SpeakToSignHostEnrollment,
  type SpeakToSignHostOperations,
  type SpeakToSignHostPlugin,
  type SpeakToSignTransferResult,
} from './core/transactionFeatures/hostPlugin';
export {
  isSpeakableAccount,
  parseSpeakableNear,
  renderTransfer,
} from './core/transactionFeatures/spokenTransfer';
export { isPlainObject } from '@shared/utils/validation';
export { base64Encode } from '@shared/utils/base64';
