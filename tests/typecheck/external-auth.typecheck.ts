import type {
  WalletSession,
  WalletAuthenticationState,
} from '../../packages/wallet/src/core/types/seams';
import type {
  ExternalAuthenticateInput,
  ExternalWalletSettings,
} from '../../packages/shared-ts/src/auth/externalAuth';

declare const settings: ExternalWalletSettings;
declare const identity: Extract<WalletSession['appIdentity'], { kind: 'resolved' }>;
declare const capabilities: Extract<WalletSession['capabilityProjection'], { kind: 'resolved' }>;

const external: WalletSession = {
  appIdentity: identity,
  authentication: settings.authentication,
  capabilityProjection: { kind: 'not_requested' },
  externalSettings: settings,
  nonceDiagnostics: null,
};

// @ts-expect-error External identity evidence is not an owner authentication state.
const owner: WalletAuthenticationState = settings.authentication;

// @ts-expect-error A direct assertion cannot convert external identity evidence into owner authentication.
const assertedOwner = settings.authentication as WalletAuthenticationState;

// @ts-expect-error Direct construction cannot combine external authentication and signing capabilities.
const signing: WalletSession = {
  appIdentity: identity,
  authentication: settings.authentication,
  capabilityProjection: capabilities,
  externalSettings: settings,
  nonceDiagnostics: null,
};

// @ts-expect-error A spread cannot upgrade settings access into signing authority.
const spread: WalletSession = { ...external, capabilityProjection: capabilities };

// @ts-expect-error Handoff and Google proof branches cannot be combined.
const mixed: ExternalAuthenticateInput = {
  method: 'google',
  walletId: 'wallet:test',
  idToken: 'token',
  code: 'code',
  attemptId: 'attempt',
};

void [external, owner, assertedOwner, signing, spread, mixed];
