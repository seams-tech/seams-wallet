/**
 * Compile-time proof that the three-route commit receipt makes invalid
 * committed states unrepresentable.
 *
 * Every `@ts-expect-error` here fails the build if the union ever stops
 * rejecting that shape.
 */

import type {
  WalletRegistrationCommittedInstallationProjectionV1,
  WalletRegistrationSessionCommitReceiptV2,
} from './threeRouteRegistrationContracts';

type EcdsaReadyReceipt = Extract<
  WalletRegistrationSessionCommitReceiptV2,
  { readonly committed: { readonly kind: 'ecdsa_ready' } }
>;
type EcdsaReadyCommit = EcdsaReadyReceipt['committed'];
type MixedEcdsaReadyCommit = Extract<
  EcdsaReadyCommit,
  { readonly nearProvisioning: { readonly status: 'near_pending' } }
>;

declare const receiptEcdsa: EcdsaReadyCommit['ecdsa'];
declare const receiptSession: EcdsaReadyCommit['session'];
declare const committedInstallation: WalletRegistrationCommittedInstallationProjectionV1;
declare const mixedCommit: MixedEcdsaReadyCommit;

const requiredInstallation: WalletRegistrationCommittedInstallationProjectionV1 =
  mixedCommit.installation;

const missingCommittedInstallation = {
  kind: 'ecdsa_ready' as const,
  ecdsa: receiptEcdsa,
  session: receiptSession,
  nearProvisioning: { status: 'near_pending' } as const,
};
// @ts-expect-error Mixed ECDSA receipts require their committed installation projection.
const rejectedMissingInstallation: EcdsaReadyCommit = missingCommittedInstallation;

const invalidEcdsaOnlyProjection = {
  kind: 'ecdsa_ready' as const,
  ecdsa: receiptEcdsa,
  session: receiptSession,
  installation: committedInstallation,
};
// @ts-expect-error ECDSA-only receipts cannot carry a mixed installation projection.
const rejectedEcdsaOnlyProjection: EcdsaReadyCommit = invalidEcdsaOnlyProjection;

export const _threeRouteRequestFixtures = [
  requiredInstallation,
  rejectedMissingInstallation,
  rejectedEcdsaOnlyProjection,
] as const;
