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
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';

export { encodeSignedTransactionBase64 } from '@shared/near/nearClient';
// re-export near-js types
export type { AccessKeyList } from '@near-js/types';

export class SignedTransaction extends SharedSignedTransaction<
  WasmTransaction,
  WasmSignature,
  NonceLeaseRef
> {
  readonly transactionHash: string;

  constructor(input: {
    transaction: WasmTransaction;
    signature: WasmSignature;
    borsh_bytes: number[];
    transactionHash: string;
    nonceLease?: NonceLeaseRef;
    serverDispatch?: { transactionHash: string; rpcResult: unknown };
  }) {
    super(input);
    this.transactionHash = input.transactionHash;
  }

  static fromPlain(input: {
    transaction: unknown;
    signature: unknown;
    borsh_bytes: number[];
    transactionHash: string;
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
      transactionHash: requireCanonicalString(input.transactionHash, 'signed transaction hash'),
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

/** An owner operation records its hash before one broadcast and then recovers by status. */
export class OwnerOperationNearClient extends MinimalNearClient {
  protected override readonly requestTimeoutMs = 30_000;

  protected override broadcastOutcome(
    outcome: DecodedNearFinalExecutionOutcome,
  ): DecodedNearFinalExecutionOutcome {
    // Owner operations classify confirmed failures as reverted and persist the exact hash.
    return outcome;
  }

  protected override sendWithRetry<T>(send: () => Promise<T>): Promise<T> {
    return send();
  }

  /**
   * The price at which NEAR buys a transaction's gas, in yoctoNEAR per gas unit. The
   * `gas_price` RPC gives the block price, but NEAR charges prepaid gas at no less than
   * the runtime's `min_gas_purchase_price` (protocol 88: 10^9, 10x the block price), so
   * a balance check that uses the block price alone passes a transaction that NEAR refuses.
   */
  async gasPurchasePrice(): Promise<bigint> {
    const [blockPrice, minimum] = await Promise.all([
      this.makeRpcCall('gas_price', [null], 'Gas Price', decodeGasPrice),
      this.makeRpcCall(
        'EXPERIMENTAL_protocol_config',
        { finality: 'final' },
        'Protocol Config',
        decodeMinGasPurchasePrice,
      ),
    ]);
    return blockPrice > minimum ? blockPrice : minimum;
  }

  /**
   * The chain that this node serves, and its validity rule: NEAR rejects a transaction
   * when its reference block is older than `validityPeriod` blocks.
   */
  async transactionValidity(): Promise<NearTransactionValidity> {
    return await this.makeRpcCall(
      'EXPERIMENTAL_genesis_config',
      [],
      'Genesis Config',
      decodeTransactionValidity,
    );
  }
}

type NearTransactionValidity = Readonly<{ chainId: string; validityPeriod: number }>;

function decodeGasPrice(raw: unknown): bigint {
  const price = requireRecord(raw, 'NEAR gas price').gas_price;
  if (typeof price !== 'string' || !/^\d+$/.test(price)) throw new Error('Invalid NEAR gas price');
  return BigInt(price);
}

function decodeMinGasPurchasePrice(raw: unknown): bigint {
  const runtime = requireRecord(
    requireRecord(raw, 'NEAR protocol config').runtime_config,
    'NEAR runtime config',
  );
  const price = runtime.min_gas_purchase_price;
  if (typeof price !== 'string' || !/^\d+$/.test(price))
    throw new Error('Invalid NEAR minimum gas purchase price');
  return BigInt(price);
}

function decodeTransactionValidity(raw: unknown): NearTransactionValidity {
  const genesis = requireRecord(raw, 'NEAR genesis config');
  const period = genesis.transaction_validity_period;
  if (typeof period !== 'number' || !Number.isSafeInteger(period) || period <= 0)
    throw new Error('Invalid NEAR transaction validity period');
  return {
    chainId: requireCanonicalString(genesis.chain_id, 'NEAR chain ID'),
    validityPeriod: period,
  };
}
