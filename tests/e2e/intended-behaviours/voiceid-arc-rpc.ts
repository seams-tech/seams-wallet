import type { Route } from '@playwright/test';
import {
  isHex,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  serializeTransaction,
  toHex,
} from 'viem';
import { requireRecord, requireCanonicalString } from '@shared/utils/validation';

export class VoiceIdArcRpc {
  readonly transactions: {
    hash: string;
    raw: string;
    sender: string;
    to: string;
    value: string;
    chainId: number;
    nonce: number;
  }[] = [];
  async handle(route: Route): Promise<void> {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
      });
      return;
    }
    const body = requireRecord(route.request().postDataJSON(), 'Arc RPC');
    const method = requireCanonicalString(body.method, 'RPC method');
    const params = Array.isArray(body.params) ? body.params : [];
    const result = await this.result(method, params);
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result }),
    });
  }
  private async result(method: string, params: unknown[]): Promise<unknown> {
    const transaction = this.transactions[this.transactions.length - 1];
    switch (method) {
      case 'eth_chainId':
        return toHex(5_042_002);
      case 'eth_getTransactionCount':
        return toHex(this.transactions.length);
      case 'eth_gasPrice':
        return '0x3b9aca00';
      case 'eth_estimateGas':
        return '0x5208';
      case 'eth_getBalance':
        return '0xde0b6b3a7640000';
      case 'eth_getCode':
        return '0x';
      case 'eth_blockNumber':
        return '0x10';
      case 'eth_getBlockByNumber':
        return {
          number: '0x10',
          hash: `0x${'ab'.repeat(32)}`,
          timestamp: '0x1',
          baseFeePerGas: '0x3b9aca00',
        };
      case 'eth_sendRawTransaction': {
        const raw = params[0];
        if (typeof raw !== 'string' || !isHex(raw)) throw new Error('Expected signed EVM bytes');
        const parsed = parseTransaction(raw);
        if (
          parsed.type !== 'eip1559' ||
          !parsed.to ||
          parsed.chainId !== 5_042_002 ||
          parsed.value !== 1n ||
          (parsed.data && parsed.data !== '0x')
        )
          throw new Error('Unexpected Arc transfer');
        const sender = await recoverTransactionAddress({
          serializedTransaction: serializeTransaction(parsed),
        });
        if (sender.toLowerCase() !== parsed.to.toLowerCase())
          throw new Error('Arc transfer is not signed by its self-transfer recipient');
        const hash = keccak256(raw);
        this.transactions.push({
          hash,
          raw,
          sender,
          to: parsed.to,
          value: String(parsed.value),
          chainId: parsed.chainId,
          nonce: parsed.nonce ?? 0,
        });
        return hash;
      }
      case 'eth_getTransactionReceipt':
        return transaction
          ? {
              transactionHash: transaction.hash,
              blockNumber: '0x10',
              blockHash: `0x${'ab'.repeat(32)}`,
              status: '0x1',
              gasUsed: '0x5208',
              effectiveGasPrice: '0x3b9aca00',
              logs: [],
              from: transaction.sender,
              to: transaction.to,
            }
          : null;
      case 'eth_getTransactionByHash':
        return transaction
          ? {
              hash: transaction.hash,
              from: transaction.sender,
              to: transaction.to,
              value: toHex(BigInt(transaction.value)),
              input: '0x',
              nonce: toHex(transaction.nonce),
              blockNumber: '0x10',
            }
          : null;
      default:
        throw new Error(`Unhandled Arc RPC method ${method}`);
    }
  }
}
