import type { WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { PrepareEmailOtpRegistrationEnrollmentMaterialInternalArgs } from './emailOtpPublic';

declare const walletId: WalletId;

const validPrepareEmailOtpRegistrationEnrollmentMaterialInternalArgs: PrepareEmailOtpRegistrationEnrollmentMaterialInternalArgs =
  {
    walletId,
    userId: 'google-subject',
  };
void validPrepareEmailOtpRegistrationEnrollmentMaterialInternalArgs;

const invalidPrepareEmailOtpRegistrationEnrollmentMaterialInternalArgs: PrepareEmailOtpRegistrationEnrollmentMaterialInternalArgs =
  {
    // @ts-expect-error internal Email OTP registration preparation requires WalletId.
    walletId: 'alice.testnet',
    userId: 'google-subject',
  };
void invalidPrepareEmailOtpRegistrationEnrollmentMaterialInternalArgs;

export {};
