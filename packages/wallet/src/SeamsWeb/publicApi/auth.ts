import type { AuthCapability } from '@/SeamsWeb/signingSurface/types';

export type WalletSessionCommands = Pick<
  AuthCapability,
  | 'unlock'
  | 'lock'
  | 'logout'
  | 'getWalletSession'
  | 'getRecentUnlocks'
  | 'hasPasskeyCredential'
  | 'prefillRouterAbEcdsaDerivationPresignaturePool'
>;
