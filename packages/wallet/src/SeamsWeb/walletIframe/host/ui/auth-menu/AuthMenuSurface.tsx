/** @jsxImportSource preact */
import { Component, Fragment, type ComponentChildren } from 'preact';
import type { CspStylesheetManager } from '@/core/browser/walletIframe/csp-stylesheet';
import {
  isAuthMenuActionReady,
  isAuthMenuGoogleActionReady,
  isAuthMenuLoadingStatus,
  isAuthMenuReady,
  resolveAuthMenuLoginAccount,
  type AuthMenuAccountOption,
  type AuthMenuIntent,
  type AuthMenuLinkDeviceState,
  type AuthMenuLoginViewModel,
  type AuthMenuRecoveryStage,
  type AuthMenuRecoveryViewModel,
  type AuthMenuRegisterViewModel,
  type AuthMenuViewModel,
} from '../../auth-menu/domain';
import { isLinkedDeviceTargetEmailAddressV1 } from '@/core/types/linkDevice';

const AUTH_MENU_TITLE_ID = 'seams-auth-menu-title';
const AUTH_MENU_ACCOUNT_LIST_ID = 'seams-auth-menu-account-list';

function otpCodeDigits(code: string): readonly string[] {
  return code.padEnd(6, ' ').slice(0, 6).split('');
}

function renderOtpCodeDigit(digit: string): ComponentChildren {
  return (
    <>
      <span class={`seams-otp-slot ${digit.trim() ? 'is-filled' : ''}`}>{digit}</span>
    </>
  );
}

function authViewKey(viewModel: AuthMenuViewModel): string {
  const stage = viewModel.kind === 'recovery' ? `:${viewModel.stage}` : '';
  return `${viewModel.kind}:${viewModel.mode}:${viewModel.status.kind}${stage}`;
}

function recoveryAnnouncement(viewModel: AuthMenuRecoveryViewModel): string {
  if (viewModel.status.kind === 'busy') return viewModel.status.headline;
  if (viewModel.status.kind === 'recoverable') return viewModel.status.message;
  if (viewModel.stage === 'passkey_ready') return 'Recovery code accepted.';
  if (viewModel.stage === 'sign_in_ready') return 'Account recovered. Sign in to continue.';
  return '';
}

function recoveryNavigationLocked(viewModel: AuthMenuViewModel): boolean {
  return viewModel.kind === 'recovery' && viewModel.stage === 'finalizing';
}

function modeSwitchCopy(mode: AuthMenuViewModel['mode']): {
  prompt: string;
  action: string;
  nextMode: 'login' | 'register';
} {
  return mode === 'register'
    ? { prompt: 'Already have an account?', action: 'Sign in', nextMode: 'login' }
    : { prompt: "Don't have an account?", action: 'Sign up', nextMode: 'register' };
}

function passkeyButtonLabel(mode: AuthMenuViewModel['mode']): string {
  return mode === 'register' ? 'Sign up with Passkey' : 'Sign in with Passkey';
}

function googleButtonLabel(mode: AuthMenuViewModel['mode']): string {
  return mode === 'register' ? 'Sign up with Google' : 'Sign in with Google';
}

function fingerprintIcon(): ComponentChildren {
  return (
    <>
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M6.405 19.048c.184-.443.353-.894.507-1.351" />
        <path d="M14.343 20.693c.266-.751.502-1.516.707-2.294.186-.706.346-1.422.478-2.147" />
        <path d="M19.448 17.058c.364-1.964.555-3.989.555-6.058 0-4.418-3.582-8-8-8-1.255 0-2.443.289-3.501.805" />
        <path d="M3.523 15.025c.314-1.29.48-2.638.48-4.025 0-1.74.556-3.351 1.499-4.664" />
        <path d="M12.003 11c0 2.76-.447 5.416-1.273 7.899-.213.639-.451 1.266-.712 1.881" />
        <path d="M7.712 14.5c.191-1.138.291-2.308.291-3.5 0-2.209 1.791-4 4-4s4 1.791 4 4c0 .617-.02 1.229-.058 1.836" />
      </svg>
    </>
  );
}

function googleIcon(): ComponentChildren {
  return (
    <>
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M10.88 21.94 15.46 14" />
        <path d="M21.17 8H12" />
        <path d="M3.95 6.06 8.54 14" />
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="4" />
      </svg>
    </>
  );
}

function arrowIcon(): ComponentChildren {
  return (
    <>
      <div class="stripe-arrow seams-auth-method-arrow">
        <svg class="HoverArrow" width="16" height="16" viewBox="0 0 10 10" aria-hidden="true">
          <g fill-rule="evenodd">
            <path class="HoverArrow__linePath" d="M0 5h7" />
            <path class="HoverArrow__tipPath" d="M1 1l4 4-4 4" />
          </g>
        </svg>
      </div>
    </>
  );
}

function accountDropdownIcon(): ComponentChildren {
  return (
    <>
      <svg
        class="seams-account-dropdown-arrow"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M9.75 3h4.5v10.28l4.3-4.3 3.18 3.18L12 21.9l-9.73-9.74 3.18-3.18 4.3 4.3V3Z" />
      </svg>
    </>
  );
}

function backIcon(): ComponentChildren {
  return (
    <>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.25"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
    </>
  );
}

function linkDeviceIcon(): ComponentChildren {
  return (
    <>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect width="5" height="5" x="3" y="3" rx="1" />
        <rect width="5" height="5" x="16" y="3" rx="1" />
        <rect width="5" height="5" x="3" y="16" rx="1" />
        <path d="M21 16h-3a2 2 0 0 0-2 2v3" />
        <path d="M21 21v.01" />
        <path d="M12 7v3a2 2 0 0 1-2 2H7" />
        <path d="M3 12h.01" />
        <path d="M12 3h.01" />
        <path d="M12 16v.01" />
        <path d="M16 12h1" />
        <path d="M21 12v.01" />
        <path d="M12 21v-1" />
      </svg>
    </>
  );
}

function recoveryIcon(): ComponentChildren {
  return (
    <>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M20 11v6" />
        <path d="M20 13h2" />
        <path d="M3 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 2.072.578" />
        <circle cx="10" cy="7" r="4" />
        <circle cx="20" cy="19" r="2" />
      </svg>
    </>
  );
}

const LINK_DEVICE_DOT_COUNT = 12;

/* Three phases of one badge: `waiting` sweeps the dots like a clock spinner,
   `idle` rests them to a faint ring around whatever glyph the view supplies,
   and `approved` settles them while the check strokes itself in over the top. */
type LinkDeviceRingPhase = 'waiting' | 'idle' | 'approved';

function linkDeviceDotRing(
  phase: LinkDeviceRingPhase,
  glyph?: ComponentChildren,
): ComponentChildren {
  return (
    <>
      <div class={`seams-link-device-dot-ring is-${phase}`} aria-hidden="true">
        {Array.from({ length: LINK_DEVICE_DOT_COUNT }, (_, index) => (
          <>
            <span data-dot-index={index}></span>
          </>
        ))}
        {glyph ? (
          <>
            <div class="seams-link-device-dot-ring-glyph">{glyph}</div>
          </>
        ) : null}
        <svg
          class="seams-link-device-dot-ring-check"
          viewBox="0 0 52 52"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m18.5 27 5 5 10-11" />
        </svg>
      </div>
    </>
  );
}

function mailIcon(): ComponentChildren {
  return (
    <>
      <svg
        width="21"
        height="21"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect x="2.75" y="5" width="18.5" height="14" rx="2.75" />
        <path d="m3.75 7.75 6.94 4.86a2.25 2.25 0 0 0 2.62 0l6.94-4.86" />
      </svg>
    </>
  );
}

type AuthMenuLinkDeviceEmailOtpState = Extract<
  AuthMenuLinkDeviceState,
  { kind: 'email_otp_required' }
>;

/* One row per activation state, so the badge, heading, and status line can
   never disagree about which phase the view is in. `pending` marks the phases
   the flow drives itself out of — those get the animated ellipsis. */
type LinkDeviceEmailOtpPresentation = {
  readonly ring: LinkDeviceRingPhase;
  readonly heading: string;
  readonly status: string;
  readonly pending: boolean;
  readonly tone: 'neutral' | 'error';
};

function linkDeviceEmailOtpPresentation(
  activation: AuthMenuLinkDeviceEmailOtpState['state'],
): LinkDeviceEmailOtpPresentation {
  switch (activation.kind) {
    case 'sending':
      return {
        ring: 'waiting',
        heading: 'Sending your code',
        status: 'Emailing a 6-digit code',
        pending: true,
        tone: 'neutral',
      };
    case 'resending':
      return {
        ring: 'waiting',
        heading: 'Sending a new code',
        status: 'Emailing a fresh 6-digit code',
        pending: true,
        tone: 'neutral',
      };
    case 'submitting':
      return {
        ring: 'waiting',
        heading: 'Checking your code',
        status: 'Verifying the code you entered',
        pending: true,
        tone: 'neutral',
      };
    case 'code_input':
      return {
        ring: 'idle',
        heading: 'Verify your email',
        status: 'Enter the 6-digit code we just sent.',
        pending: false,
        tone: 'neutral',
      };
    case 'incorrect':
      return {
        ring: 'idle',
        heading: 'Verify your email',
        status: activation.message,
        pending: false,
        tone: 'error',
      };
    case 'expired':
      return {
        ring: 'idle',
        heading: 'That code expired',
        status: activation.message,
        pending: false,
        tone: 'error',
      };
    case 'unavailable':
      return {
        ring: 'idle',
        heading: 'Email code unavailable',
        status: activation.message,
        pending: false,
        tone: 'error',
      };
    case 'completed':
      return {
        ring: 'approved',
        heading: 'Email verified',
        status: 'Finishing linking this device',
        pending: true,
        tone: 'neutral',
      };
  }
}

function linkFailedIcon(): ComponentChildren {
  return (
    <>
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M9 17H7A5 5 0 0 1 7 7h2" />
        <path d="M15 7h2a5 5 0 0 1 3.54 8.54" />
        <path d="m2 2 20 20" />
        <path d="M8 12h3" />
      </svg>
    </>
  );
}

function rerollIcon(): ComponentChildren {
  return (
    <>
      <svg
        class="seams-input-action-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
        <path d="M8 16H3v5" />
      </svg>
    </>
  );
}

function selectedLoginAccount(viewModel: AuthMenuLoginViewModel) {
  return resolveAuthMenuLoginAccount(viewModel.accountOptions, viewModel.selectedAccount)
    .selectedAccount;
}

function selectedAccountPrimaryText(account: AuthMenuAccountOption): string {
  return account.walletId;
}

function accountSecondaryText(account: AuthMenuAccountOption): string | null {
  return account.authMethod === 'email_otp' ? account.emailAddress : null;
}

function savedAccountsTriggerLabel(account: AuthMenuAccountOption | null): string {
  if (!account) return 'Saved accounts';
  const emailAddress = accountSecondaryText(account);
  return emailAddress
    ? `Saved accounts. Selected wallet ID ${account.walletId}, email ${emailAddress}`
    : `Saved accounts. Selected ${account.walletId}`;
}

type AuthMenuAccountGroup = Readonly<{
  authMethod: AuthMenuAccountOption['authMethod'];
  label: 'Passkey' | 'Email OTP';
  accounts: readonly AuthMenuAccountOption[];
}>;

function accountGroups(options: readonly AuthMenuAccountOption[]): AuthMenuAccountGroup[] {
  const passkeyAccounts = options.filter((option) => option.authMethod === 'passkey');
  const emailOtpAccounts = options.filter((option) => option.authMethod === 'email_otp');
  const groups: AuthMenuAccountGroup[] = [
    { authMethod: 'passkey', label: 'Passkey', accounts: passkeyAccounts },
    { authMethod: 'email_otp', label: 'Email OTP', accounts: emailOtpAccounts },
  ];
  return groups.filter((group) => group.accounts.length > 0);
}

export type AuthMenuSurfaceProps = {
  readonly viewModel: AuthMenuViewModel;
  readonly element: HTMLElement;
  readonly onIntent: (intent: AuthMenuIntent) => void;
  readonly styles: CspStylesheetManager;
};

export class AuthMenuSurface extends Component<AuthMenuSurfaceProps, { accountMenuOpen: boolean }> {
  state = { accountMenuOpen: false };
  private previouslyFocusedElement: HTMLElement | null = null;
  private shouldFocusInitialControl = true;
  private contentResizeObserver: ResizeObserver | null = null;
  private contentHeightFrame: number | null = null;
  private previousLinkDeviceStateKind: AuthMenuLinkDeviceState['kind'] | null = null;
  private previousRecoveryStage: AuthMenuRecoveryStage | null = null;

  private get viewModel(): AuthMenuViewModel {
    return this.props.viewModel;
  }
  private get accountMenuOpen(): boolean {
    return this.state.accountMenuOpen;
  }
  private set accountMenuOpen(value: boolean) {
    this.setState({ accountMenuOpen: value });
  }

  componentDidMount(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !this.props.element.contains(active)) {
      this.previouslyFocusedElement = active;
    }
    document.addEventListener('pointerdown', this.onDocumentPointerDown);
    document.addEventListener('keydown', this.onKeyDown, true);
    this.afterRender();
  }

  componentDidUpdate(previous: AuthMenuSurfaceProps): void {
    this.afterRender(previous.viewModel);
  }

  componentWillUnmount(): void {
    this.contentResizeObserver?.disconnect();
    this.contentResizeObserver = null;
    if (this.contentHeightFrame !== null) cancelAnimationFrame(this.contentHeightFrame);
    this.contentHeightFrame = null;
    window.removeEventListener('resize', this.queueContentHeightSync);
    document.removeEventListener('pointerdown', this.onDocumentPointerDown);
    document.removeEventListener('keydown', this.onKeyDown, true);
    this.props.styles.deleteDynamicRule(this.props.element.id + '-height');
    this.restoreFocus();
  }

  private afterRender(previous?: AuthMenuViewModel): void {
    if (this.shouldFocusInitialControl) this.focusInitialControl();
    this.focusRecoveryControl(previous);
    this.focusLinkDevicePasskeyAction();
    this.observeContentSize();
    this.queueContentHeightSync();
  }

  private focusRecoveryControl(previous: AuthMenuViewModel | undefined): void {
    const current = this.viewModel;
    if (previous?.kind === 'recovery' && current.kind !== 'recovery') {
      this.previousRecoveryStage = null;
      this.props.element.querySelector<HTMLElement>('[data-recovery-action]')?.focus();
      return;
    }
    if (current.kind !== 'recovery') return;
    const stageChanged = this.previousRecoveryStage !== current.stage;
    this.previousRecoveryStage = current.stage;
    if (current.stage === 'enter_code') {
      const invalid = this.props.element.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (invalid) {
        invalid.focus();
        return;
      }
      if (previous?.kind !== 'recovery' || previous.stage !== 'enter_code') {
        this.props.element.querySelector<HTMLElement>('[data-recovery-code]')?.focus();
      }
      return;
    }
    const becameRecoverable =
      current.status.kind === 'recoverable' &&
      previous?.kind === 'recovery' &&
      previous.status.kind !== 'recoverable';
    if (
      (stageChanged || becameRecoverable) &&
      (current.stage === 'passkey_ready' ||
        current.stage === 'finalizing' ||
        current.stage === 'sign_in_ready')
    ) {
      this.props.element.querySelector<HTMLElement>('[data-auth-menu-primary]')?.focus();
    }
  }

  private focusLinkDevicePasskeyAction(): void {
    const currentKind =
      this.viewModel.kind === 'link_device' ? this.viewModel.linkDevice.kind : null;
    const shouldFocus =
      currentKind === 'passkey_required' && this.previousLinkDeviceStateKind !== currentKind;
    this.previousLinkDeviceStateKind = currentKind;
    if (shouldFocus) {
      this.props.element.querySelector<HTMLElement>('[data-link-device-passkey-action]')?.focus();
    }
  }

  private observeContentSize(): void {
    if (this.contentResizeObserver) return;
    const sizer = this.props.element.querySelector<HTMLElement>('.seams-content-sizer');
    if (!sizer) return;
    this.contentResizeObserver = new ResizeObserver(this.queueContentHeightSync);
    this.contentResizeObserver.observe(sizer);
    window.addEventListener('resize', this.queueContentHeightSync);
  }

  private readonly queueContentHeightSync = (): void => {
    if (this.contentHeightFrame !== null) cancelAnimationFrame(this.contentHeightFrame);
    this.contentHeightFrame = requestAnimationFrame(this.syncContentHeight);
  };

  private readonly syncContentHeight = (): void => {
    this.contentHeightFrame = null;
    const switcher = this.props.element.querySelector<HTMLElement>('.seams-content-switcher');
    const sizer = this.props.element.querySelector<HTMLElement>('.seams-content-sizer');
    if (!switcher || !sizer) return;
    this.props.styles.setDynamicDeclarations(
      this.props.element.id + '-height',
      '#' + this.props.element.id + ' .seams-content-switcher',
      { height: sizer.scrollHeight + 'px' },
    );
  };

  private focusInitialControl(): void {
    if (!this.props.element.isConnected || !this.shouldFocusInitialControl) return;
    this.shouldFocusInitialControl = false;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && this.props.element.contains(activeElement)) return;
    this.props.element
      .querySelector<HTMLElement>('[data-auth-menu-input], [data-auth-menu-primary]')
      ?.focus();
  }

  private restoreFocus(): void {
    const target = this.previouslyFocusedElement;
    this.previouslyFocusedElement = null;
    if (!target?.isConnected) return;
    target.focus();
  }

  private onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.viewModel && recoveryNavigationLocked(this.viewModel)) return;
      if (this.accountMenuOpen) {
        this.accountMenuOpen = false;
        return;
      }
      this.emitIntent({ kind: 'close', reason: 'escape' });
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = this.focusableElements();
    if (focusable.length === 0) return;
    const active = document.activeElement;
    const activeIndex = focusable.indexOf(active instanceof HTMLElement ? active : focusable[0]);
    if (event.shiftKey && activeIndex <= 0) {
      event.preventDefault();
      focusable[focusable.length - 1]?.focus();
    } else if (!event.shiftKey && activeIndex === focusable.length - 1) {
      event.preventDefault();
      focusable[0]?.focus();
    }
  };

  private focusableElements(): HTMLElement[] {
    return Array.from(
      this.props.element.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    );
  }

  private onBackClick = (): void => {
    this.emitIntent({ kind: 'back' });
  };

  /**
   * Escape backs out of the in-progress views the back arrow already serves.
   * The host dialog is opened non-modally, so it never receives the UA's
   * `cancel` event — without this the key does nothing while a ceremony is
   * pending. Deliberately scoped to those views: from the menu itself Escape
   * belongs to the embedding page, not to us.
   */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const viewModel = this.viewModel;
    if (
      !viewModel ||
      (viewModel.kind !== 'recovery' && !isAuthMenuLoadingStatus(viewModel.status))
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (recoveryNavigationLocked(viewModel)) return;
    this.emitIntent({ kind: 'back' });
  };

  private onIntentSwitchClick = (): void => {
    const viewModel = this.viewModel;
    if (!viewModel) return;
    this.emitIntent({ kind: 'mode_selected', mode: modeSwitchCopy(viewModel.mode).nextMode });
  };

  private onRegistrationReroll = (): void => {
    this.emitIntent({ kind: 'registration_reroll' });
  };

  private onPasskeyNameInput = (event: Event): void => {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    this.emitIntent({ kind: 'passkey_name_changed', passkeyName: event.currentTarget.value });
  };

  private onLoginAccountSelect = (event: Event): void => {
    if (!(event.currentTarget instanceof HTMLButtonElement)) return;
    const walletId = event.currentTarget.dataset.walletId;
    const authMethod = event.currentTarget.dataset.authMethod;
    const viewModel = this.viewModel;
    if (!walletId || viewModel.kind !== 'passkey' || viewModel.mode !== 'login') return;
    const selected = viewModel.accountOptions.find(
      (account) => account.walletId === walletId && account.authMethod === authMethod,
    );
    if (!selected) return;
    this.accountMenuOpen = false;
    this.emitIntent({
      kind: 'login_account_selected',
      walletId: selected.walletId,
      authMethod: selected.authMethod,
    });
  };

  private onAccountMenuToggle = (): void => {
    this.accountMenuOpen = !this.accountMenuOpen;
  };

  private onDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.accountMenuOpen || !(event.target instanceof Node)) return;
    if (this.props.element.querySelector('.seams-account-menu')?.contains(event.target)) return;
    this.accountMenuOpen = false;
  };

  private onPrimaryClick = (): void => {
    const viewModel = this.viewModel;
    if (!viewModel || !isAuthMenuActionReady(viewModel)) return;
    if (viewModel.kind === 'link_device') return;
    if (viewModel.kind === 'google_otp_login') {
      this.emitIntent({ kind: 'google_otp_submit' });
      return;
    }
    if (viewModel.kind === 'google_registration') {
      this.emitIntent({ kind: 'google_registration_complete' });
      return;
    }
    const intent: AuthMenuIntent =
      viewModel.mode === 'register'
        ? { kind: 'submit', mode: 'register', passkeyName: viewModel.passkeyName }
        : { kind: 'submit', mode: 'login' };
    this.emitIntent(intent);
  };

  private onGoogleOtpCodeInput = (event: Event): void => {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    this.emitIntent({ kind: 'google_otp_code_changed', code: event.currentTarget.value });
  };

  private onGoogleOtpKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    this.emitIntent({ kind: 'google_otp_submit' });
  };

  private onGoogleOtpResend = (): void => {
    this.emitIntent({ kind: 'google_otp_resend' });
  };

  private onGoogleRegistrationReroll = (): void => {
    this.emitIntent({ kind: 'google_registration_reroll' });
  };

  private onGoogleClick = (): void => {
    this.emitIntent({ kind: 'external_auth', provider: 'google' });
  };

  private onLinkDeviceOpen = (): void => {
    this.emitIntent({ kind: 'link_device_open' });
  };

  private onRecoveryOpen = (): void => {
    this.emitIntent({ kind: 'recovery_open' });
  };

  private onRecoveryCodeInput = (event: Event): void => {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    this.emitIntent({ kind: 'recovery_code_changed', recoveryCode: event.currentTarget.value });
  };

  private onRecoverySubmit = (event: SubmitEvent): void => {
    event.preventDefault();
  };

  private onRecoveryPasskeySelected = (): void => {
    this.emitIntent({ kind: 'recovery_passkey_selected' });
  };

  private onRecoveryGoogleSelected = (): void => {
    this.emitIntent({ kind: 'recovery_google_selected' });
  };

  private onRecoveryGoogleOtpCodeInput = (event: Event): void => {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    this.emitIntent({ kind: 'recovery_google_otp_code_changed', code: event.currentTarget.value });
  };

  private onRecoveryGoogleOtpKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    this.emitIntent({ kind: 'recovery_google_otp_submit' });
  };

  private onRecoveryGoogleOtpSubmit = (): void => {
    this.emitIntent({ kind: 'recovery_google_otp_submit' });
  };

  private onRecoveryCreatePasskey = (): void => {
    this.emitIntent({ kind: 'recovery_create_passkey' });
  };

  private onRecoverySignIn = (): void => {
    this.emitIntent({ kind: 'recovery_sign_in' });
  };

  private onLinkDeviceCreatePasskey = (): void => {
    this.emitIntent({ kind: 'link_device_create_passkey' });
  };

  private onLinkDeviceFactorChange = (event: Event): void => {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    const targetFactor =
      event.currentTarget.value === 'email_otp'
        ? ({ kind: 'email_otp' } as const)
        : ({ kind: 'passkey_prf' } as const);
    this.emitIntent({ kind: 'link_device_factor_selected', targetFactor });
  };

  private onLinkDeviceTargetEmailInput = (event: Event): void => {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    this.emitIntent({
      kind: 'link_device_target_email_changed',
      emailAddress: event.currentTarget.value,
    });
  };

  private onLinkDeviceStart = (): void => {
    this.emitIntent({ kind: 'link_device_start' });
  };

  private onLinkDeviceEmailOtpCodeInput = (event: Event): void => {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    this.emitIntent({
      kind: 'link_device_email_otp_code_changed',
      code: event.currentTarget.value,
    });
  };

  private onLinkDeviceEmailOtpKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    this.emitIntent({ kind: 'link_device_email_otp_submit' });
  };

  private onLinkDeviceEmailOtpResend = (): void => {
    this.emitIntent({ kind: 'link_device_email_otp_resend' });
  };

  private onLinkDeviceEmailOtpSubmit = (): void => {
    this.emitIntent({ kind: 'link_device_email_otp_submit' });
  };

  private emitIntent(intent: AuthMenuIntent): void {
    this.props.onIntent(intent);
  }

  render(): ComponentChildren {
    const viewModel = this.viewModel;
    if (!viewModel) return <></>;

    const loading = isAuthMenuLoadingStatus(viewModel.status);
    const linkDevice = viewModel.kind === 'link_device';
    const otpPrompt = viewModel.kind === 'google_otp_login';
    const registrationPrompt = viewModel.kind === 'google_registration';
    const recovery = viewModel.kind === 'recovery';

    return (
      <>
        <div
          class="seams-signup-menu-root auth-menu-root"
          data-mode={viewModel.mode}
          data-waiting={loading ? 'true' : 'false'}
          data-scan-device={linkDevice ? 'true' : 'false'}
          data-otp-prompt={otpPrompt ? 'true' : 'false'}
          data-registration-prompt={registrationPrompt ? 'true' : 'false'}
          data-recovery={recovery ? 'true' : 'false'}
          aria-labelledby={AUTH_MENU_TITLE_ID}
          aria-busy={loading ? 'true' : 'false'}
          tabIndex={-1}
          onKeyDown={this.onKeydown}
        >
          <div class="seams-content-switcher">
            <button
              class={`seams-back-button ${
                loading || linkDevice || otpPrompt || registrationPrompt || recovery
                  ? 'is-visible'
                  : ''
              }`}
              type="button"
              aria-label={recovery ? 'Back to sign in' : 'Back'}
              data-auth-menu-close
              disabled={recoveryNavigationLocked(viewModel)}
              onClick={this.onBackClick}
            >
              {backIcon()}
            </button>
            <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {recovery ? recoveryAnnouncement(viewModel) : ''}
            </div>
            <div class="seams-content-area">
              <div class="seams-content-sizer">
                {loading ? (
                  this.renderWaiting(viewModel)
                ) : (
                  <>
                    <div class="seams-signin-menu">
                      {
                        <Fragment key={authViewKey(viewModel)}>
                          {this.renderActiveView(viewModel)}
                        </Fragment>
                      }
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  private renderActiveView(viewModel: AuthMenuViewModel): ComponentChildren {
    if (viewModel.kind === 'recovery') return this.renderRecovery(viewModel);
    if (viewModel.kind === 'link_device') return this.renderLinkDevice(viewModel);
    if (viewModel.kind === 'google_otp_login') return this.renderGoogleOtp(viewModel);
    if (viewModel.kind === 'google_registration') return this.renderGoogleRegistration(viewModel);
    return (
      <>
        {this.renderHeader(viewModel)} {this.renderPasskeyInput(viewModel)}
        {this.renderAuthMethods(viewModel)} {this.renderOtherOptions(viewModel)}
        {this.renderIntentSwitch(viewModel)}
      </>
    );
  }

  private renderHeader(viewModel: AuthMenuViewModel): ComponentChildren {
    return (
      <>
        <div class="seams-header">
          <div>
            <div class="seams-title" id={AUTH_MENU_TITLE_ID}>
              {viewModel.heading}
            </div>
            <div class="seams-subhead">{viewModel.subtitle}</div>
          </div>
        </div>
      </>
    );
  }

  private renderPasskeyInput(
    viewModel: AuthMenuLoginViewModel | AuthMenuRegisterViewModel,
  ): ComponentChildren {
    if (viewModel.mode === 'login') {
      const selected = selectedLoginAccount(viewModel);
      const hasAccounts = viewModel.accountOptions.length > 0;
      const groups = accountGroups(viewModel.accountOptions);
      return (
        <>
          <div class="seams-passkey-row">
            <div class="seams-input-pill">
              <div class="seams-input-wrap">
                {selected ? (
                  <>
                    <div
                      class="seams-account-menu-account seams-selected-account"
                      aria-hidden="true"
                    >
                      <span class="seams-account-menu-account-primary">
                        {selectedAccountPrimaryText(selected)}
                      </span>
                      {accountSecondaryText(selected) ? (
                        <>
                          <span class="seams-account-menu-account-secondary">
                            {accountSecondaryText(selected)}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <>
                    <input
                      id="seams-auth-menu-login-account"
                      class="seams-input"
                      data-auth-menu-input
                      type="text"
                      name="passkey"
                      aria-label="Saved account"
                      autocomplete="off"
                      autocapitalize="none"
                      autocorrect="off"
                      spellcheck={false}
                      placeholder="Enter your username"
                      value=""
                      readonly
                    />
                  </>
                )}
              </div>
              {hasAccounts ? (
                <>
                  <div class={`seams-account-menu ${this.accountMenuOpen ? 'is-open' : ''}`}>
                    <button
                      class="seams-account-menu-trigger"
                      type="button"
                      data-auth-menu-input
                      aria-label={savedAccountsTriggerLabel(selected)}
                      aria-haspopup="listbox"
                      aria-expanded={this.accountMenuOpen ? 'true' : 'false'}
                      aria-controls={AUTH_MENU_ACCOUNT_LIST_ID}
                      onClick={this.onAccountMenuToggle}
                    >
                      {accountDropdownIcon()}
                    </button>
                    {this.accountMenuOpen ? (
                      <>
                        <div
                          id={AUTH_MENU_ACCOUNT_LIST_ID}
                          class="seams-account-menu-popover"
                          role="listbox"
                        >
                          {groups.map((group) => {
                            const groupLabelId = `${AUTH_MENU_ACCOUNT_LIST_ID}-${group.authMethod}`;
                            return (
                              <>
                                <div
                                  class="seams-account-menu-group"
                                  role="group"
                                  aria-labelledby={groupLabelId}
                                >
                                  <div id={groupLabelId} class="seams-account-menu-group-label">
                                    {group.label}
                                  </div>
                                  {group.accounts.map((account) => {
                                    const isSelected =
                                      account.walletId === selected?.walletId &&
                                      account.authMethod === selected.authMethod;
                                    const secondaryText = accountSecondaryText(account);
                                    return (
                                      <>
                                        <button
                                          class={`seams-account-menu-option ${
                                            isSelected ? 'is-selected' : ''
                                          }`}
                                          type="button"
                                          role="option"
                                          aria-selected={isSelected ? 'true' : 'false'}
                                          title={
                                            secondaryText
                                              ? `${account.walletId} ${secondaryText}`
                                              : account.walletId
                                          }
                                          data-wallet-id={account.walletId}
                                          data-auth-method={account.authMethod}
                                          onClick={this.onLoginAccountSelect}
                                        >
                                          <span
                                            class="seams-account-menu-check"
                                            aria-hidden="true"
                                          ></span>
                                          <span class="seams-account-menu-account">
                                            <span class="seams-account-menu-account-primary">
                                              {account.walletId}
                                            </span>
                                            {secondaryText ? (
                                              <>
                                                <span class="seams-account-menu-account-secondary">
                                                  {secondaryText}
                                                </span>
                                              </>
                                            ) : null}
                                          </span>
                                        </button>
                                      </>
                                    );
                                  })}
                                </div>
                              </>
                            );
                          })}
                        </div>
                      </>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </>
      );
    }

    if (!viewModel.showRegistrationInput) return <></>;
    return (
      <>
        <div class="seams-passkey-row">
          <div class="seams-input-pill">
            <div class="seams-input-wrap">
              <input
                id="seams-auth-menu-passkey-name"
                class="seams-input"
                data-auth-menu-input
                type="text"
                autocomplete="nickname"
                placeholder={viewModel.passkeyNameLabel}
                value={viewModel.passkeyName}
                readonly={viewModel.passkeyNameReadOnly}
                disabled={isAuthMenuLoadingStatus(viewModel.status)}
                onInput={this.onPasskeyNameInput}
              />
            </div>
            {viewModel.passkeyNameReadOnly ? (
              <>
                <button
                  class="seams-input-action-trigger auth-menu-registration-reroll"
                  type="button"
                  title="Generate another name"
                  aria-label="Generate another name"
                  onClick={this.onRegistrationReroll}
                  disabled={!isAuthMenuReady(viewModel)}
                >
                  {rerollIcon()}
                </button>
              </>
            ) : null}
          </div>
        </div>
      </>
    );
  }

  private renderAuthMethods(
    viewModel: AuthMenuLoginViewModel | AuthMenuRegisterViewModel,
  ): ComponentChildren {
    const googleEnabled = viewModel.enabledExternalProviders?.includes('google') ?? false;
    return (
      <>
        <div class="seams-auth-methods">
          <div class="seams-auth-method-stack">
            <button
              class="seams-auth-method-btn seams-auth-method-btn-primary"
              type="button"
              data-auth-menu-primary
              disabled={!isAuthMenuActionReady(viewModel)}
              onClick={this.onPrimaryClick}
            >
              {viewModel.mode === 'login' ? fingerprintIcon() : null}
              <span>{passkeyButtonLabel(viewModel.mode)}</span>
              {arrowIcon()}
            </button>
            {googleEnabled ? (
              <>
                <div class="seams-auth-method-stack seams-social-stack">
                  <div class="seams-social-provider">
                    <button
                      class="seams-auth-method-btn seams-auth-method-btn-primary"
                      type="button"
                      data-auth-menu-provider="google"
                      disabled={!isAuthMenuGoogleActionReady(viewModel)}
                      onClick={this.onGoogleClick}
                    >
                      {googleIcon()}
                      <span>{googleButtonLabel(viewModel.mode)}</span>
                      {arrowIcon()}
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </>
    );
  }

  private renderOtherOptions(viewModel: AuthMenuLoginViewModel | AuthMenuRegisterViewModel) {
    return (
      <>
        <div class="seams-scan-device-row">
          <div class="seams-section-divider">
            <span class="seams-section-divider-text">Other options</span>
          </div>
          <div class="seams-secondary-actions">
            <button class="seams-link-device-btn" type="button" onClick={this.onLinkDeviceOpen}>
              {linkDeviceIcon()} Scan and Link Device
            </button>
            <button
              class="seams-link-device-btn"
              type="button"
              data-recovery-action
              onClick={this.onRecoveryOpen}
            >
              {recoveryIcon()} Recover account
            </button>
          </div>
        </div>
      </>
    );
  }

  private renderRecovery(viewModel: AuthMenuRecoveryViewModel): ComponentChildren {
    if (viewModel.stage === 'enter_code') {
      const statusMessage = viewModel.status.kind === 'recoverable' ? viewModel.status.message : '';
      const feedbackMessage = viewModel.recoveryCodeError ?? statusMessage;
      const feedbackIsError = feedbackMessage.length > 0;
      return (
        <>
          {this.renderHeader(viewModel)}
          <p
            id="seams-recovery-code-feedback"
            class={`seams-recovery-status ${feedbackIsError ? 'seams-recovery-error' : ''}`}
            aria-hidden={feedbackIsError ? 'false' : 'true'}
            role={feedbackIsError ? 'alert' : 'status'}
          >
            {feedbackMessage}
          </p>
          <form class="seams-recovery-form" novalidate onSubmit={this.onRecoverySubmit}>
            <div class="seams-recovery-field">
              <label class="seams-field-label" for="seams-recovery-code">
                Recovery code
              </label>
              <input
                id="seams-recovery-code"
                class="seams-recovery-input seams-recovery-code-input"
                data-recovery-code
                name="recoveryCode"
                type="text"
                autocomplete="one-time-code"
                autocapitalize="characters"
                autocorrect="off"
                spellcheck={false}
                aria-invalid={viewModel.recoveryCodeError ? 'true' : 'false'}
                aria-describedby={viewModel.recoveryCodeError ? 'seams-recovery-code-feedback' : ''}
                value={viewModel.recoveryCode}
                onInput={this.onRecoveryCodeInput}
              />
            </div>
            <div class="seams-secondary-actions">
              <button
                class="seams-link-device-btn seams-auth-method-choice-btn"
                type="button"
                data-recovery-target="passkey"
                onClick={this.onRecoveryPasskeySelected}
              >
                <span class="seams-auth-method-choice-icon">{fingerprintIcon()}</span>
                <span>Recover with Passkey</span>
              </button>
              <button
                class="seams-link-device-btn seams-auth-method-choice-btn"
                type="button"
                data-recovery-target="google_email_otp"
                onClick={this.onRecoveryGoogleSelected}
              >
                <span class="seams-auth-method-choice-icon">{googleIcon()}</span>
                <span>Recover with Google</span>
              </button>
            </div>
          </form>
        </>
      );
    }
    if (viewModel.stage === 'email_code_required') {
      const digits = otpCodeDigits(viewModel.otpCode);
      const canSubmit = /^\d{6}$/.test(viewModel.otpCode) && viewModel.status.kind !== 'busy';
      const deliveryMessage =
        viewModel.delivery.status === 'reused'
          ? `Use the code already sent to ${viewModel.emailHint}.`
          : `A 6-digit code was sent to ${viewModel.emailHint}.`;
      return (
        <>
          {this.renderHeader(viewModel)}
          <div class="seams-otp-prompt" aria-live="polite">
            <p class="seams-otp-description">{deliveryMessage}</p>
            <label class="seams-field-label" for="seams-recovery-google-otp">
              Email code
            </label>
            <div
              class="seams-otp-code-field"
              data-disabled={viewModel.status.kind === 'busy' ? 'true' : 'false'}
            >
              <input
                class="seams-otp-input"
                id="seams-recovery-google-otp"
                data-auth-menu-input
                data-email-otp-challenge-id={viewModel.challengeId}
                data-email-otp-wallet-id={viewModel.walletId}
                name="recoveryEmailOtpCode"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                spellcheck={false}
                pattern="[0-9]*"
                maxLength={6}
                aria-invalid={viewModel.status.kind === 'recoverable' ? 'true' : 'false'}
                aria-describedby={
                  viewModel.status.kind === 'recoverable' ? 'seams-recovery-google-otp-error' : ''
                }
                value={viewModel.otpCode}
                disabled={viewModel.status.kind === 'busy'}
                onInput={this.onRecoveryGoogleOtpCodeInput}
                onKeyDown={this.onRecoveryGoogleOtpKeydown}
              />
              <div class="seams-otp-slots" aria-hidden="true">
                {digits.map(renderOtpCodeDigit)}
              </div>
            </div>
            {viewModel.status.kind === 'recoverable' ? (
              <>
                <p
                  id="seams-recovery-google-otp-error"
                  class="seams-recovery-status seams-recovery-error"
                  role="alert"
                >
                  {viewModel.status.message}
                </p>
              </>
            ) : null}
            <button
              class="seams-link-device-btn seams-link-device-btn-primary"
              type="button"
              data-auth-menu-primary
              disabled={!canSubmit}
              onClick={this.onRecoveryGoogleOtpSubmit}
            >
              Verify email code
            </button>
          </div>
        </>
      );
    }
    const finalizationRetry =
      viewModel.stage === 'finalizing' && viewModel.status.kind === 'recoverable';
    const signIn = viewModel.stage === 'sign_in_ready';
    const googleTarget = viewModel.target.kind === 'google_email_otp';
    const message =
      viewModel.status.kind === 'recoverable'
        ? viewModel.status.message
        : signIn
          ? null
          : viewModel.stage === 'google_ready'
            ? 'Continue with Google, then verify the code sent to your email.'
            : googleTarget
              ? 'Finishing recovery with Google…'
              : 'Create a new passkey to finish recovering this account.';
    const action = signIn
      ? this.onRecoverySignIn
      : googleTarget
        ? finalizationRetry
          ? this.onRecoveryGoogleOtpSubmit
          : this.onGoogleClick
        : this.onRecoveryCreatePasskey;
    return (
      <>
        {this.renderHeader(viewModel)}
        <div class="seams-recovery-confirmation">
          {message === null ? null : (
            <>
              <p class="seams-recovery-status">{message}</p>
            </>
          )}
          <button
            class="seams-link-device-btn seams-link-device-btn-primary"
            type="button"
            data-auth-menu-primary
            onClick={action}
          >
            {googleTarget && !finalizationRetry ? googleIcon() : null}
            {signIn
              ? googleTarget
                ? 'Sign in with Google'
                : 'Sign in with new passkey'
              : finalizationRetry
                ? 'Retry finalization'
                : googleTarget
                  ? 'Continue with Google'
                  : 'Create new passkey'}
          </button>
        </div>
      </>
    );
  }

  private renderIntentSwitch(viewModel: AuthMenuLoginViewModel | AuthMenuRegisterViewModel) {
    const copy = modeSwitchCopy(viewModel.mode);
    return (
      <>
        <div class="seams-auth-intent-switch">
          <span>{copy.prompt}</span>
          <button
            type="button"
            data-auth-menu-mode={copy.nextMode}
            onClick={this.onIntentSwitchClick}
          >
            {copy.action}
          </button>
        </div>
      </>
    );
  }

  private renderWaiting(viewModel: AuthMenuViewModel): ComponentChildren {
    const status = viewModel.status;
    if (status.kind !== 'busy') return <></>;
    // `headline` is required on the busy status, so there is no fallback to
    // inherit here — every wait names itself.
    const waitingText = status.headline;
    return (
      <>
        <div class="seams-waiting" role="status" aria-live="polite">
          <div class="seams-waiting-message">
            <span class="seams-waiting-text">{waitingText}</span>
            {viewModel.showProgress && status.detail && status.detail !== waitingText ? (
              <>
                <span class="seams-waiting-sdk-events">{status.detail}</span>
              </>
            ) : null}
          </div>
          <div aria-label="Loading" class="seams-spinner"></div>
        </div>
      </>
    );
  }

  private renderLinkDevice(
    viewModel: Extract<AuthMenuViewModel, { kind: 'link_device' }>,
  ): ComponentChildren {
    const linkDevice = viewModel.linkDevice;
    if (linkDevice.kind === 'select_factor') {
      return this.renderLinkDeviceFactorSelection(linkDevice);
    }
    if (linkDevice.kind === 'passkey_required' || linkDevice.kind === 'creating_passkey') {
      return this.renderLinkDevicePasskeyConfirmation(linkDevice);
    }
    if (linkDevice.kind === 'email_otp_required') {
      return this.renderLinkDeviceEmailOtp(linkDevice);
    }
    if (linkDevice.kind === 'activating') return this.renderLinkedDeviceActivation(linkDevice);
    if (linkDevice.kind === 'expired') return this.renderLinkDeviceExpired(linkDevice);
    if (linkDevice.kind === 'cancelled') return this.renderLinkDeviceCancelled(linkDevice);
    if (linkDevice.kind === 'error' || linkDevice.kind === 'activation_error') {
      return this.renderLinkDeviceFailure(linkDevice);
    }
    // The code plate keeps its box while the QR is still being generated, so the
    // title/instruction/status stack below it never shifts when the image lands —
    // the placeholder simply dissolves into the code.
    const ready = linkDevice.kind === 'ready';
    return (
      <>
        <div class="seams-scan-device-content">
          <div class="qr-code-container">
            <div class="qr-body">
              <div class="qr-code-section">
                <div class="qr-code-display">
                  {ready ? (
                    <>
                      <img
                        src={linkDevice.qrCodeDataURL}
                        alt="QR code to link this device"
                        class="qr-code-image"
                      />
                    </>
                  ) : (
                    <>
                      <div class="qr-code-placeholder">
                        <span class="seams-spinner" aria-hidden="true"></span>
                      </div>
                    </>
                  )}
                </div>
                <div class="qr-header">
                  <h2 class="qr-title" id={AUTH_MENU_TITLE_ID}>
                    {viewModel.heading}
                  </h2>
                </div>
                <div class="qr-instruction">
                  {ready ? viewModel.subtitle : 'Preparing a one-time code for your other device.'}
                </div>
                <div class="qr-status" role="status" aria-live="polite">
                  {ready ? linkDevice.message : 'Generating QR code'}
                  <span class="animated-ellipsis"></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  private renderLinkDeviceFactorSelection(
    linkDevice: Extract<AuthMenuLinkDeviceState, { kind: 'select_factor' }>,
  ): ComponentChildren {
    const emailTargetSelected = linkDevice.targetFactor.kind === 'email_otp';
    const emailAddress =
      linkDevice.targetFactor.kind === 'email_otp' && typeof linkDevice.targetEmail === 'string'
        ? linkDevice.targetEmail
        : '';
    const canStart = !emailTargetSelected || isLinkedDeviceTargetEmailAddressV1(emailAddress);
    return (
      <>
        <div class="seams-link-device-confirmation">
          <h2 class="qr-title" id={AUTH_MENU_TITLE_ID}>
            Match your other device
          </h2>
          <p class="seams-link-device-confirmation-copy">
            Choose the unlock method for Device 2. Email code sends a one-time code to the address
            you enter.
          </p>
          <fieldset class="seams-link-device-factor-options">
            <legend class="sr-only">Wallet unlock method</legend>
            <label>
              <span class="seams-auth-method-choice-icon">{fingerprintIcon()}</span>
              <span class="seams-auth-method-choice-label">Passkey</span>
              <input
                type="radio"
                name="linked-device-factor"
                value="passkey_prf"
                checked={linkDevice.targetFactor.kind === 'passkey_prf'}
                onChange={this.onLinkDeviceFactorChange}
              />
            </label>
            <label>
              <span class="seams-auth-method-choice-icon">{mailIcon()}</span>
              <span class="seams-auth-method-choice-label">Email code</span>
              <input
                type="radio"
                name="linked-device-factor"
                value="email_otp"
                checked={linkDevice.targetFactor.kind === 'email_otp'}
                onChange={this.onLinkDeviceFactorChange}
              />
            </label>
          </fieldset>
          {emailTargetSelected ? (
            <>
              <label class="seams-link-device-target-email">
                <span class="seams-field-label">Email address</span>
                <input
                  type="email"
                  name="linked-device-target-email"
                  autocomplete="email"
                  value={emailAddress}
                  aria-label="Email address"
                  aria-invalid={emailAddress.length > 0 && !canStart ? 'true' : 'false'}
                  onInput={this.onLinkDeviceTargetEmailInput}
                />
              </label>
            </>
          ) : null}
          {linkDevice.error ? (
            <>
              <p class="seams-link-device-inline-error" role="alert">
                {linkDevice.error}
              </p>
            </>
          ) : null}
          <button
            class="seams-link-device-btn seams-link-device-btn-primary"
            type="button"
            data-auth-menu-primary
            disabled={!canStart}
            onClick={this.onLinkDeviceStart}
          >
            Continue
          </button>
        </div>
      </>
    );
  }

  private renderLinkDeviceEmailOtp(linkDevice: AuthMenuLinkDeviceEmailOtpState): ComponentChildren {
    const activation = linkDevice.state;
    const view = linkDeviceEmailOtpPresentation(activation);
    const busy =
      activation.kind === 'sending' ||
      activation.kind === 'submitting' ||
      activation.kind === 'resending';
    const canSubmit =
      linkDevice.otpCode.length === 6 &&
      (activation.kind === 'code_input' || activation.kind === 'incorrect');
    // The slots stay mounted through the busy phases so nothing under them
    // moves while a code is in flight; only the end states retire the field.
    const showCodeField =
      activation.kind !== 'completed' &&
      activation.kind !== 'expired' &&
      activation.kind !== 'unavailable';
    const hint = 'maskedEmailHint' in activation ? activation.maskedEmailHint : '';
    const digits = otpCodeDigits(linkDevice.otpCode);
    return (
      <>
        <div
          class="seams-link-device-confirmation seams-link-device-email-otp"
          data-tone={view.tone}
          data-otp-phase={activation.kind}
        >
          {linkDeviceDotRing(view.ring, mailIcon())}
          <h2 class="qr-title" id={AUTH_MENU_TITLE_ID}>
            {view.heading}
          </h2>
          {hint ? (
            <>
              <div class="seams-link-device-email-chip" title={hint}>
                <span>{hint}</span>
              </div>
            </>
          ) : null}
          <p
            class="seams-link-device-email-status"
            id="seams-linked-device-otp-status"
            role="status"
            aria-live="polite"
          >
            {view.status}
            {view.pending ? (
              <>
                <span class="animated-ellipsis" aria-hidden="true"></span>
              </>
            ) : null}
          </p>
          {showCodeField ? (
            <>
              <label class="sr-only" for="seams-linked-device-email-otp">
                Email code
              </label>
              <div class="seams-otp-code-field" data-disabled={busy ? 'true' : 'false'}>
                <input
                  class="seams-otp-input"
                  id="seams-linked-device-email-otp"
                  data-auth-menu-input
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  aria-label="Email verification code"
                  aria-describedby="seams-linked-device-otp-status"
                  aria-invalid={activation.kind === 'incorrect' ? 'true' : 'false'}
                  value={linkDevice.otpCode}
                  disabled={busy}
                  onInput={this.onLinkDeviceEmailOtpCodeInput}
                  onKeyDown={this.onLinkDeviceEmailOtpKeydown}
                />
                <div class="seams-otp-slots" aria-hidden="true">
                  {digits.map(renderOtpCodeDigit)}
                </div>
              </div>
            </>
          ) : null}
          {this.renderLinkDeviceEmailOtpActions(activation, { busy, canSubmit })}
        </div>
      </>
    );
  }

  private renderLinkDeviceEmailOtpActions(
    activation: AuthMenuLinkDeviceEmailOtpState['state'],
    input: { readonly busy: boolean; readonly canSubmit: boolean },
  ): ComponentChildren | null {
    // Verification hands straight over to activation, so the completed frame
    // owns no control — anything offered here would race the flow.
    if (activation.kind === 'completed') return null;
    if (activation.kind === 'unavailable') {
      return (
        <>
          <button
            class="seams-link-device-btn"
            type="button"
            data-link-device-error-dismiss
            onClick={this.onBackClick}
          >
            Return to sign in
          </button>
        </>
      );
    }
    if (activation.kind === 'expired') {
      return (
        <>
          <button
            class="seams-link-device-btn seams-link-device-btn-primary"
            type="button"
            onClick={this.onLinkDeviceEmailOtpResend}
          >
            Send a new code
          </button>
        </>
      );
    }
    return (
      <>
        <button
          class="seams-link-device-btn seams-link-device-btn-primary"
          type="button"
          disabled={!input.canSubmit}
          onClick={this.onLinkDeviceEmailOtpSubmit}
        >
          {activation.kind === 'submitting' ? 'Verifying' : 'Verify code'}
        </button>
        <button
          class="seams-otp-resend"
          type="button"
          disabled={input.busy}
          onClick={this.onLinkDeviceEmailOtpResend}
        >
          Send another code
        </button>
      </>
    );
  }

  private renderLinkDeviceFailure(
    linkDevice: Extract<AuthMenuLinkDeviceState, { kind: 'error' | 'activation_error' }>,
  ): ComponentChildren {
    const activationFailed = linkDevice.kind === 'activation_error';
    return (
      <>
        <div class="seams-link-device-confirmation seams-link-device-failure">
          <div class="seams-link-device-failure-icon">{linkFailedIcon()}</div>
          <h2 class="qr-title" id={AUTH_MENU_TITLE_ID}>
            {activationFailed ? 'Device linked' : "Couldn't link device"}
          </h2>
          <p class="seams-link-device-failure-detail" role="alert">
            {activationFailed ? (
              <>Unable to open the wallet. Return to sign in and try again. {linkDevice.message}</>
            ) : (
              linkDevice.message
            )}
          </p>
          <button
            class="seams-link-device-btn"
            type="button"
            data-auth-menu-primary
            data-link-device-error-dismiss
            onClick={this.onBackClick}
          >
            Return to sign in
          </button>
        </div>
      </>
    );
  }

  private renderLinkDeviceExpired(
    linkDevice: Extract<AuthMenuLinkDeviceState, { kind: 'expired' }>,
  ): ComponentChildren {
    return (
      <>
        <div class="seams-link-device-confirmation seams-link-device-failure">
          <div class="seams-link-device-failure-icon">{linkFailedIcon()}</div>
          <h2 class="qr-title" id={AUTH_MENU_TITLE_ID}>
            Linking expired
          </h2>
          <p class="seams-link-device-failure-detail" role="alert">
            {linkDevice.message}
          </p>
          <button
            class="seams-link-device-btn"
            type="button"
            data-auth-menu-primary
            data-link-device-expired-dismiss
            onClick={this.onBackClick}
          >
            Try again
          </button>
        </div>
      </>
    );
  }

  private renderLinkDeviceCancelled(
    linkDevice: Extract<AuthMenuLinkDeviceState, { kind: 'cancelled' }>,
  ): ComponentChildren {
    return (
      <>
        <div class="seams-link-device-confirmation seams-link-device-failure">
          <div class="seams-link-device-failure-icon">{linkFailedIcon()}</div>
          <h2 class="qr-title" id={AUTH_MENU_TITLE_ID}>
            Linking cancelled
          </h2>
          <p class="seams-link-device-failure-detail" role="alert">
            {linkDevice.message}
          </p>
          <button
            class="seams-link-device-btn"
            type="button"
            data-auth-menu-primary
            data-link-device-cancelled-dismiss
            onClick={this.onBackClick}
          >
            Return to sign in
          </button>
        </div>
      </>
    );
  }

  private renderLinkedDeviceActivation(
    linkDevice: Extract<AuthMenuLinkDeviceState, { kind: 'activating' }>,
  ): ComponentChildren {
    return (
      <>
        <div class="seams-link-device-confirmation">
          <span class="seams-spinner" aria-hidden="true"></span>
          <h2 class="qr-title" id={AUTH_MENU_TITLE_ID}>
            Opening linked wallet
          </h2>
          <p class="seams-link-device-confirmation-copy" role="status" aria-live="polite">
            {linkDevice.message}
          </p>
        </div>
      </>
    );
  }

  private renderLinkDevicePasskeyConfirmation(
    linkDevice: Extract<AuthMenuLinkDeviceState, { kind: 'passkey_required' | 'creating_passkey' }>,
  ): ComponentChildren {
    const creating = linkDevice.kind === 'creating_passkey';
    return (
      <>
        <div class="seams-link-device-confirmation">
          {linkDeviceDotRing(creating ? 'waiting' : 'approved')}
          <h2 class="qr-title" id={AUTH_MENU_TITLE_ID} aria-live="polite">
            {linkDevice.message}
          </h2>
          <button
            class="seams-link-device-btn seams-link-device-btn-primary"
            type="button"
            data-auth-menu-primary
            data-link-device-passkey-action
            disabled={creating}
            onClick={this.onLinkDeviceCreatePasskey}
          >
            {creating ? 'Waiting for passkey' : 'Create passkey'}
          </button>
        </div>
      </>
    );
  }

  private renderGoogleOtp(viewModel: Extract<AuthMenuViewModel, { kind: 'google_otp_login' }>) {
    const deliveryMessage =
      viewModel.delivery.status === 'reused'
        ? `Use the code already sent to ${viewModel.emailHint}.`
        : `A 6-digit code was sent to ${viewModel.emailHint}.`;
    const digits = otpCodeDigits(viewModel.otpCode);
    return (
      <>
        <div class="seams-otp-prompt" aria-live="polite">
          <div class="seams-otp-prompt-copy">
            <div class="seams-otp-title" id={AUTH_MENU_TITLE_ID}>
              {viewModel.heading}
            </div>
            <p class="seams-otp-description">{deliveryMessage}</p>
            <div class="seams-otp-account" title={viewModel.walletId}>
              <span class="seams-otp-account-label">Wallet</span>
              <span class="seams-otp-account-value">{viewModel.walletId}</span>
            </div>
          </div>
          <label class="seams-field-label" for="seams-auth-menu-google-otp">
            Email code
          </label>
          <div class="seams-otp-code-field" data-disabled={viewModel.submitBusy ? 'true' : 'false'}>
            <input
              class="seams-otp-input"
              id="seams-auth-menu-google-otp"
              data-auth-menu-input
              data-email-otp-challenge-id={viewModel.challengeId}
              data-email-otp-wallet-id={viewModel.walletId}
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={viewModel.otpCode}
              disabled={viewModel.submitBusy}
              onInput={this.onGoogleOtpCodeInput}
              onKeyDown={this.onGoogleOtpKeydown}
            />
            <div class="seams-otp-slots" aria-hidden="true">
              {digits.map(renderOtpCodeDigit)}
            </div>
          </div>
          <p class="seams-otp-helper">{viewModel.prompt.helperText ?? ''}</p>
          <button
            class="seams-auth-method-btn seams-auth-method-btn-primary"
            type="button"
            data-auth-menu-primary
            disabled={!isAuthMenuActionReady(viewModel)}
            onClick={this.onPrimaryClick}
          >
            {viewModel.submitBusy ? 'Unlocking…' : viewModel.ctaLabel}
          </button>
          <button
            class="seams-otp-resend auth-menu-google-resend"
            type="button"
            disabled={viewModel.resendBusy || viewModel.submitBusy}
            onClick={this.onGoogleOtpResend}
          >
            {viewModel.resendBusy ? 'Sending…' : 'Resend Code'}
          </button>
        </div>
      </>
    );
  }

  private renderGoogleRegistration(
    viewModel: Extract<AuthMenuViewModel, { kind: 'google_registration' }>,
  ) {
    return (
      <>
        <div class="seams-otp-prompt" aria-live="polite">
          <div class="seams-otp-prompt-copy">
            <div class="seams-otp-title" id={AUTH_MENU_TITLE_ID}>
              {viewModel.heading}
            </div>
            <p class="seams-otp-description">{viewModel.subtitle}</p>
            <div class="seams-otp-account" title={viewModel.walletId}>
              <span class="seams-otp-account-label">Wallet</span>
              <span class="seams-otp-account-value">{viewModel.walletId}</span>
            </div>
            <button
              class="seams-otp-reroll"
              type="button"
              disabled={viewModel.rerollBusy || viewModel.submitBusy}
              onClick={this.onGoogleRegistrationReroll}
            >
              {viewModel.rerollBusy ? 'Generating…' : 'Generate another name'}
            </button>
          </div>
          <button
            class="seams-auth-method-btn seams-auth-method-btn-primary"
            type="button"
            data-auth-menu-primary
            disabled={!isAuthMenuActionReady(viewModel)}
            onClick={this.onPrimaryClick}
          >
            {viewModel.submitBusy ? 'Creating...' : viewModel.ctaLabel}
          </button>
        </div>
      </>
    );
  }
}
