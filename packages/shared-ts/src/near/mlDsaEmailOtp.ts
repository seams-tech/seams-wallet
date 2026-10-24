import { exactRecord } from '../utils/exactRecord';
import { requireCanonicalString } from '../utils/validation';
import { parseEmailOtpChallengeId, type EmailOtpChallengeId } from '../utils/domainIds';
import { requireParsed } from '../passkey-custody/primitives';

export type MlDsaEmailOtpProof = {
  readonly challengeId: EmailOtpChallengeId;
  readonly otpCode: string;
};
export function parseMlDsaEmailOtpProof(raw: unknown): MlDsaEmailOtpProof {
  const record = exactRecord(raw, ['challengeId', 'otpCode'], 'ML-DSA Email OTP proof');
  const otpCode = requireCanonicalString(record.otpCode, 'OTP code');
  if (!/^\d{6}$/.test(otpCode)) throw new Error('A six-digit Email OTP code is required');
  return {
    challengeId: requireParsed(parseEmailOtpChallengeId(record.challengeId), 'challengeId'),
    otpCode,
  };
}
