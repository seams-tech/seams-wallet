import { isObject } from '@shared/utils/validation';
import type { TransactionInput } from '../core/types/actions';
import { externalNearAction } from './actions';
import type { ExternalNearConnection, ExternalNearNetwork, NearWalletProvider } from './types';

/** Direct extension API documented by hot-dao/hot-sdk-js. No iframe fallback. */
export class HotExtensionProvider implements NearWalletProvider {
  private readonly transport: unknown = Reflect.get(window, 'hotExtension');
  private async request(method: string, params: object): Promise<unknown> {
    if (!isObject(this.transport) || Reflect.get(window, 'hotExtension') !== this.transport) {
      throw new Error('Install HOT Wallet or reconnect after the extension changes.');
    }
    const request: unknown = this.transport.request;
    if (typeof request !== 'function') throw new Error('HOT extension API is unavailable.');
    return Reflect.apply(request, this.transport, [method, params]);
  }
  async connect(network: ExternalNearNetwork): Promise<unknown> {
    if (network !== 'mainnet') throw new Error('HOT testnet support is not qualified.');
    const response = await this.request('near:signIn', {});
    if (!isObject(response)) throw new Error('Invalid HOT account response.');
    return [response.accountId];
  }
  async accounts(network: ExternalNearNetwork): Promise<unknown> {
    return this.connect(network);
  }
  async send(connection: ExternalNearConnection, transaction: TransactionInput): Promise<unknown> {
    if (connection.network !== 'mainnet') throw new Error('HOT requires mainnet.');
    const response = await this.request('near:signAndSendTransactions', {
      transactions: [
        {
          signerId: connection.accountId,
          receiverId: transaction.receiverId,
          actions: transaction.actions.map(externalNearAction),
        },
      ],
    });
    if (!isObject(response)) throw new Error('Invalid HOT transaction response.');
    return response.transactions;
  }
  async disconnect(): Promise<void> {
    // Site permissions remain in the extension. Controller disposal revokes local authority.
  }
}
