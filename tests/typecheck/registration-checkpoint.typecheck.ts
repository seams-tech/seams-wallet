import type { WalletCustodyCeremonyWorkerOperationMap } from '../../packages/wallet/src/core/signingEngine/workerManager/workerTypes';

type RestoreRequest = WalletCustodyCeremonyWorkerOperationMap['restoreNearRegistration']['payload'];

const restore: RestoreRequest = {
  ceremonyId: 'registration-checkpoint',
  custodyJson: '{}',
  factorSecret: new ArrayBuffer(32),
  checkpointJson: '{}',
};

// @ts-expect-error ciphertext alone cannot reopen wallet custody.
const withoutFactor: RestoreRequest = {
  ceremonyId: restore.ceremonyId,
  custodyJson: restore.custodyJson,
  checkpointJson: restore.checkpointJson,
};

const withSeed = { ...restore, walletCustodySeed: new ArrayBuffer(32) };
// @ts-expect-error broad spreads cannot substitute a plaintext custody seed.
const suppliedSeed: RestoreRequest = withSeed;

const withRecipientKey = { ...restore, recipientPrivateKey: new ArrayBuffer(32) };
// @ts-expect-error restoration never accepts an unsealed recipient private key.
const suppliedRecipientKey: RestoreRequest = withRecipientKey;

const withFreshPreparation = { ...restore, protocolInputsJson: '{}' };
// @ts-expect-error a restored request cannot carry instructions for a fresh exchange.
const freshPreparation: RestoreRequest = withFreshPreparation;

void [withoutFactor, suppliedSeed, suppliedRecipientKey, freshPreparation];

import type {
  PendingWalletRegistrationCommitV1,
  PendingNearRegistrationContinuationV1,
} from '../../packages/wallet/src/core/indexedDB/pendingWalletRegistrationCommit';
declare const planned: Extract<
  PendingNearRegistrationContinuationV1,
  { readonly phase: 'planned' }
>;
declare const prepared: Extract<
  PendingNearRegistrationContinuationV1,
  { readonly phase: 'execution_prepared' }
>;
declare const joined: Extract<PendingWalletRegistrationCommitV1, { readonly phase: 'joined' }>;
declare const mixed: Extract<
  PendingWalletRegistrationCommitV1,
  {
    readonly operation: 'registration_activate';
    readonly signerPlanKind: 'near_ed25519_and_evm_family_ecdsa';
  }
>;

const leakedMaterial = { ...planned, localMaterial: joined.localMaterial };
// @ts-expect-error Planned NEAR has no joined material, even via a broad spread.
const invalidPlanned: PendingWalletRegistrationCommitV1 = leakedMaterial;
const leakedCheckpoint = { ...mixed, checkpointJson: prepared.checkpointJson };
// @ts-expect-error EVM activation never owns the NEAR completion checkpoint.
const invalidMixed: PendingWalletRegistrationCommitV1 = leakedCheckpoint;
const missingCheckpoint = { ...prepared, checkpointJson: undefined };
// @ts-expect-error Prepared execution cannot exist without its encrypted completion state.
const invalidPrepared: PendingWalletRegistrationCommitV1 = missingCheckpoint;
const joinedWithCheckpoint = { ...joined, checkpointJson: prepared.checkpointJson };
// @ts-expect-error A joined record cannot retain the prepared-state branch.
const invalidJoined: PendingWalletRegistrationCommitV1 = joinedWithCheckpoint;
void [invalidPlanned, invalidMixed, invalidPrepared, invalidJoined];

import type {
  IssuedWalletSessionAuthorizationV2,
  LiveWalletSessionAuthorizationProjectionV2,
} from '../../packages/wallet-server/src/authorization/domain';

declare const observedRegistrationSession: LiveWalletSessionAuthorizationProjectionV2;
// @ts-expect-error A live authorization projection may have an exhausted quota.
const reusableRegistrationAllowance: IssuedWalletSessionAuthorizationV2 =
  observedRegistrationSession;
// @ts-expect-error Spreading a projection cannot turn it into reusable signing authority.
const spreadRegistrationAllowance: IssuedWalletSessionAuthorizationV2 = {
  ...observedRegistrationSession,
};
void reusableRegistrationAllowance;
void spreadRegistrationAllowance;
