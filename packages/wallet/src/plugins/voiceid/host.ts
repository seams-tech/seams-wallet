import type { WalletAuthMethodHostPlugin } from '@/core/authMethods/hostPlugin';
import { addVoiceIdWalletAuthMethod } from './activation/addVoiceId';
import { voiceIdPolicyForRequest } from './capture/approval';

export const voiceIdHostPlugin: WalletAuthMethodHostPlugin = {
  activate: addVoiceIdWalletAuthMethod,
  review: voiceIdPolicyForRequest,
};
