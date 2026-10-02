import { errorMessage } from '@shared/utils/errors';
import type { JsonRpcErrorDetails } from '@shared/utils/jsonRpc';
import type { DecodedNearFinalExecutionOutcome } from '@shared/utils/nearRpcResults';
import {
  NearJsonRpcClient,
  SignedTransaction as SharedSignedTransaction,
  type NearClient as SharedNearClient,
} from '@shared/near/nearClient';
import { NearRpcError } from './NearRpcError';
import type { WasmTransaction, WasmSignature } from '@/core/types/signer-worker';
import type { NonceLeaseRef } from '@/core/signingEngine/nonce/NonceCoordinator';

export { encodeSignedTransactionBase64 } from '@shared/near/nearClient';
// re-export near-js types
export type { AccessKeyList } from '@near-js/types';

export class SignedTransaction extends SharedSignedTransaction<
  WasmTransaction,
  WasmSignature,
  NonceLeaseRef
> {
  static fromPlain(input: {
    transaction: unknown;
    signature: unknown;
    borsh_bytes: number[];
    nonceLease?: NonceLeaseRef;
    serverDispatch?: {
      transactionHash: string;
      rpcResult: unknown;
    };
  }): SignedTransaction {
    return new SignedTransaction({
      transaction: input.transaction as WasmTransaction,
      signature: input.signature as WasmSignature,
      borsh_bytes: input.borsh_bytes,
      ...(input.nonceLease ? { nonceLease: input.nonceLease } : {}),
      ...(input.serverDispatch ? { serverDispatch: input.serverDispatch } : {}),
    });
  }

  static decode(): SignedTransaction {
    // This would need borsh deserialization
    throw new Error('SignedTransaction.decode(): borsh deserialization not implemented');
  }
}

export type NearClient = SharedNearClient<SignedTransaction>;

export class MinimalNearClient extends NearJsonRpcClient<SignedTransaction> {
  protected errorFromRpc(operationName: string, error: JsonRpcErrorDetails): Error {
    return NearRpcError.fromRpcError(operationName, error);
  }

  protected errorFromWrappedResult(message: string): Error {
    return new NearRpcError({ message, short: 'RpcError', type: 'RpcError' });
  }

  protected errorFromOutcome(
    operationName: string,
    outcome: DecodedNearFinalExecutionOutcome,
    failure: unknown,
  ): Error {
    return NearRpcError.fromOutcome(operationName, outcome, failure);
  }

  protected override errorFromHttpStatus(response: Response): Error {
    // sendWithRetry retries on this message.
    if (response.status === 429) return new Error('RPC throttled; retry shortly');
    return super.errorFromHttpStatus(response);
  }

  // Retry on transient RPC errors commonly seen with shared/public nodes
  protected override async sendWithRetry<T>(send: () => Promise<T>): Promise<T> {
    const maxAttempts = 5;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await send();
      } catch (err: unknown) {
        lastError = err;
        const msg = errorMessage(err);
        const retryable =
          /server error|internal|temporar|timeout|throttl|too many requests|429|unavailable|bad gateway|gateway timeout/i.test(
            msg || '',
          );
        if (!retryable || attempt === maxAttempts) {
          throw err;
        }
        // Exponential backoff with jitter (200–1200ms approx across attempts)
        const base = 200 * Math.pow(2, attempt - 1);
        const jitter = Math.floor(Math.random() * 150);
        await new Promise((r) => setTimeout(r, base + jitter));
      }
    }
    // Should be unreachable
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
