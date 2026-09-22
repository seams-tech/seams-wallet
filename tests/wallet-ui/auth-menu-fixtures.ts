import type {
  AuthMenuLinkDeviceState,
  AuthMenuLoginViewModel,
  AuthMenuRegisterViewModel,
  AuthMenuViewModel,
} from '@/SeamsWeb/walletIframe/host/auth-menu/domain';
import { parseWalletRecoveryTargetV1 } from '@shared/wallet-recovery/walletRecoveryTarget';
import QRCode from 'qrcode';

export type AuthMenuTheme = 'light' | 'dark';

export function registration(theme: AuthMenuTheme): AuthMenuRegisterViewModel {
  return {
    appearance: { theme: { id: 'default', mode: theme, colors: {} }, palette: 'default' },
    hostname: 'wallet.example.test',
    closeLabel: 'Close authentication menu',
    heading: 'Create your passkey',
    subtitle: 'Use a passkey to create your wallet.',
    ctaLabel: 'Create passkey',
    showProgress: true,
    kind: 'passkey',
    mode: 'register',
    showRegistrationInput: true,
    passkeyNameReadOnly: false,
    passkeyNameLabel: 'Passkey name',
    passkeyName: 'Visual fixture',
    enabledExternalProviders: ['google'],
    status: { kind: 'idle', interaction: 'actionable' },
  };
}

export function authBranchFixtures(
  theme: AuthMenuTheme,
): { name: string; model: AuthMenuViewModel }[] {
  const display: Pick<
    AuthMenuLoginViewModel,
    'appearance' | 'hostname' | 'closeLabel' | 'heading' | 'subtitle' | 'ctaLabel' | 'showProgress'
  > = {
    appearance: { theme: { id: 'default', mode: theme, colors: {} }, palette: 'default' },
    hostname: 'wallet.example.test',
    closeLabel: 'Close authentication menu',
    heading: 'Sign in',
    subtitle: 'Use your passkey to continue.',
    ctaLabel: 'Continue with passkey',
    showProgress: true,
  };
  const login: AuthMenuLoginViewModel = {
    ...display,
    kind: 'passkey',
    mode: 'login',
    enabledExternalProviders: ['google'],
    accountOptions: [],
    selectedAccount: null,
    status: { kind: 'idle', interaction: 'actionable' },
  };
  const passkeyTarget = parseWalletRecoveryTargetV1({ kind: 'passkey', rpId: 'example.test' });
  if (passkeyTarget.kind !== 'passkey') throw new Error('Expected a passkey recovery fixture');
  const recoveryDisplay = {
    ...display,
    heading: 'Recover account',
    subtitle: 'Restore access to your wallet.',
    ctaLabel: 'Continue',
    recoveryCode: '',
    recoveryCodeError: null,
  };
  const deviceStates: { name: string; state: AuthMenuLinkDeviceState }[] = [
    {
      name: 'factor-passkey',
      state: { kind: 'select_factor', targetFactor: { kind: 'passkey_prf' } },
    },
    {
      name: 'factor-email',
      state: {
        kind: 'select_factor',
        targetFactor: { kind: 'email_otp' },
        targetEmail: 'fixture@example.test',
      },
    },
    { name: 'loading', state: { kind: 'loading', message: 'Preparing a one-time code…' } },
    {
      name: 'qr-ready',
      state: {
        kind: 'ready',
        qrCodeDataURL: syntheticDeviceQr(),
        message: 'Waiting for device to scan',
      },
    },
    {
      name: 'passkey-required',
      state: { kind: 'passkey_required', message: 'Create a passkey on this device.' },
    },
    {
      name: 'creating-passkey',
      state: { kind: 'creating_passkey', message: 'Creating your passkey…' },
    },
    {
      name: 'email-otp',
      state: {
        kind: 'email_otp_required',
        otpCode: '123456',
        state: {
          kind: 'code_input',
          maskedEmailHint: 'f***@example.test',
          expiresAtMs: 4102444800000,
          resendAvailableAtMs: 0,
        },
      },
    },
    { name: 'expired', state: { kind: 'expired', message: 'This code has expired.' } },
    { name: 'cancelled', state: { kind: 'cancelled', message: 'Device linking was cancelled.' } },
    { name: 'error', state: { kind: 'error', message: 'Unable to link this device.' } },
  ];
  const deviceFixtures: { name: string; model: AuthMenuViewModel }[] = [];
  for (const { name, state } of deviceStates) {
    deviceFixtures.push({
      name: `device-${name}`,
      model: {
        ...display,
        kind: 'link_device',
        mode: 'login',
        heading: 'Scan and link device',
        subtitle: 'Scan this code with your other device.',
        ctaLabel: '',
        linkDevice: state,
        status: { kind: 'idle', interaction: 'actionable' },
      },
    });
  }
  return [
    ...deviceFixtures,
    {
      name: 'recovery-preparing',
      model: {
        ...recoveryDisplay,
        kind: 'recovery',
        mode: 'login',
        stage: 'preparing',
        target: passkeyTarget,
        status: { kind: 'busy', headline: 'Checking recovery code…' },
      },
    },
    {
      name: 'recovery-passkey-ready',
      model: {
        ...recoveryDisplay,
        kind: 'recovery',
        mode: 'login',
        stage: 'passkey_ready',
        target: passkeyTarget,
        walletId: 'visual-fixture.testnet',
        ctaLabel: 'Create new passkey',
        status: { kind: 'idle', interaction: 'actionable' },
      },
    },
    {
      name: 'recovery-google-ready',
      model: {
        ...recoveryDisplay,
        kind: 'recovery',
        mode: 'login',
        stage: 'google_ready',
        target: { kind: 'google_email_otp', googleProvider: 'google' },
        walletId: 'visual-fixture.testnet',
        ctaLabel: 'Continue with Google',
        status: { kind: 'idle', interaction: 'actionable' },
      },
    },
    {
      name: 'recovery-email-code',
      model: {
        ...recoveryDisplay,
        kind: 'recovery',
        mode: 'login',
        stage: 'email_code_required',
        target: { kind: 'google_email_otp', googleProvider: 'google' },
        walletId: 'visual-fixture.testnet',
        challengeId: 'synthetic-recovery-challenge',
        emailHint: 'f***@example.test',
        delivery: { kind: 'provider', status: 'sent', emailHint: 'f***@example.test' },
        otpCode: '123456',
        status: { kind: 'idle', interaction: 'actionable' },
      },
    },
    {
      name: 'recovery-finalizing',
      model: {
        ...recoveryDisplay,
        kind: 'recovery',
        mode: 'login',
        stage: 'finalizing',
        target: passkeyTarget,
        walletId: 'visual-fixture.testnet',
        status: { kind: 'busy', headline: 'Finishing recovery…' },
      },
    },
    {
      name: 'recovery-invalid-code',
      model: {
        ...recoveryDisplay,
        kind: 'recovery',
        mode: 'login',
        stage: 'enter_code',
        recoveryCode: 'TEST-ONLY-INVALID',
        recoveryCodeError: 'Check this recovery code and try again.',
        status: { kind: 'idle', interaction: 'actionable' },
      },
    },
    { name: 'login-discoverable', model: login },
    {
      name: 'login-accounts',
      model: {
        ...login,
        accountOptions: [
          { walletId: 'visual-fixture.testnet', authMethod: 'passkey' },
          {
            walletId: 'visual-fixture.testnet',
            authMethod: 'email_otp',
            emailAddress: 'fixture@example.test',
          },
        ],
        selectedAccount: { walletId: 'visual-fixture.testnet', authMethod: 'passkey' },
      },
    },
    {
      name: 'google-otp',
      model: {
        ...display,
        kind: 'google_otp_login',
        mode: 'login',
        heading: 'Verify your email',
        subtitle: 'Enter the code we sent.',
        ctaLabel: 'Verify',
        walletId: 'visual-fixture.testnet',
        emailHint: 'f***@example.test',
        challengeId: 'synthetic-visual-challenge',
        prompt: {
          title: 'Verify your email',
          description: 'Enter the code we sent.',
          submitLabel: 'Verify',
          helperText: '',
        },
        delivery: { kind: 'provider', status: 'sent', emailHint: 'f***@example.test' },
        otpCode: '123456',
        resendBusy: false,
        submitBusy: false,
        status: { kind: 'idle', interaction: 'actionable' },
      },
    },
    {
      name: 'google-registration',
      model: {
        ...display,
        kind: 'google_registration',
        mode: 'register',
        heading: 'Create your wallet',
        subtitle: 'Continue with your Google account.',
        ctaLabel: 'Create wallet',
        walletId: 'visual-fixture.testnet',
        emailHint: 'f***@example.test',
        prompt: {
          title: 'Create your wallet',
          description: 'Continue with your Google account.',
          submitLabel: 'Create wallet',
          helperText: '',
        },
        rerollBusy: false,
        submitBusy: false,
        status: { kind: 'idle', interaction: 'actionable' },
      },
    },
    {
      name: 'recovery-entry',
      model: {
        ...display,
        kind: 'recovery',
        mode: 'login',
        heading: 'Recover account',
        subtitle: 'Enter a recovery code to recover your wallet.',
        ctaLabel: 'Continue',
        stage: 'enter_code',
        recoveryCode: '',
        recoveryCodeError: null,
        status: { kind: 'idle', interaction: 'awaiting_input' },
      },
    },
    {
      name: 'recovery-sign-in-ready',
      model: {
        ...display,
        kind: 'recovery',
        mode: 'login',
        heading: 'Recover account',
        subtitle: 'Your Google account is ready to sign in.',
        ctaLabel: 'Sign in with Google',
        stage: 'sign_in_ready',
        target: { kind: 'google_email_otp', googleProvider: 'google' },
        walletId: 'visual-fixture.testnet',
        recoveryCode: '',
        recoveryCodeError: null,
        status: { kind: 'idle', interaction: 'actionable' },
      },
    },
    {
      name: 'device-activation',
      model: {
        ...display,
        kind: 'link_device',
        mode: 'login',
        linkDevice: { kind: 'activating', message: 'Preparing this device for signing' },
        status: { kind: 'idle', interaction: 'arming' },
      },
    },
    {
      name: 'device-activation-error',
      model: {
        ...display,
        kind: 'link_device',
        mode: 'login',
        linkDevice: { kind: 'activation_error', message: 'Synthetic wallet session renewal error' },
        status: { kind: 'idle', interaction: 'actionable' },
      },
    },
  ];
}

function syntheticDeviceQr(): string {
  const { modules } = QRCode.create('https://example.test/visual-only-device-link');
  const pixels: string[] = [];
  for (let row = 0; row < modules.size; row += 1) {
    for (let column = 0; column < modules.size; column += 1) {
      if (modules.get(row, column))
        pixels.push(`<rect x="${column + 4}" y="${row + 4}" width="1" height="1"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${modules.size + 8} ${modules.size + 8}"><rect width="100%" height="100%" fill="white"/><g fill="black">${pixels.join('')}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
