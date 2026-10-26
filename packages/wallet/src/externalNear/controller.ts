import { createNearWalletProvider, nearWalletName } from './wallets';
import { connectedNear } from './types';
import type { TransactionInput } from '../core/types/actions';
import { executionStatus, parseAccounts, parseSubmission, validateTransaction } from './boundary';
import type {
  ExternalNearConnection,
  ExternalNearNetwork,
  ExternalNearOutcome,
  ExternalNearResult,
  ExternalNearSnapshot,
  ExternalNearSubmission,
  NearWalletProvider,
  ExternalNearWalletId,
} from './types';

function failure(
  code:
    | 'unavailable'
    | 'invalid_input'
    | 'connection_changed'
    | 'pending_request'
    | 'submission_unknown',
  message: string,
): ExternalNearResult<never> {
  return { ok: false, code, message };
}

export class ExternalNearController {
  private snapshot: ExternalNearSnapshot = { connection: { kind: 'disconnected' }, busy: false };
  private listeners = new Set<() => void>();
  private generation = 0;
  private provider: NearWalletProvider | null = null;
  private pending = false;
  constructor(
    readonly network: ExternalNearNetwork,
    private readonly rpcUrl: string,
  ) {
    const url = new URL(rpcUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
      throw new Error('Use an HTTP NEAR RPC URL.');
  }
  getSnapshot = (): ExternalNearSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return this.unsubscribe.bind(this, listener);
  };
  private unsubscribe(listener: () => void): void {
    this.listeners.delete(listener);
  }
  private publish(connection: ExternalNearSnapshot['connection']): void {
    this.snapshot = Object.freeze({ connection, busy: this.pending });
    for (const listener of this.listeners) listener();
  }
  async connect(wallet: ExternalNearWalletId): Promise<ExternalNearResult<ExternalNearConnection>> {
    if (this.pending) return failure('pending_request', 'Complete the pending wallet request.');
    if (wallet === 'hot' && this.network !== 'mainnet') {
      return failure('unavailable', 'HOT Wallet is available on mainnet only.');
    }
    this.disconnect();
    this.pending = true;
    const generation = ++this.generation;
    this.publish({ kind: 'connecting' });
    try {
      const provider = await createNearWalletProvider(wallet, this.rpcUrl);
      if (generation !== this.generation) {
        provider.dispose();
        return failure('connection_changed', 'Wallet selection changed.');
      }
      this.provider = provider;
      const accounts = parseAccounts(await provider.connect(this.network));
      if (generation !== this.generation)
        return failure('connection_changed', 'Wallet selection changed.');
      const accountId = accounts[0];
      if (!accountId) return failure('unavailable', 'No wallet account is available.');
      const connection: ExternalNearConnection = connectedNear(
        wallet,
        accountId,
        this.network,
        generation,
      );
      this.publish(connection);
      return { ok: true, value: connection };
    } catch {
      if (generation !== this.generation)
        return failure('connection_changed', 'Wallet selection changed.');
      this.disconnect();
      return failure(
        'unavailable',
        `${nearWalletName(wallet)} did not connect. Check the wallet and network, then try again.`,
      );
    } finally {
      if (generation === this.generation) {
        this.pending = false;
        this.publish(this.snapshot.connection);
      }
    }
  }
  disconnect(): void {
    ++this.generation;
    const provider = this.provider;
    this.provider = null;
    this.pending = false;
    provider?.dispose();
    this.publish({ kind: 'disconnected' });
  }

  async sendTransaction(
    connection: ExternalNearConnection,
    input: TransactionInput,
  ): Promise<ExternalNearResult<ExternalNearSubmission>> {
    if (this.pending) return failure('pending_request', 'Complete the pending wallet request.');
    if (connection !== this.snapshot.connection || !this.provider)
      return failure('connection_changed', 'Reconnect the wallet before signing.');
    const provider = this.provider;
    const generation = this.generation;
    let transaction: TransactionInput;
    try {
      transaction = validateTransaction(input);
    } catch {
      return failure('invalid_input', 'Provide a valid transfer or function call.');
    }
    this.pending = true;
    this.publish(connection);
    let dispatched = false;
    try {
      const accounts = parseAccounts(await provider.accounts(this.network));
      if (connection !== this.snapshot.connection || !accounts.includes(connection.accountId))
        return failure('connection_changed', 'Wallet account changed. Reconnect before signing.');
      dispatched = true;
      const raw = await provider.send(connection, transaction);
      return { ok: true, value: parseSubmission(raw, connection) };
    } catch {
      return dispatched
        ? failure(
            'submission_unknown',
            'Submission is unknown. Check wallet activity before sending again.',
          )
        : failure('unavailable', 'Wallet account is unavailable.');
    } finally {
      if (generation === this.generation) {
        this.pending = false;
        this.publish(this.snapshot.connection);
      }
    }
  }
  async checkOutcome(submission: ExternalNearSubmission): Promise<ExternalNearOutcome> {
    if (submission.network !== this.network) return { kind: 'unresolved', submission };
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'external-near',
          method: 'tx',
          params: {
            tx_hash: submission.hash,
            sender_account_id: submission.accountId,
            wait_until: 'FINAL',
          },
        }),
      });
      if (!response.ok) return { kind: 'unresolved', submission };
      return { kind: executionStatus(await response.json(), submission), submission };
    } catch {
      return { kind: 'unresolved', submission };
    }
  }
}
