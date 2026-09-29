import {
  toEmailOtpAuthSubjectId,
  type WalletSessionUserId,
} from './emailOtpEcdsaDerivationIdentity';
const authSubjectId = toEmailOtpAuthSubjectId('google:subject-1');

// @ts-expect-error provider-scoped Email OTP subjects cannot become wallet-scoped DERIVATION ids
const invalidWalletSessionUserId: WalletSessionUserId = authSubjectId;

void invalidWalletSessionUserId;

export {};
