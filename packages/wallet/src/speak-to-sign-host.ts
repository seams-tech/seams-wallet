// Scoped operations and data contracts for the trusted Speak-to-Sign plugin.
export {
  SPEAK_TO_SIGN_HOST_API_VERSION,
  type SpeakToSignEnrollmentRecording,
  type SpeakToSignEnrollmentResult,
  type SpeakToSignHostEnrollment,
  type SpeakToSignHostNote,
  type SpeakToSignHostOperations,
  type SpeakToSignHostPlugin,
  type SpeakToSignNoteResult,
  type SpeakToSignPayment,
  type SpeakToSignPaymentHooks,
  type SpeakToSignPrompt,
  type SpeakToSignTransferResult,
} from './core/transactionFeatures/hostPlugin';
export { type VerifierRefusal } from './core/transactionFeatures/voiceVerdict';
export {
  noteActionRefusal,
  noteVerifyRequest,
  renderNoteAction,
  type SpokenNoteAction,
} from './core/transactionFeatures/spokenNote';
export {
  type PhraseCheckView,
  type PhraseResultView,
  type PhraseSegmentState,
} from './core/authMethods/hostPlugin';
export {
  isSpeakableAccount,
  parseSpeakableNear,
  renderTransfer,
} from './core/transactionFeatures/spokenTransfer';
export { isPlainObject } from '@shared/utils/validation';
export { base64Encode } from '@shared/utils/base64';
