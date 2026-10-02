export const EMAIL_OTP_CODE_LENGTH = 6 as const;

export type EmailOtpRateLimitScope =
  | 'challenge'
  | 'verify'
  | 'grant'
  | 'googleRegistrationAttempt';
