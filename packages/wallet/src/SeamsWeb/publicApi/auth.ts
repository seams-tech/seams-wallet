import type { AuthCapability } from '@/SeamsWeb/signingSurface/types';

export type WalletAuthCommands = Omit<AuthCapability, 'onSessionChange'>;

export type WalletSessionCommands = Pick<
  AuthCapability,
  'unlock' | 'lock' | 'getSession' | 'getRecentUnlocks' | 'hasPasskey'
>;

export type EmailOtpAuthCommands = Pick<
  AuthCapability,
  | 'requestEmailOtpChallenge'
  | 'loginWithEmailOtpEcdsaCapability'
  | 'unlockAddedEmailOtpWallet'
  | 'startGoogleSignIn'
>;
