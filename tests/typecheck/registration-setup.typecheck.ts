import type { registrationSetupRepository } from '../../packages/wallet/src/core/indexedDB/seamsWalletDB/registrationSetup';
import type { WalletId } from '../../packages/shared-ts/src/utils/domainIds';
import type { Variant } from '../../packages/shared-ts/src/utils/variant';

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
