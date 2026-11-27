import type { Ed25519ReusableAuthorizedOperationReceipt } from './ed25519AuthorizedOperationReceipt';
import type { AuthorizedOperation } from '../../../authorization/domain';

export type AuthorizedOperationBindingWire =
  | {
      readonly kind: 'reusable_wallet_session';
      readonly authorization_id: string;
      readonly wallet_session_id: string;
      readonly quota_id: string;
    }
  | {
      readonly kind: 'gateway_owner_wallet_session';
      readonly ownership_generation: number;
      readonly subject_id: string;
      readonly account_id: string;
      readonly authorization_id: string;
      readonly wallet_session_id: string;
      readonly quota_id: string;
      readonly threshold_session_id: string;
      readonly org_id: string;
      readonly project_id: string;
      readonly environment: string;
      readonly project_environment_id: string;
      readonly signing_worker_id: string;
      readonly expires_at_ms: number;
    }
  | {
      readonly kind: 'operation_step_up';
      readonly ownership_generation: number;
      readonly authorization_session_id: string;
      readonly org_id: string;
      readonly project_id: string;
      readonly environment: string;
      readonly project_environment_id: string;
      readonly subject_id: string;
      readonly account_id: string;
    };

export type AuthorizedOperationWireInput =
  | {
      readonly operation: AuthorizedOperation;
      readonly binding: {
        readonly kind: 'reusable_wallet_session';
        readonly walletSessionId: string;
        readonly quotaId: string;
      };
    }
  | {
      readonly operation: AuthorizedOperation;
      readonly binding: {
        readonly kind: 'gateway_owner_wallet_session';
        readonly ownershipGeneration: number;
        readonly subjectId: string;
        readonly accountId: string;
        readonly authorizationId: string;
        readonly walletSessionId: string;
        readonly quotaId: string;
        readonly thresholdSessionId: string;
        readonly orgId: string;
        readonly projectId: string;
        readonly environment: string;
        readonly projectEnvironmentId: string;
        readonly signingWorkerId: string;
        readonly expiresAtMs: number;
      };
    }
  | {
      readonly operation: AuthorizedOperation;
      readonly binding: OperationStepUpBinding;
    };

export type OperationStepUpBinding = {
  readonly kind: 'operation_step_up';
  readonly ownershipGeneration: number;
  readonly authorizationSessionId: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly environment: string;
  readonly projectEnvironmentId: string;
  readonly subjectId: string;
  readonly accountId: string;
};

type AuthorizedOperationKinds =
  | {
      readonly capability_kind: 'evm_ecdsa_mpc_signing';
      readonly operation_kind: 'evm.sign_transaction';
    }
  | Pick<Ed25519ReusableAuthorizedOperationReceipt, 'capability_kind' | 'operation_kind'>;

type OperationDigests = AuthorizedOperation['operation']['digests'];

type AuthorizedOperationFields<K extends AuthorizedOperationKinds> = {
  readonly authorized_operation_id: AuthorizedOperation['authorizedOperationId'];
  readonly operation_id: AuthorizedOperation['operation']['operationId'];
  readonly capability_kind: K['capability_kind'];
  readonly operation_kind: K['operation_kind'];
  readonly lane_digest_b64u: OperationDigests['laneDigest'];
  readonly intent_digest_b64u: OperationDigests['intentDigest'];
  readonly display_digest_b64u: OperationDigests['displayDigest'];
  readonly operation_fingerprint_digest: AuthorizedOperation['operationFingerprintDigest'];
};

/** The fields every authorized operation carries on the wire, in wire order. */
function authorizedOperationFields<K extends AuthorizedOperationKinds>(
  operation: AuthorizedOperation,
  kinds: K,
): AuthorizedOperationFields<K> {
  return {
    authorized_operation_id: operation.authorizedOperationId,
    operation_id: operation.operation.operationId,
    capability_kind: kinds.capability_kind,
    operation_kind: kinds.operation_kind,
    lane_digest_b64u: operation.operation.digests.laneDigest,
    intent_digest_b64u: operation.operation.digests.intentDigest,
    display_digest_b64u: operation.operation.digests.displayDigest,
    operation_fingerprint_digest: operation.operationFingerprintDigest,
  };
}

type AuthorizedOperationWire<K extends AuthorizedOperationKinds> = {
  readonly binding: AuthorizedOperationBindingWire;
  readonly authorized_operation:
    | (AuthorizedOperationFields<K> & {
        readonly kind: 'reusable_wallet_session_authorized_operation_v1';
      })
    | (AuthorizedOperationFields<K> & {
        readonly kind: 'verified_step_up_authorized_operation_v1';
        readonly authorization_session_id: string;
        readonly evidence_set_digest: string;
      });
};

export function buildAuthorizedOperationWire<K extends AuthorizedOperationKinds>(
  input: AuthorizedOperationWireInput,
  kinds: K,
): AuthorizedOperationWire<K> {
  const operation = input.operation;
  const commonAuthorizedOperation = authorizedOperationFields(operation, kinds);
  switch (input.binding.kind) {
    case 'reusable_wallet_session':
      if (
        operation.authorization.kind !== 'authorization_grant' ||
        operation.quota.kind !== 'consume_reusable_wallet_session'
      ) {
        throw new Error('Reusable Wallet Session authorized operation is invalid');
      }
      return {
        binding: {
          kind: 'reusable_wallet_session',
          authorization_id: operation.authorization.authorizationGrantRef.authorizationId,
          wallet_session_id: input.binding.walletSessionId,
          quota_id: input.binding.quotaId,
        },
        authorized_operation: {
          kind: 'reusable_wallet_session_authorized_operation_v1',
          ...commonAuthorizedOperation,
        },
      };
    case 'gateway_owner_wallet_session':
      if (
        operation.authorization.kind !== 'authorization_grant' ||
        operation.quota.kind !== 'consume_reusable_wallet_session'
      ) {
        throw new Error('Gateway owner Wallet Session authorized operation is invalid');
      }
      return {
        binding: {
          kind: 'gateway_owner_wallet_session',
          ownership_generation: input.binding.ownershipGeneration,
          subject_id: input.binding.subjectId,
          account_id: input.binding.accountId,
          authorization_id: input.binding.authorizationId,
          wallet_session_id: input.binding.walletSessionId,
          quota_id: input.binding.quotaId,
          threshold_session_id: input.binding.thresholdSessionId,
          org_id: input.binding.orgId,
          project_id: input.binding.projectId,
          environment: input.binding.environment,
          project_environment_id: input.binding.projectEnvironmentId,
          signing_worker_id: input.binding.signingWorkerId,
          expires_at_ms: input.binding.expiresAtMs,
        },
        authorized_operation: {
          kind: 'reusable_wallet_session_authorized_operation_v1',
          ...commonAuthorizedOperation,
        },
      };
    case 'operation_step_up':
      if (
        operation.authorization.kind !== 'verified_step_up' ||
        operation.quota.kind !== 'quota_neutral'
      ) {
        throw new Error('Verified step-up authorized operation is invalid');
      }
      return {
        binding: {
          kind: 'operation_step_up',
          ownership_generation: input.binding.ownershipGeneration,
          authorization_session_id: input.binding.authorizationSessionId,
          org_id: input.binding.orgId,
          project_id: input.binding.projectId,
          environment: input.binding.environment,
          project_environment_id: input.binding.projectEnvironmentId,
          subject_id: input.binding.subjectId,
          account_id: input.binding.accountId,
        },
        authorized_operation: {
          kind: 'verified_step_up_authorized_operation_v1',
          authorization_session_id: input.binding.authorizationSessionId,
          evidence_set_digest: operation.authorization.evidenceSetDigest,
          ...commonAuthorizedOperation,
        },
      };
    default:
      return assertNeverOperationBinding(input.binding);
  }
}

function assertNeverOperationBinding(_binding: never): never {
  throw new Error('Unsupported authorized-operation binding');
}
