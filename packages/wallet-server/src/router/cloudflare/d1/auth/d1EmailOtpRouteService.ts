import type { RouterApiServiceBag } from '../../../framework/authServicePort';
import type { CloudflareD1EmailOtpServerSealRuntime } from '../emailOtp/d1EmailOtpServerSealRuntime';
import type { CloudflareD1EmailOtpChallengeService } from '../emailOtp/d1EmailOtpChallengeService';
import type { CloudflareD1EmailOtpRecoveryService } from '../emailOtp/d1EmailOtpRecoveryService';
import type { CloudflareD1GoogleEmailOtpSessionResolver } from '../emailOtp/d1GoogleEmailOtpSessionResolver';
import type { CloudflareD1OidcVerificationService } from '../oidc/d1OidcVerificationService';

type D1EmailOtpRouteServiceAssembly = {
  readonly emailOtpServerSeal: CloudflareD1EmailOtpServerSealRuntime;
  readonly emailOtpChallengeService: CloudflareD1EmailOtpChallengeService;
  readonly emailOtpRecoveryService: CloudflareD1EmailOtpRecoveryService;
  readonly googleEmailOtpSessions: CloudflareD1GoogleEmailOtpSessionResolver;
  readonly oidcVerification: CloudflareD1OidcVerificationService;
};

export function createD1EmailOtpRouteService(
  assembly: D1EmailOtpRouteServiceAssembly,
): RouterApiServiceBag['emailOtp'] {
  return {
    applyEmailOtpServerSeal: assembly.emailOtpServerSeal.applyEmailOtpServerSeal.bind(
      assembly.emailOtpServerSeal,
    ),
    cleanupGoogleEmailOtpDevRegistrationState:
      assembly.googleEmailOtpSessions.cleanupDevRegistrationState.bind(
        assembly.googleEmailOtpSessions,
      ),
    consumeEmailOtpGrant: assembly.emailOtpRecoveryService.consumeEmailOtpGrant.bind(
      assembly.emailOtpRecoveryService,
    ),
    createEmailOtpChallenge: assembly.emailOtpChallengeService.createEmailOtpChallenge.bind(
      assembly.emailOtpChallengeService,
    ),
    createEmailOtpEnrollmentChallenge:
      assembly.emailOtpChallengeService.createEmailOtpEnrollmentChallenge.bind(
        assembly.emailOtpChallengeService,
      ),
    isEmailOtpStrongAuthRequired:
      assembly.emailOtpRecoveryService.isEmailOtpStrongAuthRequired.bind(
        assembly.emailOtpRecoveryService,
      ),
    markEmailOtpStrongAuthSatisfied:
      assembly.emailOtpRecoveryService.markEmailOtpStrongAuthSatisfied.bind(
        assembly.emailOtpRecoveryService,
      ),
    readActiveEmailOtpEnrollment:
      assembly.emailOtpRecoveryService.readActiveEmailOtpEnrollment.bind(
        assembly.emailOtpRecoveryService,
      ),
    readEmailOtpEnrollment: assembly.emailOtpRecoveryService.readEmailOtpEnrollment.bind(
      assembly.emailOtpRecoveryService,
    ),
    readEmailOtpOutboxEntry: assembly.emailOtpChallengeService.readEmailOtpOutboxEntry.bind(
      assembly.emailOtpChallengeService,
    ),
    removeEmailOtpServerSeal: assembly.emailOtpServerSeal.removeEmailOtpServerSeal.bind(
      assembly.emailOtpServerSeal,
    ),
    validateGoogleEmailOtpRegistrationCandidateWallet:
      assembly.googleEmailOtpSessions.validateRegistrationCandidateWallet.bind(
        assembly.googleEmailOtpSessions,
      ),
    verifyEmailOtpChallenge: assembly.emailOtpChallengeService.verifyEmailOtpChallenge.bind(
      assembly.emailOtpChallengeService,
    ),
    verifyEmailOtpWalletRecoveryChallenge:
      assembly.emailOtpChallengeService.verifyEmailOtpWalletRecoveryChallenge.bind(
        assembly.emailOtpChallengeService,
      ),
    verifyEmailOtpEnrollment: assembly.emailOtpChallengeService.verifyEmailOtpEnrollment.bind(
      assembly.emailOtpChallengeService,
    ),
    verifyGoogleLogin: assembly.oidcVerification.verifyGoogleLogin.bind(assembly.oidcVerification),
  };
}
