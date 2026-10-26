import type { TransactionInput } from '../core/types/actions';
import type { ValidatedNearMessage } from './message';

export type ExternalNearWalletId = 'meteor' | 'hot' | 'intear';

export type ExternalNearNetwork = 'mainnet' | 'testnet';

export type ExternalNearConfig = Readonly<{
  network: ExternalNearNetwork;
  rpcUrl: string;
  wallets: readonly ExternalNearWalletId[];
}>;
export type ExternalNearResult<T> =
  | { readonly ok: true; readonly value: T; readonly code?: never; readonly message?: never }
  | {
      readonly ok: false;
      readonly code:
        | 'unavailable'
        | 'invalid_input'
        | 'connection_changed'
        | 'pending_request'
        | 'submission_unknown';
      readonly message: string;
      readonly value?: never;
    };

const connectionBrand: unique symbol = Symbol('external NEAR connection');

export function connectedNear(
  wallet: ExternalNearWalletId,
  accountId: string,
  network: ExternalNearNetwork,
  generation: number,
): ExternalNearConnection {
  const connection: ExternalNearConnection = {
    kind: 'connected',
    wallet,
    accountId,
    network,
    generation,
    [connectionBrand]: true,
  };
  return Object.freeze(connection);
}

export type ExternalNearConnection = Readonly<{
  kind: 'connected';
  [connectionBrand]: true;
  accountId: string;
  network: ExternalNearNetwork;
  wallet: ExternalNearWalletId;
  generation: number;
}>;
export type ExternalNearState =
  | ExternalNearConnection
  | {
      readonly kind: 'disconnected';
      readonly accountId?: never;
      readonly network?: never;
      readonly wallet?: never;
      readonly generation?: never;
    }
  | {
      readonly kind: 'connecting';
      readonly wallet: ExternalNearWalletId;
      readonly accountId?: never;
      readonly network?: never;
      readonly generation?: never;
    };
export type ExternalNearSnapshot = Readonly<{
  connection: ExternalNearState;
  busy: boolean;
  wallets: readonly ExternalNearWalletId[];
}>;
export type ExternalNearSubmission = Readonly<{
  hash: string;
  accountId: string;
  network: ExternalNearNetwork;
}>;
export type ExternalNearOutcome =
  | { readonly kind: 'confirmed' | 'failed'; readonly submission: ExternalNearSubmission }
  | { readonly kind: 'unresolved'; readonly submission: ExternalNearSubmission };

export type ExternalNearMessageParams = Readonly<{
  message: string;
  recipient: string;
  nonce: Uint8Array;
  callbackUrl?: string;
  state?: string;
}>;

export type ExternalNearSignedMessage = Readonly<{
  accountId: string;
  publicKey: string;
  signature: string;
  state?: string;
}>;

export type NearWalletProvider = {
  connect(network: ExternalNearNetwork): Promise<unknown>;
  accounts(network: ExternalNearNetwork): Promise<unknown>;
  send(connection: ExternalNearConnection, transaction: TransactionInput): Promise<unknown>;
  dispose(): void;
} & (
  | {
      readonly messageSigning: 'nep413';
      signMessage(
        connection: ExternalNearConnection,
        message: ValidatedNearMessage,
      ): Promise<unknown>;
    }
  | { readonly messageSigning: 'unsupported'; readonly signMessage?: never }
);
