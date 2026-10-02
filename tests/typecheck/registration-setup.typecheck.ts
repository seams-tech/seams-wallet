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
