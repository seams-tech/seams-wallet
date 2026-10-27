import { serialize, type Schema } from 'borsh';
import { base64Encode } from '@shared/utils/base64';
import { base58Decode } from '@shared/utils/base58';
import { isPlainObject } from '@shared/utils/validation';
import { isValidAccountId } from '@shared/utils/near';
import {
  ActionType,
  toActionArgsWasm,
  type ActionArgs,
  type TransactionInput,
} from '../core/types/actions';
import { MeteorRequest, meteorTransportFromWindow } from './meteorRequest';
import type { ExternalNearConnection, ExternalNearNetwork } from './types';
import type { ValidatedNearMessage } from './message';

const transactionSchema: Schema = {
  struct: {
    signerId: 'string',
    publicKey: { struct: { keyType: 'u8', data: { array: { type: 'u8', len: 32 } } } },
    nonce: 'u64',
    receiverId: 'string',
    blockHash: { array: { type: 'u8', len: 32 } },
    actions: {
      array: {
        type: {
          enum: [
            { struct: { createAccount: { struct: {} } } },
            { struct: { deployContract: { struct: { code: { array: { type: 'u8' } } } } } },
            {
              struct: {
                functionCall: {
                  struct: {
                    methodName: 'string',
                    args: { array: { type: 'u8' } },
                    gas: 'u64',
                    deposit: 'u128',
                  },
                },
              },
            },
            { struct: { transfer: { struct: { deposit: 'u128' } } } },
          ],
        },
      },
    },
  },
};
function meteorAction(action: ActionArgs) {
  const value = toActionArgsWasm(action);
  switch (value.action_type) {
    case ActionType.Transfer:
      return { transfer: { deposit: BigInt(value.deposit) } };
    case ActionType.FunctionCall:
      return {
        functionCall: {
          methodName: value.method_name,
          args: new TextEncoder().encode(value.args),
          gas: BigInt(value.gas),
          deposit: BigInt(value.deposit),
        },
      };
    default:
      throw new Error('Unsupported external NEAR action.');
  }
}

export class MeteorExtensionProvider {
  readonly messageSigning = 'nep413';
  private lifecycle: 'active' | 'disposed' = 'active';
  private readonly transport = meteorTransportFromWindow();
  private request: MeteorRequest | null = null;
  private account: { accountId: string; network: ExternalNearNetwork } | null = null;
  constructor(private readonly rpcUrl: string) {}
  private async execute(
    network: ExternalNearNetwork,
    action: 'login' | 'sign' | 'sign_message',
    inputs: object,
  ): Promise<unknown> {
    if (this.lifecycle !== 'active') throw new Error('Meteor connection disposed.');
    const request = new MeteorRequest(this.transport, network, action, inputs);
    this.request = request;
    try {
      return await request.result;
    } finally {
      if (this.request === request) this.request = null;
    }
  }
  async connect(network: ExternalNearNetwork): Promise<unknown> {
    const response = await this.execute(network, 'login', { methods: [] });
    if (!isPlainObject(response) || !isValidAccountId(response.accountId))
      throw new Error('Invalid Meteor account.');
    this.account = { accountId: response.accountId, network };
    return [response.accountId];
  }
  async accounts(network: ExternalNearNetwork): Promise<unknown> {
    return this.account?.network === network ? [this.account.accountId] : [];
  }
  async signMessage(
    connection: ExternalNearConnection,
    message: ValidatedNearMessage,
  ): Promise<unknown> {
    if (
      this.account?.accountId !== connection.accountId ||
      this.account.network !== connection.network
    )
      throw new Error('Meteor account changed.');
    return this.execute(connection.network, 'sign_message', {
      accountId: connection.accountId,
      message: message.message,
      nonce: Array.from(message.nonce),
      recipient: message.recipient,
      callbackUrl: message.callbackUrl ?? undefined,
      state: message.state ?? undefined,
    });
  }
  async send(connection: ExternalNearConnection, transaction: TransactionInput): Promise<unknown> {
    if (
      this.account?.accountId !== connection.accountId ||
      this.account.network !== connection.network
    )
      throw new Error('Meteor account changed.');
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'meteor-block',
        method: 'block',
        params: { finality: 'final' },
      }),
    });
    const block: unknown = await response.json();
    if (
      !response.ok ||
      !isPlainObject(block) ||
      !isPlainObject(block.result) ||
      !isPlainObject(block.result.header) ||
      typeof block.result.header.hash !== 'string'
    )
      throw new Error('Cannot read NEAR block.');
    const blockHash = base58Decode(block.result.header.hash);
    if (blockHash.length !== 32) throw new Error('Invalid NEAR block hash.');
    // Meteor receives an unsigned template and selects its key and nonce in the wallet.
    const encoded = serialize(transactionSchema, {
      signerId: connection.accountId,
      publicKey: { keyType: 0, data: new Uint8Array(32) },
      nonce: 0n,
      receiverId: transaction.receiverId,
      blockHash,
      actions: transaction.actions.map(meteorAction),
    });
    const outcome = await this.execute(connection.network, 'sign', {
      transactions: base64Encode(encoded),
    });
    if (!isPlainObject(outcome)) throw new Error('Invalid Meteor response.');
    return outcome.executionOutcomes;
  }
  dispose(): void {
    this.lifecycle = 'disposed';
    this.request?.cancel();
    this.request = null;
    this.account = null;
  }
}
