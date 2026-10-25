import { type WalletAuthMethodPlugin } from '../../packages/wallet/src/core/authMethods/plugins';
import { voiceIdAuthMethod } from '../../packages/wallet/src/plugins/voiceid/descriptor';
import { ConfirmedVoiceChange } from '../../packages/wallet/src/plugins/voiceid/activation/ownerConfirmation';
import type {
  VoiceEnrollmentChange,
  VoiceEnrollment,
} from '../../packages/wallet/src/plugins/voiceid/browser/enrollmentStore';

declare const assertCurrentOwner: (signal: AbortSignal) => Promise<void>;
// @ts-expect-error Confirmation must verify a fresh passkey assertion.
new ConfirmedVoiceChange('forged', Date.now(), assertCurrentOwner);
declare const consumeChange: ConfirmedVoiceChange['consume'];
// @ts-expect-error A plain object cannot manufacture a passkey confirmation.
const forgedChange: ConfirmedVoiceChange = { consume: consumeChange };
declare const confirmedChange: ConfirmedVoiceChange;
// @ts-expect-error Spreading removes private proof identity.
const copiedChange: ConfirmedVoiceChange = { ...confirmedChange, consume: confirmedChange.consume };
// @ts-expect-error Improvement requires fresh confirmation.
const unconfirmedImprovement: VoiceEnrollmentChange = { kind: 'improve', samples: [] };
const improvementFields = { samples: [] };
// @ts-expect-error Reset cannot carry replacement samples.
const resetWithSamples: VoiceEnrollmentChange = {
  kind: 'reset',
  confirmation: confirmedChange,
  ...improvementFields,
};
// @ts-expect-error Adaptation requires both expiry and a remaining-use bound.
const unlimitedAdaptation: VoiceEnrollment['adaptation'] = { kind: 'adapted', samples: [] };
void forgedChange;
void copiedChange;
void unconfirmedImprovement;
void resetWithSamples;
void unlimitedAdaptation;

import type { PreparedVoiceCapture } from '../../packages/wallet/src/plugins/voiceid/capture/surface';
declare const managementAction: (signal: AbortSignal) => Promise<void>;
const recordingDeadline = { expiresAtMs: Date.now() };
// @ts-expect-error Management has per-action owner confirmation, not a recording deadline.
const mixedCapture: PreparedVoiceCapture<void> = {
  kind: 'management',
  action: managementAction,
  ...recordingDeadline,
};
void mixedCapture;
import type { SeamsConfigsInput } from '../../packages/wallet/src/core/types/seams';
import type { VerifiedVoiceIdSessionProof } from '../../packages/wallet-server/src/authorization/voiceIdDeviceProof';
import type {
  AuthMethodApprovalResult,
  AuthMethodReviewPolicy,
  AuthMethodReviewApproval,
} from '../../packages/wallet/src/core/authMethods/hostPlugin';
import type {
  WalletAuthMethodHostPlugin,
  AuthMethodSessionInstaller,
} from '../../packages/wallet/src/core/authMethods/hostPlugin';
import type { WalletId, WalletAuthMethodId } from '../../packages/shared-ts/src/utils/domainIds';
import type {
  SigningLaneAuthBinding,
  OwnerLaneScope,
} from '@/core/signingEngine/session/identity/signingLaneAuthBinding';
import type { ExactEcdsaSigningLaneIdentity } from '@/core/signingEngine/session/identity/exactSigningLaneIdentity';

const enabled: SeamsConfigsInput = { authMethods: [voiceIdAuthMethod()] };
void enabled;

// @ts-expect-error A wallet auth method plugin needs an exact known kind.
const unknownMethod: WalletAuthMethodPlugin = { kind: 'unknown' };
void unknownMethod;

// @ts-expect-error A browser callback cannot cross into the wallet iframe.
const callbackPlugin: WalletAuthMethodPlugin = { kind: 'voiceid', load: async () => ({}) };
void callbackPlugin;

declare const approval: AuthMethodReviewApproval;
const requiredPolicy: AuthMethodReviewPolicy = { kind: 'required', approval };
// @ts-expect-error Required policy needs an approval implementation.
const missingApproval: AuthMethodReviewPolicy = { kind: 'required' };
const approvalFields = { approval };
// @ts-expect-error Disabled policy rejects approval fields, including broad spreads.
const disabledWithApproval: AuthMethodReviewPolicy = { kind: 'disabled', ...approvalFields };
void requiredPolicy;
void missingApproval;
void disabledWithApproval;

declare const hostPlugin: WalletAuthMethodHostPlugin;
declare const walletId: WalletId;
declare const walletAuthMethodId: WalletAuthMethodId;
declare const assertUnlockActive: () => void;
// @ts-expect-error A plugin unlock must prepare its core signing installer after its prompt opens.
hostPlugin.unlock({
  relayerUrl: 'https://router.example.test',
  walletId,
  walletAuthMethodId,
  assertActive: assertUnlockActive,
  surfaceMeasurementBinding: { kind: 'disabled' },
});
// @ts-expect-error An installer can return only a successful installed unlock.
const failedInstaller: AuthMethodSessionInstaller = async () => ({
  success: false,
  error: 'not installed',
});
void failedInstaller;

declare const verifiedProofFields: Pick<VerifiedVoiceIdSessionProof, 'challenge' | 'deviceKeyId'>;
// @ts-expect-error Only the server verifier can construct verified VoiceID proof.
const forgedProof: VerifiedVoiceIdSessionProof = { ...verifiedProofFields };
void forgedProof;

declare const voiceIdLane: Extract<SigningLaneAuthBinding, { kind: 'voiceid' }>;
const voiceWithPasskeyFields = { ...voiceIdLane, rpId: 'wallet.example.test' };
// @ts-expect-error VoiceID cannot acquire passkey data through a broad spread.
void (voiceWithPasskeyFields satisfies SigningLaneAuthBinding);
const voiceWithoutAuthority = { auth: voiceIdLane };
// @ts-expect-error VoiceID requires its exact selected Wallet authority.
void (voiceWithoutAuthority satisfies OwnerLaneScope);

declare const ecdsaIdentity: ExactEcdsaSigningLaneIdentity;
const ecdsaWithVoice = { ...ecdsaIdentity, auth: voiceIdLane };
// @ts-expect-error The NEAR VoiceID plugin cannot construct an ECDSA signing identity.
void (ecdsaWithVoice satisfies ExactEcdsaSigningLaneIdentity);

// @ts-expect-error A retry must provide an actionable message.
const missingRetryMessage: AuthMethodApprovalResult = { kind: 'retry' };
const retryFields = { message: 'Try again.' };
// @ts-expect-error Approval cannot include a retry message through a spread.
const approvedWithRetry: AuthMethodApprovalResult = { kind: 'approved', ...retryFields };
void missingRetryMessage;
void approvedWithRetry;

// @ts-expect-error A review approval must supply its trusted host capture surface.
const missingCaptureSurface: AuthMethodReviewApproval = {
  messages: approval.messages,
  approve: approval.approve,
  consume: approval.consume,
};
void missingCaptureSurface;
// @ts-expect-error Capture UI is a trusted DOM element, not raw markup.
const captureMarkup: AuthMethodReviewApproval = { ...approval, surface: '<button>Record</button>' };
void captureMarkup;

import type { VoiceCaptureEvent } from '../../packages/wallet/src/plugins/voiceid/browser/microphone';
declare const captureStream: MediaStream;
// @ts-expect-error The trace draws recorder frames; no capture event carries the stream.
const listeningWithStream: VoiceCaptureEvent = { kind: 'listening', stream: captureStream };
const liveStreamFields = { stream: captureStream };
// @ts-expect-error Processing cannot retain a live stream through a broad spread.
const processingWithStream: VoiceCaptureEvent = { kind: 'processing', ...liveStreamFields };
// @ts-expect-error Activity frames cannot carry a live stream through a broad spread.
const activityWithStream: VoiceCaptureEvent = {
  kind: 'activity',
  rms: 0,
  speech: false,
  ...liveStreamFields,
};
void listeningWithStream;
void processingWithStream;
void activityWithStream;

import type { ConfirmationContentModel } from '../../packages/wallet/src/core/signingEngine/uiConfirm/ui/preact/ConfirmationContent';
declare const registrationContent: Extract<ConfirmationContentModel, { kind: 'registration' }>;
const registrationWithCapture = { ...registrationContent, capture: approval.surface };
// @ts-expect-error Registration cannot acquire a transaction capture surface through a spread.
void (registrationWithCapture satisfies ConfirmationContentModel);

// @ts-expect-error A completed measurement needs its exact capture metrics.
const missingCaptureMetrics: VoiceCaptureEvent = { kind: 'measured' };
void missingCaptureMetrics;

type RecordingResult = Awaited<
  ReturnType<
    typeof import('../../packages/wallet/src/plugins/voiceid/browser/microphone').recordVoice
  >
>;
declare const captureQuality: import('../../packages/wallet/src/plugins/voiceid/browser/microphone').VoiceCaptureQuality;
declare const capturedSamples: Float32Array;
const capturedAudioFields = { samples: capturedSamples };
// @ts-expect-error Rejected audio cannot carry a captured sample buffer through a spread.
const rejectedAudioWithSamples: RecordingResult = {
  kind: 'insufficient_audio',
  quality: captureQuality,
  ...capturedAudioFields,
};
// @ts-expect-error Successful capture requires the actual sample buffer.
const captureWithoutSamples: RecordingResult = { kind: 'captured', quality: captureQuality };
void rejectedAudioWithSamples;
void captureWithoutSamples;

import type { AuthMethodAvailability } from '../../packages/wallet/src/core/authMethods/availabilityTypes';
import type {
  HostedAuthMenuOutcome,
  HostedAuthMenuSessionId,
} from '../../packages/wallet/src/SeamsWeb/walletIframe/shared/messages';
declare const authMenuSessionId: HostedAuthMenuSessionId;
const existingMethod = { walletAuthMethodId };
// @ts-expect-error An unenrolled method cannot retain an enrolled identity through a spread.
const unenrolledWithIdentity: AuthMethodAvailability = { kind: 'not_enrolled', ...existingMethod };
const voiceRegistration: HostedAuthMenuOutcome = {
  kind: 'registered',
  authMenuSessionId,
  walletId,
  // @ts-expect-error VoiceID unlocks an existing wallet; it cannot create a wallet.
  method: 'voiceid',
};
void unenrolledWithIdentity;
void voiceRegistration;
