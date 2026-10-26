import bs58 from 'bs58';
import { isPlainObject } from '@shared/utils/validation';
import { isValidAccountId } from '@shared/utils/near';
import { ActionType, toActionArgsWasm, type TransactionInput } from '../core/types/actions';
import type { ExternalNearConnection, ExternalNearSubmission } from './types';

export function parseAccounts(raw: unknown): readonly string[] {
  if (!Array.isArray(raw) || raw.length === 0)
    throw new Error('The wallet has no connected accounts.');
  const accounts: string[] = [];
  for (const account of raw) {
    if (!isValidAccountId(account)) throw new Error('The wallet returned an invalid account.');
    accounts.push(account);
  }
  return Object.freeze(accounts);
}

export function validateTransaction(input: TransactionInput): TransactionInput {
  if (!isValidAccountId(input.receiverId) || input.actions.length === 0) {
    throw new Error('Provide a receiver and at least one action.');
  }
  for (const action of input.actions) {
    const normalized = toActionArgsWasm(action);
    if (
      normalized.action_type !== ActionType.FunctionCall &&
      normalized.action_type !== ActionType.Transfer
    ) {
      throw new Error('External NEAR supports function calls and transfers.');
    }
    if (!/^\d+$/.test(normalized.deposit)) throw new Error('Deposit must be an unsigned integer.');
    if (
      normalized.action_type === ActionType.FunctionCall &&
      (!/^\d+$/.test(normalized.gas) || BigInt(normalized.gas) === 0n || !normalized.method_name)
    ) {
      throw new Error('Provide a method and positive gas amount.');
    }
  }
  return structuredClone(input);
}

export function parseSubmission(
  raw: unknown,
  connection: ExternalNearConnection,
): ExternalNearSubmission {
  if (!Array.isArray(raw) || raw.length !== 1) throw new Error('Missing transaction outcome.');
  const outcome: unknown = raw[0];
  if (!isPlainObject(outcome) || !isPlainObject(outcome.transaction))
    throw new Error('Invalid transaction outcome.');
  const { hash, signer_id } = outcome.transaction;
  if (
    typeof hash !== 'string' ||
    bs58.decode(hash).length !== 32 ||
    signer_id !== connection.accountId
  ) {
    throw new Error('Transaction identity does not match the request.');
  }
  return Object.freeze({ hash, accountId: connection.accountId, network: connection.network });
}

export function executionStatus(
  raw: unknown,
  submission: ExternalNearSubmission,
): 'confirmed' | 'failed' | 'unresolved' {
  if (!isPlainObject(raw) || !isPlainObject(raw.result)) return 'unresolved';
  const result = raw.result;
  if (
    !isPlainObject(result.transaction) ||
    result.transaction.hash !== submission.hash ||
    result.transaction.signer_id !== submission.accountId ||
    result.final_execution_status !== 'FINAL'
  )
    return 'unresolved';
  if (!isPlainObject(result.status)) return 'unresolved';
  if ('Failure' in result.status) return 'failed';
  if (!('SuccessValue' in result.status) || !Array.isArray(result.receipts_outcome))
    return 'unresolved';
  for (const receipt of result.receipts_outcome) {
    if (
      !isPlainObject(receipt) ||
      !isPlainObject(receipt.outcome) ||
      !isPlainObject(receipt.outcome.status)
    )
      return 'unresolved';
    if ('Failure' in receipt.outcome.status) return 'failed';
  }
  return 'confirmed';
}
