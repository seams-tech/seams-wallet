import {
  ExecutionStatusBasic,
  FinalExecutionStatusBasic,
  type ExecutionError,
  type TxExecutionStatus,
} from '@near-js/types';

export type NearRpcResultDecoder<T> = (value: unknown) => T;

export type DecodedNearFunctionCallPermission = {
  FunctionCall: {
    allowance: string;
    receiver_id: string;
    method_names: string[];
  };
};

export type DecodedNearAccessKeyView = {
  block_height: number;
  block_hash: string;
  nonce: bigint;
  permission: 'FullAccess' | DecodedNearFunctionCallPermission;
};

export type DecodedNearAccessKeyList = {
  block_height: number;
  block_hash: string;
  keys: Array<{
    public_key: string;
    access_key: DecodedNearAccessKeyView;
  }>;
};

export type DecodedNearAccountView = {
  block_height: number;
  block_hash: string;
  amount: bigint;
  locked: bigint;
  code_hash: string;
  storage_usage: number;
  storage_paid_at: number;
};

export type DecodedNearBlockReference = {
  header: {
    hash: string;
    height: number;
  };
};

export type DecodedNearContractCallResult = {
  block_height: number;
  block_hash: string;
  logs: string[];
  result: number[];
};

type DecodedNearExecutionError = ExecutionError & {
  InvalidTxError?: unknown;
  ActionError?: unknown;
};

export type DecodedNearFinalExecutionStatus =
  | { SuccessValue: string; Failure?: never }
  | { Failure: DecodedNearExecutionError; SuccessValue?: never }
  | FinalExecutionStatusBasic;

export type DecodedNearExecutionStatus =
  | { SuccessValue: string; SuccessReceiptId?: never; Failure?: never }
  | { SuccessReceiptId: string; SuccessValue?: never; Failure?: never }
  | { Failure: DecodedNearExecutionError; SuccessValue?: never; SuccessReceiptId?: never }
  | ExecutionStatusBasic;

type DecodedNearExecutionOutcome = {
  logs: string[];
  receipt_ids: string[];
  gas_burnt: number;
  tokens_burnt: string;
  executor_id: string;
  status: DecodedNearExecutionStatus;
};

export type DecodedNearFinalExecutionOutcome = {
  final_execution_status: TxExecutionStatus;
  status: DecodedNearFinalExecutionStatus;
  transaction: { hash: string };
  transaction_outcome: { id: string; outcome: DecodedNearExecutionOutcome };
  receipts_outcome: Array<{ id: string; outcome: DecodedNearExecutionOutcome }>;
};

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}: expected a string`);
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}: expected a string array`);
  }
  const strings: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new Error(`Invalid ${label}: expected a string array`);
    }
    strings.push(entry);
  }
  return strings;
}

function requireSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${label}: expected a non-negative safe integer`);
  }
  return value;
}

function requireDecimalBigint(value: unknown, label: string): bigint {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new Error(`Invalid ${label}: expected a safe integer or decimal string`);
  }
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+$/.test(String(value))) {
    throw new Error(`Invalid ${label}: expected an unsigned decimal integer`);
  }
  return BigInt(value);
}

function decodeNearQueryReference(
  record: Record<string, unknown>,
  label: string,
): {
  block_height: number;
  block_hash: string;
} {
  return {
    block_height: requireSafeInteger(record.block_height, `${label}.block_height`),
    block_hash: requireString(record.block_hash, `${label}.block_hash`),
  };
}

function decodeNearFunctionCallPermission(value: unknown): DecodedNearFunctionCallPermission {
  const permission = requireRecord(value, 'NEAR access key permission');
  const functionCall = requireRecord(
    permission.FunctionCall,
    'NEAR access key permission.FunctionCall',
  );
  return {
    FunctionCall: {
      allowance: requireString(functionCall.allowance, 'NEAR access key allowance'),
      receiver_id: requireString(functionCall.receiver_id, 'NEAR access key receiver_id'),
      method_names: requireStringArray(functionCall.method_names, 'NEAR access key method_names'),
    },
  };
}

function decodeNearAccessKeyPermission(
  value: unknown,
): 'FullAccess' | DecodedNearFunctionCallPermission {
  if (value === 'FullAccess') return value;
  return decodeNearFunctionCallPermission(value);
}

function decodeNearAccessKeyFields(
  record: Record<string, unknown>,
  queryReference: { block_height: number; block_hash: string },
): DecodedNearAccessKeyView {
  return {
    ...queryReference,
    nonce: requireDecimalBigint(record.nonce, 'NEAR access key nonce'),
    permission: decodeNearAccessKeyPermission(record.permission),
  };
}

export function decodeNearAccessKeyView(value: unknown): DecodedNearAccessKeyView {
  const record = requireRecord(value, 'NEAR access key response');
  return decodeNearAccessKeyFields(
    record,
    decodeNearQueryReference(record, 'NEAR access key response'),
  );
}

export function decodeNearAccessKeyList(value: unknown): DecodedNearAccessKeyList {
  const record = requireRecord(value, 'NEAR access key list response');
  const queryReference = decodeNearQueryReference(record, 'NEAR access key list response');
  if (!Array.isArray(record.keys)) {
    throw new Error('Invalid NEAR access key list response.keys: expected an array');
  }
  const keys: DecodedNearAccessKeyList['keys'] = [];
  for (const entry of record.keys) {
    const key = requireRecord(entry, 'NEAR access key list entry');
    const accessKey = requireRecord(key.access_key, 'NEAR access key list entry.access_key');
    keys.push({
      public_key: requireString(key.public_key, 'NEAR access key list entry.public_key'),
      access_key: decodeNearAccessKeyFields(accessKey, queryReference),
    });
  }
  return { ...queryReference, keys };
}

export function decodeNearAccountView(value: unknown): DecodedNearAccountView {
  const record = requireRecord(value, 'NEAR account response');
  return {
    ...decodeNearQueryReference(record, 'NEAR account response'),
    amount: requireDecimalBigint(record.amount, 'NEAR account response.amount'),
    locked: requireDecimalBigint(record.locked, 'NEAR account response.locked'),
    code_hash: requireString(record.code_hash, 'NEAR account response.code_hash'),
    storage_usage: requireSafeInteger(record.storage_usage, 'NEAR account response.storage_usage'),
    storage_paid_at: requireSafeInteger(
      record.storage_paid_at,
      'NEAR account response.storage_paid_at',
    ),
  };
}

export function decodeNearCodeBase64(value: unknown): string {
  const record = requireRecord(value, 'NEAR view code response');
  const codeBase64 = requireString(record.code_base64, 'NEAR view code response.code_base64');
  if (!codeBase64) throw new Error('Invalid NEAR view code response.code_base64: empty string');
  return codeBase64;
}

export function decodeNearBlockReference(value: unknown): DecodedNearBlockReference {
  const record = requireRecord(value, 'NEAR block response');
  const header = requireRecord(record.header, 'NEAR block response.header');
  return {
    header: {
      hash: requireString(header.hash, 'NEAR block response.header.hash'),
      height: requireSafeInteger(header.height, 'NEAR block response.header.height'),
    },
  };
}

export function decodeNearContractCallResult(value: unknown): DecodedNearContractCallResult {
  const record = requireRecord(value, 'NEAR contract call response');
  if (!Array.isArray(record.result)) {
    throw new Error('Invalid NEAR contract call response.result: expected bytes');
  }
  const result: number[] = [];
  for (const entry of record.result) {
    if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 0 || entry > 255) {
      throw new Error('Invalid NEAR contract call response.result: expected bytes');
    }
    result.push(entry);
  }
  return {
    ...decodeNearQueryReference(record, 'NEAR contract call response'),
    logs: requireStringArray(record.logs, 'NEAR contract call response.logs'),
    result,
  };
}

export function parseNearContractResult(bytes: readonly number[]): unknown {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function decodeNearExecutionError(value: unknown, label: string): DecodedNearExecutionError {
  const record = requireRecord(value, label);
  const errorType =
    typeof record.error_type === 'string'
      ? record.error_type
      : 'InvalidTxError' in record
        ? 'InvalidTxError'
        : 'ActionError' in record
          ? 'ActionError'
          : 'TxExecutionError';
  return {
    error_message:
      typeof record.error_message === 'string' ? record.error_message : 'NEAR execution failed',
    error_type: errorType,
    ...('InvalidTxError' in record ? { InvalidTxError: record.InvalidTxError } : {}),
    ...('ActionError' in record ? { ActionError: record.ActionError } : {}),
  };
}

function requireSingleStatus(record: Record<string, unknown>, keys: readonly string[]): void {
  let count = 0;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) count++;
  }
  if (count !== 1) throw new Error('Invalid NEAR status: expected exactly one variant');
}

function decodeNearExecutionStatus(value: unknown): DecodedNearExecutionStatus {
  if (value === 'Unknown') return ExecutionStatusBasic.Unknown;
  if (value === 'Pending') return ExecutionStatusBasic.Pending;
  if (value === 'Failure') return ExecutionStatusBasic.Failure;
  const record = requireRecord(value, 'NEAR execution status');
  requireSingleStatus(record, ['SuccessValue', 'SuccessReceiptId', 'Failure']);
  if (typeof record.SuccessValue === 'string') return { SuccessValue: record.SuccessValue };
  if (typeof record.SuccessReceiptId === 'string') {
    return { SuccessReceiptId: record.SuccessReceiptId };
  }
  if ('Failure' in record) {
    return { Failure: decodeNearExecutionError(record.Failure, 'NEAR execution failure') };
  }
  throw new Error('Invalid NEAR execution status');
}

function decodeNearFinalExecutionStatus(value: unknown): DecodedNearFinalExecutionStatus {
  if (value === 'NotStarted') return FinalExecutionStatusBasic.NotStarted;
  if (value === 'Started') return FinalExecutionStatusBasic.Started;
  if (value === 'Failure') return FinalExecutionStatusBasic.Failure;
  const record = requireRecord(value, 'NEAR final execution status');
  requireSingleStatus(record, ['SuccessValue', 'Failure']);
  if (typeof record.SuccessValue === 'string') return { SuccessValue: record.SuccessValue };
  if ('Failure' in record) {
    return { Failure: decodeNearExecutionError(record.Failure, 'NEAR final execution failure') };
  }
  throw new Error('Invalid NEAR final execution status');
}

function decodeNearExecutionOutcome(value: unknown): DecodedNearExecutionOutcome {
  const record = requireRecord(value, 'NEAR execution outcome');
  return {
    logs: requireStringArray(record.logs, 'NEAR execution outcome.logs'),
    receipt_ids: requireStringArray(record.receipt_ids, 'NEAR execution outcome.receipt_ids'),
    gas_burnt: requireSafeInteger(record.gas_burnt, 'NEAR execution outcome.gas_burnt'),
    tokens_burnt: requireString(record.tokens_burnt, 'NEAR execution outcome.tokens_burnt'),
    executor_id: requireString(record.executor_id, 'NEAR execution outcome.executor_id'),
    status: decodeNearExecutionStatus(record.status),
  };
}

function decodeNearExecutionOutcomeWithId(value: unknown): {
  id: string;
  outcome: DecodedNearExecutionOutcome;
} {
  const record = requireRecord(value, 'NEAR execution outcome with id');
  return {
    id: requireString(record.id, 'NEAR execution outcome id'),
    outcome: decodeNearExecutionOutcome(record.outcome),
  };
}

function decodeNearTransactionExecutionStatus(
  value: unknown,
): DecodedNearFinalExecutionOutcome['final_execution_status'] {
  switch (value) {
    case 'NONE':
    case 'INCLUDED':
    case 'INCLUDED_FINAL':
    case 'EXECUTED':
    case 'FINAL':
    case 'EXECUTED_OPTIMISTIC':
      return value;
    default:
      throw new Error('Invalid NEAR final_execution_status');
  }
}

export function decodeNearFinalExecutionOutcome(value: unknown): DecodedNearFinalExecutionOutcome {
  const record = requireRecord(value, 'NEAR final execution outcome');
  if (!Array.isArray(record.receipts_outcome)) {
    throw new Error('Invalid NEAR final execution outcome.receipts_outcome: expected an array');
  }
  return {
    final_execution_status: decodeNearTransactionExecutionStatus(record.final_execution_status),
    status: decodeNearFinalExecutionStatus(record.status),
    transaction: {
      hash: requireString(
        requireRecord(record.transaction, 'NEAR final execution outcome.transaction').hash,
        'NEAR final execution outcome.transaction.hash',
      ),
    },
    transaction_outcome: decodeNearExecutionOutcomeWithId(record.transaction_outcome),
    receipts_outcome: record.receipts_outcome.map(decodeNearExecutionOutcomeWithId),
  };
}
