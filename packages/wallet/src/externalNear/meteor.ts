import { isObject } from '@shared/utils/validation';
import { MeteorConnect } from '@meteorwallet/sdk';
import { actionCreators } from '@near-js/transactions';
import {
  ActionType,
  toActionArgsWasm,
  type ActionArgs,
  type TransactionInput,
} from '../core/types/actions';
import type { ExternalNearConnection, ExternalNearNetwork, NearExtensionProvider } from './types';

class MemoryStorage {
  private values = new Map<string, string>();
  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function meteorAction(action: ActionArgs) {
  const value = toActionArgsWasm(action);
  switch (value.action_type) {
    case ActionType.Transfer:
      return actionCreators.transfer(BigInt(value.deposit));
    case ActionType.FunctionCall:
      return actionCreators.functionCall(
        value.method_name,
        new TextEncoder().encode(value.args),
        BigInt(value.gas),
        BigInt(value.deposit),
      );
    default:
      throw new Error('Unsupported external NEAR action.');
  }
}

export class MeteorExtensionProvider implements NearExtensionProvider {
  private transport: unknown = Reflect.get(window, 'meteorCom');
  private client = new MeteorConnect();
  private assertExtension(): void {
    if (!isObject(this.transport) || Reflect.get(window, 'meteorCom') !== this.transport) {
      throw new Error('Install Meteor or reconnect after the extension changes.');
    }
  }
  private ready = this.client.initialize({
    storage: new MemoryStorage(),
    mobileBridge: { enabled: false },
  });

  async connect(network: ExternalNearNetwork): Promise<unknown> {
    await this.ready;
    this.assertExtension();
    const action = await this.client.createAction({
      id: 'near::sign_in',
      input: { target: { blockchain: 'near', network } },
    });
    const account = await action.execute('v1_ext');
    if (account.connection.executionTarget !== 'v1_ext' || account.identifier.network !== network)
      throw new Error('Meteor extension connection required.');
    return [account.identifier.accountId];
  }

  async accounts(network: ExternalNearNetwork): Promise<unknown> {
    await this.ready;
    this.assertExtension();
    const accounts = await this.client.getAllAccounts({ blockchain: 'near', network });
    const result: string[] = [];
    for (const account of accounts) {
      if (account.connection.executionTarget === 'v1_ext')
        result.push(account.identifier.accountId);
    }
    return result;
  }

  async send(connection: ExternalNearConnection, transaction: TransactionInput): Promise<unknown> {
    this.assertExtension();
    const action = await this.client.createAction({
      id: 'near::sign_transactions',
      input: {
        target: {
          blockchain: 'near',
          network: connection.network,
          accountId: connection.accountId,
        },
        useFunctionCallKey: false,
        transactions: [
          { receiverId: transaction.receiverId, actions: transaction.actions.map(meteorAction) },
        ],
      },
    });
    return action.execute('v1_ext');
  }

  async disconnect(connection: ExternalNearConnection): Promise<void> {
    await this.client.removeSignedInAccount({
      blockchain: 'near',
      network: connection.network,
      accountId: connection.accountId,
    });
  }
}
