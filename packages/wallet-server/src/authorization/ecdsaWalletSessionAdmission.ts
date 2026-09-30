import type { EcdsaMaterialReadSnapshot } from '../core/ecdsaMaterialReadSnapshot';
import type { CapabilityOperationEnvelope } from '@shared/authorization/operationFingerprint';
import type { Variant } from '@shared/utils/variant';
import type { AuthorizedOperation, AuthorizedOperationInput } from './domain';
import type { AuthorizedOperationAdmissionRejection, EcdsaMaterialActivationScope } from './service';

export type EcdsaWalletSessionAdmissionInput = {
  readonly operation: AuthorizedOperationInput & {
    readonly operation: CapabilityOperationEnvelope<{
      readonly capabilityKind: 'evm_ecdsa_mpc_signing';
      readonly operationKind: 'evm.sign_transaction';
    }>;
    readonly authorization: { readonly kind: 'authorization_grant' };
    readonly quota: { readonly kind: 'consume_reusable_wallet_session' };
  };
  readonly material: EcdsaMaterialActivationScope & { readonly readSnapshot: EcdsaMaterialReadSnapshot };
};

export type PinnedOwnerWalletScope = {
  readonly orgId: string;
  readonly projectId: string;
  readonly projectEnvironmentId: string;
};

type EcdsaWalletSessionExistingOperation =
  | {
      readonly kind: 'operation_in_progress';
      readonly operation: AuthorizedOperation;
      readonly ownerScope: PinnedOwnerWalletScope;
    }
  | {
      readonly kind: 'replayed';
      readonly operation: AuthorizedOperation;
      readonly ownerScope?: never;
    };

type EcdsaWalletSessionAdmission = EcdsaWalletSessionExistingOperation
  | {
      readonly kind: 'claimed';
      readonly operation: AuthorizedOperation;
      readonly ownerScope: PinnedOwnerWalletScope;
    };

export type EcdsaWalletSessionAdmissionVariant<K extends EcdsaWalletSessionAdmission['kind']> =
  Variant<EcdsaWalletSessionAdmission, 'kind', K>;

export type EcdsaWalletSessionResolutionResult = EcdsaWalletSessionExistingOperation
  | ((AuthorizedOperationAdmissionRejection | { readonly kind: 'authorized_operation_missing' }) & {
      readonly operation?: never;
      readonly ownerScope?: never;
    });

export type EcdsaWalletSessionAdmissionResult = EcdsaWalletSessionAdmission
  | (AuthorizedOperationAdmissionRejection & {
      readonly operation?: never;
      readonly ownerScope?: never;
    });

export type EcdsaWalletSessionPhaseAdmission =
  | { readonly phase: 'prepare'; readonly admission: EcdsaWalletSessionAdmission }
  | { readonly phase: 'finalize'; readonly admission: EcdsaWalletSessionExistingOperation };
