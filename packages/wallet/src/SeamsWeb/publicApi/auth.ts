import type { AuthCapability } from '@/SeamsWeb/signingSurface/types';

export type WalletAuthCommands = Omit<AuthCapability, 'onSessionChange'>;

export type WalletSessionCommands = Pick<
  AuthCapability,
  'unlock' | 'lock' | 'getSession' | 'getRecentUnlocks' | 'hasPasskey'
>;

export type EmailOtpAuthCommands = Pick<
  AuthCapability,
  | 'requestEmailCode'
  | 'unlockWithEmailCode'
  | 'startGoogleSignIn'
>;

export async function unlockWithEmailCode(
  args: Parameters<AuthCapability['unlockWithEmailCode']>[0],
): ReturnType<AuthCapability['unlockWithEmailCode']> {
  return await args.challenge.submit({ otpCode: args.code });
}
