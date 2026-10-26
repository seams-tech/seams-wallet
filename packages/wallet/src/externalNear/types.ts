import type { TransactionInput } from '../core/types/actions';

export type ExternalNearWalletId = 'meteor' | 'hot' | 'intear';

export type ExternalNearNetwork = 'mainnet' | 'testnet';
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
      readonly kind: 'disconnected' | 'connecting';
      readonly accountId?: never;
      readonly network?: never;
      readonly wallet?: never;
      readonly generation?: never;
    };
export type ExternalNearSnapshot = Readonly<{ connection: ExternalNearState; busy: boolean }>;
export type ExternalNearSubmission = Readonly<{
  hash: string;
  accountId: string;
  network: ExternalNearNetwork;
}>;
export type ExternalNearOutcome =
  | { readonly kind: 'confirmed' | 'failed'; readonly submission: ExternalNearSubmission }
  | { readonly kind: 'unresolved'; readonly submission: ExternalNearSubmission };

export interface NearWalletProvider {
  connect(network: ExternalNearNetwork): Promise<unknown>;
  accounts(network: ExternalNearNetwork): Promise<unknown>;
  send(connection: ExternalNearConnection, transaction: TransactionInput): Promise<unknown>;
  disconnect(connection: ExternalNearConnection): Promise<void>;
}
