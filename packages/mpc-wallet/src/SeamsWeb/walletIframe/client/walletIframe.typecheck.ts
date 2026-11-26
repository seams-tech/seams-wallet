import type { RequestEmailCodeInput } from '@/SeamsWeb/publicApi/types';
import type { SigningEngineExportKeypairWithUIInput } from '@/core/signingEngine/flows/recovery/keyExportFlow';
import type { ExactEcdsaSigningLaneIdentity } from '@/core/signingEngine/session/identity/exactSigningLaneIdentity';
import type {
  ThresholdEcdsaChainTarget,
  WalletSessionRef,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type {
  PMRegistrationAuthMethodInput,
  PMExportKeypairUiPayload,
  ParentToChildType,
} from '../shared/messages';

declare const walletSession: WalletSessionRef;
declare const chainTarget: ThresholdEcdsaChainTarget;
declare const ecdsaLane: ExactEcdsaSigningLaneIdentity;
const iframeExportPayload: PMExportKeypairUiPayload = {
  kind: 'ecdsa',
  walletSession,
  chainTarget,
  laneIdentity: { raw: 'untrusted-boundary-payload' },
  options: {},
};
void iframeExportPayload;

const coreExportInput: SigningEngineExportKeypairWithUIInput = {
  kind: 'ecdsa',
  walletSession,
  chainTarget,
  laneIdentity: ecdsaLane,
  options: {},
};
void coreExportInput;

const coreExportInputWithRawLane: SigningEngineExportKeypairWithUIInput = {
  kind: 'ecdsa',
  walletSession,
  chainTarget,
  // @ts-expect-error Core export requires parsed exact lane identity.
  laneIdentity: { raw: 'untrusted-boundary-payload' },
  options: {},
};
void coreExportInputWithRawLane;

// @ts-expect-error Stale named-account registration iframe route was removed.
const staleRegisterRoute: ParentToChildType = 'PM_REGISTER';
void staleRegisterRoute;

declare const emailRegistrationAuth: Extract<
  PMRegistrationAuthMethodInput,
  { proofKind: 'otp_challenge' }
>;
const enrollmentWithParentBearer: PMRegistrationAuthMethodInput = {
  ...emailRegistrationAuth,
  // @ts-expect-error Hosted-wallet enrollment exchanges the bearer before postMessage.
  walletSessionToken: 'parent-wallet-session-token',
};
void enrollmentWithParentBearer;

const emailUnlockWithParentBearer: RequestEmailCodeInput = {
  method: 'email',
  walletId: 'wallet-id',
  email: 'owner@example.com',
  // @ts-expect-error Email unlock proof belongs to the host.
  walletSessionToken: 'parent-wallet-session-token',
};
void emailUnlockWithParentBearer;

// @ts-expect-error Specialized ECDSA unlock is internal to the host.
const retiredEcdsaUnlock: ParentToChildType = 'PM_LOGIN_EMAIL_OTP_ECDSA_CAPABILITY';
void retiredEcdsaUnlock;
// @ts-expect-error Added-method unlock uses the unified email flow.
const retiredAddedEmailUnlock: ParentToChildType = 'PM_UNLOCK_ADDED_EMAIL_OTP_WALLET';
void retiredAddedEmailUnlock;

export {};

// @ts-expect-error ECDSA bootstrap belongs to host authentication, not iframe RPC.
const retiredBootstrapRoute: ParentToChildType = 'PM_BOOTSTRAP_THRESHOLD_ECDSA_SESSION';
void retiredBootstrapRoute;
