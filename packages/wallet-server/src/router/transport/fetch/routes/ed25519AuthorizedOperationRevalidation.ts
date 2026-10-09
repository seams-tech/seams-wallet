import type { AuthorizedOperationId, TenantId } from '@shared/authorization/capabilityKinds';
import type { CapabilityOperationFingerprintDigest } from '@shared/authorization/operationFingerprint';
import type { WalletId } from '@shared/utils/domainIds';
import type { AuthorizedOperation } from '../../../../authorization/domain';
import type { PinnedOwnerWalletScope } from '../../../../authorization/ecdsaWalletSessionAdmission';
import type { AuthorizedOperationAdmissionRejection } from '../../../../authorization/service';
import { json } from '../../../framework/http';
import type { FetchRouterApiContext } from '../createFetchRouter';

type Revalidated<Result> = Result | { readonly ok: false; readonly response: Response };

function rejected(
  code: string,
  message: string,
  status: number,
): { ok: false; response: Response } {
  return { ok: false, response: json({ ok: false, code, message }, { status }) };
}

function rejectedAdmission(kind: AuthorizedOperationAdmissionRejection['kind']) {
  return kind === 'authorization_grant_rejected' || kind === 'verified_step_up_rejected'
    ? rejected(kind, 'Ed25519 operation authorization is no longer active', 403)
    : rejected(kind, 'Ed25519 operation admission failed', 409);
}

export async function revalidateEd25519StepUpOperation(input: {
  readonly ctx: FetchRouterApiContext;
  readonly operation: AuthorizedOperation;
}): Promise<Revalidated<{ readonly ok: true; readonly operation: AuthorizedOperation }>> {
  const stored = input.operation;
  if (stored.authorization.kind !== 'verified_step_up' || stored.quota.kind !== 'quota_neutral') {
    return rejected(
      'verified_step_up_rejected',
      'Ed25519 operation step-up authorization has an invalid quota',
      403,
    );
  }
  const result = await input.ctx.service.authorizedOperations.admitAuthorizedOperation({
    operation: {
      tenantId: stored.tenantId,
      authorizedOperationId: stored.authorizedOperationId,
      auditEventId: stored.auditEventId,
      operation: stored.operation,
      authorization: stored.authorization,
      quota: stored.quota,
      claimedAtMs: Date.now(),
    },
  });
  if (!('operation' in result)) return rejectedAdmission(result.kind);
  if (result.operation.authorizedOperationId !== stored.authorizedOperationId) {
    throw new Error('Ed25519 authorized operation changed during revalidation');
  }
  return { ok: true, operation: result.operation };
}

/**
 * Finds the operation a reusable Wallet Session prepared and checks that its
 * grant is still active. A live operation returns the owner scope its
 * admission row pinned. A completed operation returns none: it replays its
 * stored response. The operation is read by its fingerprint, so a receipt
 * that names another operation ID has no stored operation.
 */
export async function resolveEd25519WalletSessionOperation(input: {
  readonly ctx: FetchRouterApiContext;
  readonly tenantId: TenantId;
  readonly authorizedOperationId: AuthorizedOperationId;
  readonly operationFingerprintDigest: CapabilityOperationFingerprintDigest;
  readonly walletId: WalletId;
}): Promise<
  Revalidated<{
    readonly ok: true;
    readonly operation: AuthorizedOperation;
    readonly ownerScope: PinnedOwnerWalletScope | null;
  }>
> {
  const result = await input.ctx.service.authorizedOperations.resolveEd25519WalletSessionOperation({
    tenantId: input.tenantId,
    operationFingerprintDigest: input.operationFingerprintDigest,
    walletId: input.walletId,
    nowMs: Date.now(),
  });
  if (result.kind === 'authorized_operation_missing') {
    return rejected('authorized_operation_missing', 'Authorized operation is unavailable', 409);
  }
  if (!result.operation) return rejectedAdmission(result.kind);
  const stored = result.operation;
  if (stored.authorizedOperationId !== input.authorizedOperationId) {
    return rejected('authorized_operation_missing', 'Authorized operation is unavailable', 409);
  }
  if (stored.quota.kind !== 'consume_reusable_wallet_session') {
    return rejected(
      'authorization_grant_rejected',
      'Ed25519 reusable operation authorization has an invalid quota',
      403,
    );
  }
  const operation = stored.operation.operation;
  if (
    operation.capabilityKind !== 'near_ed25519_mpc_signing' ||
    operation.operationKind === 'near.export_key'
  ) {
    return rejected(
      'authorization_grant_rejected',
      'Ed25519 reusable operation kind is invalid',
      403,
    );
  }
  return { ok: true, operation: stored, ownerScope: result.ownerScope ?? null };
}
