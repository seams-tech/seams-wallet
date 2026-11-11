// The data contracts of the trusted Speak-to-Sign plugin (host API 12). The plugin gets bound
// operations for one request: it passes no intent, no sentence and no audio back to core.
export {
  SPEAK_TO_SIGN_HOST_API_VERSION,
  type SpeakToSignApprovalOperations,
  type SpeakToSignApprovalResult,
  type SpeakToSignClipHandle,
  type SpeakToSignEnrollmentOperations,
  type SpeakToSignEnrollmentReply,
  type SpeakToSignEnrollmentResult,
  type SpeakToSignHostApproval,
  type SpeakToSignHostEnrollment,
  type SpeakToSignHostPlugin,
  type SpeakToSignMessageResult,
  type SpeakToSignNoteActionResult,
  type SpeakToSignPaymentHooks,
  type SpeakToSignRecording,
  type SpeakToSignRequestView,
  type SpeakToSignSigning,
  type SpeakToSignSurface,
  type SpeakToSignTransferResult,
  type SpeakToSignVerifyReply,
} from './core/transactionFeatures/hostPlugin';
export { type VerifierRefusal } from './core/transactionFeatures/voiceVerdict';
export {
  type PhraseCheckView,
  type PhraseResultView,
  type PhraseSegmentState,
} from './core/authMethods/hostPlugin';
export { isPlainObject } from '@shared/utils/validation';
