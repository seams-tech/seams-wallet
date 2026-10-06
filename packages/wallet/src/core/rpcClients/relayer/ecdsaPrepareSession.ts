import {
  parseRouterAbEcdsaDerivationEvmDigestSigningPrepareResponseForRequestV1,
  type RouterAbEcdsaDerivationEvmDigestSigningRequestV1Wire,
  type RouterAbEcdsaDerivationEvmDigestSigningPrepareResponseV1Wire,
} from '@shared/utils/routerAbEcdsaDerivation';
import {
  parseMpcWalletSigningQuotaId,
  parseWalletSessionId,
} from '@shared/authorization/capabilityKinds';
import { requireRecord } from '@shared/utils/validation';
import {
  parseExactWalletSessionStatusResponse,
  type ExactWalletSessionStatus,
} from './walletSessionAuthorizationStatus';

export type PreparedWalletSessionStatus = Extract<
  ExactWalletSessionStatus,
  { readonly status: 'active' }
>;

export type EcdsaPrepareSessionResult =
  | {
      readonly kind: 'reusable_wallet_session';
      readonly signing: RouterAbEcdsaDerivationEvmDigestSigningPrepareResponseV1Wire;
      readonly sessionStatus: PreparedWalletSessionStatus;
    }
  | {
      readonly kind: 'operation_step_up';
      readonly signing: RouterAbEcdsaDerivationEvmDigestSigningPrepareResponseV1Wire;
      readonly sessionStatus?: never;
    };

export async function parseEcdsaPrepareSessionResponse(
  request: RouterAbEcdsaDerivationEvmDigestSigningRequestV1Wire,
  value: unknown,
): Promise<EcdsaPrepareSessionResult> {
  const response = requireRecord(value, 'ECDSA prepare response');
  if (response.kind !== request.authorization.kind) {
    throw new Error('ECDSA prepare authorization kind does not match the request');
  }
  const signing = await parseRouterAbEcdsaDerivationEvmDigestSigningPrepareResponseForRequestV1(
    request,
    response.signing,
  );
  if (request.authorization.kind === 'operation_step_up') {
    if (Object.keys(response).some(isUnexpectedStepUpField))
      throw new Error('Invalid step-up prepare response');
    return { kind: 'operation_step_up', signing };
  }
  if (Object.keys(response).some(isUnexpectedSessionField))
    throw new Error('Invalid Wallet Session prepare response');
  const snapshot = requireRecord(response.session_status, 'ECDSA prepare session status');
  const quotaId = parseMpcWalletSigningQuotaId(snapshot.quotaId);
  const walletSessionId = parseWalletSessionId(request.authorization.wallet_session_id);
  if (!quotaId.ok || !walletSessionId.ok) throw new Error('Invalid prepare session identity');
  const status = parseExactWalletSessionStatusResponse(snapshot, {
    walletSessionId: walletSessionId.value,
    quotaId: quotaId.value,
  });
  if (
    !status ||
    status.status !== 'active' ||
    status.authorization.walletId !== request.scope.wallet_id
  ) {
    throw new Error('ECDSA prepare did not return the admitted Wallet Session');
  }
  return { kind: 'reusable_wallet_session', signing, sessionStatus: status };
}

function isUnexpectedStepUpField(key: string): boolean {
  return key !== 'kind' && key !== 'signing';
}
function isUnexpectedSessionField(key: string): boolean {
  return isUnexpectedStepUpField(key) && key !== 'session_status';
}
