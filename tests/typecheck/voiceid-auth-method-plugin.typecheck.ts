import {
  voiceIdAuthMethod,
  type WalletAuthMethodPlugin,
} from '../../packages/wallet/src/core/authMethods/plugins';
import type { SeamsConfigsInput } from '../../packages/wallet/src/core/types/seams';
import type { VerifiedVoiceIdSessionProof } from '../../packages/wallet-server/src/authorization/voiceIdDeviceProof';

const enabled: SeamsConfigsInput = { authMethods: [voiceIdAuthMethod()] };
void enabled;

// @ts-expect-error A wallet auth method plugin needs an exact known kind.
const unknownMethod: WalletAuthMethodPlugin = { kind: 'unknown' };
void unknownMethod;

// @ts-expect-error A browser callback cannot cross into the wallet iframe.
const callbackPlugin: WalletAuthMethodPlugin = { kind: 'voiceid', load: async () => ({}) };
void callbackPlugin;

declare const verifiedProofFields: Pick<
  VerifiedVoiceIdSessionProof,
  'challenge' | 'deviceKeyId'
>;
// @ts-expect-error Only the server verifier can construct verified VoiceID proof.
const forgedProof: VerifiedVoiceIdSessionProof = { ...verifiedProofFields };
void forgedProof;
