// Scoped operations and data contracts for the trusted VoiceID plugin.
export { VOICE_ID_HOST_API_VERSION } from './core/authMethods/hostPlugin';
export {
  type WalletAuthMethodHostPlugin,
  type AuthMethodActivationResult,
  type AuthMethodApprovalResult,
  type AuthMethodCaptureMount,
  type AuthMethodCaptureSettlement,
  type AuthMethodUnlockSuccess,
} from './core/authMethods/hostPlugin';
export { type Variant } from '@shared/utils/variant';
export {
  type VoiceIdActivationPreparation,
  type VoiceOwnerConfirmation,
  type VoiceIdReviewRequest,
  type VoiceIdUnlockChallenge,
} from './core/authMethods/voiceId/boundary';
export {
  type VoiceIdTranscriptionModel,
  type VoiceIdAuthMethodPlugin,
} from './core/authMethods/plugins';
export { WorkerDeferred } from './core/signingEngine/workerManager/workerDeferred';
export { prepareVoiceOwner } from './core/authMethods/voiceId/ownerConfirmation';
export { toError } from '@shared/utils/errors';
export {
  voiceEnrollmentStorage,
  resolveVoiceEnrollmentScope,
  assertVoiceOwner,
  resolveSelectedVoiceEnrollmentScope,
  resolveActivatingVoiceEnrollmentScope,
} from './core/authMethods/voiceId/enrollmentStorage';
export {
  type VoiceEnrollment,
  type VoiceEnrollmentAuthorization,
  type VoiceEnrollmentChange,
  type VoiceEnrollmentConfirmationRequest,
  type VoiceEnrollmentScope,
  type VoiceEnrollmentSnapshot,
  type VoiceTemplateAccess,
  type VoiceIdActivationCapture,
  type VoiceIdUnlockCapture,
} from './core/authMethods/voiceId/contracts';
export { requireRecord, isFiniteNumber, isPlainObject } from '@shared/utils/validation';
export {
  readVoiceMicrophonePreference,
  saveVoiceMicrophonePreference,
} from './core/authMethods/voiceId/microphonePreference';
export { type VoiceConfirmation } from './core/authMethods/voiceId/confirmationCommand';
export { type WalletId } from '@shared/utils/domainIds';
export {
  voiceIdWalletSessionChallengeBytes,
  parseVoiceIdDeviceAssertion,
} from '@shared/authorization/voiceIdDeviceAssertion';
export { base64UrlEncode } from '@shared/utils/base64';
export {
  createBrowserVoiceDevice,
  readBrowserVoiceDevice,
  openBrowserVoiceFactor,
} from './core/authMethods/voiceId/deviceStore';
export {
  createCspStylesheetManager,
  getDefaultCspNonce,
} from './core/browser/walletIframe/csp-stylesheet';
export { authMenuSuccessCopy } from './SeamsWeb/walletIframe/host/auth-menu/domain';
export { type UiConfirmSurfaceMeasurementBinding } from './core/signingEngine/uiConfirm/uiConfirm.types';
export {
  createWalletIframeSurfaceMeasurementReporter,
  type WalletIframeSurfaceMeasurementReporter,
} from './SeamsWeb/walletIframe/host/surface-measurement-reporter';
export { SeamsWordmark } from './core/signingEngine/uiConfirm/ui/preact/SeamsWordmark';
export { backIcon } from './SeamsWeb/walletIframe/host/ui/auth-menu/icons';
export { TransactionReviewError } from './SeamsWeb/walletIframe/shared/transactionReview';
export type { VoiceMicrophonePreference } from './core/authMethods/voiceId/microphonePreference';
