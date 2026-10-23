import type { WalletAuthMethodHostPlugin } from '@/core/authMethods/hostPlugin';
import { addVoiceIdWalletAuthMethod } from './activation/addVoiceId';
import { voiceIdPolicyForRequest } from './capture/approval';
import { unlockWithVoiceId } from './session/unlock';

export const voiceIdHostPlugin: WalletAuthMethodHostPlugin = {
  unlock: unlockWithVoiceId,
  activate: addVoiceIdWalletAuthMethod,
  review: voiceIdPolicyForRequest,
};
