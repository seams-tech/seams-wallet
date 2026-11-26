import type { EmailOtpAuthLane } from '../../stepUpConfirmation/otpPrompt/authLane';
import type { ExactEvmFamilyWalletSessionAuthorization } from '../material/ecdsaSigningCapability';

export function emailOtpEcdsaSigningSessionAuthLane(
  authorization: ExactEvmFamilyWalletSessionAuthorization,
): Extract<EmailOtpAuthLane, { kind: 'signing_session'; curve: 'ecdsa' }> {
  if (
    authorization.selectedAuthMethod.kind !== 'email_otp' ||
    authorization.runtime.kind !== 'exact_ecdsa_sealed_runtime_v1' ||
    authorization.runtime.authBinding.kind !== 'email_otp' ||
    authorization.operationCredential.token.trim().length === 0 ||
    authorization.runtime.sealedRecord.thresholdSessionId.trim().length === 0
  ) {
    throw new Error('Exact Email OTP ECDSA signing-session authorization is incomplete');
  }
  return {
    kind: 'signing_session',
    operationCredential: authorization.operationCredential,
    thresholdSessionId: authorization.runtime.sealedRecord.thresholdSessionId,
    curve: 'ecdsa',
    chainTarget: authorization.runtime.chainTarget,
  };
}
