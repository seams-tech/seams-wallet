import type {
  NearSignerCapability,
  ExportKeyInput,
} from '../../packages/wallet/src/SeamsWeb/publicApi/types';
import type {
  AddedMlDsaSignerCapability,
  NearTransactionSignerSelection,
} from '../../packages/wallet/src/index';
import type { SigningEngineExportKeypairWithUIInput } from '../../packages/wallet/src/core/signingEngine/flows/recovery/keyExportFlow';
import type { SignIntentDigestPayload } from '../../packages/wallet/src/core/signingEngine/stepUpConfirmation/channel/confirmTypes';
import type { ExactEcdsaSigningLaneIdentity } from '../../packages/wallet/src/core/signingEngine/session/identity/exactSigningLaneIdentity';
import type { MlDsaSigningAuthorization } from '../../packages/shared-ts/src/near/mlDsaSigningSession';
import type { WebAuthnAuthenticationCredential } from '../../packages/wallet/src/core/types/webauthn';
import type { ApprovedMlDsaSessionOperation } from '../../packages/wallet-server/src/router/cloudflare/d1/wallet/d1MlDsaSigningSessions';

declare const near: NearSignerCapability;
declare const signer: AddedMlDsaSignerCapability;
declare const transaction: Parameters<NearSignerCapability['signTransaction']>[0]['transaction'];
declare const exportInput: Extract<SigningEngineExportKeypairWithUIInput, { kind: 'ml_dsa_65' }>;
declare const ecdsaLane: ExactEcdsaSigningLaneIdentity;
declare const challenge: string;

near.signTransaction({ signer, transaction });
const exportRequest: ExportKeyInput = { kind: 'ml_dsa_65', signer };
void exportRequest;

// @ts-expect-error ML-DSA selection requires the full public key reference.
const incompleteSigner: NearTransactionSignerSelection = {
  kind: 'near_ml_dsa_65',
  signingKeyId: signer.signingKeyId,
};
void incompleteSigner;

// @ts-expect-error An Ed25519 selection cannot carry an ML-DSA key through a spread.
const mixedSigner: NearTransactionSignerSelection = { ...signer, kind: 'ed25519' };
void mixedSigner;

// @ts-expect-error Export inputs cannot mix ML-DSA identity and an ECDSA lane.
const mixedExport: SigningEngineExportKeypairWithUIInput = {
  ...exportInput,
  laneIdentity: ecdsaLane,
};
void mixedExport;

const subject = {
  kind: 'near_ml_dsa_wallet' as const,
  walletId: 'wallet-1',
  nearAccountId: 'wallet-1.testnet',
  credentialIdB64u: 'credential-1',
};
// @ts-expect-error ML-DSA exact passkey review cannot use an Email OTP auth plan.
const wrongFactor: SignIntentDigestPayload = {
  signingSubject: subject,
  challengeB64u: challenge,
  signingAuthPlan: { kind: 'emailOtpReauth', method: 'email_otp' },
};
void wrongFactor;

declare const passkeyApproval: Extract<
  MlDsaSigningAuthorization<WebAuthnAuthenticationCredential>,
  { kind: 'passkey' }
>;
declare const sessionCredential: Extract<
  MlDsaSigningAuthorization<WebAuthnAuthenticationCredential>,
  { kind: 'session' }
>;
// @ts-expect-error A session credential cannot retain a passkey assertion through a spread.
const mixedApproval: MlDsaSigningAuthorization<WebAuthnAuthenticationCredential> = {
  ...sessionCredential,
  credential: passkeyApproval.credential,
};
void mixedApproval;
declare const approved: ApprovedMlDsaSessionOperation;
// @ts-expect-error Raw records cannot mint the verified durable session-admission proof.
const forgedAdmission: ApprovedMlDsaSessionOperation = {
  record: approved.record,
  sessionIdB64u: approved.sessionIdB64u,
  expiresAtMs: approved.expiresAtMs,
};
void forgedAdmission;

import type {
  NearSignerPreference,
  NearTransactionSignerRequest,
} from '../../packages/wallet/src/core/types/nearSigningKeys';
// @ts-expect-error A default request cannot carry a concrete ML-DSA key through a spread.
const mixedDefault: NearTransactionSignerRequest = { ...signer, kind: 'wallet_default' };
void mixedDefault;
// @ts-expect-error Ed25519 preferences cannot retain another key identity.
const mixedPreference: NearSignerPreference = {
  kind: 'ed25519',
  signingKeyId: signer.signingKeyId,
};
void mixedPreference;
// @ts-expect-error A preference is not enough to authorize a concrete ML-DSA operation.
const preferenceAsSigner: NearTransactionSignerSelection = {
  kind: 'near_ml_dsa_65',
  signingKeyId: signer.signingKeyId,
};
void preferenceAsSigner;

import type { NearSignerSelectionResult } from '../../packages/wallet/src/core/signingEngine/flows/signNear/selectNearSigner';
import type { Variant } from '../../packages/shared-ts/src/utils/variant';
type ConfirmedReview = Variant<NearSignerSelectionResult, 'kind', 'reviewed'>['review'];
declare const consumeReview: ConfirmedReview['consume'];
// @ts-expect-error A plain object cannot manufacture a host-confirmed transaction review.
const forgedReview: ConfirmedReview = { consume: consumeReview };
void forgedReview;
declare const unreviewedSelection: Variant<NearSignerSelectionResult, 'kind', 'unreviewed'>;
declare const reviewedSelection: Variant<NearSignerSelectionResult, 'kind', 'reviewed'>;
// @ts-expect-error An unreviewed selection cannot retain a review receipt through a spread.
const mixedReview: NearSignerSelectionResult = {
  ...unreviewedSelection,
  review: reviewedSelection.review,
};
void mixedReview;

import type { MlDsaSigningActor } from '../../packages/shared-ts/src/near/mlDsaSigning';
declare const emailActor: Extract<MlDsaSigningActor, { kind: 'email_otp' }>;
declare const passkeyActor: Extract<MlDsaSigningActor, { kind: 'passkey' }>;
// @ts-expect-error An Email OTP actor cannot retain a Passkey identity through a spread.
const mixedActor: MlDsaSigningActor = {
  ...emailActor,
  credentialIdB64u: passkeyActor.credentialIdB64u,
};
void mixedActor;
const emailSubject = {
  kind: 'near_ml_dsa_email_wallet' as const,
  walletId: 'wallet-1',
  nearAccountId: 'wallet-1.testnet',
  walletAuthMethodId: 'method-1',
};
// @ts-expect-error An Email OTP subject cannot request a Passkey assertion.
const emailWithPasskey: SignIntentDigestPayload = {
  signingSubject: emailSubject,
  challengeB64u: challenge,
  signingAuthPlan: { kind: 'passkeyReauth', method: 'passkey' },
  webauthnChallenge: { kind: 'intent_digest', challengeB64u: challenge },
};
void emailWithPasskey;
// @ts-expect-error An Email OTP subject requires its exact OTP prompt.
const missingEmailPrompt: SignIntentDigestPayload = {
  signingSubject: emailSubject,
  challengeB64u: challenge,
  signingAuthPlan: { kind: 'emailOtpReauth', method: 'email_otp' },
};
void missingEmailPrompt;
