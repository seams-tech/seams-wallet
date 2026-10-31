import {
  SigningSessionIds,
  type SigningOperationId,
} from '@/core/signingEngine/session/operationState/types';
import { parseWalletId, type WalletId } from '@shared/utils/domainIds';
import { parseNearTransactionResult } from '@/core/signingEngine/nearTransactionSubmission';
import { toAccountId, type AccountId } from '@/core/types/accountIds';
import { ActionType, type ActionArgsWasm, type TransactionInputWasm } from '@/core/types/actions';
import type { ActionResult } from '@/core/types/seams';
import {
  parseExternalWalletAuthentication,
  type ExternalWalletAuthentication,
} from '@shared/auth/externalAuth';
import {
  parseThresholdEd25519NearTransaction,
  type ThresholdEd25519NearAction,
} from '@shared/threshold/ed25519OperationFingerprint';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';

export type OwnerNearRecovery = Readonly<{
  operationId: SigningOperationId;
  walletId: WalletId;
  nearAccountId: AccountId;
}>;

export type OwnerNearCommand = Readonly<{
  authentication: ExternalWalletAuthentication;
  recovery: OwnerNearRecovery;
}> &
  ReadonlyExclusiveUnion<
    | { action: 'approve'; transaction: TransactionInputWasm; expiresAtMs: number }
    | { action: 'recover' }
  >;

export type OwnerNearOutcome = ReadonlyExclusiveUnion<
  | { kind: 'completed'; result: Extract<ActionResult, { success: true }> }
  | { kind: 'reverted'; transactionId: string; error: string }
  | { kind: 'cancelled' }
  | { kind: 'expired' }
  | { kind: 'unknown'; recovery: OwnerNearRecovery }
  | { kind: 'unresolved'; recovery: OwnerNearRecovery; transactionId: string; error: string }
  | { kind: 'not_submitted'; error: string }
  | { kind: 'recovery_unavailable'; recovery: OwnerNearRecovery; error: string }
>;

export function parseOwnerNearRecovery(raw: unknown): OwnerNearRecovery {
  const value = requireRecord(raw, 'owner operation recovery');
  const operationId = requireCanonicalString(value.operationId, 'operationId');
  if (!/^owner-near:[A-Za-z0-9_-]{32,64}$/.test(operationId))
    throw new Error('Invalid owner operation ID.');
  const walletId = parseWalletId(value.walletId);
  if (!walletId.ok) throw new Error('Invalid owner operation wallet.');
  return {
    operationId: SigningSessionIds.signingOperation(operationId),
    walletId: walletId.value,
    nearAccountId: toAccountId(requireCanonicalString(value.nearAccountId, 'nearAccountId')),
  };
}

export function parseOwnerNearCommand(raw: unknown): OwnerNearCommand {
  const value = requireRecord(raw, 'owner operation command');
  const authentication = parseExternalWalletAuthentication(value.authentication);
  const recovery = parseOwnerNearRecovery(value.recovery);
  if (recovery.walletId !== String(authentication.walletId))
    throw new Error('Owner operation wallet mismatch.');
  switch (value.action) {
    case 'recover':
      return { action: 'recover', authentication, recovery };
    case 'approve': {
      const rawTransaction = requireRecord(value.transaction, 'transaction');
      const transaction = parseThresholdEd25519NearTransaction(
        {
          nearAccountId: recovery.nearAccountId,
          receiverId: rawTransaction.receiverId,
          actions: rawTransaction.actions,
        },
        'transaction',
      );
      if (transaction.nearAccountId !== String(recovery.nearAccountId))
        throw new Error('Owner operation account mismatch.');
      const expiresAtMs = value.expiresAtMs;
      if (typeof expiresAtMs !== 'number' || !Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0)
        throw new Error('Invalid owner operation expiry.');
      return {
        action: 'approve',
        authentication,
        recovery,
        expiresAtMs,
        transaction: {
          receiverId: transaction.receiverId,
          actions: transaction.actions.map(ownerNearAction),
        },
      };
    }
    default:
      throw new Error('Invalid owner operation action.');
  }
}

export function parseOwnerNearOutcome(raw: unknown): OwnerNearOutcome {
  const value = requireRecord(raw, 'owner operation outcome');
  switch (value.kind) {
    case 'completed': {
      const result = parseNearTransactionResult(value.result);
      if (!result.success)
        throw new Error('A completed owner operation requires a successful transaction.');
      return { kind: 'completed', result };
    }
    case 'reverted':
      return {
        kind: 'reverted',
        transactionId: requireCanonicalString(value.transactionId, 'transactionId'),
        error: requireCanonicalString(value.error, 'error'),
      };
    case 'cancelled':
      return { kind: 'cancelled' };
    case 'expired':
      return { kind: 'expired' };
    case 'not_submitted':
      return { kind: 'not_submitted', error: requireCanonicalString(value.error, 'error') };
    case 'recovery_unavailable':
      return {
        kind: 'recovery_unavailable',
        recovery: parseOwnerNearRecovery(value.recovery),
        error: requireCanonicalString(value.error, 'error'),
      };
    case 'unresolved':
      return {
        kind: 'unresolved',
        recovery: parseOwnerNearRecovery(value.recovery),
        transactionId: requireCanonicalString(value.transactionId, 'transactionId'),
        error: requireCanonicalString(value.error, 'error'),
      };
    case 'unknown':
      return { kind: 'unknown', recovery: parseOwnerNearRecovery(value.recovery) };
    default:
      throw new Error('Invalid owner operation outcome.');
  }
}

function ownerNearAction(action: ThresholdEd25519NearAction): ActionArgsWasm {
  switch (action.action_type) {
    case 'CreateAccount':
      return { action_type: ActionType.CreateAccount };
    case 'DeployContract':
      return { action_type: ActionType.DeployContract, code: [...action.code] };
    case 'FunctionCall':
      return {
        action_type: ActionType.FunctionCall,
        method_name: action.method_name,
        args: action.args,
        gas: action.gas,
        deposit: action.deposit,
      };
    case 'Transfer':
      return { action_type: ActionType.Transfer, deposit: action.deposit };
    case 'Stake':
      return { action_type: ActionType.Stake, stake: action.stake, public_key: action.public_key };
    case 'AddKey':
      return {
        action_type: ActionType.AddKey,
        public_key: action.public_key,
        access_key: action.access_key,
      };
    case 'DeleteKey':
      return { action_type: ActionType.DeleteKey, public_key: action.public_key };
    case 'DeleteAccount':
      return { action_type: ActionType.DeleteAccount, beneficiary_id: action.beneficiary_id };
    case 'DeployGlobalContract':
      return {
        action_type: ActionType.DeployGlobalContract,
        code: [...action.code],
        deploy_mode: action.deploy_mode,
      };
    case 'UseGlobalContract':
      if (action.account_id !== undefined)
        return { action_type: ActionType.UseGlobalContract, account_id: action.account_id };
      return { action_type: ActionType.UseGlobalContract, code_hash: action.code_hash };
    case 'SignedDelegate':
      throw new Error('Use the delegate API for delegated actions.');
    default:
      action satisfies never;
      throw new Error('Unsupported owner transaction action.');
  }
}

export type OwnerNearSubmissionProgress = Readonly<{
  event: 'owner_near_submitting';
  operationId: SigningOperationId;
  transactionId: string;
}>;

export function parseOwnerNearSubmissionProgress(raw: unknown): OwnerNearSubmissionProgress | null {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Reflect.get(raw, 'event') !== 'owner_near_submitting'
  )
    return null;
  const operationId = Reflect.get(raw, 'operationId');
  if (typeof operationId !== 'string' || !/^owner-near:[A-Za-z0-9_-]{32,64}$/.test(operationId))
    return null;
  return {
    event: 'owner_near_submitting',
    operationId: SigningSessionIds.signingOperation(operationId),
    transactionId: requireCanonicalString(Reflect.get(raw, 'transactionId'), 'transactionId'),
  };
}
