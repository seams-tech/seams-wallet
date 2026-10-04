import type { WalletId } from '@shared/utils/registrationIntent';
import type { D1WalletAddSignerFinalizePreparedV1 } from './d1WalletAddSignerFinalizeRecord';
import type { WalletAddSignerEcdsaActivationRequest } from '../../../../core/registrationContracts';

declare const walletId: WalletId;
declare const activationCommit: WalletAddSignerEcdsaActivationRequest;

const activationCommitWithoutCanonicalDigest = {
  addSignerCeremonyId: activationCommit.addSignerCeremonyId,
  // @ts-expect-error Add-signer activation commit requires the canonical command digest.
  ecdsa: {
    kind: activationCommit.ecdsa.kind,
    activationCorrelationId: activationCommit.ecdsa.activationCorrelationId,
    publicFacts: activationCommit.ecdsa.publicFacts,
  },
} satisfies WalletAddSignerEcdsaActivationRequest;

const activationCommitWithBrowserOwnedMaterial = {
  ...activationCommit,
  ecdsa: {
    ...activationCommit.ecdsa,
    // @ts-expect-error The public activation request cannot choose Router-owned material identity.
    materialActivation: {},
  },
} satisfies WalletAddSignerEcdsaActivationRequest;

const validEd25519FinalizePrepared = {
  walletId,
  kind: 'd1_wallet_add_signer_finalize_ed25519_prepared_v1',
  finalizingAtMs: 1,
} satisfies D1WalletAddSignerFinalizePreparedV1;

const validEcdsaFinalizePrepared = {
  walletId,
  kind: 'd1_wallet_add_signer_finalize_ecdsa_prepared_v1',
  signerWriteAtMs: 1,
} satisfies D1WalletAddSignerFinalizePreparedV1;

const mixedFinalizeFields = { ...validEcdsaFinalizePrepared, finalizingAtMs: 1 };
// @ts-expect-error A prepared claim has exactly one curve's timing state.
const mixedFinalize: D1WalletAddSignerFinalizePreparedV1 = mixedFinalizeFields;

// @ts-expect-error Persisted claims retain their wallet after ceremony cleanup.
const unownedFinalize: D1WalletAddSignerFinalizePreparedV1 = {
  kind: 'd1_wallet_add_signer_finalize_ecdsa_prepared_v1',
  signerWriteAtMs: 1,
};

void validEd25519FinalizePrepared;
void validEcdsaFinalizePrepared;
void mixedFinalize;
void unownedFinalize;
void activationCommitWithoutCanonicalDigest;
void activationCommitWithBrowserOwnedMaterial;
