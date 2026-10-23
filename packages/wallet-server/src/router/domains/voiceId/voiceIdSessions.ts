import type { VoiceIdDeviceAssertion, VoiceIdWalletSessionChallenge } from '@shared/authorization/voiceIdDeviceAssertion';
import type { WalletAuthMethodId, WalletId } from '@shared/utils/domainIds';
import type { VoiceIdSeedEnvelope } from './voiceIdActivation';
import type { DirectV2IssueResult, IssuedWalletSessionAuthorizationV2 } from '../../../authorization/domain';
import type { SessionOrigin } from '../../../authorization/domain';

export type VoiceIdChallengeRequest = Readonly<{
  walletId: WalletId;
  walletAuthMethodId: WalletAuthMethodId;
  requestOrigin: SessionOrigin;
  nowMs: number;
}>;

export type VoiceIdChallengeResult =
  | { readonly kind: 'issued'; readonly challenge: VoiceIdWalletSessionChallenge }
  | { readonly kind: 'rejected'; readonly code: 'method_unavailable' };

export type VoiceIdVerifyRequest = Readonly<{
  assertion: VoiceIdDeviceAssertion;
  requestOrigin: SessionOrigin;
  nowMs: number;
}>;

export type VoiceIdVerifyResult =
  | {
      readonly kind: 'issued';
      readonly authorization: IssuedWalletSessionAuthorizationV2;
      readonly operationCredential: Extract<DirectV2IssueResult, { readonly kind: 'issued' }>['operationCredential'];
      readonly custodyEnvelope: VoiceIdSeedEnvelope;
    }
  | {
      readonly kind: 'rejected';
      readonly code:
        | 'challenge_unavailable'
        | 'method_unavailable'
        | 'invalid_assertion'
        | 'issuance_unavailable';
    };
