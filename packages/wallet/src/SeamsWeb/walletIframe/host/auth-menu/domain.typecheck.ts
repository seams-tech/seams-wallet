import type { AppearanceConfig } from '@/core/types/seams';
import type {
  AuthMenuAccountOption,
  AuthMenuLoginAccountResolution,
  AuthMenuRecoveryViewModel,
} from './domain';
import type {
  LocalWalletAuthMethodProjectionV2,
  WalletAuthMethodLocalPresentationV1,
} from '@/core/indexedDB/passkeyClientDB.types';
import type { WalletRecoveryTargetV1 } from '@shared/wallet-recovery/walletRecoveryTarget';

declare const appearance: AppearanceConfig;

const recoveryCommon = {
  kind: 'recovery' as const,
  mode: 'login' as const,
  appearance,
  hostname: 'wallet.example.test',
  closeLabel: 'Close',
  heading: 'Recover account',
  subtitle: 'Recover this wallet.',
  ctaLabel: 'Continue',
  showProgress: true,
  enabledExternalProviders: [],
  recoveryCode: '',
  recoveryCodeError: null,
};

const preparing: AuthMenuRecoveryViewModel = {
  ...recoveryCommon,
  stage: 'preparing',
  target: { kind: 'google_email_otp', googleProvider: 'google' } satisfies WalletRecoveryTargetV1,
  status: { kind: 'busy', headline: 'Checking recovery code…' },
};

// @ts-expect-error The code-entry state cannot carry a server-resolved wallet.
const invalidEntryWalletIdentity: AuthMenuRecoveryViewModel = {
  ...recoveryCommon,
  stage: 'enter_code',
  walletId: 'wallet.test',
  status: { kind: 'idle', interaction: 'actionable' },
};

// @ts-expect-error Code entry cannot carry an in-flight status.
const invalidCodeEntry: AuthMenuRecoveryViewModel = {
  ...recoveryCommon,
  stage: 'enter_code',
  status: { kind: 'busy', headline: 'Checking recovery code…' },
};

// @ts-expect-error Finalization retry must stay recoverable until retried.
const invalidFinalization: AuthMenuRecoveryViewModel = {
  ...recoveryCommon,
  stage: 'finalizing',
  status: { kind: 'idle', interaction: 'actionable' },
};

const discoverableLogin: AuthMenuLoginAccountResolution = {
  kind: 'discoverable',
  selectedAccount: null,
  loginTarget: { kind: 'discoverable' },
};

// @ts-expect-error Passkey account options cannot carry Email OTP presentation data.
const invalidPasskeyAccountOption: AuthMenuAccountOption = {
  walletId: 'wallet.test',
  authMethod: 'passkey',
  emailAddress: 'owner@example.test',
};

// @ts-expect-error Email OTP account options must represent email availability explicitly.
const invalidEmailAccountOption: AuthMenuAccountOption = {
  walletId: 'wallet.test',
  authMethod: 'email_otp',
};

const invalidPasskeyPresentation: WalletAuthMethodLocalPresentationV1 = {
  version: 'wallet_auth_method_local_presentation_v1',
  kind: 'passkey',
  // @ts-expect-error Passkey presentation cannot carry an email state.
  email: { kind: 'unavailable' },
};

// @ts-expect-error Email OTP presentation must represent email availability explicitly.
const invalidEmailPresentation: WalletAuthMethodLocalPresentationV1 = {
  version: 'wallet_auth_method_local_presentation_v1',
  kind: 'email_otp',
};

declare const passkeyRecord: Extract<
  LocalWalletAuthMethodProjectionV2,
  { readonly kind: 'passkey' }
>['record'];
declare const emailPresentation: Extract<
  WalletAuthMethodLocalPresentationV1,
  { readonly kind: 'email_otp' }
>;

// @ts-expect-error A passkey projection cannot carry Email OTP presentation metadata.
const invalidAuthMethodProjection: LocalWalletAuthMethodProjectionV2 = {
  kind: 'passkey',
  record: passkeyRecord,
  presentation: emailPresentation,
};

// @ts-expect-error A discoverable login cannot carry a selected wallet.
const invalidDiscoverableLogin: AuthMenuLoginAccountResolution = {
  kind: 'discoverable',
  selectedAccount: {
    walletId: 'wallet.test',
    authMethod: 'passkey' as const,
  },
  loginTarget: { kind: 'discoverable' },
};

// @ts-expect-error A resolved auth-method branch requires its exact wallet target.
const invalidResolvedLogin: AuthMenuLoginAccountResolution = {
  kind: 'passkey_and_email_otp',
  selectedAccount: {
    walletId: 'wallet.test',
    authMethod: 'passkey' as const,
  },
  walletId: 'wallet.test',
  loginTarget: { kind: 'discoverable' },
};

void preparing;
void invalidEntryWalletIdentity;
void invalidCodeEntry;
void invalidFinalization;
void discoverableLogin;
void invalidPasskeyAccountOption;
void invalidEmailAccountOption;
void invalidPasskeyPresentation;
void invalidEmailPresentation;
void invalidAuthMethodProjection;
void invalidDiscoverableLogin;
void invalidResolvedLogin;
