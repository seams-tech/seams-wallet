import type {
  VoiceIdDeviceAssertion,
  VoiceIdOperationKind,
  VoiceIdWalletSessionChallenge,
} from '@shared/authorization/voiceIdDeviceAssertion';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { VoiceIdWalletAuthAuthority } from '@shared/utils/walletAuthAuthority';
import type { VerifiedVoiceIdOperationProof } from '../../../authorization/voiceIdDeviceProof';
import type { WalletAuthMethodId, WalletId } from '@shared/utils/domainIds';
import type { VoiceIdSeedEnvelope } from '@shared/passkey-custody/custodyEnvelope';
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

/** A fresh voice check for one operation, verified against the active VoiceID method. */
export type VoiceIdOperationVerifyRequest = Readonly<{
  walletId: WalletId;
  walletAuthMethodId: WalletAuthMethodId;
  assertion: unknown;
  operationKind: VoiceIdOperationKind;
  operationChallenge: DigestB64u;
  requestOrigin: SessionOrigin;
  nowMs: number;
}>;

export type VoiceIdOperationVerifyResult =
  | {
      readonly kind: 'verified';
      readonly proof: VerifiedVoiceIdOperationProof;
      readonly authority: VoiceIdWalletAuthAuthority;
      /* Sealed under the device's voice factor; the server releases it only after this check. */
      readonly custodyEnvelope: VoiceIdSeedEnvelope;
    }
  | {
      readonly kind: 'rejected';
      readonly code: 'method_unavailable' | 'invalid_assertion';
    };
