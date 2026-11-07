// Scoped operations and data contracts for the trusted Speak-to-Sign plugin.
export {
  SPEAK_TO_SIGN_HOST_API_VERSION,
  type SpeakToSignHostOperations,
  type SpeakToSignHostPlugin,
  type SpeakToSignTransferResult,
} from './core/transactionFeatures/hostPlugin';
export { isPlainObject } from '@shared/utils/validation';
export { base64UrlEncode } from '@shared/utils/base64';
