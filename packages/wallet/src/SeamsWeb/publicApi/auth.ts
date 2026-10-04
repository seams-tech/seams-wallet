import type { AuthCapability, RegistrationCapability } from '@/SeamsWeb/signingSurface/types';

export type WalletSessionCommands = Pick<
  AuthCapability,
  | 'unlock'
  | 'lock'
  | 'getSession'
  | 'getRecentUnlocks'
  | 'hasPasskey'
  | 'prefillRouterAbEcdsaDerivationPresignaturePool'
>;

export type EmailOtpCommandGroups = {
  auth: Pick<
    AuthCapability,
    | 'requestEmailOtpChallenge'
    | 'requestEmailOtpSigningSessionChallenge'
    | 'refreshEmailOtpSigningSession'
    | 'loginWithEmailOtpEcdsaCapability'
    | 'unlockAddedEmailOtpWallet'
    | 'beginGoogleEmailOtpWalletAuth'
  >;
  registration: Pick<
    RegistrationCapability,
    'requestEmailOtpEnrollmentChallenge' | 'enrollEmailOtp'
  >;
};
