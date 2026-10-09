import type { WalletRegistrationSetupSuccessV2 } from '../../packages/wallet/src/core/rpcClients/relayer/walletRegistration';
import type { WalletRegistrationSetupResponseV2 } from '../../packages/wallet-server/src/core/threeRouteRegistrationContracts';

declare const setup: WalletRegistrationSetupSuccessV2;
declare const withoutHome: Omit<WalletRegistrationSetupSuccessV2, 'home'>;
// @ts-expect-error A setup result must carry its routing home before session issuance.
const missingHome: WalletRegistrationSetupSuccessV2 = withoutHome;
const erasedHome: WalletRegistrationSetupSuccessV2 = {
  ...setup,
  // @ts-expect-error Spreading a setup result cannot erase its required home.
  home: undefined,
};
const invalidHome: WalletRegistrationSetupSuccessV2 = {
  ...setup,
  // @ts-expect-error A regional home requires a known region.
  home: { kind: 'regional', region: 'unknown' },
};
declare const serverSetup: Extract<WalletRegistrationSetupResponseV2, { ok: true }>;
const erasedServerHome: WalletRegistrationSetupResponseV2 = {
  ...serverSetup,
  // @ts-expect-error Server setup cannot omit routing metadata either.
  home: undefined,
};
void missingHome;
void erasedHome;
void invalidHome;
void erasedServerHome;

import type { PublishPendingWalletRegistrationCommitInputV1 } from '../../packages/wallet/src/core/indexedDB/seamsWalletDB/repositories';
type SessionPublication = PublishPendingWalletRegistrationCommitInputV1['walletSessionPublication'];
declare const issued: Extract<SessionPublication, { kind: 'issued' }>;
// @ts-expect-error A broad spread must not carry an operation credential into credential-free recovery.
const credentialInProjection: SessionPublication = {
  ...issued,
  kind: 'credential_free_projection',
};
void credentialInProjection;

import type { WalletRegistrationReservationAuthority } from '../../packages/wallet-server/src/router/domains/walletRegistration/walletRegistrationReservation';
type RegistrationCompletion = Parameters<WalletRegistrationReservationAuthority['complete']>[0];
declare const established: Extract<RegistrationCompletion, { outcome: 'established' }>;
declare const completionIdentity: Pick<RegistrationCompletion, 'ceremonyId' | 'walletId'>;
// @ts-expect-error Establishing a home requires the committed session locator.
const completionWithoutSession: RegistrationCompletion = {
  ...completionIdentity,
  outcome: 'established',
};
// @ts-expect-error Cancellation cannot publish a session, including through a broad spread.
const cancellationWithSession: RegistrationCompletion = { ...established, outcome: 'cancelled' };
void completionWithoutSession;
void cancellationWithSession;
