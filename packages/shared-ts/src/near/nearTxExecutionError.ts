/**
 * One reading of a NEAR transaction execution error, for the client and the
 * server copies of `NearRpcError`.
 */
import type { NearRpcErrorType } from '../utils/nearRpcResults';

export type NearTxExecutionDescription = {
  message: string;
  type: Extract<NearRpcErrorType, 'InvalidTxError' | 'ActionError' | 'TxExecutionError'>;
  kind: string;
  index?: number;
  short: string;
};

function isObj(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Names a NEAR error variant. NEAR sends a unit variant as a string, such as
 * `"Expired"`, and a variant with fields as a one-key object, such as
 * `{"InvalidNonce":{...}}`.
 */
function variantName(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined;
  if (!isObj(value)) return undefined;
  const keys = Object.keys(value);
  return keys.length ? keys[0] : undefined;
}

/**
 * The execution error in the `data` of a NEAR RPC error: `TxExecutionError`,
 * or an `InvalidTxError` or `ActionError` that a node sends without it.
 */
export function nearTxExecutionFromRpcData(details: unknown): Record<string, unknown> | undefined {
  if (!isObj(details)) return undefined;
  if (isObj(details.TxExecutionError)) return details.TxExecutionError;
  return 'InvalidTxError' in details || 'ActionError' in details ? details : undefined;
}

/**
 * Names an `InvalidTxError` variant, such as `Expired` or `InvalidNonce`. An
 * `ActionsValidation` variant also names its inner case.
 */
function nearInvalidTransactionKind(value: unknown): string {
  const name = variantName(value);
  if (!name) return 'InvalidTxError';
  if (name !== 'ActionsValidation' || !isObj(value)) return name;
  return `ActionsValidation.${variantName(value.ActionsValidation) || 'ActionsValidation'}`;
}

export function describeNearTxExecution(
  operationName: string,
  exec: Record<string, unknown>,
): NearTxExecutionDescription {
  if ('InvalidTxError' in exec) {
    const kind = nearInvalidTransactionKind(exec.InvalidTxError);
    const short = kind.startsWith('ActionsValidation.')
      ? `InvalidTxError: ${kind.split('.')[1] || 'ActionsValidation'}`
      : `InvalidTxError: ${kind}`;
    return {
      message: `${operationName} failed (InvalidTxError: ${kind})`,
      type: 'InvalidTxError',
      kind,
      short,
    };
  }

  if (isObj(exec.ActionError)) {
    const actionError = exec.ActionError;
    const index = typeof actionError.index === 'number' ? actionError.index : undefined;
    const kind = variantName(actionError.kind) || 'ActionError';
    const at = typeof index === 'number' ? ` at action ${index}` : '';
    // The message stays free of contract text: the retrying client matches words in it.
    return {
      message: `${operationName} failed${at} (ActionError: ${kind})`,
      type: 'ActionError',
      kind,
      index,
      short: `ActionError: ${kind}`,
    };
  }

  return {
    message: `${operationName} failed (TxExecutionError)`,
    type: 'TxExecutionError',
    kind: 'TxExecutionError',
    short: 'TxExecutionError',
  };
}
