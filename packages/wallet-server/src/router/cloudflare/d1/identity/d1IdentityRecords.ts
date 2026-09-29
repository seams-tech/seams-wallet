import { toOptionalTrimmedString } from '@shared/utils/validation';
import { GOOGLE_EMAIL_OTP_STALE_IDENTITY_MESSAGE } from '../../../../core/authService/googleEmailOtpErrors';
import type {
  RouterApiIdentityService,
} from '../../../framework/authServicePort';

type ResolveGoogleEmailOtpSessionResult = Awaited<
  ReturnType<RouterApiIdentityService['resolveGoogleEmailOtpSession']>
>;

export function hasDifferentWalletIdentitySubject(input: {
  readonly subjects: readonly string[];
  readonly expectedIdentitySubject: string;
}): boolean {
  for (const subject of input.subjects) {
    if (subject.startsWith('wallet:') && subject !== input.expectedIdentitySubject) return true;
  }
  return false;
}

export function googleEmailOtpStaleIdentityMapping(input: {
  readonly providerSubject: string;
  readonly linkedWalletId: string;
  readonly email?: string;
}): Extract<ResolveGoogleEmailOtpSessionResult, { readonly ok: false }> {
  const email = toOptionalTrimmedString(input.email);
  return {
    ok: false,
    mode: 'stale_identity_mapping',
    code: 'stale_identity_mapping',
    walletId: input.linkedWalletId,
    providerSubject: input.providerSubject,
    ...(email ? { email } : {}),
    message: GOOGLE_EMAIL_OTP_STALE_IDENTITY_MESSAGE,
  };
}

