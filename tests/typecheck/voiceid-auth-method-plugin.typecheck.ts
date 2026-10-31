import { type WalletAuthMethodPlugin } from '../../packages/wallet/src/core/authMethods/plugins';
import { voiceIdAuthMethod } from '../../packages/voiceid/src/descriptor';
import * as voiceHost from '../../packages/wallet/src/voiceid-host';
import type { VoiceIdActivationPreparation } from '../../packages/wallet/src/core/authMethods/voiceId/boundary';

// @ts-expect-error The optional plugin cannot access the wallet database manager.
void voiceHost.IndexedDBManager;
// @ts-expect-error Session credentials remain inside core.
void voiceHost.walletSessionAuthorizations;
// @ts-expect-error The plugin cannot obtain a custody worker transport.
void voiceHost.walletCustodyCeremonyTransportFromWorkerContextV1;
// @ts-expect-error The plugin cannot obtain an unlocked custody capability.
void voiceHost.readUnlockedWalletEd25519ExportRootCapabilityV1;
// @ts-expect-error Storage schemas remain inside core.
void voiceHost.SEAMS_WALLET_STORES;

declare const activatePreparation: Extract<VoiceIdActivationPreparation, { kind: 'activate' }>;
declare const managePreparation: Extract<VoiceIdActivationPreparation, { kind: 'enroll_existing' }>;
// @ts-expect-error Management cannot acquire custody activation through a broad spread.
const crossedPreparation: VoiceIdActivationPreparation = { ...managePreparation, activate: activatePreparation.activate };
// @ts-expect-error A management preparation cannot be cast into activation.
const castPreparation = managePreparation as typeof activatePreparation;
// @ts-expect-error A new activation requires its bound core operation.
const missingActivation: VoiceIdActivationPreparation = { kind: 'activate', walletId: activatePreparation.walletId, walletAuthMethodId: activatePreparation.walletAuthMethodId };

declare const activationWrite: Extract<VoiceEnrollmentChange, { kind: 'activate' }>;
declare const changeWrite: Extract<VoiceEnrollmentChange, { kind: 'replace' }>;
// @ts-expect-error An owner activation guard cannot authorize a later enrollment change.
const crossedWrite: VoiceEnrollmentChange = { ...changeWrite, guard: activationWrite.guard };
// @ts-expect-error Activation cannot acquire an enrollment-change confirmation.
const confirmedActivation: VoiceEnrollmentChange = { ...activationWrite, confirmation: changeWrite.confirmation };
void [crossedPreparation, castPreparation, missingActivation, crossedWrite, confirmedActivation];
import { ConfirmedVoiceChange } from '../../packages/wallet/src/core/authMethods/voiceId/ownerConfirmation';
import type { VoiceEnrollmentChange } from '../../packages/wallet/src/core/authMethods/voiceId/contracts';

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
void forgedChange;
void copiedChange;
void unconfirmedImprovement;
void resetWithSamples;

import type { PreparedVoiceCapture } from '../../packages/voiceid/src/capture/surface';
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
const aurora: SeamsConfigsInput = { authMethods: [voiceIdAuthMethod({ transcriptionModel: 'aurora' })] };
const citrinet: SeamsConfigsInput = { authMethods: [voiceIdAuthMethod({ transcriptionModel: 'citrinet' })] };
void aurora;
void citrinet;
// @ts-expect-error Only the two shipped models are supported.
voiceIdAuthMethod({ transcriptionModel: 'moonshine' });
const unknownModel = { transcriptionModel: 'remote-model' };
// @ts-expect-error A broad spread cannot choose an unknown recognizer.
voiceIdAuthMethod({ ...unknownModel });

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
// @ts-expect-error A plugin unlock must prepare its scoped core unlock after its prompt opens.
hostPlugin.unlock({
  walletId,
  walletAuthMethodId,
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
void (ecdsaWithVoice satisfies ExactEcdsaSigningLaneIdentity);
const invalidEcdsaVoice = { ...ecdsaWithVoice, auth: voiceWithPasskeyFields };
// @ts-expect-error ECDSA VoiceID keeps its own factor identity.
void (invalidEcdsaVoice satisfies ExactEcdsaSigningLaneIdentity);
import type { ConcreteEcdsaExportAvailableLane } from '@/core/signingEngine/flows/recovery/ecdsaExportMaterial';
declare const exportLane: ConcreteEcdsaExportAvailableLane;
const voiceExportLane = { ...exportLane, auth: voiceIdLane };
// @ts-expect-error VoiceID transaction authorization does not enable key export.
void (voiceExportLane satisfies ConcreteEcdsaExportAvailableLane);


import type { ExactEcdsaSealedRuntime } from '@/core/signingEngine/session/material/ecdsaSealedRuntime';
import type { VoiceIdWalletAuthAuthority } from '@shared/utils/walletAuthAuthority';
declare const voiceAuthority: VoiceIdWalletAuthAuthority;
declare const sealedRuntime: ExactEcdsaSealedRuntime;
const voiceSealedRuntime = {
  ...sealedRuntime,
  authBinding: { kind: 'voiceid' as const, voiceIdAuthority: voiceAuthority },
};
// @ts-expect-error VoiceID uses the active session and durable material, with no sealed-session fallback.
void (voiceSealedRuntime satisfies ExactEcdsaSealedRuntime);
import type { ExactEcdsaRuntimeAuthBinding } from '@/core/signingEngine/session/material/ecdsaSealedRuntime';
declare const runtimePasskey: Extract<ExactEcdsaRuntimeAuthBinding, { kind: 'passkey' }>;
const crossedRuntime = { ...runtimePasskey, voiceIdAuthority: voiceAuthority };
// @ts-expect-error A passkey runtime cannot carry a VoiceID authority through a spread.
void (crossedRuntime satisfies ExactEcdsaRuntimeAuthBinding);


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
  prepare: approval.prepare,
  approve: approval.approve,
  consume: approval.consume,
};
void missingCaptureSurface;
// @ts-expect-error Capture UI is a trusted DOM element, not raw markup.
const captureMarkup: AuthMethodReviewApproval = { ...approval, surface: '<button>Record</button>' };
void captureMarkup;

// @ts-expect-error Preparation must finish before approval can start.
const missingPreparation: AuthMethodReviewApproval = {
  messages: approval.messages,
  surface: approval.surface,
  approve: approval.approve,
  consume: approval.consume,
};
void missingPreparation;

import type { VoiceCaptureEvent } from '../../packages/voiceid/src/browser/microphone';
declare const captureStream: MediaStream;
// @ts-expect-error The trace draws recorder frames; no capture event carries the stream.
const listeningWithStream: VoiceCaptureEvent = { kind: 'listening', stream: captureStream };
const liveStreamFields = { stream: captureStream };
// @ts-expect-error Opening a microphone cannot expose its stream through a spread.
const openingWithStream: VoiceCaptureEvent = { kind: 'opening', ...liveStreamFields };
void openingWithStream;
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
    typeof import('../../packages/voiceid/src/browser/microphone').recordVoice
  >
>;
declare const captureQuality: import('../../packages/voiceid/src/browser/microphone').VoiceCaptureQuality;
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

import type { VoiceMicrophone } from '../../packages/voiceid/src/browser/microphoneInput';
type MicrophonePreference = VoiceMicrophone['preference'];
// @ts-expect-error A selected microphone requires its concrete device identity.
const microphoneWithoutIdentity: MicrophonePreference = { kind: 'device' };
const microphoneIdentity = { deviceId: 'physical-input' };
// @ts-expect-error A system-default choice cannot retain a concrete device through a spread.
const crossedMicrophone: MicrophonePreference = { kind: 'system_default', ...microphoneIdentity };
void microphoneWithoutIdentity;
void crossedMicrophone;

import type {} from '../fixtures/ui/VoiceIdHumanCalibration';
import type {
  Attempt as VoiceCalibrationAttempt,
  SpeakerScore as VoiceCalibrationScore,
  CutoffFit as VoiceCutoffFit,
  PhraseObservation as VoicePhraseObservation,
} from '../scripts/voiceid-human-calibration/report';
declare const calibrationAttempt: VoiceCalibrationAttempt;
declare const calibrationScore: VoiceCalibrationScore;
const calibrationVector = { embedding: [0.1, 0.2] };
// @ts-expect-error A calibration export cannot acquire a voice vector through a spread.
const leakedCalibrationAttempt: VoiceCalibrationAttempt = { ...calibrationAttempt, ...calibrationVector };
// @ts-expect-error Cross-speaker score exports cannot contain voice vectors.
const leakedCalibrationScore: VoiceCalibrationScore = { ...calibrationScore, ...calibrationVector };
void leakedCalibrationAttempt;
void leakedCalibrationScore;
// @ts-expect-error A public capture result cannot acquire an embedding through a spread.
const leakedCalibrationResult: VoiceCalibrationAttempt['result'] = { ...calibrationAttempt.result, ...calibrationVector };
void leakedCalibrationResult;
const fittedThreshold = { threshold: 0.45 };
// @ts-expect-error A collecting state cannot carry a fitted threshold through a spread.
const prematureVoiceCutoff: VoiceCutoffFit = { kind: 'collecting', ...fittedThreshold };
// @ts-expect-error A frozen cutoff must name the data and time that fixed its threshold.
const unboundVoiceCutoff: VoiceCutoffFit = { kind: 'frozen', threshold: 0.45 };
void prematureVoiceCutoff;
void unboundVoiceCutoff;

declare const phraseObservation: VoicePhraseObservation;
const privatePhraseText = { decodedText: 'untrusted decoded speech' };
// @ts-expect-error Recognition exports cannot acquire decoded text through a spread.
const leakedPhraseObservation: VoicePhraseObservation = { ...phraseObservation, ...privatePhraseText };
// @ts-expect-error A matched phrase cannot carry a rejection reason.
const matchedRejection: VoicePhraseObservation = { kind: 'matched', candidate: 'please sign this trade now', difference: 0, margin: 1, reason: 'different' };
// @ts-expect-error A rejected phrase needs its rejection reason.
const missingPhraseReason: VoicePhraseObservation = { kind: 'rejected', candidate: 'please sign this trade now', difference: 0, margin: 1 };
// @ts-expect-error Empty speech cannot carry candidate measurements through a spread.
const emptyWithCandidate: VoicePhraseObservation = { kind: 'empty', ...{ candidate: 'please sign this trade now' as const, difference: 0, margin: 1 } };
// @ts-expect-error Candidate labels must come from the fixed phrase bank.
const transcriptAsCandidate: VoicePhraseObservation = { kind: 'matched', candidate: 'private decoded speech', difference: 0, margin: 1 };
// @ts-expect-error Recognition exports cannot acquire embeddings through a spread.
const leakedPhraseVector: VoicePhraseObservation = { ...phraseObservation, ...calibrationVector };
const phraseTemplate = { template: [0.1, 0.2] };
// @ts-expect-error Recognition exports cannot acquire templates through a spread.
const leakedPhraseTemplate: VoicePhraseObservation = { ...phraseObservation, ...phraseTemplate };
void leakedPhraseObservation;
void matchedRejection;
void missingPhraseReason;
void emptyWithCandidate;
void transcriptAsCandidate;
void leakedPhraseVector;
void leakedPhraseTemplate;

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
