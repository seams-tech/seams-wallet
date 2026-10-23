import {
  type WalletAuthMethodPlugin,
} from '../../packages/wallet/src/core/authMethods/plugins';
import { voiceIdAuthMethod } from '../../packages/wallet/src/plugins/voiceid/descriptor';
import type { SeamsConfigsInput } from '../../packages/wallet/src/core/types/seams';
import type { VerifiedVoiceIdSessionProof } from '../../packages/wallet-server/src/authorization/voiceIdDeviceProof';
import type { AuthMethodReviewPolicy, AuthMethodReviewApproval } from '../../packages/wallet/src/core/authMethods/hostPlugin';

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

declare const verifiedProofFields: Pick<
  VerifiedVoiceIdSessionProof,
  'challenge' | 'deviceKeyId'
>;
// @ts-expect-error Only the server verifier can construct verified VoiceID proof.
const forgedProof: VerifiedVoiceIdSessionProof = { ...verifiedProofFields };
void forgedProof;
