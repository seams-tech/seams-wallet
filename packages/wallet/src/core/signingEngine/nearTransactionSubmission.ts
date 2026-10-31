import { MlDsaSigningError } from '@shared/near/mlDsaSigning';
import { nearSigningFailureCause, parseNearSigningFailureCause } from '@shared/near/signingFailure';
import type { ActionResult } from '@/core/types/seams';
import type { ActionHooksOptions } from '@/core/types/sdkSentEvents';
import type { FinalExecutionOutcome } from '@near-js/types';
import { safeErrorMessage } from '@shared/utils/errors';
import {
  requireRecord,
  requireCanonicalString,
  requireNonEmptyString,
} from '@shared/utils/validation';
import { decodeNearFinalExecutionOutcome } from '@shared/utils/nearRpcResults';
import { NearRpcError, nearExecutionFailureReason } from '@/core/rpcClients/near/NearRpcError';
import {
  nearTransactionRejection,
  nearTransactionRejectionMessage,
  parseNearTransactionRejection,
} from '@/core/rpcClients/near/nearTransactionRejection';

type NearTransactionFailure = Extract<ActionResult, { success: false }>;

export class NearTransactionRequest {
  private state: 'not_dispatched' | 'dispatched' = 'not_dispatched';

  constructor(
    private readonly transaction:
      | { readonly kind: 'sign_and_send' }
      | { readonly kind: 'send'; readonly transactionId: string },
  ) {}

  readonly dispatched = (): void => {
    this.state = 'dispatched';
  };

  failed(error: unknown): NearTransactionFailure {
    if (this.state === 'not_dispatched') return nearTransactionFailure(error, 'not_submitted');
    switch (this.transaction.kind) {
      case 'sign_and_send':
        return nearTransactionFailure(error, 'submission_unknown');
      case 'send':
        return broadcastNearTransactionFailure(this.transaction.transactionId, error, 'repeatable');
      default:
        return assertNeverNearTransactionState(this.transaction);
    }
  }
}

function assertNeverNearTransactionState(value: never): never {
  throw new Error(`Unsupported NEAR transaction state: ${String(value)}`);
}

export function parseNearTransactionResult(raw: unknown): ActionResult {
  const result = requireRecord(raw, 'NEAR transaction result');
  if (result.success === true) {
    const transactionId = requireCanonicalString(result.transactionId, 'transactionId');
    return executedNearTransaction(transactionId, decodeNearFinalExecutionOutcome(result.result));
  }
  if (result.success !== false) throw new Error('Invalid NEAR transaction result');
  const error = requireNonEmptyString(result.error, 'NEAR transaction error');
  switch (result.kind) {
    case 'not_submitted':
      return {
        success: false,
        kind: 'not_submitted',
        error,
        cause: parseNearSigningFailureCause(result.cause),
        ...optionalRejection(result.rejection),
      };
    case 'reverted': {
      const transactionId = requireCanonicalString(result.transactionId, 'transactionId');
      const executed = executedNearTransaction(
        transactionId,
        decodeNearFinalExecutionOutcome(result.result),
      );
      if (executed.success) throw new Error('A reverted NEAR transaction requires a Failure');
      return { ...executed, error };
    }
    case 'submission_unknown':
      return {
        success: false,
        kind: 'submission_unknown',
        error,
        cause: parseNearSigningFailureCause(result.cause),
      };
    case 'unresolved':
      return {
        success: false,
        kind: 'unresolved',
        transactionId: requireCanonicalString(result.transactionId, 'transactionId'),
        error,
        ...optionalRejection(result.rejection),
      };
    default:
      throw new Error('Invalid NEAR transaction failure');
  }
}

function optionalRejection(raw: unknown) {
  return raw === undefined ? {} : { rejection: parseNearTransactionRejection(raw) };
}

/** A transaction that ran. Its final status decides between success and a revert. */
export function executedNearTransaction(
  transactionId: string,
  outcome: FinalExecutionOutcome,
): ActionResult {
  if (transactionId !== outcome.transaction.hash) {
    throw new Error('NEAR transaction result contains different transaction hashes');
  }
  const { status } = outcome;
  if (typeof status === 'object' && status.Failure !== undefined) {
    return {
      success: false,
      kind: 'reverted',
      transactionId,
      error: nearExecutionFailureReason(status.Failure),
      result: outcome,
    };
  }
  return { success: true, transactionId, result: outcome };
}

export function nearTransactionFailure(
  error: unknown,
  fallback: 'not_submitted' | 'submission_unknown',
): NearTransactionFailure {
  const cause = nearSigningFailureCause(error);
  const message = safeErrorMessage(error) || 'NEAR transaction failed';
  return { success: false, kind: fallback, error: message, cause };
}

/**
 * A broadcast that ended without an outcome. A NEAR rejection proves that nothing was
 * submitted when the signed bytes are invalid, or when one request was the only one that
 * ever carried them (`only_request`). Otherwise an earlier request may have reached a
 * block, and the rejection may report the state that it left.
 */
export function broadcastNearTransactionFailure(
  transactionId: string,
  error: unknown,
  broadcast: 'only_request' | 'repeatable',
): NearTransactionFailure {
  const rejection = nearTransactionRejection(error);
  const onlyRequest =
    broadcast === 'only_request' && error instanceof NearRpcError && error.sendAttempts === 1;
  if (rejection && (rejection.permanence === 'permanent' || onlyRequest)) {
    return {
      success: false,
      kind: 'not_submitted',
      error: nearTransactionRejectionMessage(rejection, 'not_submitted'),
      cause: { kind: 'unclassified' },
      rejection,
    };
  }
  return {
    success: false,
    kind: 'unresolved',
    transactionId,
    error: rejection
      ? nearTransactionRejectionMessage(rejection, 'unresolved')
      : safeErrorMessage(error),
    ...(rejection ? { rejection } : {}),
  };
}

/** Application hooks cannot replace a settled transaction outcome with their own error. */
export async function notifyNearTransactionResult(
  options: Pick<ActionHooksOptions, 'onError' | 'afterCall'> | undefined,
  result: ActionResult,
): Promise<void> {
  const error = transactionResultError(result);
  if (error) {
    try {
      await options?.onError?.(error);
    } catch {}
  }
  try {
    if (result.success) await options?.afterCall?.(true, result);
    else await options?.afterCall?.(false, undefined, error);
  } catch {}
}

function transactionResultError(result: ActionResult): Error | undefined {
  if (result.success) return undefined;
  if (
    (result.kind === 'not_submitted' || result.kind === 'submission_unknown') &&
    result.cause.kind === 'ml_dsa'
  )
    return new MlDsaSigningError(result.cause.failure);
  return new Error(result.error);
}
