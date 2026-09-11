import type {
  AccountView,
  AccessKeyInfoView,
  AccessKeyList,
  AccessKeyView,
  BlockReference,
  FinalityReference,
  FunctionCallPermissionView,
  RpcQueryRequest,
  TxExecutionStatus,
} from '@near-js/types';
import { base64Decode, base64Encode } from '@shared/utils/base64';
import { errorMessage } from '@shared/utils/errors';
import { secureRandomId } from '@shared/utils/secureRandomId';
import { isFunction } from '@shared/utils/validation';
import {
  decodeJsonRpcEnvelope,
  type JsonRpcEnvelope,
  type JsonRpcErrorDetails,
} from '@shared/utils/jsonRpc';
import {
  decodeNearAccessKeyList,
  decodeNearAccessKeyView,
  decodeNearAccountView,
  decodeNearBlockReference,
  decodeNearCodeBase64,
  decodeNearContractCallResult,
  parseNearContractResult,
  type DecodedNearFinalExecutionOutcome,
  decodeNearFinalExecutionOutcome,
  type DecodedNearBlockReference,
  type NearRpcResultDecoder,
} from '@shared/utils/nearRpcResults';

export type { AccessKeyList } from '@near-js/types';

type NearRpcErrorType =
  | 'InvalidTxError'
  | 'ActionError'
  | 'TxExecutionError'
  | 'RpcError'
  | 'Failure'
  | 'Unknown';

export type NearRpcFailureKind =
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

export interface ViewAccountParams {
  account: string;
  block_id?: string;
}

export type FullAccessKey = Omit<AccessKeyInfoView, 'access_key'> & {
  access_key: Omit<AccessKeyView, 'permission'> & { permission: 'FullAccess' };
};

export type FunctionCallAccessKey = Omit<AccessKeyInfoView, 'access_key'> & {
  access_key: Omit<AccessKeyView, 'permission'> & { permission: FunctionCallPermissionView };
};

export enum RpcCallType {
  Query = 'query',
  View = 'view',
  Send = 'send_tx',
  Block = 'block',
  Call = 'call_function',
}

const DEFAULT_WAIT_STATUS = {
  executeAction: 'EXECUTED_OPTIMISTIC' as TxExecutionStatus,
};

export class SignedTransaction {
  transaction: unknown;
  signature: unknown;
  borsh_bytes: number[];
  nonceLease?: unknown;
  serverDispatch?: {
    transactionHash: string;
    rpcResult: unknown;
  };

  constructor(data: {
    transaction: unknown;
    signature: unknown;
    borsh_bytes: number[];
    nonceLease?: unknown;
    serverDispatch?: {
      transactionHash: string;
      rpcResult: unknown;
    };
  }) {
    this.transaction = data.transaction;
    this.signature = data.signature;
    this.borsh_bytes = data.borsh_bytes;
    if (data.nonceLease) this.nonceLease = data.nonceLease;
    if (data.serverDispatch) this.serverDispatch = data.serverDispatch;
  }

  static fromPlain(input: {
    transaction: unknown;
    signature: unknown;
    borsh_bytes: number[];
    nonceLease?: unknown;
    serverDispatch?: {
      transactionHash: string;
      rpcResult: unknown;
    };
  }): SignedTransaction {
    return new SignedTransaction({
      transaction: input.transaction,
      signature: input.signature,
      borsh_bytes: input.borsh_bytes,
      ...(input.nonceLease ? { nonceLease: input.nonceLease } : {}),
      ...(input.serverDispatch ? { serverDispatch: input.serverDispatch } : {}),
    });
  }

  encode(): ArrayBuffer {
    return new Uint8Array(this.borsh_bytes).buffer;
  }

  base64Encode(): string {
    return base64Encode(this.encode());
  }
}

type EncodableSignedTx =
  | SignedTransaction
  | {
      borsh_bytes?: unknown;
      borshBytes?: unknown;
      encode?: () => ArrayBuffer;
      base64Encode?: () => string;
    };

function toArrayBufferFromUnknownBytes(bytes: unknown): ArrayBuffer | SharedArrayBuffer | null {
  if (!bytes) return null;
  if (Array.isArray(bytes)) return new Uint8Array(bytes as number[]).buffer;
  if (ArrayBuffer.isView(bytes)) {
    const view = bytes as ArrayBufferView;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }
  if (bytes instanceof ArrayBuffer) return bytes;
  return null;
}

function encodeSignedTransactionBase64(signed: EncodableSignedTx): string {
  const maybeSigned = (signed as any)?.signedTransaction;
  const txPayload: EncodableSignedTx =
    maybeSigned && typeof maybeSigned === 'object' ? (maybeSigned as EncodableSignedTx) : signed;
  const maybeBase64 = (txPayload as { base64Encode?: unknown }).base64Encode;
  if (isFunction(maybeBase64)) {
    return (maybeBase64 as () => string).call(txPayload);
  }
  const maybeEncode = (txPayload as { encode?: unknown }).encode;
  if (isFunction(maybeEncode)) {
    return base64Encode((maybeEncode as () => ArrayBuffer).call(txPayload));
  }
  const snakeBuf = toArrayBufferFromUnknownBytes(
    (txPayload as { borsh_bytes?: unknown }).borsh_bytes,
  );
  if (snakeBuf) return base64Encode(snakeBuf);
  const camelBuf = toArrayBufferFromUnknownBytes(
    (txPayload as { borshBytes?: unknown }).borshBytes,
  );
  if (camelBuf) return base64Encode(camelBuf);
  throw new Error('Invalid signed transaction payload: cannot serialize to base64');
}

export interface NearClient {
  viewAccessKey(
    accountId: string,
    publicKey: string,
    finalityQuery?: FinalityReference,
  ): Promise<AccessKeyView>;
  viewAccessKeyList(accountId: string, finalityQuery?: FinalityReference): Promise<AccessKeyList>;
  viewAccount(accountId: string): Promise<AccountView>;
  viewCode(accountId: string, finalityQuery?: FinalityReference): Promise<Uint8Array>;
  viewBlock(params: BlockReference): Promise<DecodedNearBlockReference>;
  sendTransaction(
    signedTransaction: SignedTransaction,
    waitUntil?: TxExecutionStatus,
  ): Promise<DecodedNearFinalExecutionOutcome>;
  txStatus(txHash: string, senderAccountId: string): Promise<DecodedNearFinalExecutionOutcome>;
  query<T>(params: RpcQueryRequest, decodeResult: NearRpcResultDecoder<T>): Promise<T>;
  callFunction<A, T>(
    accountId: string,
    method: string,
    args: A,
    decodeResult: NearRpcResultDecoder<T>,
    blockQuery?: BlockReference,
  ): Promise<T>;
  view<A, T>(params: {
    account: string;
    method: string;
    args: A;
    decodeResult: NearRpcResultDecoder<T>;
  }): Promise<T>;
  getAccessKeys(params: ViewAccountParams): Promise<{
    fullAccessKeys: FullAccessKey[];
    functionCallAccessKeys: FunctionCallAccessKey[];
  }>;
}

export class MinimalNearClient implements NearClient {
  private readonly rpcUrls: string[];

  constructor(rpcUrl: string | string[]) {
    this.rpcUrls = MinimalNearClient.normalizeRpcUrls(rpcUrl);
  }

  private static normalizeRpcUrls(input: string | string[]): string[] {
    const urls = Array.isArray(input)
      ? input
      : input
          .split(/[\s,]+/)
          .map((url) => url.trim())
          .filter(Boolean);
    const normalized = urls.map((url) => {
      try {
        return new URL(url).toString();
      } catch (err) {
        throw new Error(errorMessage(err) || `Invalid NEAR RPC URL: ${url}`);
      }
    });
    if (!normalized.length) throw new Error('NEAR RPC URL cannot be empty');
    return Array.from(new Set(normalized));
  }

  private buildRequestBody<P>(method: string, params: P): string {
    return JSON.stringify({
      jsonrpc: '2.0',
      id: secureRandomId('near-rpc', 32, 'NEAR JSON-RPC request IDs'),
      method,
      params,
    });
  }

  private async postOnce(url: string, requestBody: string): Promise<JsonRpcEnvelope> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
    });
    if (!response.ok)
      throw new Error(`RPC request failed: ${response.status} ${response.statusText}`);
    const text = await response.text();
    if (!text?.trim()) throw new Error('Empty response from RPC server');
    const raw: unknown = JSON.parse(text);
    const decoded = decodeJsonRpcEnvelope(raw);
    if (!decoded.ok) throw new Error(`Invalid NEAR JSON-RPC response: ${decoded.error}`);
    return decoded.value;
  }

  private async requestWithFallback(requestBody: string): Promise<JsonRpcEnvelope> {
    let lastError: unknown;
    for (const [index, url] of this.rpcUrls.entries()) {
      try {
        const result = await this.postOnce(url, requestBody);
        if (index > 0) console.warn(`[NearClient] RPC succeeded via fallback: ${url}`);
        return result;
      } catch (err) {
        lastError = err;
        const remaining = index < this.rpcUrls.length - 1;
        console.warn(
          `[NearClient] RPC call to ${url} failed${remaining ? ', trying next' : ''}: ${errorMessage(err) || 'RPC request failed'}`,
        );
        if (!remaining) throw err instanceof Error ? err : new Error(String(err));
      }
    }
    throw new Error(errorMessage(lastError) || 'RPC request failed');
  }

  private unwrapRpcResult(rpc: JsonRpcEnvelope, operationName: string): unknown {
    if (rpc.kind === 'failure') throw NearRpcError.fromRpcError(operationName, rpc.error);
    const result = rpc.result;
    if (typeof result === 'object' && result !== null && 'error' in result) {
      const wrappedError = Reflect.get(result, 'error');
      const msg = typeof wrappedError === 'string' ? wrappedError : JSON.stringify(wrappedError);
      throw new NearRpcError({
        message: `${operationName} Error: ${msg}`,
        short: 'RpcError',
        failureKind: 'infrastructure_failure',
        type: 'RpcError',
      });
    }
    return rpc.result;
  }

  private async makeRpcCall<P, T>(
    method: string,
    params: P,
    operationName: string,
    decodeResult: NearRpcResultDecoder<T>,
  ): Promise<T> {
    const requestBody = this.buildRequestBody(method, params);
    try {
      const envelope = await this.requestWithFallback(requestBody);
      return decodeResult(this.unwrapRpcResult(envelope, operationName));
    } catch (error: unknown) {
      throw normalizeNearRpcFailure(operationName, error);
    }
  }

  async query<T>(params: RpcQueryRequest, decodeResult: NearRpcResultDecoder<T>): Promise<T> {
    return this.makeRpcCall(RpcCallType.Query, params, 'Query', decodeResult);
  }

  async viewAccessKey(
    accountId: string,
    publicKey: string,
    finalityQuery?: FinalityReference,
  ): Promise<AccessKeyView> {
    const params = {
      request_type: 'view_access_key',
      finality: finalityQuery?.finality || 'final',
      account_id: accountId,
      public_key: publicKey,
    };
    return this.makeRpcCall(RpcCallType.Query, params, 'View Access Key', decodeNearAccessKeyView);
  }

  async viewAccessKeyList(
    accountId: string,
    finalityQuery?: FinalityReference,
  ): Promise<AccessKeyList> {
    const params = {
      request_type: 'view_access_key_list',
      finality: finalityQuery?.finality || 'final',
      account_id: accountId,
    };
    return this.makeRpcCall(
      RpcCallType.Query,
      params,
      'View Access Key List',
      decodeNearAccessKeyList,
    );
  }

  async viewAccount(accountId: string): Promise<AccountView> {
    const params = { request_type: 'view_account', finality: 'final', account_id: accountId };
    return this.makeRpcCall(RpcCallType.Query, params, 'View Account', decodeNearAccountView);
  }

  async viewCode(accountId: string, finalityQuery?: FinalityReference): Promise<Uint8Array> {
    const params = {
      request_type: 'view_code',
      finality: finalityQuery?.finality || 'final',
      account_id: accountId,
    };
    const codeBase64 = await this.makeRpcCall(
      RpcCallType.Query,
      params,
      'View Code',
      decodeNearCodeBase64,
    );
    return base64Decode(codeBase64);
  }

  async viewBlock(params: BlockReference): Promise<DecodedNearBlockReference> {
    return this.makeRpcCall(RpcCallType.Block, params, 'View Block', decodeNearBlockReference);
  }

  async sendTransaction(
    signedTransaction: SignedTransaction,
    waitUntil: TxExecutionStatus = DEFAULT_WAIT_STATUS.executeAction,
  ): Promise<DecodedNearFinalExecutionOutcome> {
    const params = {
      signed_tx_base64: encodeSignedTransactionBase64(signedTransaction),
      wait_until: waitUntil,
    };
    const outcome: DecodedNearFinalExecutionOutcome = await this.makeRpcCall(
      RpcCallType.Send,
      params,
      'Send Transaction',
      decodeNearFinalExecutionOutcome,
    );
    const status = outcome.status;
    if (status && typeof status === 'object' && 'Failure' in status) {
      throw NearRpcError.fromOutcome('Send Transaction', outcome, status.Failure);
    }
    return outcome;
  }

  async txStatus(
    txHash: string,
    senderAccountId: string,
  ): Promise<DecodedNearFinalExecutionOutcome> {
    return this.makeRpcCall(
      'EXPERIMENTAL_tx_status',
      { tx_hash: txHash, sender_account_id: senderAccountId },
      'Tx Status',
      decodeNearFinalExecutionOutcome,
    );
  }

  async callFunction<A, T>(
    accountId: string,
    method: string,
    args: A,
    decodeResult: NearRpcResultDecoder<T>,
    blockQuery?: BlockReference,
  ): Promise<T> {
    const rpcParams = {
      request_type: 'call_function',
      ...(blockQuery ?? { finality: 'final' }),
      account_id: accountId,
      method_name: method,
      args_base64: base64Encode(new TextEncoder().encode(JSON.stringify(args)).buffer),
    };
    const result = await this.makeRpcCall(
      RpcCallType.Query,
      rpcParams,
      'View Function',
      decodeNearContractCallResult,
    );
    return decodeResult(parseNearContractResult(result.result));
  }

  async view<A, T>(params: {
    account: string;
    method: string;
    args: A;
    decodeResult: NearRpcResultDecoder<T>;
  }): Promise<T> {
    return this.callFunction(params.account, params.method, params.args, params.decodeResult);
  }

  async getAccessKeys({ account, block_id }: ViewAccountParams): Promise<{
    fullAccessKeys: FullAccessKey[];
    functionCallAccessKeys: FunctionCallAccessKey[];
  }> {
    const params: Record<string, unknown> = {
      request_type: 'view_access_key_list',
      account_id: account,
      finality: 'final',
    };
    if (block_id) params.block_id = block_id;
    const result = await this.makeRpcCall(
      RpcCallType.Query,
      params,
      'Get Access Keys',
      decodeNearAccessKeyList,
    );
    const keys = result.keys || [];
    const fullAccessKeys: FullAccessKey[] = [];
    const functionCallAccessKeys: FunctionCallAccessKey[] = [];
    for (const key of keys) {
      const permission = key.access_key.permission;
      if (permission === 'FullAccess') {
        fullAccessKeys.push(key as FullAccessKey);
      } else if (typeof permission === 'object' && 'FunctionCall' in permission) {
        functionCallAccessKeys.push(key as FunctionCallAccessKey);
      }
    }
    return { fullAccessKeys, functionCallAccessKeys };
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
