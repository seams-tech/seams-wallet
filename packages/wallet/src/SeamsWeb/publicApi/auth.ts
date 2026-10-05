import type { AuthCapability, RegistrationCapability } from '@/SeamsWeb/signingSurface/types';

export type WalletAuthCommands = Omit<AuthCapability, 'onSessionChange'>;

export type WalletSessionCommands = Pick<
  AuthCapability,
  | 'unlock'
  | 'lock'
  | 'getSession'
  | 'getRecentUnlocks'
  | 'hasPasskey'
>;

export type EmailOtpCommandGroups = {
  auth: Pick<
    AuthCapability,
    | 'requestEmailOtpChallenge'
    | 'requestEmailOtpSigningSessionChallenge'
    | 'refreshEmailOtpSigningSession'
    | 'loginWithEmailOtpEcdsaCapability'
    | 'unlockAddedEmailOtpWallet'
    | 'startGoogleSignIn'
  >;
  registration: Pick<
    RegistrationCapability,
    'requestEmailOtpEnrollmentChallenge' | 'enrollEmailOtp'
  >;
};
