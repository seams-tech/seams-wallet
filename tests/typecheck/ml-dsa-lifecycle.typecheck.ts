import type { Variant } from '../../packages/shared-ts/src/utils/variant';
import type {
  MlDsaSignerInventoryEntry,
  MlDsaInventoryPreparation,
  MlDsaInventoryPreparationOutcome,
} from '../../packages/shared-ts/src/near/mlDsaInventory';
import {
  resumeMlDsaNearEnrollment,
  type MlDsaNearEnrollmentOutcome,
} from '../../packages/wallet/src/core/signingEngine/walletCustody/mlDsaEnrollment';
import type { AddMlDsaNearSignerOutcome } from '../../packages/wallet/src/SeamsWeb/operations/registration/mlDsaNearSigner';

declare const unpublished: Variant<MlDsaSignerInventoryEntry, 'kind', 'unpublished'>;
declare const published: Variant<MlDsaSignerInventoryEntry, 'kind', 'published'>;
// @ts-expect-error A published signer cannot retain an unpublished phase through a spread.
const mixedInventory: MlDsaSignerInventoryEntry = {
  ...unpublished,
  kind: 'published',
  key: published.key,
};
void mixedInventory;
// @ts-expect-error An unpublished signer cannot carry a published key.
const mixedDirectInventory: MlDsaSignerInventoryEntry = {
  kind: 'unpublished',
  signingKeyId: unpublished.signingKeyId,
  phase: 'installed',
  key: published.key,
};
void mixedDirectInventory;

declare const preparation: MlDsaInventoryPreparation;
declare const preparationWithSeed: Omit<MlDsaInventoryPreparation, 'walletCustodySeed'> & {
  readonly walletCustodySeed: Uint8Array;
};
// @ts-expect-error Structural assignment cannot attach a seed to inventory approval.
const seededInventory: MlDsaInventoryPreparation = preparationWithSeed;
void seededInventory;
const sharedInventory: MlDsaInventoryPreparation = {
  ...preparation,
  // @ts-expect-error Inventory approval carries no private signing material, including in spreads.
  holderShare: new Uint8Array(32),
};
void sharedInventory;

declare const issuedInventory: Variant<MlDsaInventoryPreparationOutcome, 'kind', 'prepared'>;
// @ts-expect-error Refusal cannot retain issued-challenge fields through a spread.
const refusedWithChallenge: MlDsaInventoryPreparationOutcome = { ...issuedInventory, kind: 'refused', code: 'unauthorized', message: 'refused' };
void refusedWithChallenge;

declare const pending: Variant<MlDsaNearEnrollmentOutcome, 'kind', 'pending'>;
// @ts-expect-error Confirmed enrollment cannot retain a pending continuation.
const mixedEnrollment: MlDsaNearEnrollmentOutcome = {
  ...pending,
  kind: 'enrolled',
  publicKey: 'key',
};
void mixedEnrollment;
// @ts-expect-error Pending enrollment requires its exact read-only continuation.
const missingContinuation: MlDsaNearEnrollmentOutcome = { kind: 'pending', reason: 'not_final' };
void missingContinuation;
declare const resume: Parameters<typeof resumeMlDsaNearEnrollment>[0];
declare const signingPort: NonNullable<
  Parameters<
    typeof import('../../packages/wallet/src/core/signingEngine/walletCustody/mlDsaEnrollment').enrollMlDsaNearSigner
  >[0]['near']
>;
const resumeWithSigner = { ...resume, near: signingPort };
// @ts-expect-error Resume cannot accept a submission port through structural assignment.
void resumeMlDsaNearEnrollment(resumeWithSigner);

declare const added: Variant<AddMlDsaNearSignerOutcome, 'kind', 'published'>;
// @ts-expect-error Failed registration cannot retain a published signer or enrollment state.
const failedWithPublishedKey: AddMlDsaNearSignerOutcome = {
  ...added,
  kind: 'registration_failed',
  message: 'failed',
};
void failedWithPublishedKey;
