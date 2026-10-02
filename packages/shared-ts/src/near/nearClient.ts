/**
 * Minimal NEAR RPC client that replaces @near-js/providers, with only the methods
 * the wallet and the server use. Each package extends NearJsonRpcClient with its
 * own NearRpcError.
 */

import type {
  TxExecutionStatus,
  AccessKeyView,
  AccessKeyInfoView,
  AccessKeyList,
  FunctionCallPermissionView,
  AccountView,
  BlockReference,
  RpcQueryRequest,
  FinalityReference,
} from '@near-js/types';
import { base64Encode, base64Decode } from '../utils/base64';
import { errorMessage } from '../utils/errors';
import { secureRandomId } from '../utils/secureRandomId';
import { isFunction } from '../utils/validation';
import {
  decodeJsonRpcEnvelope,
  type JsonRpcEnvelope,
  type JsonRpcErrorDetails,
} from '../utils/jsonRpc';
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
} from '../utils/nearRpcResults';

interface ViewAccountParams {
  account: string;
  block_id?: string;
}

type FullAccessKey = Omit<AccessKeyInfoView, 'access_key'> & {
  access_key: Omit<AccessKeyView, 'permission'> & { permission: 'FullAccess' };
};

type FunctionCallAccessKey = Omit<AccessKeyInfoView, 'access_key'> & {
  access_key: Omit<AccessKeyView, 'permission'> & { permission: FunctionCallPermissionView };
};

enum RpcCallType {
  Query = 'query',
  Send = 'send_tx',
  Block = 'block',
}

const DEFAULT_SEND_WAIT_UNTIL: TxExecutionStatus = 'EXECUTED_OPTIMISTIC';

type SignedTransactionFields<Tx, Sig, Lease> = {
  transaction: Tx;
  signature: Sig;
  borsh_bytes: number[];
  nonceLease?: Lease;
  serverDispatch?: {
    transactionHash: string;
    rpcResult: unknown;
  };
};

/** The wallet narrows the transaction, signature and nonce lease types. */
export class SignedTransaction<Tx = unknown, Sig = unknown, Lease = unknown> {
  transaction: Tx;
  signature: Sig;
  borsh_bytes: number[];
  nonceLease?: Lease;
  serverDispatch?: {
    transactionHash: string;
    rpcResult: unknown;
  };

  constructor(data: SignedTransactionFields<Tx, Sig, Lease>) {
    this.transaction = data.transaction;
    this.signature = data.signature;
    this.borsh_bytes = data.borsh_bytes;
    if (data.nonceLease) this.nonceLease = data.nonceLease;
    if (data.serverDispatch) this.serverDispatch = data.serverDispatch;
  }

  static fromPlain(input: SignedTransactionFields<unknown, unknown, unknown>): SignedTransaction {
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

/**
 * Serialize a signed transaction-like object to base64.
 * Accepts either our SignedTransaction instance or a plain object
 * with borsh bytes (borsh_bytes | borshBytes) from cross-origin RPC.
 *
 * Implementation notes / pitfalls:
 * - We always bind `this` correctly when calling .base64Encode() / .encode()
 *   so methods defined on SignedTransaction can safely call this.encode().
 * - The underlying base64Encode() helper is implemented to avoid spreading large
 *   Uint8Arrays into String.fromCharCode(...), which can overflow the JS call
 *   stack for big WASM binaries or large transactions.
 * - As a fallback, we accept raw borsh bytes in multiple shapes to keep the
 *   serializer resilient to different runtimes (plain objects, typed arrays, etc.).
 */
type EncodableSignedTx =
  | SignedTransaction
  | {
      // Borsh bytes in various shapes from different runtimes
      borsh_bytes?: unknown;
      borshBytes?: unknown;
      // Optional helper methods from some callers
      encode?: () => ArrayBuffer;
      base64Encode?: () => string;
    };

function toArrayBufferFromUnknownBytes(bytes: unknown): ArrayBuffer | SharedArrayBuffer | null {
  if (!bytes) return null;

  // Plain number[]
  if (Array.isArray(bytes)) {
    return new Uint8Array(bytes).buffer;
  }

  // Typed arrays / DataView
  if (ArrayBuffer.isView(bytes)) {
    const view = bytes;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }

  // Raw ArrayBuffer
  if (bytes instanceof ArrayBuffer) {
    return bytes;
  }

  return null;
}

export function encodeSignedTransactionBase64(signed: EncodableSignedTx): string {
  // Some call sites wrap the actual SignedTransaction in a { signedTransaction } envelope.
  // Normalize that here so the rest of the function always works with a concrete tx-like object.
  const maybeSigned = (signed as any)?.signedTransaction;
  const txPayload: EncodableSignedTx =
    maybeSigned && typeof maybeSigned === 'object' ? (maybeSigned as EncodableSignedTx) : signed;

  // 1) If the payload exposes a .base64Encode() helper (our SignedTransaction class),
  //    use it directly. Bind `this` so the method can safely call this.encode().
  const maybeBase64 = txPayload.base64Encode;
  if (isFunction(maybeBase64)) {
    return maybeBase64.call(txPayload);
  }

  // 2) Otherwise, fall back to a generic encode() → ArrayBuffer method if present.
  const maybeEncode = txPayload.encode;
  if (isFunction(maybeEncode)) {
    const buf = maybeEncode.call(txPayload);
    return base64Encode(buf);
  }

  // 3) Finally, accept raw borsh bytes in multiple shapes / field names.
  //    This keeps the serializer resilient across runtimes that may not
  //    hydrate SignedTransaction instances but still provide borsh_bytes/Bytes.
  const snakeBuf = toArrayBufferFromUnknownBytes(txPayload.borsh_bytes);
  if (snakeBuf) {
    return base64Encode(snakeBuf);
  }

  const camelBuf = toArrayBufferFromUnknownBytes(
    (txPayload as { borshBytes?: unknown }).borshBytes,
  );
  if (camelBuf) {
    return base64Encode(camelBuf);
  }

  throw new Error('Invalid signed transaction payload: cannot serialize to base64');
}

/**
 * MinimalNearClient provides a simplified interface for NEAR protocol interactions
 */
export interface NearClient<SignedTx = SignedTransaction> {
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
    signedTransaction: SignedTx,
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

export abstract class NearJsonRpcClient<SignedTx extends SignedTransaction = SignedTransaction>
  implements NearClient<SignedTx>
{
  private readonly rpcUrls: string[];

  constructor(rpcUrl: string | string[]) {
    this.rpcUrls = NearJsonRpcClient.normalizeRpcUrls(rpcUrl);
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
        const message = errorMessage(err) || `Invalid NEAR RPC URL: ${url}`;
        throw new Error(message);
      }
    });

    if (!normalized.length) {
      throw new Error('NEAR RPC URL cannot be empty');
    }

    return Array.from(new Set(normalized));
  }

  // ===========================
  // PACKAGE HOOKS
  // ===========================

  /** The error for a JSON-RPC error response. */
  protected abstract errorFromRpc(operationName: string, error: JsonRpcErrorDetails): Error;

  /** The error for a result that carries an `error`, as some providers return. */
  protected abstract errorFromWrappedResult(message: string): Error;

  /** The error for a sent transaction whose outcome status is a Failure. */
  protected abstract errorFromOutcome(
    operationName: string,
    outcome: DecodedNearFinalExecutionOutcome,
    failure: unknown,
  ): Error;

  /** The error for a non-2xx HTTP response. */
  protected errorFromHttpStatus(response: Response): Error {
    return new Error(`RPC request failed: ${response.status} ${response.statusText}`);
  }

  /**
   * What a call rejects with when its request, response or decoding fails; the
   * server reports every such failure as a NearRpcError.
   */
  protected errorFromFailedCall(_operationName: string, error: unknown): unknown {
    return error;
  }

  /** Sends a transaction once; the wallet retries transient failures. */
  protected sendWithRetry<T>(send: () => Promise<T>): Promise<T> {
    return send();
  }

  // ===========================
  // PRIVATE HELPER FUNCTIONS
  // ===========================

  /** Build a JSON-RPC 2.0 POST body (stringified). */
  private buildRequestBody<P>(method: string, params: P): string {
    return JSON.stringify({
      jsonrpc: '2.0',
      id: secureRandomId('near-rpc', 32, 'NEAR JSON-RPC request IDs'),
      method,
      params,
    });
  }

  /** Perform a single POST to one endpoint and decode its JSON-RPC envelope. */
  private async postOnce(url: string, requestBody: string): Promise<JsonRpcEnvelope> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
    });

    if (!response.ok) {
      throw this.errorFromHttpStatus(response);
    }

    const text = await response.text();
    if (!text?.trim()) {
      throw new Error('Empty response from RPC server');
    }

    const raw: unknown = JSON.parse(text);
    const decoded = decodeJsonRpcEnvelope(raw);
    if (!decoded.ok) throw new Error(`Invalid NEAR JSON-RPC response: ${decoded.error}`);
    return decoded.value;
  }

  /** Try each configured RPC endpoint in order and return the first decoded envelope. */
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

  /** Unwrap an envelope while keeping the method result unknown. */
  private unwrapRpcResult(rpc: JsonRpcEnvelope, operationName: string): unknown {
    if (rpc.kind === 'failure') {
      throw this.errorFromRpc(operationName, rpc.error);
    }
    const result = rpc.result;
    // Some providers return a wrapped error in `result.error`
    if (typeof result === 'object' && result !== null && 'error' in result) {
      const wrappedError = Reflect.get(result, 'error');
      const msg = typeof wrappedError === 'string' ? wrappedError : JSON.stringify(wrappedError);
      throw this.errorFromWrappedResult(`${operationName} Error: ${msg}`);
    }
    return rpc.result;
  }

  /**
   * Execute RPC call with proper error handling and result extraction
   */
  private async makeRpcCall<P, T>(
    method: string,
    params: P,
    operationName: string,
    decodeResult: NearRpcResultDecoder<T>,
  ): Promise<T> {
    const requestBody = this.buildRequestBody(method, params);
    try {
      const rpc = await this.requestWithFallback(requestBody);
      return decodeResult(this.unwrapRpcResult(rpc, operationName));
    } catch (error: unknown) {
      throw this.errorFromFailedCall(operationName, error);
    }
  }

  // ===========================
  // PUBLIC API METHODS
  // ===========================

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
    const params = {
      request_type: 'view_account',
      finality: 'final',
      account_id: accountId,
    };
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
    signedTransaction: SignedTx,
    waitUntil: TxExecutionStatus = DEFAULT_SEND_WAIT_UNTIL,
  ): Promise<DecodedNearFinalExecutionOutcome> {
    const params = {
      signed_tx_base64: encodeSignedTransactionBase64(signedTransaction),
      wait_until: waitUntil,
    };
    return this.sendWithRetry(async () => {
      const outcome: DecodedNearFinalExecutionOutcome = await this.makeRpcCall(
        RpcCallType.Send,
        params,
        'Send Transaction',
        decodeNearFinalExecutionOutcome,
      );
      // near-api-js throws on Failure; replicate that for clearer UX
      const status = outcome.status;
      if (status && typeof status === 'object' && 'Failure' in status) {
        throw this.errorFromOutcome('Send Transaction', outcome, status.Failure);
      }
      return outcome;
    });
  }

  async txStatus(
    txHash: string,
    senderAccountId: string,
  ): Promise<DecodedNearFinalExecutionOutcome> {
    const params = {
      tx_hash: txHash,
      sender_account_id: senderAccountId,
    };
    return this.makeRpcCall(
      'EXPERIMENTAL_tx_status',
      params,
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
    // Build RPC parameters similar to the official implementation
    const params: Record<string, unknown> = {
      request_type: 'view_access_key_list',
      account_id: account,
      finality: 'final',
    };

    // Add block_id if provided (for specific block queries)
    if (block_id) {
      params.block_id = block_id;
      delete params.finality; // block_id takes precedence over finality
    }

    // Make the RPC call directly to match the official implementation
    const accessKeyList = await this.makeRpcCall(
      RpcCallType.Query,
      params,
      'View Access Key List',
      decodeNearAccessKeyList,
    );

    // Separate full access keys and function call access keys
    const fullAccessKeys: FullAccessKey[] = [];
    const functionCallAccessKeys: FunctionCallAccessKey[] = [];

    // Process each access key (matching the official categorization logic)
    for (const key of accessKeyList.keys) {
      if (key.access_key.permission === 'FullAccess') {
        // Full Access Keys: Keys with FullAccess permission
        fullAccessKeys.push(key as FullAccessKey);
      } else if (
        key.access_key.permission &&
        typeof key.access_key.permission === 'object' &&
        'FunctionCall' in key.access_key.permission
      ) {
        // Function Call Keys: Keys with limited permissions for specific contract calls
        functionCallAccessKeys.push(key as FunctionCallAccessKey);
      }
    }

    return {
      fullAccessKeys,
      functionCallAccessKeys,
    };
  }
}
