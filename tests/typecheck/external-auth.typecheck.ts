import type {
  WalletSession,
  WalletAuthenticationState,
} from '../../packages/wallet/src/core/types/seams';
import type {
  ExternalAuthenticateInput,
  ExternalWalletSettings,
  ExternalAuthConfiguration,
  ExternalAuthProvider,
  ExternalIdentity,
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

declare const applicationPublicKey: Extract<ExternalAuthProvider, { kind: 'application' }>['publicKeyB64u'];

declare const googleProvider: Extract<ExternalAuthProvider, { kind: 'google' }>;
declare const applicationIdentity: Extract<ExternalIdentity, { provider: 'application' }>;

// @ts-expect-error An application verifier cannot also carry a Google client ID.
const mixedProvider: ExternalAuthConfiguration = { kind: 'application', revision: 1, issuer: 'https://app.example', publicKeyB64u: applicationPublicKey, clientId: 'google-client' };

// @ts-expect-error A spread cannot add an application verifier to a Google provider.
const spreadProvider: ExternalAuthProvider = { ...googleProvider, issuer: 'https://app.example', publicKeyB64u: applicationPublicKey };

// @ts-expect-error Application identity cannot be asserted into a Google identity.
const assertedGoogle = applicationIdentity as Extract<ExternalIdentity, { provider: 'google' }>;

void [mixedProvider, spreadProvider, assertedGoogle];

import type { ExternalAuthStore } from '../../packages/wallet-server/src/auth/externalAuthStore';
import type { PreparedAuthorizedOperationAdmission } from '../../packages/wallet-server/src/authorization/service';

declare const commit: Parameters<ExternalAuthStore['commitOwnerOperation']>[0];
declare const replay: Extract<PreparedAuthorizedOperationAdmission, { kind: 'replayed' }>;
declare const rejection: Exclude<
  PreparedAuthorizedOperationAdmission,
  { kind: 'prepared' | 'replayed' | 'operation_in_progress' }
>;

// @ts-expect-error A stored replay cannot execute the association mutation again.
const replayedCommit: typeof commit = { ...commit, admission: replay };
// @ts-expect-error A rejected admission cannot become a prepared batch through a cast.
const rejectedAdmission = rejection as typeof commit.admission;
const replayFields = { operation: replay.operation };
// Prepared admission contains SQL statements, never a replay result.
// @ts-expect-error Direct construction must carry prepared statements.
const missingStatements: typeof commit.admission = { kind: 'prepared', ...replayFields };
void [replayedCommit, rejectedAdmission, missingStatements];
