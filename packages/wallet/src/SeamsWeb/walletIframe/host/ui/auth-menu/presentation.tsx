/** @jsxImportSource preact */
import type { ComponentChildren } from 'preact';
import { WalletText } from '@/core/signingEngine/uiConfirm/ui/preact/WalletLocale';
import { demoEmailOtpCodeFromDelivery } from '@/core/signingEngine/session/emailOtp/challengeDelivery';
import type { EmailOtpChallengeDelivery } from '@/core/signingEngine/session/emailOtp/publicTypes';
import {
  resolveAuthMenuLoginAccount,
  type AuthMenuAccountOption,
  type AuthMenuLoginViewModel,
  type AuthMenuRecoveryViewModel,
  type AuthMenuViewModel,
} from '../../auth-menu/domain';

export function renderDemoEmailCode(delivery: EmailOtpChallengeDelivery): ComponentChildren {
  const code = demoEmailOtpCodeFromDelivery(delivery);
  if (code === null) return null;
  return (
    <p class="seams-otp-description">
      <WalletText message="Demo email code:" /> <code>{code}</code>
    </p>
  );
}

export const AUTH_MENU_TITLE_ID = 'seams-auth-menu-title';
export const AUTH_MENU_ACCOUNT_LIST_ID = 'seams-auth-menu-account-list';

export function otpCodeDigits(code: string, length = 6): readonly string[] {
  return code.padEnd(length, ' ').slice(0, length).split('');
}

/* The input lies over the slots and is transparent, so a click lands on its
   hidden text, not on the slot under the pointer. Map the pointer to the slot:
   its left half puts the caret before that character, its right half after. */
export function recoveryCaretAtPoint(
  root: HTMLElement,
  clientX: number,
  clientY: number,
  codeLength: number,
): number | null {
  let nearest: {
    readonly index: number;
    readonly distance: number;
    readonly after: boolean;
  } | null = null;
  for (const slot of root.querySelectorAll<HTMLElement>('[data-recovery-slot]')) {
    const index = Number(slot.dataset.recoverySlot);
    const box = slot.getBoundingClientRect();
    const dx = clientX < box.left ? box.left - clientX : Math.max(0, clientX - box.right);
    const dy = clientY < box.top ? box.top - clientY : Math.max(0, clientY - box.bottom);
    const distance = dx * dx + dy * dy;
    if (nearest === null || distance < nearest.distance) {
      nearest = { index, distance, after: clientX > box.left + box.width / 2 };
    }
  }
  if (nearest === null) return null;
  return Math.min(nearest.after ? nearest.index + 1 : nearest.index, codeLength);
}

export function renderOtpCodeDigit(digit: string): ComponentChildren {
  return (
    <>
      <span class={`seams-otp-slot ${digit.trim() ? 'is-filled' : ''}`}>{digit}</span>
    </>
  );
}

export function authViewKey(viewModel: AuthMenuViewModel): string {
  const stage = viewModel.kind === 'recovery' ? `:${viewModel.stage}` : '';
  return `${viewModel.kind}:${viewModel.mode}:${viewModel.status.kind}${stage}`;
}

export function recoveryAnnouncement(viewModel: AuthMenuRecoveryViewModel): string {
  if (viewModel.status.kind === 'busy') return viewModel.status.headline;
  if (viewModel.status.kind === 'recoverable') return viewModel.status.message;
  if (viewModel.stage === 'passkey_ready') return 'Recovery code accepted.';
  if (viewModel.stage === 'sign_in_ready') return 'Wallet recovered. Unlock it to continue.';
  return '';
}

export function recoveryBackLabel(viewModel: AuthMenuViewModel): string {
  if (viewModel.kind !== 'recovery') return 'Back';
  return viewModel.stage === 'choose_method' ? 'Back to recovery code' : 'Back to unlock wallet';
}

export function recoveryNavigationLocked(viewModel: AuthMenuViewModel): boolean {
  return viewModel.kind === 'recovery' && viewModel.stage === 'finalizing';
}

export function modeSwitchCopy(mode: AuthMenuViewModel['mode']): {
  prompt: string;
  action: string;
  nextMode: 'login' | 'register';
} {
  return mode === 'register'
    ? { prompt: 'Already have a wallet?', action: 'Unlock wallet', nextMode: 'login' }
    : { prompt: "Don't have a wallet?", action: 'Create a wallet', nextMode: 'register' };
}

export function modeLabel(mode: AuthMenuViewModel['mode']): string {
  return mode === 'register' ? 'Create a wallet' : 'Unlock wallet';
}

export function passkeyButtonLabel(mode: AuthMenuViewModel['mode']): string {
  return mode === 'register' ? 'Create wallet with passkey' : 'Unlock with passkey';
}

/** The failure the footer strip reports. Only the menu itself reports there. */
export function menuNotice(viewModel: AuthMenuViewModel): string | null {
  if (viewModel.kind === 'google_otp_login' || viewModel.kind === 'google_registration') {
    return viewModel.error || null;
  }
  return viewModel.kind === 'passkey' &&
    viewModel.status.kind === 'recoverable' &&
    viewModel.status.reason === 'error'
    ? viewModel.status.message
    : null;
}

export function selectedLoginAccount(viewModel: AuthMenuLoginViewModel) {
  return resolveAuthMenuLoginAccount(viewModel.accountOptions, viewModel.selectedAccount)
    .selectedAccount;
}

export function selectedAccountPrimaryText(account: AuthMenuAccountOption): string {
  return account.walletId;
}

export function accountSecondaryText(account: AuthMenuAccountOption): string | null {
  return account.authMethod === 'email_otp' ? account.emailAddress : null;
}

export function savedAccountsTriggerLabel(account: AuthMenuAccountOption | null): string {
  if (!account) return 'Saved wallets';
  const emailAddress = accountSecondaryText(account);
  return emailAddress
    ? `Saved wallets. Selected wallet ID ${account.walletId}, email ${emailAddress}`
    : `Saved wallets. Selected ${account.walletId}`;
}

type AuthMenuAccountGroup = Readonly<{
  authMethod: AuthMenuAccountOption['authMethod'];
  label: 'Passkey' | 'Email OTP';
  accounts: readonly AuthMenuAccountOption[];
}>;

export function accountGroups(options: readonly AuthMenuAccountOption[]): AuthMenuAccountGroup[] {
  const passkeyAccounts = options.filter((option) => option.authMethod === 'passkey');
  const emailOtpAccounts = options.filter((option) => option.authMethod === 'email_otp');
  const groups: AuthMenuAccountGroup[] = [
    { authMethod: 'passkey', label: 'Passkey', accounts: passkeyAccounts },
    { authMethod: 'email_otp', label: 'Email OTP', accounts: emailOtpAccounts },
  ];
  return groups.filter((group) => group.accounts.length > 0);
}
