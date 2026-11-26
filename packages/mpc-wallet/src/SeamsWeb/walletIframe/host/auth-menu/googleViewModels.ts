import type {
  AuthMenuGoogleLoginViewModel,
  AuthMenuGoogleRegistrationViewModel,
  AuthMenuLoginViewModel,
  AuthMenuViewModel,
} from './domain';
import type {
  GoogleEmailOtpWalletAuthFlow,
  GoogleEmailOtpWalletAuthLoginFlow,
  GoogleEmailOtpWalletAuthRegistrationFlow,
} from '@/SeamsWeb/publicApi/types';

/**
 * What a Google sign-in from the menu gives: a flow that sent a code or offers registration, or
 * a wallet whose Email OTP key this device does not hold, for which no code was sent.
 */
export type AuthMenuGoogleSignInResult =
  | GoogleEmailOtpWalletAuthFlow
  | {
      readonly kind: 'device_factor_missing';
      readonly walletId: string;
      readonly emailHint: string;
    };

/** The login menu, showing device linking and recovery for a wallet this device has no key for. */
export function deviceFactorMissingViewModel(
  base: AuthMenuViewModel,
  missing: Extract<AuthMenuGoogleSignInResult, { readonly kind: 'device_factor_missing' }>,
): AuthMenuLoginViewModel {
  if (base.kind !== 'passkey' || base.mode !== 'login') {
    throw new Error('The no-key view needs the login menu');
  }
  return {
    ...base,
    deviceFactorMissing: { walletId: missing.walletId, emailHint: missing.emailHint },
    status: { kind: 'idle', interaction: 'actionable' },
  };
}

function googleViewModelBase(args: {
  base: AuthMenuViewModel;
  flow: GoogleEmailOtpWalletAuthFlow;
  status: AuthMenuViewModel['status'];
}): Pick<
  AuthMenuViewModel,
  'appearance' | 'hostname' | 'closeLabel' | 'showProgress' | 'enabledExternalProviders' | 'status'
> & {
  heading: string;
  subtitle: string;
  ctaLabel: string;
} {
  return {
    appearance: args.base.appearance,
    hostname: args.base.hostname,
    closeLabel: args.base.closeLabel,
    heading: args.flow.prompt.title,
    subtitle: args.flow.prompt.description,
    ctaLabel: args.flow.prompt.submitLabel,
    showProgress: args.base.showProgress,
    enabledExternalProviders: args.base.enabledExternalProviders,
    status: args.status,
  };
}

export function googleLoginViewModel(args: {
  base: AuthMenuViewModel;
  flow: GoogleEmailOtpWalletAuthLoginFlow;
  otpCode?: string;
  resendBusy?: boolean;
  submitBusy?: boolean;
  error?: string;
  status?: AuthMenuViewModel['status'];
}): AuthMenuGoogleLoginViewModel {
  const challengePrefix = `google-email-otp-login:${args.flow.walletId}:`;
  if (!args.flow.flowId.startsWith(challengePrefix)) {
    throw new Error('Google Email OTP login flow identity is invalid');
  }
  return {
    ...googleViewModelBase({
      base: args.base,
      flow: args.flow,
      status: args.status ?? { kind: 'idle', interaction: 'actionable' },
    }),
    kind: 'google_otp_login',
    mode: 'login',
    emailHint: args.flow.emailHint,
    walletId: String(args.flow.walletId),
    challengeId: args.flow.flowId.slice(challengePrefix.length),
    prompt: args.flow.prompt,
    delivery: args.flow.delivery,
    otpCode: args.otpCode ?? '',
    resendBusy: args.resendBusy ?? false,
    submitBusy: args.submitBusy ?? false,
    ...(args.error ? { error: args.error } : {}),
  };
}

export function googleRegistrationViewModel(args: {
  base: AuthMenuViewModel;
  flow: GoogleEmailOtpWalletAuthRegistrationFlow;
  rerollBusy?: boolean;
  submitBusy?: boolean;
  error?: string;
  status?: AuthMenuViewModel['status'];
}): AuthMenuGoogleRegistrationViewModel {
  return {
    ...googleViewModelBase({
      base: args.base,
      flow: args.flow,
      status: args.status ?? { kind: 'idle', interaction: 'actionable' },
    }),
    kind: 'google_registration',
    mode: 'register',
    emailHint: args.flow.emailHint,
    walletId: String(args.flow.walletId),
    prompt: args.flow.prompt,
    rerollBusy: args.rerollBusy ?? false,
    submitBusy: args.submitBusy ?? false,
    ...(args.error ? { error: args.error } : {}),
  };
}
