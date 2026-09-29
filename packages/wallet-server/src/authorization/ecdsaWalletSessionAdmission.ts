import type { CapabilityOperationEnvelope } from '@shared/authorization/operationFingerprint';
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
  readonly material: EcdsaMaterialActivationScope;
};

export type PinnedOwnerWalletScope = {
  readonly orgId: string;
  readonly projectId: string;
  readonly projectEnvironmentId: string;
};

export type EcdsaWalletSessionAdmission =
  | {
      readonly kind: 'claimed' | 'operation_in_progress';
      readonly operation: AuthorizedOperation;
      readonly ownerScope: PinnedOwnerWalletScope;
    }
  | {
      readonly kind: 'replayed';
      readonly operation: AuthorizedOperation;
      readonly ownerScope?: never;
    };

export type EcdsaWalletSessionAdmissionResult = EcdsaWalletSessionAdmission
  | (AuthorizedOperationAdmissionRejection & {
      readonly operation?: never;
      readonly ownerScope?: never;
    });
