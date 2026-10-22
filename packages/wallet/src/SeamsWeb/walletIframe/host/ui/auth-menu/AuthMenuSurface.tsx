/** @jsxImportSource preact */
import {
  WalletText,
  WalletLocaleContext,
} from '@/core/signingEngine/uiConfirm/ui/preact/WalletLocale';
import { walletText, walletDisplayText } from '@/core/ui/messages';
import type { WalletLocale } from '@/core/ui/locale';
import {
  recoveryInputCharacters,
  rejectedRecoveryCharacters,
  renderRecoveryCodeGroups,
  type RecoveryCodeSelection,
  type RecoveryCodeArrival,
} from './recovery-code-input';
import {
  renderDemoEmailCode,
  AUTH_MENU_TITLE_ID,
  AUTH_MENU_ACCOUNT_LIST_ID,
  otpCodeDigits,
  recoveryCaretAtPoint,
  renderOtpCodeDigit,
  authViewKey,
  recoveryAnnouncement,
  recoveryBackLabel,
  recoveryNavigationLocked,
  modeSwitchCopy,
  modeLabel,
  passkeyButtonLabel,
  menuNotice,
  selectedLoginAccount,
  selectedAccountPrimaryText,
  accountSecondaryText,
  savedAccountsTriggerLabel,
  accountGroups,
} from './presentation';
import { Component, Fragment, type ComponentChildren } from 'preact';
import { WALLET_RECOVERY_CODE_CHAR_LENGTH } from '@shared/wallet-recovery/recoveryCodes';
import type { CspStylesheetManager } from '@/core/browser/walletIframe/csp-stylesheet';
import {
  AUTH_MENU_WAITING_PROMPTS,
  isAuthMenuActionReady,
  isAuthMenuGoogleActionReady,
  isAuthMenuLoadingStatus,
  isAuthMenuReady,
  type AuthMenuAccountOption,
  type AuthMenuIntent,
  type AuthMenuLinkDeviceState,
  type AuthMenuLoginViewModel,
  type AuthMenuRecoveryStage,
  type AuthMenuRecoveryViewModel,
  type AuthMenuRegisterViewModel,
  type AuthMenuSucceededStatus,
  type AuthMenuViewModel,
} from '../../auth-menu/domain';
import { isLinkedDeviceTargetEmailAddressV1 } from '@/core/types/linkDevice';
import { PadlockIcon } from '@/core/signingEngine/uiConfirm/ui/preact/PadlockIcon';
import { blinkMenuItem } from '@/utils/menuItemBlink';
import { AuthMenuFooter } from './AuthMenuFooter';
import {
  linkDeviceDotRing,
  linkDeviceEmailOtpPresentation,
  type AuthMenuLinkDeviceEmailOtpState,
} from './linkDeviceBadge';
import {
  accountDropdownIcon,
  backIcon,
  chevronIcon,
  fingerprintIcon,
  googleIcon,
  linkDeviceIcon,
  linkFailedIcon,
  mailIcon,
  passkeyRingIcon,
  passkeySuccessIcon,
  recoveryIcon,
  rerollIcon,
} from './icons';

type AuthMenuSurfaceProps = {
  readonly viewModel: AuthMenuViewModel;
  readonly element: HTMLElement;
  readonly onIntent: (intent: AuthMenuIntent) => void;
  readonly styles: CspStylesheetManager;
};

type AccountMenuState = 'closed' | 'open' | 'closing';

// Matches the account-menu-exit animation in auth-menu.css.
const ACCOUNT_MENU_EXIT_MS = 160;

type AuthMenuSurfaceState = {
  accountMenu: AccountMenuState;
  // The recovery code input's caret or selection, while the input has focus.
  recoverySelection: RecoveryCodeSelection | null;
  // Characters the last keystroke or paste dropped; parity restarts the shake.
  recoveryRejection: { readonly characters: readonly string[]; readonly parity: 0 | 1 } | null;
};

export class AuthMenuSurface extends Component<AuthMenuSurfaceProps, AuthMenuSurfaceState> {
  static contextType = WalletLocaleContext;
  declare context: WalletLocale;

  state: AuthMenuSurfaceState = {
    accountMenu: 'closed',
    recoverySelection: null,
    recoveryRejection: null,
  };
  // The code the slots last drew, so an edit knows which characters are new.
  private recoveryDrawnCode = '';
  private recoveryArrival: RecoveryCodeArrival | null = null;
  private recoveryArrivalTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryRejectionTimer: ReturnType<typeof setTimeout> | null = null;
  private accountMenuExitTimer: ReturnType<typeof setTimeout> | null = null;
  // The account a click chose and the one selected before it. The list keeps
  // rendering both as they were at the click while it blinks and fades out.
  private accountMenuChoice: {
    readonly chosen: AuthMenuAccountOption;
    readonly previous: AuthMenuAccountOption;
  } | null = null;
  private previouslyFocusedElement: HTMLElement | null = null;
  private shouldFocusInitialControl = true;
  private contentResizeObserver: ResizeObserver | null = null;
  private contentHeightFrame: number | null = null;
  private previousLinkDeviceStateKind: AuthMenuLinkDeviceState['kind'] | null = null;
  private previousRecoveryStage: AuthMenuRecoveryStage | null = null;
  // The method the person last chose, which the footer's retry repeats.
  private lastMethod: 'passkey' | 'google' = 'passkey';

  private get viewModel(): AuthMenuViewModel {
    return this.props.viewModel;
  }
  private get accountMenuOpen(): boolean {
    return this.state.accountMenu === 'open';
  }

  private openAccountMenu(): void {
    this.endAccountMenuExit();
    this.setState({ accountMenu: 'open' });
  }

  private closeAccountMenu(): void {
    if (!this.accountMenuOpen) return;
    this.setState({ accountMenu: 'closing' });
    this.accountMenuExitTimer = setTimeout(() => {
      this.endAccountMenuExit();
      this.setState({ accountMenu: 'closed' });
    }, ACCOUNT_MENU_EXIT_MS);
  }

  private endAccountMenuExit(): void {
    if (this.accountMenuExitTimer !== null) clearTimeout(this.accountMenuExitTimer);
    this.accountMenuExitTimer = null;
    this.accountMenuChoice = null;
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
    this.endAccountMenuExit();
    if (this.recoveryArrivalTimer !== null) clearTimeout(this.recoveryArrivalTimer);
    if (this.recoveryRejectionTimer !== null) clearTimeout(this.recoveryRejectionTimer);
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
    if (current.stage === 'choose_method') {
      if (stageChanged) {
        this.props.element.querySelector<HTMLElement>('[data-recovery-target]')?.focus();
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
        this.closeAccountMenu();
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
    const option = event.currentTarget;
    if (!(option instanceof HTMLButtonElement)) return;
    const walletId = option.dataset.walletId;
    const authMethod = option.dataset.authMethod;
    const viewModel = this.viewModel;
    if (!walletId || viewModel.kind !== 'passkey' || viewModel.mode !== 'login') return;
    const selected = viewModel.accountOptions.find(
      (account) => account.walletId === walletId && account.authMethod === authMethod,
    );
    const previous = selectedLoginAccount(viewModel);
    if (!selected || !previous || this.accountMenuChoice) return;
    const blink = blinkMenuItem(option);
    if (!blink) return;
    const choice = { chosen: selected, previous };
    this.accountMenuChoice = choice;
    // The selection commits within the click; only the list's close waits for the blink.
    this.emitIntent({
      kind: 'login_account_selected',
      walletId: selected.walletId,
      authMethod: selected.authMethod,
    });
    void blink.then(() => {
      // Closing or reopening the list during the blink drops the choice.
      if (this.accountMenuChoice === choice) this.closeAccountMenu();
    });
  };

  private onAccountMenuToggle = (): void => {
    if (this.accountMenuOpen) this.closeAccountMenu();
    else this.openAccountMenu();
  };

  private onDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.accountMenuOpen || !(event.target instanceof Node)) return;
    if (this.props.element.querySelector('.seams-account-menu')?.contains(event.target)) return;
    this.closeAccountMenu();
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
    this.lastMethod = 'passkey';
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
    this.lastMethod = 'google';
    this.emitIntent({ kind: 'external_auth', provider: 'google' });
  };

  private onNoticeRetry = (): void => {
    if (this.lastMethod === 'google' && isAuthMenuGoogleActionReady(this.viewModel)) {
      this.onGoogleClick();
    } else {
      this.onPrimaryClick();
    }
  };

  private onLinkDeviceOpen = (): void => {
    this.emitIntent({ kind: 'link_device_open' });
  };

  private onRecoveryOpen = (): void => {
    this.emitIntent({ kind: 'recovery_open' });
  };

  private onRecoveryCodeInput = (event: Event): void => {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    const viewModel = this.viewModel;
    if (viewModel.kind !== 'recovery') return;
    const input = event.currentTarget;
    const raw = input.value;
    const rejected = rejectedRecoveryCharacters(raw);
    if (rejected.length > 0) this.showRecoveryRejection(rejected);
    const caret = recoveryInputCharacters(raw.slice(0, input.selectionStart ?? raw.length)).length;
    const code = recoveryInputCharacters(raw).slice(0, WALLET_RECOVERY_CODE_CHAR_LENGTH);
    if (input.value !== code) {
      input.value = code;
      input.setSelectionRange(Math.min(caret, code.length), Math.min(caret, code.length));
    }
    this.syncRecoverySelection(input);
    this.emitIntent({ kind: 'recovery_code_changed', recoveryCode: code });
  };

  private onRecoverySelectionMove = (event: Event): void => {
    if (event.currentTarget instanceof HTMLInputElement) {
      this.syncRecoverySelection(event.currentTarget);
    }
  };

  private onRecoveryCodeClick = (event: MouseEvent): void => {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    // A drag or double click made a selection; keep it.
    if (input.selectionStart === input.selectionEnd) {
      const caret = recoveryCaretAtPoint(
        this.props.element,
        event.clientX,
        event.clientY,
        input.value.length,
      );
      if (caret !== null) input.setSelectionRange(caret, caret);
    }
    this.syncRecoverySelection(input);
  };

  private showRecoveryRejection(characters: readonly string[]): void {
    const parity = this.state.recoveryRejection?.parity === 0 ? 1 : 0;
    this.setState({ recoveryRejection: { characters, parity } });
    if (this.recoveryRejectionTimer !== null) clearTimeout(this.recoveryRejectionTimer);
    this.recoveryRejectionTimer = setTimeout(this.clearRecoveryRejection, 2000);
  }

  private clearRecoveryRejection = (): void => {
    this.recoveryRejectionTimer = null;
    this.setState({ recoveryRejection: null });
  };

  /* Marks the characters an edit added, so they settle in. The mark outlives
     the re-renders that follow one keystroke, and lapses after the motion. */
  private recoveryCodeArrival(code: string): RecoveryCodeArrival | null {
    const drawn = this.recoveryDrawnCode;
    if (code === drawn) return this.recoveryArrival;
    this.recoveryDrawnCode = code;
    let start = 0;
    while (start < drawn.length && drawn[start] === code[start]) start += 1;
    const end = start + code.length - drawn.length;
    this.recoveryArrival = code.length > drawn.length ? { start, end } : null;
    if (this.recoveryArrivalTimer !== null) clearTimeout(this.recoveryArrivalTimer);
    this.recoveryArrivalTimer = setTimeout(this.endRecoveryArrival, 600);
    return this.recoveryArrival;
  }

  private endRecoveryArrival = (): void => {
    this.recoveryArrivalTimer = null;
    this.recoveryArrival = null;
  };

  private onRecoveryCodeBlur = (): void => {
    this.setState({ recoverySelection: null });
  };

  private syncRecoverySelection(input: HTMLInputElement): void {
    const length = input.value.length;
    const start = Math.min(input.selectionStart ?? length, length);
    const end = Math.min(Math.max(input.selectionEnd ?? start, start), length);
    const current = this.state.recoverySelection;
    if (current?.start === start && current.end === end) return;
    this.setState({ recoverySelection: { start, end } });
  }

  private onRecoverySubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    this.emitIntent({ kind: 'recovery_code_submit' });
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
    // The success view keeps the waiting view's layout, so the ring holds still.
    const success = viewModel.status.kind === 'succeeded' ? viewModel.status.phase : null;
    const linkDevice = viewModel.kind === 'link_device';
    const otpPrompt = viewModel.kind === 'google_otp_login';
    const registrationPrompt = viewModel.kind === 'google_registration';
    const recovery = viewModel.kind === 'recovery';

    return (
      <>
        <div
          class="seams-signup-menu-root auth-menu-root"
          data-mode={viewModel.mode}
          data-waiting={loading || success ? 'true' : 'false'}
          data-success={success ?? undefined}
          data-scan-device={linkDevice ? 'true' : 'false'}
          data-otp-prompt={otpPrompt ? 'true' : 'false'}
          data-registration-prompt={registrationPrompt ? 'true' : 'false'}
          data-recovery={recovery ? 'true' : 'false'}
          aria-labelledby={AUTH_MENU_TITLE_ID}
          aria-busy={loading ? 'true' : 'false'}
          tabIndex={-1}
          onKeyDown={this.onKeydown}
        >
          {/* The site asking stays put in every view, so switching views never moves it. */}
          <div class="seams-menu-origin">
            <PadlockIcon /> <span>{viewModel.hostname}</span>
          </div>
          <div class="seams-content-switcher">
            <button
              class={`seams-back-button ${
                !success && (loading || linkDevice || otpPrompt || registrationPrompt || recovery)
                  ? 'is-visible'
                  : ''
              }`}
              type="button"
              aria-label={walletDisplayText(this.context, recoveryBackLabel(viewModel))}
              data-auth-menu-close
              disabled={success !== null || recoveryNavigationLocked(viewModel)}
              onClick={this.onBackClick}
            >
              {backIcon()}
            </button>
            {recovery ? (
              <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
                <WalletText copy={recoveryAnnouncement(viewModel)} />
              </div>
            ) : null}
            <div class="seams-content-area">
              <div class="seams-content-sizer">
                {loading || success ? (
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
          <AuthMenuFooter notice={menuNotice(viewModel)} onRetry={this.onNoticeRetry} />
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
        {this.renderMenuHeader(viewModel)} {this.renderPasskeyInput(viewModel)}
        {this.renderAuthMethods(viewModel)} {this.renderOtherOptions()}
        {this.renderIntentSwitch(viewModel)}
      </>
    );
  }

  private renderMenuHeader(
    viewModel: AuthMenuLoginViewModel | AuthMenuRegisterViewModel,
  ): ComponentChildren {
    const eyebrow = modeLabel(viewModel.mode);
    return (
      <div class="seams-menu-header">
        {/* An app that titles the menu with the mode itself needs no second copy of it. */}
        {eyebrow === viewModel.heading ? null : (
          <div class="seams-menu-eyebrow">
            <WalletText copy={eyebrow} />
          </div>
        )}
        <div class="seams-title" id={AUTH_MENU_TITLE_ID}>
          <WalletText copy={viewModel.heading} />
        </div>
        {viewModel.subtitle ? (
          <div class="seams-subhead">
            <WalletText copy={viewModel.subtitle} />
          </div>
        ) : null}
      </div>
    );
  }

  private renderHeader(viewModel: AuthMenuViewModel): ComponentChildren {
    return (
      <>
        <div class="seams-header">
          <div>
            <div class="seams-title" id={AUTH_MENU_TITLE_ID}>
              <WalletText copy={viewModel.heading} />
            </div>
            <div class="seams-subhead">
              <WalletText copy={viewModel.subtitle} />
            </div>
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
      if (!selected) return <></>;

      const groups = accountGroups(viewModel.accountOptions);
      const accountMenu = this.state.accountMenu;
      const choice = this.accountMenuChoice;
      const listSelected = choice?.previous ?? selected;
      return (
        <>
          <div class="seams-passkey-row">
            <div class="seams-input-pill">
              <div class="seams-input-wrap">
                <div class="seams-account-menu-account seams-selected-account" aria-hidden="true">
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
              </div>
              <div class={`seams-account-menu ${accountMenu === 'closed' ? '' : 'is-open'}`}>
                <button
                  class="seams-account-menu-trigger"
                  type="button"
                  data-auth-menu-input
                  aria-label={walletDisplayText(this.context, savedAccountsTriggerLabel(selected))}
                  aria-haspopup="listbox"
                  aria-expanded={this.accountMenuOpen ? 'true' : 'false'}
                  aria-controls={AUTH_MENU_ACCOUNT_LIST_ID}
                  onClick={this.onAccountMenuToggle}
                >
                  {accountDropdownIcon()}
                </button>
                {accountMenu !== 'closed' ? (
                  <>
                    <div
                      id={AUTH_MENU_ACCOUNT_LIST_ID}
                      class={`seams-account-menu-popover ${
                        accountMenu === 'closing' ? 'is-closing' : ''
                      }`}
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
                                <WalletText copy={group.label} />
                              </div>
                              {group.accounts.map((account) => {
                                const isSelected =
                                  account.walletId === listSelected.walletId &&
                                  account.authMethod === listSelected.authMethod;
                                const isChosen =
                                  !isSelected &&
                                  account.walletId === choice?.chosen.walletId &&
                                  account.authMethod === choice.chosen.authMethod;
                                const secondaryText = accountSecondaryText(account);
                                return (
                                  <>
                                    <button
                                      class={`seams-account-menu-option ${
                                        isSelected ? 'is-selected' : ''
                                      } ${isChosen ? 'is-chosen' : ''}`}
                                      type="button"
                                      role="option"
                                      aria-selected={isSelected ? 'true' : 'false'}
                                      title={walletDisplayText(
                                        this.context,
                                        secondaryText
                                          ? `${account.walletId} ${secondaryText}`
                                          : account.walletId,
                                      )}
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
                                              <WalletText copy={secondaryText} />
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
                placeholder={walletDisplayText(this.context, viewModel.passkeyNameLabel)}
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
                  title={walletText(this.context, 'Generate another name')}
                  aria-label={walletText(this.context, 'Generate another name')}
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
          <button
            class="seams-auth-method-btn seams-auth-method-btn-primary"
            type="button"
            data-auth-menu-primary
            disabled={!isAuthMenuActionReady(viewModel)}
            onClick={this.onPrimaryClick}
          >
            {fingerprintIcon()}
            <span>
              <WalletText copy={passkeyButtonLabel(viewModel.mode)} />
            </span>
          </button>
          {googleEnabled ? (
            <button
              class="seams-auth-method-btn"
              type="button"
              data-auth-menu-provider="google"
              disabled={!isAuthMenuGoogleActionReady(viewModel)}
              onClick={this.onGoogleClick}
            >
              {googleIcon()}
              <span>
                <WalletText message="Continue with Google" />
              </span>
            </button>
          ) : null}
        </div>
      </>
    );
  }

  private renderOtherOptions(): ComponentChildren {
    return (
      <>
        <div class="seams-menu-options-label">
          <WalletText message="Other options" />
        </div>
        <div class="seams-menu-options">
          <button class="seams-menu-option" type="button" onClick={this.onLinkDeviceOpen}>
            <span class="seams-menu-option-icon">{linkDeviceIcon()}</span>
            <span class="seams-menu-option-text">
              <WalletText message="Link this device" />
              <small>
                <WalletText message="Scan a code with your other device" />
              </small>
            </span>
            {chevronIcon()}
          </button>
          <button
            class="seams-menu-option"
            type="button"
            data-recovery-action
            onClick={this.onRecoveryOpen}
          >
            <span class="seams-menu-option-icon">{recoveryIcon()}</span>
            <span class="seams-menu-option-text">
              <WalletText message="Recover wallet" />
              <small>
                <WalletText message="Use your recovery code" />
              </small>
            </span>
            {chevronIcon()}
          </button>
        </div>
      </>
    );
  }

  private renderRecovery(viewModel: AuthMenuRecoveryViewModel): ComponentChildren {
    if (viewModel.stage === 'enter_code') {
      const code = recoveryInputCharacters(viewModel.recoveryCode).slice(
        0,
        WALLET_RECOVERY_CODE_CHAR_LENGTH,
      );
      const arrival = this.recoveryCodeArrival(code);
      const rejection = this.state.recoveryRejection;
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
            <WalletText copy={feedbackMessage} />
          </p>
          <form class="seams-recovery-form" novalidate onSubmit={this.onRecoverySubmit}>
            <div class="seams-recovery-field">
              <div class="seams-recovery-field-header">
                <label class="seams-field-label" for="seams-recovery-code">
                  <WalletText message="Recovery code" />
                </label>
                <span id="seams-recovery-code-count" class="seams-recovery-code-count">
                  {code.length}/{WALLET_RECOVERY_CODE_CHAR_LENGTH}
                </span>
              </div>
              <div
                class={`seams-otp-code-field seams-recovery-code-field ${
                  rejection ? `is-rejecting-${rejection.parity}` : ''
                }`}
              >
                <input
                  id="seams-recovery-code"
                  class="seams-otp-input"
                  data-recovery-code
                  name="recoveryCode"
                  type="text"
                  inputmode="text"
                  autocomplete="off"
                  autocapitalize="characters"
                  autocorrect="off"
                  spellcheck={false}
                  aria-invalid={viewModel.recoveryCodeError ? 'true' : 'false'}
                  aria-describedby={
                    viewModel.recoveryCodeError
                      ? 'seams-recovery-code-feedback seams-recovery-code-count seams-recovery-code-hint'
                      : 'seams-recovery-code-count seams-recovery-code-hint'
                  }
                  value={code}
                  onInput={this.onRecoveryCodeInput}
                  onFocus={this.onRecoverySelectionMove}
                  onKeyUp={this.onRecoverySelectionMove}
                  onSelect={this.onRecoverySelectionMove}
                  onClick={this.onRecoveryCodeClick}
                  onBlur={this.onRecoveryCodeBlur}
                />
                <div
                  class={`seams-otp-slots seams-recovery-code-slots ${
                    arrival && arrival.end - arrival.start > 1 ? 'is-sweeping' : ''
                  }`}
                  aria-hidden="true"
                >
                  {renderRecoveryCodeGroups(code, this.state.recoverySelection, arrival)}
                </div>
              </div>
              <p
                id="seams-recovery-code-hint"
                class={`seams-recovery-code-hint ${rejection ? 'is-error' : ''}`}
                aria-live="polite"
              >
                {rejection ? (
                  `Recovery codes don’t use ${rejection.characters.join(', ')}.`
                ) : (
                  <WalletText message="You can paste the whole code." />
                )}
              </p>
            </div>
            {/* Continue stays enabled: the session names what a short code lacks. */}
            <button
              class="seams-auth-method-btn seams-auth-method-btn-primary"
              type="submit"
              data-auth-menu-primary
              data-recovery-continue
            >
              <WalletText message="Continue" />
            </button>
          </form>
        </>
      );
    }
    if (viewModel.stage === 'choose_method' || viewModel.stage === 'preparing') {
      const busyTarget = viewModel.stage === 'preparing' ? viewModel.target.kind : null;
      const statusMessage =
        viewModel.status.kind === 'recoverable'
          ? viewModel.status.message
          : viewModel.status.kind === 'busy'
            ? viewModel.status.headline
            : '';
      const googleEnabled = viewModel.enabledExternalProviders?.includes('google') ?? false;
      return (
        <>
          {this.renderHeader(viewModel)}
          {/* The menu's live region announces this status; the copy here is visual. */}
          <p
            class={`seams-recovery-status ${
              viewModel.status.kind === 'recoverable' ? 'seams-recovery-error' : ''
            }`}
            aria-hidden="true"
          >
            <WalletText copy={statusMessage} />
          </p>
          <div class="seams-auth-methods seams-recovery-methods">
            <button
              class="seams-auth-method-btn seams-auth-method-btn-primary"
              type="button"
              data-auth-menu-primary
              data-recovery-target="passkey"
              disabled={busyTarget !== null}
              onClick={this.onRecoveryPasskeySelected}
            >
              {busyTarget === 'passkey' ? (
                <span class="seams-spinner" aria-hidden="true"></span>
              ) : (
                fingerprintIcon()
              )}
              <span>
                <WalletText message="Create a passkey" />
              </span>
            </button>
            {googleEnabled ? (
              <button
                class="seams-auth-method-btn"
                type="button"
                data-recovery-target="google_email_otp"
                disabled={busyTarget !== null}
                onClick={this.onRecoveryGoogleSelected}
              >
                {busyTarget === 'google_email_otp' ? (
                  <span class="seams-spinner" aria-hidden="true"></span>
                ) : (
                  googleIcon()
                )}
                <span>
                  <WalletText message="Continue with Google" />
                </span>
              </button>
            ) : null}
          </div>
          <p class="seams-recovery-method-note">
            <WalletText message="This adds a new sign-in method to your wallet." />
          </p>
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
            <p class="seams-otp-description">
              <WalletText copy={deliveryMessage} />
            </p>
            {renderDemoEmailCode(viewModel.delivery)}
            <label class="seams-field-label" for="seams-recovery-google-otp">
              <WalletText message="Email code" />
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
                  <WalletText copy={viewModel.status.message} />
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
              <WalletText message="Verify email code" />
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
              : 'Create a new passkey to finish recovering this wallet.';
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
              <p class="seams-recovery-status">
                <WalletText copy={message} />
              </p>
            </>
          )}
          <button
            class="seams-link-device-btn seams-link-device-btn-primary"
            type="button"
            data-auth-menu-primary
            onClick={action}
          >
            {googleTarget && !finalizationRetry ? googleIcon() : null}
            {signIn ? (
              googleTarget ? (
                <WalletText message="Unlock with Google" />
              ) : (
                <WalletText message="Unlock with new passkey" />
              )
            ) : finalizationRetry ? (
              <WalletText message="Retry finalization" />
            ) : googleTarget ? (
              <WalletText message="Continue with Google" />
            ) : (
              <WalletText message="Create new passkey" />
            )}
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
          <span>
            <WalletText copy={copy.prompt} />
          </span>
          <button
            type="button"
            data-auth-menu-mode={copy.nextMode}
            onClick={this.onIntentSwitchClick}
          >
            <WalletText copy={copy.action} />
          </button>
        </div>
      </>
    );
  }

  private renderWaiting(viewModel: AuthMenuViewModel): ComponentChildren {
    const status = viewModel.status;
    if (status.kind === 'succeeded') return this.renderSuccess(status);
    if (status.kind !== 'busy') return <></>;
    // `headline` is required on the busy status, so there is no fallback to
    // inherit here — every wait names itself.
    const waitingText = status.headline;
    const prompt = status.illustration ? AUTH_MENU_WAITING_PROMPTS[status.illustration] : null;
    return (
      <>
        <div class="seams-waiting" role="status" aria-live="polite">
          {prompt ? (
            <span
              class="seams-passkey-prompt"
              role="img"
              aria-label={walletDisplayText(this.context, prompt.label)}
            >
              {passkeyRingIcon()}
            </span>
          ) : null}
          <div class="seams-waiting-message">
            <span class="seams-waiting-text">
              <WalletText copy={waitingText} />
            </span>
            {prompt ? (
              <span class="seams-passkey-instruction">
                <WalletText copy={prompt.instruction} />
              </span>
            ) : null}
            {viewModel.showProgress && status.detail && status.detail !== waitingText ? (
              <>
                <span class="seams-waiting-sdk-events">
                  <WalletText copy={status.detail} />
                </span>
              </>
            ) : null}
          </div>
          {prompt ? null : (
            <div aria-label={walletText(this.context, 'Loading')} class="seams-spinner"></div>
          )}
        </div>
      </>
    );
  }

  // The ring of the wait closes into a check in the same place; new keys start
  // its CSS timeline afresh when the view arrives.
  private renderSuccess(status: AuthMenuSucceededStatus): ComponentChildren {
    return (
      <div class="seams-waiting seams-success" role="status" aria-live="polite">
        <span key="success-prompt" class="seams-passkey-prompt seams-success-prompt">
          {passkeySuccessIcon()}
        </span>
        <div key="success-message" class="seams-waiting-message seams-success-message">
          <span class="seams-waiting-text">
            <WalletText copy={status.headline} />
          </span>
          <span class="seams-passkey-instruction">
            <WalletText copy={status.message} />
          </span>
        </div>
      </div>
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
    if (linkDevice.kind === 'expired') {
      return this.renderLinkDeviceFailurePanel({
        dismiss: 'expired',
        title: 'Linking expired',
        detail: linkDevice.message,
        action: 'Try again',
      });
    }
    if (linkDevice.kind === 'cancelled') {
      return this.renderLinkDeviceFailurePanel({
        dismiss: 'cancelled',
        title: 'Linking cancelled',
        detail: linkDevice.message,
        action: 'Return to unlock wallet',
      });
    }
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
                    <WalletText copy={viewModel.heading} />
                  </h2>
                </div>
                <div class="qr-instruction">
                  {ready ? (
                    <WalletText copy={viewModel.subtitle} />
                  ) : (
                    <WalletText message="Preparing a one-time code for your other device." />
                  )}
                </div>
                <div class="qr-status" role="status" aria-live="polite">
                  {ready ? (
                    <WalletText copy={linkDevice.message} />
                  ) : (
                    <WalletText message="Generating QR code" />
                  )}
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
            <WalletText message="Match your other device" />
          </h2>
          <p class="seams-link-device-confirmation-copy">
            <WalletText message="Choose the unlock method for Device 2. Email code sends a one-time code to the address you enter." />
          </p>
          <fieldset class="seams-link-device-factor-options">
            <legend class="sr-only">
              <WalletText message="Wallet unlock method" />
            </legend>
            <label>
              <span class="seams-auth-method-choice-icon">{fingerprintIcon()}</span>
              <span class="seams-auth-method-choice-label">
                <WalletText message="Passkey" />
              </span>
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
              <span class="seams-auth-method-choice-label">
                <WalletText message="Email code" />
              </span>
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
                <span class="seams-field-label">
                  <WalletText message="Email address" />
                </span>
                <input
                  type="email"
                  name="linked-device-target-email"
                  autocomplete="email"
                  value={emailAddress}
                  aria-label={walletText(this.context, 'Email address')}
                  aria-invalid={emailAddress.length > 0 && !canStart ? 'true' : 'false'}
                  onInput={this.onLinkDeviceTargetEmailInput}
                />
              </label>
            </>
          ) : null}
          {linkDevice.error ? (
            <>
              <p class="seams-link-device-inline-error" role="alert">
                <WalletText copy={linkDevice.error} />
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
            <WalletText message="Continue" />
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
            <WalletText copy={view.heading} />
          </h2>
          {hint ? (
            <>
              <div
                class="seams-link-device-email-chip"
                title={walletDisplayText(this.context, hint)}
              >
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
            <WalletText copy={view.status} />
            {view.pending ? (
              <>
                <span class="animated-ellipsis" aria-hidden="true"></span>
              </>
            ) : null}
          </p>
          {showCodeField ? (
            <>
              <label class="sr-only" for="seams-linked-device-email-otp">
                <WalletText message="Email code" />
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
                  aria-label={walletText(this.context, 'Email verification code')}
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
            <WalletText message="Return to unlock wallet" />
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
            <WalletText message="Send a new code" />
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
          {activation.kind === 'submitting' ? (
            <WalletText message="Verifying" />
          ) : (
            <WalletText message="Verify code" />
          )}
        </button>
        <button
          class="seams-otp-resend"
          type="button"
          disabled={input.busy}
          onClick={this.onLinkDeviceEmailOtpResend}
        >
          <WalletText message="Send another code" />
        </button>
      </>
    );
  }

  private renderLinkDeviceFailure(
    linkDevice: Extract<AuthMenuLinkDeviceState, { kind: 'error' | 'activation_error' }>,
  ): ComponentChildren {
    const activationFailed = linkDevice.kind === 'activation_error';
    return this.renderLinkDeviceFailurePanel({
      dismiss: 'error',
      title: activationFailed ? 'Device linked' : "Couldn't link device",
      detail: activationFailed ? (
        <>
          <WalletText message="Unable to open the wallet. Go back and try again." />{' '}
          <WalletText copy={linkDevice.message} />
        </>
      ) : (
        linkDevice.message
      ),
      action: 'Return to unlock wallet',
    });
  }

  // `dismiss` names the button's data-link-device-*-dismiss attribute.
  private renderLinkDeviceFailurePanel(panel: {
    dismiss: 'error' | 'expired' | 'cancelled';
    title: string;
    detail: ComponentChildren;
    action: string;
  }): ComponentChildren {
    return (
      <>
        <div class="seams-link-device-confirmation seams-link-device-failure">
          <div class="seams-link-device-failure-icon">{linkFailedIcon()}</div>
          <h2 class="qr-title" id={AUTH_MENU_TITLE_ID}>
            <WalletText copy={panel.title} />
          </h2>
          <p class="seams-link-device-failure-detail" role="alert">
            {typeof panel.detail === 'string' ? <WalletText copy={panel.detail} /> : panel.detail}
          </p>
          <button
            class="seams-link-device-btn"
            type="button"
            data-auth-menu-primary
            {...{ [`data-link-device-${panel.dismiss}-dismiss`]: true }}
            onClick={this.onBackClick}
          >
            <WalletText copy={panel.action} />
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
            <WalletText message="Opening linked wallet" />
          </h2>
          <p class="seams-link-device-confirmation-copy" role="status" aria-live="polite">
            <WalletText copy={linkDevice.message} />
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
            <WalletText copy={linkDevice.message} />
          </h2>
          <button
            class="seams-link-device-btn seams-link-device-btn-primary"
            type="button"
            data-auth-menu-primary
            data-link-device-passkey-action
            disabled={creating}
            onClick={this.onLinkDeviceCreatePasskey}
          >
            {creating ? (
              <WalletText message="Waiting for passkey" />
            ) : (
              <WalletText message="Create passkey" />
            )}
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
              <WalletText copy={viewModel.heading} />
            </div>
            <p class="seams-otp-description">
              <WalletText copy={deliveryMessage} />
            </p>
            {renderDemoEmailCode(viewModel.delivery)}
            <div
              class="seams-otp-account"
              title={walletDisplayText(this.context, viewModel.walletId)}
            >
              <span class="seams-otp-account-label">
                <WalletText message="Wallet" />
              </span>
              <span class="seams-otp-account-value">{viewModel.walletId}</span>
            </div>
          </div>
          <label class="seams-field-label" for="seams-auth-menu-google-otp">
            <WalletText message="Email code" />
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
          <p class="seams-otp-helper">
            <WalletText copy={viewModel.prompt.helperText ?? ''} />
          </p>
          <button
            class="seams-auth-method-btn seams-auth-method-btn-primary"
            type="button"
            data-auth-menu-primary
            disabled={!isAuthMenuActionReady(viewModel)}
            onClick={this.onPrimaryClick}
          >
            {viewModel.submitBusy ? (
              <WalletText message="Unlocking…" />
            ) : (
              <WalletText copy={viewModel.ctaLabel} />
            )}
          </button>
          <button
            class="seams-otp-resend auth-menu-google-resend"
            type="button"
            disabled={viewModel.resendBusy || viewModel.submitBusy}
            onClick={this.onGoogleOtpResend}
          >
            {viewModel.resendBusy ? (
              <WalletText message="Sending…" />
            ) : (
              <WalletText message="Resend Code" />
            )}
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
              <WalletText copy={viewModel.heading} />
            </div>
            <p class="seams-otp-description">
              <WalletText copy={viewModel.subtitle} />
            </p>
            <div
              class="seams-otp-account"
              title={walletDisplayText(this.context, viewModel.walletId)}
            >
              <span class="seams-otp-account-label">
                <WalletText message="Wallet" />
              </span>
              <span class="seams-otp-account-value">{viewModel.walletId}</span>
            </div>
            <button
              class="seams-otp-reroll"
              type="button"
              disabled={viewModel.rerollBusy || viewModel.submitBusy}
              onClick={this.onGoogleRegistrationReroll}
            >
              {viewModel.rerollBusy ? (
                <WalletText message="Generating…" />
              ) : (
                <WalletText message="Generate another name" />
              )}
            </button>
          </div>
          <button
            class="seams-auth-method-btn seams-auth-method-btn-primary"
            type="button"
            data-auth-menu-primary
            disabled={!isAuthMenuActionReady(viewModel)}
            onClick={this.onPrimaryClick}
          >
            {viewModel.submitBusy ? (
              <WalletText message="Creating..." />
            ) : (
              <WalletText copy={viewModel.ctaLabel} />
            )}
          </button>
        </div>
      </>
    );
  }
}
