import type { registrationSetupRepository } from '../../packages/wallet/src/core/indexedDB/seamsWalletDB/registrationSetup';
import type { WalletId } from '../../packages/shared-ts/src/utils/domainIds';
import type { Variant } from '../../packages/shared-ts/src/utils/variant';
import type {
  WalletRegistrationSetupReservation,
  WalletRegistrationSetupReservationResult,
} from '../../packages/wallet-server/src/router/domains/walletRegistration/walletRegistrationReservation';

type SetupAttempt = Awaited<ReturnType<typeof registrationSetupRepository.begin>>;
declare const pending: Variant<SetupAttempt, 'state', 'pending'>;
declare const accepted: Variant<SetupAttempt, 'state', 'accepted'>;
declare const walletId: WalletId;

// @ts-expect-error A pending operation has no accepted wallet, including through spreads.
const pendingWithWallet: SetupAttempt = { ...pending, walletId };
// @ts-expect-error An accepted operation requires its exact ceremony.
const missingCeremony: SetupAttempt = {
  state: 'accepted',
  operationId: accepted.operationId,
  scopeDigest: accepted.scopeDigest,
  requestDigest: accepted.requestDigest,
  walletId,
};
// @ts-expect-error A response's wallet identity must already have passed boundary parsing.
const rawWallet: SetupAttempt = { ...accepted, walletId: 'unvalidated' };
// @ts-expect-error A direct literal cannot put a ceremony on a pending operation.
const pendingWithCeremony: SetupAttempt = {
  state: 'pending',
  operationId: pending.operationId,
  scopeDigest: pending.scopeDigest,
  requestDigest: pending.requestDigest,
  registrationCeremonyId: accepted.registrationCeremonyId,
};

void [pendingWithWallet, missingCeremony, rawWallet, pendingWithCeremony];

declare const reservation: WalletRegistrationSetupReservation;
declare const reserved: Variant<WalletRegistrationSetupReservationResult, 'ok', true>;
// @ts-expect-error Every admitted setup requires its authoritative lifecycle state.
const missingLifecycle: WalletRegistrationSetupReservationResult = { ok: true, reservation };
const cancelledAdmission: WalletRegistrationSetupReservationResult = {
  ...reserved,
  // @ts-expect-error Cancelled reservations cannot become executable setup admissions.
  lifecycle: 'cancelled',
};
// @ts-expect-error Failure cannot retain an executable reservation through a broad spread.
const failedAdmission: WalletRegistrationSetupReservationResult = {
  ...reserved,
  ok: false,
  code: 'cancelled',
  message: 'Cancelled',
};
void [missingLifecycle, cancelledAdmission, failedAdmission];

import type { WalletRegistrationReservationAuthority } from '../../packages/wallet-server/src/router/domains/walletRegistration/walletRegistrationReservation';
type HomeAdmission = Awaited<ReturnType<WalletRegistrationReservationAuthority['admitHome']>>;
// @ts-expect-error Successful admission must retain its ownership generation and purpose.
const admissionWithoutGeneration: HomeAdmission = { ok: true };
// @ts-expect-error Rejection cannot also grant an execution generation.
const mixedHomeAdmission: HomeAdmission = {
  ok: false,
  code: 'paused',
  message: 'Paused',
  ownershipGeneration: 1,
};
void admissionWithoutGeneration;
void mixedHomeAdmission;

import type { RouterAbEd25519YaoVerifiedActivationIntentV1 } from '../../packages/wallet-server/src/router/domains/ed25519Yao/registration/routerAbEd25519YaoRegistrationIntentAuthorization';

declare const verifiedActivationIntent: RouterAbEd25519YaoVerifiedActivationIntentV1;
declare const intentWithoutGeneration: Omit<
  RouterAbEd25519YaoVerifiedActivationIntentV1,
  'ownershipGeneration'
>;
// @ts-expect-error Verified intents require the authoritative ownership generation.
const missingIntentGeneration: RouterAbEd25519YaoVerifiedActivationIntentV1 =
  intentWithoutGeneration;
const erasedIntentGeneration: RouterAbEd25519YaoVerifiedActivationIntentV1 = {
  ...verifiedActivationIntent,
  // @ts-expect-error A broad spread cannot erase the execution generation.
  ownershipGeneration: undefined,
};
type EstablishedHomeAdmission = Awaited<
  ReturnType<WalletRegistrationReservationAuthority['admitEstablishedHome']>
>;
const registrationAuthorityForEstablishedWallet: EstablishedHomeAdmission = {
  ok: true,
  ownershipGeneration: 1,
  // @ts-expect-error An established wallet cannot receive registration-only execution authority.
  purpose: 'registration',
};
void [missingIntentGeneration, erasedIntentGeneration, registrationAuthorityForEstablishedWallet];

import type { RouterAbEd25519YaoRegistrationAuthorizationResult } from '../../packages/wallet-server/src/router/domains/ed25519Yao/registration/routerAbEd25519YaoRegistration';
// @ts-expect-error Successful execution authorization must carry an ownership generation.
const missingAuthorizedGeneration: RouterAbEd25519YaoRegistrationAuthorizationResult = { ok: true };
declare const authorizedRegistration: Extract<
  RouterAbEd25519YaoRegistrationAuthorizationResult,
  { ok: true }
>;
// @ts-expect-error A failure cannot retain execution authority through a broad spread.
const failedWithGeneration: RouterAbEd25519YaoRegistrationAuthorizationResult = {
  ...authorizedRegistration,
  ok: false,
  status: 403,
  code: 'denied',
  message: 'Denied',
};
void [missingAuthorizedGeneration, failedWithGeneration];

import type { RouterAbEd25519YaoRecoveryAuthorizationResult } from '../../packages/wallet-server/src/router/domains/ed25519Yao/recovery/routerAbEd25519YaoRecovery';
declare const authorizedRecovery: Extract<
  RouterAbEd25519YaoRecoveryAuthorizationResult,
  { ok: true }
>;
// @ts-expect-error Recovery credentials alone do not grant execution at a wallet home.
const recoveryWithoutHome: RouterAbEd25519YaoRecoveryAuthorizationResult = {
  ok: true,
  authorization: authorizedRecovery.authorization,
};
// @ts-expect-error A rejected recovery cannot retain ownership authority through a spread.
const rejectedRecoveryWithHome: RouterAbEd25519YaoRecoveryAuthorizationResult = {
  ...authorizedRecovery,
  ok: false,
  status: 409,
  code: 'wallet_paused',
  message: 'Paused',
};
void [recoveryWithoutHome, rejectedRecoveryWithHome];

import type { RouterAbEd25519YaoRecoveryAuthorizationInput } from '../../packages/wallet-server/src/router/domains/ed25519Yao/recovery/routerAbEd25519YaoRecovery';
type RecoveryExecutionAuthorization = Extract<
  RouterAbEd25519YaoRecoveryAuthorizationInput,
  { kind: 'execute' }
>;
declare const recoveryExecutionWithoutGeneration: Omit<
  RecoveryExecutionAuthorization,
  'ownershipGeneration'
>;
// @ts-expect-error Recovery execution requires the generation loaded from its admitted state.
const unpinnedRecoveryExecution: RecoveryExecutionAuthorization =
  recoveryExecutionWithoutGeneration;
void unpinnedRecoveryExecution;

import type {
  RouterAbEd25519YaoExportAdmissionAuthorizationResultV1,
  RouterAbEd25519YaoExportExecuteClaimV1,
} from '../../packages/wallet-server/src/router/domains/ed25519Yao/export/routerAbEd25519YaoExport';
declare const authorizedExport: Extract<
  RouterAbEd25519YaoExportAdmissionAuthorizationResultV1,
  { ok: true }
>;
// @ts-expect-error An export owner proof also requires admission at its wallet home.
const exportWithoutHome: RouterAbEd25519YaoExportAdmissionAuthorizationResultV1 = {
  ok: true,
  authorizationIdentity: authorizedExport.authorizationIdentity,
  admission: authorizedExport.admission,
};
// @ts-expect-error A rejected export cannot retain ownership authority through a spread.
const rejectedExportWithHome: RouterAbEd25519YaoExportAdmissionAuthorizationResultV1 = {
  ...authorizedExport,
  ok: false,
  status: 409,
  code: 'wallet_paused',
  message: 'Paused',
};
declare const exportClaimWithoutGeneration: Omit<
  RouterAbEd25519YaoExportExecuteClaimV1,
  'ownershipGeneration'
>;
// @ts-expect-error Export execution must carry its stored admission generation.
const unpinnedExportExecution: RouterAbEd25519YaoExportExecuteClaimV1 =
  exportClaimWithoutGeneration;
void [exportWithoutHome, rejectedExportWithHome, unpinnedExportExecution];
