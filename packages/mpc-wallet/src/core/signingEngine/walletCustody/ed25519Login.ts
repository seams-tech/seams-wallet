import type { WalletSessionRef } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { EmailOtpAuthoritySelector } from '@/core/signingEngine/workerManager/workerTypes';
import type { EmailOtpUnlockSignerSelection } from '@/core/signingEngine/session/emailOtp/publicTypes';
import type { WalletSessionBudget } from '@shared/threshold/walletSessionBudget';

export type LoginWithEmailOtpWalletCustodyEd25519Args = {
  walletSession: WalletSessionRef;
  authoritySelector: EmailOtpAuthoritySelector;
  /**
   * Email OTP provider subject id (e.g. `google:<sub>`). Carried as its own
   * field so it is never conflated with the wallet-scoped
   * `walletSession.walletSessionUserId`.
   */
  providerSubjectId: string;
  challengeId: string;
  otpCode: string;
  /** The app's budget for this unlock. Null: the app asks for none. */
  walletSessionBudget: WalletSessionBudget | null;
  emailOtpAuthorityEmail: string;
  emailHashHex: string;
  ed25519Selection: Extract<EmailOtpUnlockSignerSelection, { readonly kind: 'ed25519_only' }>;
};
