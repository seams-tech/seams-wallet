import type { AppearanceConfig } from '@/core/types/seams';
import type { HostedAuthMenuExternalProvider } from '../../shared/messages';
import type {
  GoogleEmailOtpWalletAuthDelivery,
  GoogleEmailOtpWalletAuthLoginTarget,
  GoogleEmailOtpWalletAuthPromptCopy,
} from '@/SeamsWeb/publicApi/types';
import type { LinkedDeviceEmailOtpActivationStateV1 } from '@/core/types/linkDevice';
import type { LinkedDeviceTargetFactorV1 } from '@shared/device-linking';
import type { WalletRecoveryTargetV1 } from '@shared/wallet-recovery/walletRecoveryTarget';
import type { EmailOtpChallengeDelivery } from '@/core/signingEngine/session/emailOtp/publicTypes';
import type { WalletAuthMethod } from '@shared/utils/signerDomain';
import { getUserFriendlyErrorMessage, isWebAuthnBrowserSecurityError } from '@shared/utils/errors';

/**
 * The view model is normalized by the wallet-host controller before it reaches
 * the element. Keeping the model here makes the component usable by a future
 * host controller without coupling it to a renderer or the message router.
 */
/**
 * Discriminated by PRESENTATION, not by which internal phase produced it.
 *
 * The surface can show the form, the waiting view, the form with a message,
 * or the success view that ends a session, so those are the kinds. An earlier
 * shape split the busy case in two ('preparing' vs 'performing'), a provenance
 * distinction the surface could not act on: it rendered the waiting view for
 * one and the form for the other, so every author who reached for the wrong
 * one silently got a form where they meant a spinner. That exact mistake
 * shipped four times. Here "busy but rendering the form" cannot be expressed.
 *
 * `headline` is required on `busy` so entering a wait forces naming what is
 * being waited on, rather than inheriting whatever copy the previous view had.
 */
type AuthMenuSurfaceStatus =
  | {
      /** Renders the form. */
      readonly kind: 'idle';
      /**
       * - `actionable`: primary control is live.
       * - `awaiting_input`: live once the required input is filled in.
       * - `arming`: background preparation in flight; control not yet usable.
       */
      readonly interaction: 'actionable' | 'awaiting_input' | 'arming';
    }
  | {
      /** Renders the waiting view. The only busy state there is. */
      readonly kind: 'busy';
      /** Names the wait, e.g. "Verifying your email code". */
      readonly headline: string;
      /** Optional prompt outside the menu: the device's passkey prompt or
       *  Google's account chooser. The waiting view shows its ring and copy. */
      readonly illustration?: keyof typeof AUTH_MENU_WAITING_PROMPTS;
      /** Optional secondary line, shown only when the host opts into progress. */
      readonly detail?: string;
    }
  | {
      /** Renders the form plus a message; the primary control stays live. */
      readonly kind: 'recoverable';
      readonly reason: 'error' | 'expired';
      /** Written for the person signing in. */
      readonly message: string;
      /** The underlying error text. Reported to the host app, never rendered. */
      readonly detail?: string;
    }
  | {
      /** Renders the success view: the wait's ring closes into a check. The
       *  menu takes no input; the session reports its outcome when the view
       *  has faded out. */
      readonly kind: 'succeeded';
      readonly headline: string;
      readonly message: string;
      /** `leaving` fades the whole card out before the surface goes. */
      readonly phase: 'shown' | 'leaving';
    };

/** A wait on a prompt outside the menu shares one look: the ring, then the
 *  headline, then what to do in that prompt. */
export const AUTH_MENU_WAITING_PROMPTS = {
  passkey: { label: 'Passkey authentication', instruction: 'Complete the prompt on your device.' },
  google: { label: 'Google sign-in', instruction: 'Choose your Google account.' },
} as const;

/** The waiting headline for the passkey ceremony itself. */
export function passkeyCeremonyHeadline(mode: 'login' | 'register'): string {
  return mode === 'register' ? 'Creating passkey wallet…' : 'Unlocking wallet…';
}

/** What the success view says for each successful outcome. */
export function authMenuSuccessCopy(
  outcome: 'authenticated' | 'registered' | 'account_synced',
): Pick<AuthMenuSucceededStatus, 'headline' | 'message'> {
  return outcome === 'registered'
    ? { headline: 'Wallet created', message: 'Your wallet is ready on this device.' }
    : { headline: 'You’re in', message: 'Your wallet is unlocked.' };
}

const RATE_LIMITED_FAILURE = /\bHTTP 429\b|too many requests|rate limit/i;
const UNREACHABLE_FAILURE =
  /\bHTTP 5\d\d\b|failed to fetch|load failed|networkerror|network request failed|connection ?closed/i;
const TIMED_OUT_FAILURE = /timed out|timeout/i;

function authMenuFailureMessage(detail: string): string {
  if (isWebAuthnBrowserSecurityError(detail)) return getUserFriendlyErrorMessage(detail);
  if (RATE_LIMITED_FAILURE.test(detail)) return 'Too many attempts. Wait a moment.';
  if (UNREACHABLE_FAILURE.test(detail)) return 'Can’t reach Seams right now.';
  if (TIMED_OUT_FAILURE.test(detail)) return 'That took too long.';
  return 'Something went wrong.';
}

/**
 * The status for a failure the menu has no sentence of its own for. Thrown
 * text is written for developers, so the menu shows one of a few plain
 * sentences and keeps the original as `detail`.
 */
export function authMenuFailureStatus(detail: string): AuthMenuRecoverableStatus {
  return { kind: 'recoverable', reason: 'error', message: authMenuFailureMessage(detail), detail };
}

interface AuthMenuViewModelCommon {
  readonly appearance: AppearanceConfig;
  readonly hostname: string;
  readonly closeLabel: string;
  readonly heading: string;
  readonly subtitle: string;
  readonly ctaLabel: string;
  readonly showProgress: boolean;
  readonly enabledExternalProviders?: readonly HostedAuthMenuExternalProvider[];
  readonly status: AuthMenuSurfaceStatus;
}

export type AuthMenuLoginViewModel = AuthMenuViewModelCommon & {
  readonly kind: 'passkey';
  readonly mode: 'login';
  readonly accountOptions: readonly AuthMenuAccountOption[];
  readonly selectedAccount: AuthMenuAccountOption | null;
  readonly passkeyName?: never;
  readonly passkeyNameLabel?: never;
};

export type AuthMenuRegisterViewModel = AuthMenuViewModelCommon & {
  readonly kind: 'passkey';
  readonly mode: 'register';
  readonly showRegistrationInput: boolean;
  readonly passkeyNameReadOnly: boolean;
  readonly passkeyName: string;
  readonly passkeyNameLabel: string;
};

export type AuthMenuAccountOption =
  | Readonly<{
      walletId: string;
      authMethod: 'voiceid';
      walletAuthMethodId: string;
      emailAddress?: never;
    }>
  | Readonly<{
      readonly walletId: string;
      readonly authMethod: Extract<WalletAuthMethod, 'passkey'>;
      readonly emailAddress?: never;
    }>
  | Readonly<{
      readonly walletId: string;
      readonly authMethod: Extract<WalletAuthMethod, 'email_otp'>;
      readonly emailAddress: string | null;
    }>;

type ResolvedAuthMenuLoginAccount = Readonly<{
  selectedAccount: AuthMenuAccountOption;
  walletId: string;
  loginTarget: Extract<GoogleEmailOtpWalletAuthLoginTarget, { kind: 'wallet' }>;
}>;

export type AuthMenuLoginAccountResolution =
  | {
      readonly kind: 'discoverable';
      readonly selectedAccount: null;
      readonly loginTarget: Extract<GoogleEmailOtpWalletAuthLoginTarget, { kind: 'discoverable' }>;
    }
  | (ResolvedAuthMenuLoginAccount & { readonly kind: 'voiceid' })
  | (ResolvedAuthMenuLoginAccount & { readonly kind: 'passkey' })
  | (ResolvedAuthMenuLoginAccount & { readonly kind: 'email_otp' })
  | (ResolvedAuthMenuLoginAccount & { readonly kind: 'passkey_and_email_otp' });

export function resolveAuthMenuLoginAccount(
  accountOptions: readonly AuthMenuAccountOption[],
  selectedAccount: AuthMenuAccountOption | null,
): AuthMenuLoginAccountResolution {
  const exactSelection = selectedAccount
    ? accountOptions.find(
        (account) =>
          account.walletId === selectedAccount.walletId &&
          account.authMethod === selectedAccount.authMethod,
      )
    : null;
  const sameWalletSelection = selectedAccount
    ? accountOptions.find((account) => account.walletId === selectedAccount.walletId)
    : null;
  const selected = exactSelection ?? sameWalletSelection ?? accountOptions[0];
  if (!selected) {
    return {
      kind: 'discoverable',
      selectedAccount: null,
      loginTarget: { kind: 'discoverable' },
    };
  }
  const walletMethods = accountOptions.filter((account) => account.walletId === selected.walletId);
  const hasPasskey = walletMethods.some((account) => account.authMethod === 'passkey');
  const hasEmailOtp = walletMethods.some((account) => account.authMethod === 'email_otp');
  const resolved = {
    selectedAccount: selected,
    walletId: selected.walletId,
    loginTarget: { kind: 'wallet' as const, walletId: selected.walletId },
  };
  if (hasPasskey && hasEmailOtp) return { kind: 'passkey_and_email_otp', ...resolved };
  if (hasPasskey) return { kind: 'passkey', ...resolved };
  if (hasEmailOtp) return { kind: 'email_otp', ...resolved };
  if (walletMethods.some(isVoiceIdAccount)) return { kind: 'voiceid', ...resolved };
  throw new Error('Selected auth-menu account has no supported authentication method');
}

export function authMenuLoginAllowsPasskey(resolution: AuthMenuLoginAccountResolution): boolean {
  switch (resolution.kind) {
    case 'discoverable':
    case 'passkey':
    case 'passkey_and_email_otp':
      return true;
    case 'email_otp':
    case 'voiceid':
      return false;
  }
}

export function authMenuLoginAllowsEmailOtp(resolution: AuthMenuLoginAccountResolution): boolean {
  switch (resolution.kind) {
    case 'discoverable':
    case 'email_otp':
    case 'passkey_and_email_otp':
      return true;
    case 'passkey':
    case 'voiceid':
      return false;
  }
}

export type AuthMenuGoogleLoginViewModel = AuthMenuViewModelCommon & {
  readonly kind: 'google_otp_login';
  readonly mode: 'login';
  readonly emailHint: string;
  readonly walletId: string;
  readonly challengeId: string;
  readonly prompt: GoogleEmailOtpWalletAuthPromptCopy;
  readonly delivery: GoogleEmailOtpWalletAuthDelivery;
  readonly otpCode: string;
  readonly resendBusy: boolean;
  readonly submitBusy: boolean;
  readonly error?: string;
  readonly passkeyName?: never;
  readonly passkeyNameLabel?: never;
};

export type AuthMenuGoogleRegistrationViewModel = AuthMenuViewModelCommon & {
  readonly kind: 'google_registration';
  readonly mode: 'register';
  readonly emailHint: string;
  readonly walletId: string;
  readonly prompt: GoogleEmailOtpWalletAuthPromptCopy;
  readonly rerollBusy: boolean;
  readonly submitBusy: boolean;
  readonly error?: string;
  readonly passkeyName?: never;
  readonly passkeyNameLabel?: never;
};

export type AuthMenuLinkDeviceState =
  | {
      readonly kind: 'select_factor';
      readonly targetFactor: Extract<LinkedDeviceTargetFactorV1, { readonly kind: 'passkey_prf' }>;
      readonly targetEmail?: never;
      readonly error?: string;
    }
  | {
      readonly kind: 'select_factor';
      readonly targetFactor: Extract<LinkedDeviceTargetFactorV1, { readonly kind: 'email_otp' }>;
      readonly targetEmail: string;
      readonly error?: string;
    }
  | { readonly kind: 'loading'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly qrCodeDataURL: string;
      readonly message: string;
    }
  | {
      readonly kind: 'passkey_required';
      readonly message: string;
    }
  | {
      readonly kind: 'creating_passkey';
      readonly message: string;
    }
  | {
      readonly kind: 'email_otp_required';
      readonly state: LinkedDeviceEmailOtpActivationStateV1;
      readonly otpCode: string;
    }
  | { readonly kind: 'activating'; readonly message: string }
  | { readonly kind: 'expired'; readonly message: string }
  | { readonly kind: 'cancelled'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'activation_error'; readonly message: string };

export type AuthMenuLinkDeviceViewModel = AuthMenuViewModelCommon & {
  readonly kind: 'link_device';
  readonly mode: 'login' | 'register';
  readonly linkDevice: AuthMenuLinkDeviceState;
  readonly passkeyName?: never;
  readonly passkeyNameLabel?: never;
};

export type AuthMenuRecoveryStage =
  | 'enter_code'
  | 'choose_method'
  | 'preparing'
  | 'passkey_ready'
  | 'google_ready'
  | 'email_code_required'
  | 'finalizing'
  | 'sign_in_ready';

type AuthMenuIdleStatus = Extract<AuthMenuSurfaceStatus, { readonly kind: 'idle' }>;
type AuthMenuBusyStatus = Extract<AuthMenuSurfaceStatus, { readonly kind: 'busy' }>;
type AuthMenuRecoverableStatus = Extract<AuthMenuSurfaceStatus, { readonly kind: 'recoverable' }>;
export type AuthMenuSucceededStatus = Extract<
  AuthMenuSurfaceStatus,
  { readonly kind: 'succeeded' }
>;

export type AuthMenuRecoveryViewModel = AuthMenuViewModelCommon & {
  readonly kind: 'recovery';
  readonly mode: 'login';
  readonly recoveryCode: string;
  readonly recoveryCodeError: string | null;
  readonly passkeyName?: never;
  readonly passkeyNameLabel?: never;
} & (
    | {
        readonly stage: 'enter_code';
        readonly walletId?: never;
        readonly status: AuthMenuIdleStatus | AuthMenuRecoverableStatus;
      }
    | {
        /* The code is well formed; the server has not seen it yet. The owner
           picks the sign-in method recovery will install, and that click is
           what sends the code. */
        readonly stage: 'choose_method';
        readonly walletId?: never;
        readonly status: AuthMenuIdleStatus | AuthMenuRecoverableStatus;
      }
    | {
        readonly stage: 'preparing';
        readonly target: WalletRecoveryTargetV1;
        readonly walletId?: never;
        readonly status: AuthMenuBusyStatus;
      }
    | {
        readonly stage: 'passkey_ready';
        readonly target: Extract<WalletRecoveryTargetV1, { readonly kind: 'passkey' }>;
        readonly walletId: string;
        readonly status: AuthMenuIdleStatus | AuthMenuRecoverableStatus;
      }
    | {
        readonly stage: 'google_ready';
        readonly target: Extract<WalletRecoveryTargetV1, { readonly kind: 'google_email_otp' }>;
        readonly walletId: string;
        readonly status: AuthMenuIdleStatus | AuthMenuRecoverableStatus;
      }
    | {
        readonly stage: 'email_code_required';
        readonly target: Extract<WalletRecoveryTargetV1, { readonly kind: 'google_email_otp' }>;
        readonly walletId: string;
        readonly challengeId: string;
        readonly emailHint: string;
        readonly delivery: EmailOtpChallengeDelivery;
        readonly otpCode: string;
        readonly status: AuthMenuIdleStatus | AuthMenuRecoverableStatus | AuthMenuBusyStatus;
      }
    | {
        readonly stage: 'finalizing';
        readonly target: WalletRecoveryTargetV1;
        readonly walletId: string;
        readonly status: AuthMenuBusyStatus | AuthMenuRecoverableStatus;
      }
    | {
        readonly stage: 'sign_in_ready';
        readonly target: WalletRecoveryTargetV1;
        readonly walletId: string;
        readonly status:
          | AuthMenuIdleStatus
          | AuthMenuBusyStatus
          | AuthMenuRecoverableStatus
          | AuthMenuSucceededStatus;
      }
  );

export type AuthMenuViewModel =
  | AuthMenuLoginViewModel
  | AuthMenuRegisterViewModel
  | AuthMenuGoogleLoginViewModel
  | AuthMenuGoogleRegistrationViewModel
  | AuthMenuLinkDeviceViewModel
  | AuthMenuRecoveryViewModel;

type AuthMenuCloseReason = 'close_button' | 'escape';

export type AuthMenuIntent =
  | {
      readonly kind: 'close';
      readonly reason: AuthMenuCloseReason;
    }
  | {
      readonly kind: 'mode_selected';
      readonly mode: 'login' | 'register';
    }
  | {
      readonly kind: 'back';
    }
  | {
      readonly kind: 'link_device_open';
    }
  | {
      readonly kind: 'recovery_open';
    }
  | {
      readonly kind: 'recovery_code_changed';
      readonly recoveryCode: string;
    }
  | {
      readonly kind: 'recovery_code_submit';
    }
  | {
      readonly kind: 'recovery_passkey_selected';
    }
  | {
      readonly kind: 'recovery_google_selected';
    }
  | {
      readonly kind: 'recovery_google_otp_code_changed';
      readonly code: string;
    }
  | {
      readonly kind: 'recovery_google_otp_submit';
    }
  | {
      readonly kind: 'recovery_create_passkey';
    }
  | {
      readonly kind: 'recovery_sign_in';
    }
  | {
      readonly kind: 'link_device_create_passkey';
    }
  | {
      readonly kind: 'link_device_factor_selected';
      readonly targetFactor: LinkedDeviceTargetFactorV1;
    }
  | {
      readonly kind: 'link_device_target_email_changed';
      readonly emailAddress: string;
    }
  | {
      readonly kind: 'link_device_start';
    }
  | {
      readonly kind: 'link_device_email_otp_code_changed';
      readonly code: string;
    }
  | {
      readonly kind: 'link_device_email_otp_resend';
    }
  | {
      readonly kind: 'link_device_email_otp_submit';
    }
  | {
      readonly kind: 'registration_reroll';
    }
  | {
      readonly kind: 'submit';
      readonly mode: 'login';
    }
  | {
      readonly kind: 'submit';
      readonly mode: 'register';
      readonly passkeyName: string;
    }
  | {
      readonly kind: 'passkey_name_changed';
      readonly passkeyName: string;
    }
  | {
      readonly kind: 'voiceid_selected';
    }
  | {
      readonly kind: 'login_account_selected';
      readonly walletId: string;
      readonly authMethod: WalletAuthMethod;
    }
  | {
      readonly kind: 'external_auth';
      readonly provider: HostedAuthMenuExternalProvider;
    }
  | {
      readonly kind: 'google_otp_code_changed';
      readonly code: string;
    }
  | {
      readonly kind: 'google_otp_resend';
    }
  | {
      readonly kind: 'google_otp_submit';
    }
  | {
      readonly kind: 'google_registration_reroll';
    }
  | {
      readonly kind: 'google_registration_complete';
    }
  | {
      readonly kind: 'retry';
    };

export function isAuthMenuLoadingStatus(status: AuthMenuSurfaceStatus): boolean {
  return status.kind === 'busy';
}

/** The view a session ends on, or null where the view cannot show success.
 *  Recovery succeeds only from its sign-in stage. */
export function authMenuSuccessViewModel(
  viewModel: AuthMenuViewModel,
  status: AuthMenuSucceededStatus,
): AuthMenuViewModel | null {
  if (viewModel.kind !== 'recovery') return { ...viewModel, status };
  if (viewModel.stage !== 'sign_in_ready') return null;
  return { ...viewModel, status };
}

export function isAuthMenuReady(viewModel: AuthMenuViewModel): boolean {
  const status = viewModel.status;
  return status.kind === 'idle' && status.interaction === 'actionable';
}

/**
 * A failed or expired preparation is recoverable by acting again, so the
 * primary control stays live and re-prepares on click. Only genuinely
 * in-flight work or a required input disables it.
 */
function isAuthMenuActionable(viewModel: AuthMenuViewModel): boolean {
  const status = viewModel.status;
  if (status.kind === 'recoverable') return true;
  return status.kind === 'idle' && status.interaction === 'actionable';
}

export function isAuthMenuActionReady(viewModel: AuthMenuViewModel): boolean {
  if (!isAuthMenuActionable(viewModel)) return false;
  switch (viewModel.kind) {
    case 'google_otp_login':
      return !viewModel.submitBusy && /^\d{6}$/.test(viewModel.otpCode);
    case 'google_registration':
      return !viewModel.rerollBusy && !viewModel.submitBusy;
    case 'link_device':
      return false;
    case 'recovery':
      return (
        viewModel.stage === 'passkey_ready' ||
        viewModel.stage === 'google_ready' ||
        viewModel.stage === 'sign_in_ready' ||
        (viewModel.stage === 'email_code_required' && /^\d{6}$/.test(viewModel.otpCode))
      );
    case 'passkey':
      return viewModel.mode === 'login'
        ? authMenuLoginAllowsPasskey(
            resolveAuthMenuLoginAccount(viewModel.accountOptions, viewModel.selectedAccount),
          )
        : !viewModel.showRegistrationInput || viewModel.passkeyName.trim().length > 0;
  }
}

export function isAuthMenuGoogleActionReady(viewModel: AuthMenuViewModel): boolean {
  if (!isAuthMenuActionable(viewModel)) return false;
  if (viewModel.kind !== 'passkey' || viewModel.mode !== 'login') return true;
  return authMenuLoginAllowsEmailOtp(
    resolveAuthMenuLoginAccount(viewModel.accountOptions, viewModel.selectedAccount),
  );
}

function isVoiceIdAccount(account: AuthMenuAccountOption): boolean {
  return account.authMethod === 'voiceid';
}
