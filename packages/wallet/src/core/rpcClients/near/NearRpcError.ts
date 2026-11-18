import type { JsonRpcErrorDetails } from '@shared/utils/jsonRpc';
import type {
  DecodedNearFinalExecutionOutcome,
  NearRpcErrorType,
} from '@shared/utils/nearRpcResults';
import {
  describeNearTxExecution,
  nearTxExecutionFromRpcData,
} from '@shared/near/nearTxExecutionError';

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
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
  const execution = nearTxExecutionFromRpcData(details);
  if (execution) return describeTxExecution(operationName, execution);
  const detail =
    typeof details === 'string' && details.trim()
      ? details.trim()
      : isObj(details)
        ? JSON.stringify(details)
        : rpcMessage.trim();
  const suffix = detail ? `: ${detail}` : '';
  return { message: `${operationName} RPC error${suffix}` };
}

function describeFailure(operationName: string, failure: unknown): FailureDescription {
  if (!isObj(failure)) {
    return { message: `${operationName} failed (Unknown Failure)` };
  }
  return describeTxExecution(operationName, failure);
}

function describeTxExecution(
  operationName: string,
  exec: Record<string, unknown>,
): FailureDescription {
  const described = describeNearTxExecution(operationName, exec);
  return described.type === 'ActionError' && isObj(exec.ActionError)
    ? { ...described, reason: actionErrorReason(exec.ActionError) }
    : described;
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
