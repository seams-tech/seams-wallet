import { errorMessage } from '@shared/utils/errors';
import type { JsonRpcErrorDetails } from '@shared/utils/jsonRpc';
import type {
  DecodedNearFinalExecutionOutcome,
  NearRpcErrorType,
} from '@shared/utils/nearRpcResults';
import { NearJsonRpcClient } from '@shared/near/nearClient';

export type { AccessKeyList } from '@near-js/types';
export { SignedTransaction, type NearClient } from '@shared/near/nearClient';

type NearRpcFailureKind =
  | 'transaction_not_found'
  | 'account_not_found'
  | 'access_key_not_found'
  | 'invalid_nonce'
  | 'expired'
  | 'invalid_transaction'
  | 'action_error'
  | 'execution_failure'
  | 'infrastructure_failure'
  | 'unknown';

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
  readonly failureKind: NearRpcFailureKind;

  constructor(params: {
    message: string;
    short: string;
    failureKind: NearRpcFailureKind;
    type?: NearRpcErrorType;
    kind?: string;
    index?: number;
    code?: number;
    name?: string;
    operation?: string;
    details?: unknown;
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
    this.failureKind = params.failureKind;
  }

  static fromRpcError(operationName: string, err: JsonRpcErrorDetails): NearRpcError {
    const details = err.data;
    const rpcMessage = err.message;
    const { message, type, kind, index, short, failureKind } = describeDetails(operationName, err);
    return new NearRpcError({
      message: message || rpcMessage || `${operationName} RPC error`,
      short: short || kind || 'RPC error',
      failureKind,
      type: type || 'RpcError',
      kind,
      index,
      code: typeof err.code === 'number' ? err.code : undefined,
      name: err.name || 'NearRpcError',
      operation: operationName,
      details,
    });
  }

  static fromOutcome(operationName: string, outcome: any, failure: any): NearRpcError {
    const { message, type, kind, index, short, failureKind } = describeFailure(
      operationName,
      failure,
    );
    return new NearRpcError({
      message: message || `${operationName} failed`,
      short: short || kind || 'TxExecutionError',
      failureKind,
      type: type || 'Failure',
      kind,
      index,
      name: 'TxExecutionFailure',
      operation: operationName,
      details: { Failure: failure, outcome },
    });
  }
}

function describeDetails(
  operationName: string,
  error: JsonRpcErrorDetails,
): {
  message: string;
  type?: NearRpcErrorType;
  kind?: string;
  index?: number;
  short?: string;
  failureKind: NearRpcFailureKind;
} {
  const details = error.data;
  const rpcMessage = typeof error.message === 'string' ? error.message : '';
  const d = isObj(details) ? details : undefined;
  const txExec = isObj(d?.TxExecutionError)
    ? (d.TxExecutionError as Record<string, unknown>)
    : undefined;
  const directExecution = d && ('InvalidTxError' in d || 'ActionError' in d) ? d : undefined;
  if (txExec) return describeTxExecution(operationName, txExec);
  if (directExecution) return describeTxExecution(operationName, directExecution);

  const structuredName = rpcFailureName(error, d);
  const structuredFailureKind = classifyStructuredRpcFailure(structuredName);
  const detail =
    typeof details === 'string' && details.trim()
      ? details.trim()
      : d
        ? JSON.stringify(d)
        : rpcMessage.trim();
  const suffix = detail ? `: ${detail}` : '';
  return {
    message: `${operationName} RPC error${suffix}`,
    ...(structuredName ? { kind: structuredName } : {}),
    failureKind: structuredFailureKind,
  };
}

function rpcFailureName(
  error: JsonRpcErrorDetails,
  details: Record<string, unknown> | undefined,
): string | undefined {
  const directCause = isObj(error.cause) ? error.cause : undefined;
  const dataCause = isObj(details?.cause) ? details.cause : undefined;
  const candidates = [directCause?.name, dataCause?.name, details?.name, error.name];
  return candidates.find((candidate): candidate is string => typeof candidate === 'string');
}

function classifyStructuredRpcFailure(name: string | undefined): NearRpcFailureKind {
  switch (name) {
    case 'UNKNOWN_TRANSACTION':
    case 'TRANSACTION_NOT_FOUND':
      return 'transaction_not_found';
    case 'UNKNOWN_ACCOUNT':
    case 'ACCOUNT_DOES_NOT_EXIST':
      return 'account_not_found';
    case 'UNKNOWN_ACCESS_KEY':
    case 'ACCESS_KEY_DOES_NOT_EXIST':
      return 'access_key_not_found';
    default:
      return 'infrastructure_failure';
  }
}

function describeFailure(
  operationName: string,
  failure: any,
): {
  message: string;
  type?: NearRpcErrorType;
  kind?: string;
  index?: number;
  short?: string;
  failureKind: NearRpcFailureKind;
} {
  const f = isObj(failure) ? (failure as Record<string, unknown>) : undefined;
  if (!f) {
    return {
      message: `${operationName} failed (Unknown Failure)`,
      failureKind: 'unknown',
    };
  }
  return describeTxExecution(operationName, f);
}

function describeTxExecution(
  operationName: string,
  exec: Record<string, unknown>,
): {
  message: string;
  type?: NearRpcErrorType;
  kind?: string;
  index?: number;
  short?: string;
  failureKind: NearRpcFailureKind;
} {
  if ('InvalidTxError' in exec) {
    const kind = invalidTransactionKind(exec.InvalidTxError);
    const short = kind.startsWith('ActionsValidation.')
      ? `InvalidTxError: ${kind.split('.')[1] || 'ActionsValidation'}`
      : `InvalidTxError: ${kind}`;
    return {
      message: `${operationName} failed (InvalidTxError: ${kind})`,
      type: 'InvalidTxError',
      kind,
      short,
      failureKind: classifyInvalidTransaction(kind),
    };
  }

  if (isObj(exec.ActionError)) {
    const ae = exec.ActionError as Record<string, unknown>;
    const idx = typeof (ae.index as unknown) === 'number' ? (ae.index as number) : undefined;
    const kobj = isObj(ae.kind) ? (ae.kind as Record<string, unknown>) : undefined;
    const kind = firstKey(kobj) || 'ActionError';
    const idxStr = typeof idx === 'number' ? ` at action ${idx}` : '';
    return {
      message: `${operationName} failed${idxStr} (ActionError: ${kind})`,
      type: 'ActionError',
      kind,
      index: idx,
      short: `ActionError: ${kind}`,
      failureKind: 'action_error',
    };
  }

  return {
    message: `${operationName} failed (TxExecutionError)`,
    type: 'TxExecutionError',
    kind: 'TxExecutionError',
    short: 'TxExecutionError',
    failureKind: 'execution_failure',
  };
}

function invalidTransactionKind(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!isObj(value)) return 'InvalidTxError';
  if (isObj(value.ActionsValidation)) {
    return `ActionsValidation.${firstKey(value.ActionsValidation) || 'ActionsValidation'}`;
  }
  return firstKey(value) || 'InvalidTxError';
}

function classifyInvalidTransaction(kind: string): NearRpcFailureKind {
  switch (kind) {
    case 'InvalidNonce':
      return 'invalid_nonce';
    case 'Expired':
      return 'expired';
    default:
      return 'invalid_transaction';
  }
}

export class MinimalNearClient extends NearJsonRpcClient {
  protected errorFromRpc(operationName: string, error: JsonRpcErrorDetails): Error {
    return NearRpcError.fromRpcError(operationName, error);
  }

  protected errorFromWrappedResult(message: string): Error {
    return new NearRpcError({
      message,
      short: 'RpcError',
      failureKind: 'infrastructure_failure',
      type: 'RpcError',
    });
  }

  protected errorFromOutcome(
    operationName: string,
    outcome: DecodedNearFinalExecutionOutcome,
    failure: unknown,
  ): Error {
    return NearRpcError.fromOutcome(operationName, outcome, failure);
  }

  protected override errorFromFailedCall(operationName: string, error: unknown): NearRpcError {
    return normalizeNearRpcFailure(operationName, error);
  }
}

function normalizeNearRpcFailure(operationName: string, error: unknown): NearRpcError {
  if (error instanceof NearRpcError) return error;
  const cause = errorMessage(error) || 'RPC request failed';
  return new NearRpcError({
    message: `${operationName} RPC infrastructure failure: ${cause}`,
    short: 'RPC infrastructure failure',
    failureKind: 'infrastructure_failure',
    type: 'RpcError',
    operation: operationName,
    details: { cause },
  });
}
