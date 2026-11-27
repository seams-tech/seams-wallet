import type { WalletId, WalletAuthMethodId } from '@shared/utils/domainIds';
import type { AuthMethodActivationResult, AuthMethodUnlockSuccess } from '../hostPlugin';
import type { ReadonlyExclusiveUnion, Variant } from '@shared/utils/variant';
import type { ConfirmedVoiceChange } from './ownerConfirmation';
import type {
  VoiceEnrollmentScope,
  VoiceEnrollmentConfirmationRequest,
  VoiceIdActivationCapture,
  VoiceIdOperationCapture,
  VoiceIdUnlockCapture,
} from './contracts';
import type { VoiceIdOperationProof } from './operationProof';

export type VoiceOwnerConfirmation = (
  request: VoiceEnrollmentConfirmationRequest,
) => Promise<ConfirmedVoiceChange>;

export type VoiceIdActivationPreparation = ReadonlyExclusiveUnion<
  | {
      readonly kind: 'enroll_existing';
      readonly scope: VoiceEnrollmentScope;
      readonly confirmChange: VoiceOwnerConfirmation;
    }
  | {
      readonly kind: 'activate';
      readonly walletId: WalletId;
      readonly walletAuthMethodId: WalletAuthMethodId;
      readonly activate: (
        capture: VoiceIdActivationCapture,
        signal: AbortSignal,
      ) => Promise<Variant<AuthMethodActivationResult, 'kind', 'activated'>>;
    }
>;

export type VoiceIdUnlockChallenge = Readonly<{
  expiresAtMs: number;
  complete: (
    capture: VoiceIdUnlockCapture,
    signal: AbortSignal,
  ) => Promise<AuthMethodUnlockSuccess>;
}>;
export type VoiceIdUnlockPreparation = Readonly<{
  scope: VoiceEnrollmentScope;
  challenge: (signal: AbortSignal) => Promise<VoiceIdUnlockChallenge>;
}>;


export type VoiceIdOperationChallenge = Readonly<{
  expiresAtMs: number;
  complete: (
    capture: VoiceIdOperationCapture,
    signal: AbortSignal,
  ) => Promise<VoiceIdOperationProof>;
}>;
export type VoiceIdOperationPreparation = Readonly<{
  scope: VoiceEnrollmentScope;
  challenge: (signal: AbortSignal) => Promise<VoiceIdOperationChallenge>;
}>;
