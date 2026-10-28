import type { ActionResult } from '@/core/types/seams';
import type { ActionHooksOptions } from '@/core/types/sdkSentEvents';
import { safeErrorMessage } from '@shared/utils/errors';
import {
  requireRecord,
  requireCanonicalString,
  requireNonEmptyString,
} from '@shared/utils/validation';
import { decodeNearFinalExecutionOutcome } from '@shared/utils/nearRpcResults';

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
        return unresolvedNearTransaction(this.transaction.transactionId, error);
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
    const outcome = decodeNearFinalExecutionOutcome(result.result);
    if (transactionId !== outcome.transaction.hash) {
      throw new Error('NEAR transaction result contains different transaction hashes');
    }
    if (typeof outcome.status === 'object' && 'Failure' in outcome.status) {
      return unresolvedNearTransaction(
        transactionId,
        new Error('NEAR transaction execution failed'),
      );
    }
    return {
      success: true,
      transactionId,
      result: outcome,
    };
  }
  if (result.success !== false) throw new Error('Invalid NEAR transaction result');
  const error = requireNonEmptyString(result.error, 'NEAR transaction error');
  switch (result.kind) {
    case 'not_submitted':
      return { success: false, kind: 'not_submitted', error };
    case 'submission_unknown':
      return { success: false, kind: 'submission_unknown', error };
    case 'unresolved':
      return {
        success: false,
        kind: 'unresolved',
        transactionId: requireCanonicalString(result.transactionId, 'transactionId'),
        error,
      };
    default:
      throw new Error('Invalid NEAR transaction failure');
  }
}

export function nearTransactionFailure(
  error: unknown,
  fallback: 'not_submitted' | 'submission_unknown',
): NearTransactionFailure {
  return {
    success: false,
    kind: fallback,
    error: safeErrorMessage(error) || 'NEAR transaction failed',
  };
}

export function unresolvedNearTransaction(
  transactionId: string,
  error: unknown,
): NearTransactionFailure {
  return { success: false, kind: 'unresolved', transactionId, error: safeErrorMessage(error) };
}

/** Application hooks cannot replace a settled transaction outcome with their own error. */
export async function notifyNearTransactionResult(
  options: Pick<ActionHooksOptions, 'onError' | 'afterCall'> | undefined,
  result: ActionResult,
): Promise<void> {
  const error = result.success ? undefined : new Error(result.error);
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
