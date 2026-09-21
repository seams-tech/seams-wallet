import type { Address, Hex } from 'viem';

const connectionBrand: unique symbol = Symbol('external EVM connection');

export type ExternalEvmChain = Readonly<{ chainId: number; name: string; rpcUrl: string }>;
export type ExternalEvmWallet = Readonly<{
  id: string;
  name: string;
  icon: string | null;
  rdns: string | null;
}>;
export type ExternalEvmNetwork =
  | { readonly kind: 'configured'; readonly chain: ExternalEvmChain }
  | { readonly kind: 'unsupported'; readonly chain?: never };

export type ExternalEvmConnection = Readonly<{
  kind: 'connected';
  [connectionBrand]: true;
  generation: number;
  wallet: ExternalEvmWallet;
  accounts: readonly [Address, ...Address[]];
  account: Address;
  chainId: number;
  network: ExternalEvmNetwork;
}>;

export type ExternalEvmState =
  | ExternalEvmConnection
  | Readonly<{
      kind: 'disconnected';
      wallet?: never;
      account?: never;
      accounts?: never;
      chainId?: never;
      network?: never;
      generation?: never;
    }>
  | Readonly<{
      kind: 'connecting';
      wallet: ExternalEvmWallet;
      account?: never;
      accounts?: never;
      chainId?: never;
      network?: never;
      generation?: never;
    }>;

export type ExternalEvmErrorCode =
  | 'rejected'
  | 'unavailable'
  | 'connection_changed'
  | 'unsupported_chain'
  | 'unsupported_method'
  | 'pending_request'
  | 'invalid_input'
  | 'malformed_response'
  | 'provider_failure'
  | 'submission_unknown';

export type ExternalEvmFailure = Readonly<{
  ok: false;
  code: ExternalEvmErrorCode;
  message: string;
  value?: never;
}>;

export type ExternalEvmResult<T> =
  | Readonly<{
      ok: true;
      value: T;
      code?: never;
      message?: never;
    }>
  | ExternalEvmFailure;

export type ExternalEvmSnapshot = Readonly<{
  wallets: readonly ExternalEvmWallet[];
  connection: ExternalEvmState;
  busy: boolean;
}>;

export type ExternalEvmTransactionInput = Readonly<{
  to: string;
  data: Hex;
  value: bigint;
  gas: { readonly kind: 'wallet' } | { readonly kind: 'limit'; readonly limit: bigint };
  fees:
    | {
        readonly kind: 'wallet';
        readonly gasPrice?: never;
        readonly maxFeePerGas?: never;
        readonly maxPriorityFeePerGas?: never;
      }
    | {
        readonly kind: 'legacy';
        readonly gasPrice: bigint;
        readonly maxFeePerGas?: never;
        readonly maxPriorityFeePerGas?: never;
      }
    | {
        readonly kind: 'eip1559';
        readonly gasPrice?: never;
        readonly maxFeePerGas: bigint;
        readonly maxPriorityFeePerGas: bigint;
      };
}>;

export type ExternalEvmSubmission = Readonly<{
  kind: 'submitted';
  hash: Hex;
  account: Address;
  chainId: number;
}>;

export type ExternalEvmReceipt =
  | {
      readonly kind: 'confirmed' | 'reverted';
      readonly submission: ExternalEvmSubmission;
      readonly blockNumber: bigint;
      readonly reason?: never;
    }
  | {
      readonly kind: 'unresolved';
      readonly submission: ExternalEvmSubmission;
      readonly reason: string;
      readonly blockNumber?: never;
    };

export function connectedExternalEvm(
  generation: number,
  wallet: ExternalEvmWallet,
  accounts: readonly [Address, ...Address[]],
  account: Address,
  chainId: number,
  chains: readonly ExternalEvmChain[],
): ExternalEvmConnection {
  const configuredChain = chains.find((chain) => chain.chainId === chainId);
  const network: ExternalEvmNetwork = configuredChain
    ? Object.freeze({ kind: 'configured', chain: configuredChain })
    : Object.freeze({ kind: 'unsupported' });
  const connection: ExternalEvmConnection = {
    kind: 'connected',
    [connectionBrand]: true,
    generation,
    wallet,
    accounts: Object.freeze(accounts),
    account,
    chainId,
    network,
  };
  return Object.freeze(connection);
}

export function externalEvmFailure(
  code: ExternalEvmErrorCode,
  message: string,
): ExternalEvmFailure {
  return { ok: false, code, message };
}
