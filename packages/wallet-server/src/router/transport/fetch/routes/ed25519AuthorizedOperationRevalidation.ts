import type { CapabilityOperationRef } from '@shared/authorization/capabilityKinds';
import { buildNearEd25519MpcOperationRef } from '@shared/authorization/capabilityKinds';
import {
  buildCapabilityOperationEnvelope,
  type CapabilityOperationEnvelope,
} from '@shared/authorization/operationFingerprint';
import type {
  AuthorizedOperation,
  AuthorizedOperationInput,
} from '../../../../authorization/domain';
import { json } from '../../../framework/http';
import type { FetchRouterApiContext } from '../createFetchRouter';

export async function revalidateEd25519AuthorizedOperation(input: {
  readonly ctx: FetchRouterApiContext;
  readonly operation: AuthorizedOperation;
}): Promise<
  | { readonly ok: true; readonly operation: AuthorizedOperation }
  | { readonly ok: false; readonly response: Response }
> {
  let admission: AuthorizedOperationInput;
  if (input.operation.authorization.kind === 'verified_step_up') {
    if (input.operation.quota.kind !== 'quota_neutral') {
      return {
        ok: false,
        response: json(
          {
            ok: false,
            code: 'verified_step_up_rejected',
            message: 'Ed25519 operation step-up authorization has an invalid quota',
          },
          { status: 403 },
        ),
      };
    }
    admission = {
      tenantId: input.operation.tenantId,
      authorizedOperationId: input.operation.authorizedOperationId,
      auditEventId: input.operation.auditEventId,
      operation: input.operation.operation,
      authorization: input.operation.authorization,
      quota: input.operation.quota,
      claimedAtMs: Date.now(),
    };
  } else {
    if (input.operation.quota.kind !== 'consume_reusable_wallet_session') {
      return {
        ok: false,
        response: json(
          {
            ok: false,
            code: 'authorization_grant_rejected',
            message: 'Ed25519 reusable operation authorization has an invalid quota',
          },
          { status: 403 },
        ),
      };
    }
    const operation = buildEd25519ReusableOperationEnvelope(input.operation);
    if (!operation) {
      return {
        ok: false,
        response: json(
          {
            ok: false,
            code: 'authorization_grant_rejected',
            message: 'Ed25519 reusable operation kind is invalid',
          },
          { status: 403 },
        ),
      };
    }
    admission = {
      tenantId: input.operation.tenantId,
      authorizedOperationId: input.operation.authorizedOperationId,
      auditEventId: input.operation.auditEventId,
      operation,
      authorization: input.operation.authorization,
      quota: input.operation.quota,
      claimedAtMs: Date.now(),
    };
  }
  const result = await input.ctx.service.authorizedOperations.admitAuthorizedOperation({
    operation: admission,
  });
  switch (result.kind) {
    case 'claimed':
    case 'operation_in_progress':
    case 'replayed':
      if (result.operation.authorizedOperationId !== input.operation.authorizedOperationId) {
        throw new Error('Ed25519 authorized operation changed during revalidation');
      }
      return { ok: true, operation: result.operation };
    case 'authorization_grant_rejected':
    case 'verified_step_up_rejected':
      return {
        ok: false,
        response: json(
          {
            ok: false,
            code: result.kind,
            message: 'Ed25519 operation authorization is no longer active',
          },
          { status: 403 },
        ),
      };
    case 'wallet_session_quota_exhausted':
    case 'material_mismatch':
      return {
        ok: false,
        response: json(
          { ok: false, code: result.kind, message: 'Ed25519 operation admission failed' },
          { status: 409 },
        ),
      };
  }
}

type Ed25519ReusableOperationRef = Extract<
  CapabilityOperationRef,
  { readonly capabilityKind: 'near_ed25519_mpc_signing' }
> & {
  readonly operationKind:
    | 'near.sign_transaction'
    | 'near.sign_delegate_action'
    | 'near.sign_nep413_message';
};

function buildEd25519ReusableOperationEnvelope(
  operation: AuthorizedOperation,
): CapabilityOperationEnvelope<Ed25519ReusableOperationRef> | null {
  const operationRef = operation.operation.operation;
  if (operationRef.capabilityKind !== 'near_ed25519_mpc_signing') return null;
  switch (operationRef.operationKind) {
    case 'near.sign_transaction':
    case 'near.sign_delegate_action':
    case 'near.sign_nep413_message':
      return buildCapabilityOperationEnvelope({
        tenantId: operation.operation.tenantId,
        principalId: operation.operation.principalId,
        capabilityId: operation.operation.capabilityId,
        operationId: operation.operation.operationId,
        operation: buildNearEd25519MpcOperationRef(operationRef.operationKind),
        digests: operation.operation.digests,
      });
    case 'near.export_key':
      return null;
  }
}

