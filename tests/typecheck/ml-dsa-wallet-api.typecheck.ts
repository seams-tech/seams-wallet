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

declare const passkeyApproval: Extract<MlDsaSigningAuthorization<WebAuthnAuthenticationCredential>, { kind: 'passkey' }>;
declare const sessionCredential: Extract<MlDsaSigningAuthorization<WebAuthnAuthenticationCredential>, { kind: 'session' }>;
// @ts-expect-error A session credential cannot retain a passkey assertion through a spread.
const mixedApproval: MlDsaSigningAuthorization<WebAuthnAuthenticationCredential> = { ...sessionCredential, credential: passkeyApproval.credential };
void mixedApproval;
declare const approved: ApprovedMlDsaSessionOperation;
// @ts-expect-error Raw records cannot mint the verified durable session-admission proof.
const forgedAdmission: ApprovedMlDsaSessionOperation = { record: approved.record, sessionIdB64u: approved.sessionIdB64u, expiresAtMs: approved.expiresAtMs };
void forgedAdmission;
