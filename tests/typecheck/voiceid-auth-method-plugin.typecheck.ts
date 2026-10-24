import { type WalletAuthMethodPlugin } from '../../packages/wallet/src/core/authMethods/plugins';
import { voiceIdAuthMethod } from '../../packages/wallet/src/plugins/voiceid/descriptor';
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
// @ts-expect-error A plugin unlock cannot omit the core signing installer.
hostPlugin.unlock({ relayerUrl: 'https://router.example.test', walletId, walletAuthMethodId });
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
