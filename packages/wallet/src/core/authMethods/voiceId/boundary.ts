import type { WalletId, WalletAuthMethodId } from '@shared/utils/domainIds';
import type { AuthMethodActivationResult, AuthMethodUnlockSuccess } from '../hostPlugin';
import type { Variant } from '@shared/utils/variant';
import type { ConfirmedVoiceChange } from './ownerConfirmation';
import type {
  VoiceEnrollmentScope,
  VoiceEnrollmentConfirmationRequest,
  VoiceIdActivationCapture,
  VoiceIdUnlockCapture,
} from './contracts';
import type { VoiceConfirmation } from './confirmationCommand';

export type VoiceOwnerConfirmation = (
  request: VoiceEnrollmentConfirmationRequest,
) => Promise<ConfirmedVoiceChange>;

export type VoiceIdActivationPreparation =
  | {
      readonly kind: 'enroll_existing';
      readonly scope: VoiceEnrollmentScope;
      readonly confirmChange: VoiceOwnerConfirmation;
      readonly activate?: never;
      readonly walletId?: never;
      readonly walletAuthMethodId?: never;
    }
  | {
      readonly kind: 'activate';
      readonly walletId: WalletId;
      readonly walletAuthMethodId: WalletAuthMethodId;
      readonly activate: (
        capture: VoiceIdActivationCapture,
        signal: AbortSignal,
      ) => Promise<Variant<AuthMethodActivationResult, 'kind', 'activated'>>;
      readonly scope?: never;
      readonly confirmChange?: never;
    };

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

export type VoiceIdReviewRequest = Readonly<{
  walletId: WalletId;
  expiresAtMs: number;
  operationHash: string;
  confirmation: VoiceConfirmation;
}>;
