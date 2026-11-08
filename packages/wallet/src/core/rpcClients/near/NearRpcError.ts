import type { JsonRpcErrorDetails } from '@shared/utils/jsonRpc';
import type {
  DecodedNearFinalExecutionOutcome,
  NearRpcErrorType,
} from '@shared/utils/nearRpcResults';

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function firstKey(o: Record<string, unknown> | undefined): string | undefined {
  if (!o) return undefined;
  const keys = Object.keys(o);
  return keys.length ? keys[0] : undefined;
}

export class NearRpcError extends Error {
  code?: number;
  type: NearRpcErrorType;
  kind?: string;
  index?: number;
  short: string;
  details?: unknown;
  operation?: string;
  /** The JSON-RPC `cause.name`. Nodes also send `data`, so `details` can omit it. */
  causeName?: string;
  /** Why an action failed, for the person, with the contract's own text when NEAR sends it. */
  reason?: string;
  /** The outcome of a transaction that ran and failed. Only `fromOutcome` sets it. */
  outcome?: DecodedNearFinalExecutionOutcome;
  /** How many `send_tx` requests a retrying client made. The last one returned this error. */
  sendAttempts?: number;

  constructor(params: {
    message: string;
    short: string;
    type?: NearRpcErrorType;
    kind?: string;
    index?: number;
    code?: number;
    name?: string;
    operation?: string;
    details?: unknown;
    causeName?: string;
    reason?: string;
    outcome?: DecodedNearFinalExecutionOutcome;
  }) {
    super(params.message);
    this.name = params.name || 'NearRpcError';
    this.code = params.code;
    this.type = params.type || 'Unknown';
    this.kind = params.kind;
    this.index = params.index;
    this.short = params.short;
    this.details = params.details;
    this.operation = params.operation;
    this.causeName = params.causeName;
    this.reason = params.reason;
    this.outcome = params.outcome;
  }

  static fromOutcome(
    operationName: string,
    outcome: DecodedNearFinalExecutionOutcome,
    failure: unknown,
  ): NearRpcError {
    const { message, type, kind, index, short } = describeFailure(operationName, failure);
    return new NearRpcError({
      message: message || `${operationName} failed`,
      short: short || kind || 'TxExecutionError',
      type: type || 'Failure',
      kind,
      index,
      name: 'TxExecutionFailure',
      operation: operationName,
      details: { Failure: failure, outcome },
      reason: nearExecutionFailureReason(failure),
      outcome,
    });
  }

  static fromRpcError(operationName: string, err: JsonRpcErrorDetails): NearRpcError {
    const details = err.data ?? err.cause;
    const { message, type, kind, index, short, reason } = describeDetails(
      operationName,
      details,
      err.message,
    );
    return new NearRpcError({
      message: message || err.message || `${operationName} RPC error`,
      short: short || kind || 'RPC error',
      type: type || 'RpcError',
      kind,
      index,
      code: typeof err.code === 'number' ? err.code : undefined,
      name: err.name || 'NearRpcError',
      operation: operationName,
      details,
      causeName: isObj(err.cause) && typeof err.cause.name === 'string' ? err.cause.name : undefined,
      reason,
    });
  }
}

type FailureDescription = {
  message: string;
  type?: NearRpcErrorType;
  kind?: string;
  index?: number;
  short?: string;
  reason?: string;
};

function describeDetails(
  operationName: string,
  details: unknown,
  rpcMessage = '',
): FailureDescription {
  const d = isObj(details) ? details : undefined;
  const txExec = isObj(d?.TxExecutionError) ? d.TxExecutionError : undefined;
  if (!txExec) {
    const detail =
      typeof details === 'string' && details.trim()
        ? details.trim()
        : d
          ? JSON.stringify(d)
          : rpcMessage.trim();
    const suffix = detail ? `: ${detail}` : '';
    return { message: `${operationName} RPC error${suffix}` };
  }
  return describeTxExecution(operationName, txExec);
}

function describeFailure(operationName: string, failure: unknown): FailureDescription {
  const f = isObj(failure) ? failure : undefined;
  if (!f) {
    return { message: `${operationName} failed (Unknown Failure)` };
  }
  // Reuse TxExecutionError shape if available
  return describeTxExecution(operationName, f);
}

function describeTxExecution(
  operationName: string,
  exec: Record<string, unknown>,
): FailureDescription {
  // InvalidTxError
  if (isObj(exec.InvalidTxError)) {
    const inv = exec.InvalidTxError;
    let kind = firstKey(inv) || 'InvalidTxError';
    if (isObj(inv.ActionsValidation)) {
      kind = `ActionsValidation.${firstKey(inv.ActionsValidation)}`;
    }
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

  // ActionError
  if (isObj(exec.ActionError)) {
    const ae = exec.ActionError;
    const idx = typeof (ae.index as unknown) === 'number' ? (ae.index as number) : undefined;
    const kobj = isObj(ae.kind) ? ae.kind : undefined;
    const kind = firstKey(kobj) || 'ActionError';
    const idxStr = typeof idx === 'number' ? ` at action ${idx}` : '';
    const short = `ActionError: ${kind}`;
    // The message stays free of contract text: the retrying client matches words in it.
    return {
      message: `${operationName} failed${idxStr} (ActionError: ${kind})`,
      type: 'ActionError',
      kind,
      index: idx,
      short,
      reason: actionErrorReason(ae),
    };
  }

  // Fallback TxExecutionError without specifics
  return {
    message: `${operationName} failed (TxExecutionError)`,
    type: 'TxExecutionError',
    kind: 'TxExecutionError',
    short: 'TxExecutionError',
  };
}

/** Why NEAR could not execute a transaction, from the `Failure` of its outcome status. */
export function nearExecutionFailureReason(failure: unknown): string {
  if (isObj(failure) && isObj(failure.ActionError)) return actionErrorReason(failure.ActionError);
  return `NEAR could not run this transaction: ${variantText(failure) || 'TxExecutionError'}.`;
}

function actionErrorReason(error: Record<string, unknown>): string {
  const call = isObj(error.kind) ? error.kind.FunctionCallError : undefined;
  if (isObj(call) && typeof call.ExecutionError === 'string')
    return `The contract refused the call: ${call.ExecutionError}`;
  if (call !== undefined)
    return `The contract call failed: ${variantText(call) || 'FunctionCallError'}.`;
  const kind = variantText(error.kind) || 'ActionError';
  return typeof error.index === 'number'
    ? `NEAR could not run action ${error.index}: ${kind}.`
    : `NEAR could not run this transaction: ${kind}.`;
}

/** NEAR names a variant in PascalCase and a field in snake_case. */
function variantName(value: Record<string, unknown>): string | undefined {
  const keys = Object.keys(value);
  return keys.length === 1 && /^[A-Z_]/.test(keys[0]) ? keys[0] : undefined;
}

/**
 * Names a NEAR error variant and its fields, such as `MethodResolveError.MethodNotFound`
 * or `AccountDoesNotExist (account_id: bob.near)`.
 */
function variantText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (!isObj(value)) return '';
  const name = variantName(value);
  if (!name) {
    return Object.entries(value)
      .map(([key, field]) => `${key}: ${typeof field === 'string' ? field : JSON.stringify(field)}`)
      .join(', ');
  }
  const inner = value[name];
  const detail = variantText(inner);
  if (!detail) return name;
  return isObj(inner) && !variantName(inner) ? `${name} (${detail})` : `${name}.${detail}`;
}
