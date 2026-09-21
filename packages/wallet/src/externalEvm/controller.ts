import { bytesToHex, getAddress, isAddress, numberToHex, type Hex } from 'viem';
import { createEvmClient } from '../core/rpcClients/evm/EvmClient';
import {
  inputFailure,
  malformedProviderResponse,
  parseAnnouncement,
  parseChainId,
  parseChains,
  parseExternalAccounts,
  parseHex,
  parsePhantomProvider,
  parseTransaction,
  parseTypedData,
  providerFailure,
  readExternalProviderState,
  type DiscoveredExternalProvider,
  type ExternalProvider,
} from './boundary';
import {
  connectedExternalEvm,
  externalEvmFailure,
  type ExternalEvmChain,
  type ExternalEvmConnection,
  type ExternalEvmFailure,
  type ExternalEvmReceipt,
  type ExternalEvmResult,
  type ExternalEvmSnapshot,
  type ExternalEvmState,
  type ExternalEvmSubmission,
  type ExternalEvmTransactionInput,
  type ExternalEvmWallet,
} from './types';

type OperationLease = Readonly<{
  token: symbol;
  binding: ProviderBinding;
}>;

const DISCONNECTED_EXTERNAL_EVM: ExternalEvmState = Object.freeze({
  kind: 'disconnected',
});

class ProviderBinding {
  constructor(
    readonly detail: DiscoveredExternalProvider,
    private readonly owner: ExternalEvmController,
  ) {}

  private readonly accountsChanged = (value: unknown): void => {
    this.owner.providerEvent(this, 'accounts', value);
  };

  private readonly chainChanged = (value: unknown): void => {
    this.owner.providerEvent(this, 'chain', value);
  };

  private readonly disconnected = (): void => {
    this.owner.providerEvent(this, 'disconnect', null);
  };

  attach(): void {
    this.detail.provider.on('accountsChanged', this.accountsChanged);
    this.detail.provider.on('chainChanged', this.chainChanged);
    this.detail.provider.on('disconnect', this.disconnected);
  }

  detach(): void {
    removeProviderListener(this.detail.provider, 'accountsChanged', this.accountsChanged);
    removeProviderListener(this.detail.provider, 'chainChanged', this.chainChanged);
    removeProviderListener(this.detail.provider, 'disconnect', this.disconnected);
  }
}

function removeProviderListener(
  provider: ExternalProvider,
  event: string,
  listener: (value: unknown) => void,
): void {
  try {
    provider.removeListener(event, listener);
  } catch {
    // Continue removing the other listeners from a broken extension provider.
  }
}

/** Host-owned controller. Construction is side-effect free; start discovery on mount. */
export class ExternalEvmController {
  readonly chains: readonly ExternalEvmChain[];
  private readonly registry = new Map<string, DiscoveredExternalProvider>();
  private readonly subscribers = new Set<() => void>();
  private readonly mountTokens = new Set<symbol>();
  private binding: ProviderBinding | null = null;
  private target: EventTarget | null = null;
  private activeRequestToken: symbol | null = null;
  private generation = 0;
  private eventVersion = 0;
  private snapshot: ExternalEvmSnapshot = Object.freeze({
    wallets: [],
    connection: DISCONNECTED_EXTERNAL_EVM,
    busy: false,
  });

  constructor(chains: readonly ExternalEvmChain[]) {
    this.chains = parseChains(chains);
  }

  getSnapshot = (): ExternalEvmSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return this.unsubscribe.bind(this, listener);
  };

  private unsubscribe(listener: () => void): void {
    this.subscribers.delete(listener);
  }

  private publish(
    connection: ExternalEvmState,
    wallets: readonly ExternalEvmWallet[] = this.snapshot.wallets,
  ): void {
    this.snapshot = Object.freeze({
      wallets,
      connection,
      busy: this.activeRequestToken !== null,
    });
    for (const listener of this.subscribers) listener();
  }

  start(target: EventTarget): void {
    if (this.target === target) return;
    if (this.target) {
      this.stopDiscovery();
      this.clearConnection([]);
    }
    this.target = target;
    target.addEventListener('eip6963:announceProvider', this.announce);
    try {
      const phantom = parsePhantomProvider(target);
      if (phantom) this.registerProvider(phantom);
    } catch {
      // An extension-owned namespace may expose throwing getters.
    }
    target.dispatchEvent(new Event('eip6963:requestProvider'));
  }

  mount = (): (() => void) => {
    const token = Symbol('external EVM mount');
    this.mountTokens.add(token);
    if (typeof window !== 'undefined') this.start(window);
    return this.releaseMount.bind(this, token);
  };

  private releaseMount(token: symbol): void {
    if (!this.mountTokens.delete(token)) return;
    if (this.mountTokens.size === 0) this.dispose();
  }

  private announce = (event: Event): void => {
    try {
      if (!('detail' in event)) return;
      const detail = parseAnnouncement(event.detail);
      if (detail) this.registerProvider(detail);
    } catch {
      // Announcements are extension-owned objects and may contain throwing getters.
    }
  };

  private registerProvider(detail: DiscoveredExternalProvider): void {
    if (this.registry.has(detail.wallet.id)) return;
    for (const registered of this.registry.values()) {
      if (registered.provider === detail.provider) return;
    }
    this.registry.set(detail.wallet.id, detail);
    const wallets = Object.freeze([...this.snapshot.wallets, detail.wallet]);
    this.publish(this.snapshot.connection, wallets);
  }

  disconnect = (): void => {
    this.clearConnection(this.snapshot.wallets);
  };

  private clearConnection(wallets: readonly ExternalEvmWallet[]): void {
    this.activeRequestToken = null;
    this.generation += 1;
    const previous = this.binding;
    this.binding = null;
    previous?.detach();
    this.publish(DISCONNECTED_EXTERNAL_EVM, wallets);
  }

  private stopDiscovery(): void {
    this.target?.removeEventListener('eip6963:announceProvider', this.announce);
    this.target = null;
    this.registry.clear();
  }

  dispose = (): void => {
    this.mountTokens.clear();
    this.stopDiscovery();
    this.clearConnection([]);
  };

  async connect(walletId: string): Promise<ExternalEvmResult<ExternalEvmConnection>> {
    if (this.activeRequestToken !== null) return pending();
    if (typeof walletId !== 'string' || !walletId.trim()) {
      return externalEvmFailure('invalid_input', 'Select a wallet.');
    }
    const normalizedWalletId = walletId.trim().toLowerCase();
    const detail = this.registry.get(normalizedWalletId);
    if (!detail || !this.target) {
      return externalEvmFailure('unavailable', 'Select an available wallet.');
    }
    this.disconnect();
    const requestToken = Symbol('external EVM connect request');
    this.activeRequestToken = requestToken;
    const generation = this.generation;
    const binding = new ProviderBinding(detail, this);
    this.binding = binding;
    this.publish(Object.freeze({ kind: 'connecting', wallet: detail.wallet }));
    try {
      binding.attach();
      await detail.provider.request({ method: 'eth_requestAccounts' });
      if (this.binding !== binding || this.generation !== generation) return changed();
      const version = this.eventVersion;
      const observed = await readExternalProviderState(detail.provider);
      if (
        this.binding !== binding ||
        this.generation !== generation ||
        version !== this.eventVersion
      ) {
        return changed();
      }
      if (!observed.ok) return observed;
      if (observed.value.kind === 'unauthorized') {
        return externalEvmFailure('unavailable', 'The wallet has no authorized accounts.');
      }
      const connection = connectedExternalEvm(
        generation,
        detail.wallet,
        observed.value.accounts,
        observed.value.accounts[0],
        observed.value.chainId,
        this.chains,
      );
      this.publish(connection);
      return { ok: true, value: connection };
    } catch (error) {
      return providerFailure(error);
    } finally {
      if (this.binding === binding && this.snapshot.connection.kind !== 'connected') {
        this.disconnect();
      }
      this.finishRequest(requestToken);
    }
  }

  providerEvent(
    binding: ProviderBinding,
    event: 'accounts' | 'chain' | 'disconnect',
    value: unknown,
  ): void {
    if (this.binding !== binding) return;
    this.eventVersion += 1;
    if (event === 'disconnect') {
      this.disconnect();
      return;
    }
    const current = this.snapshot.connection;
    if (current.kind !== 'connected') return;
    try {
      if (event === 'accounts') {
        const observed = parseExternalAccounts(value);
        if (!observed) {
          this.disconnect();
          return;
        }
        const accounts = observed;
        const selected = accounts.includes(current.account) ? current.account : accounts[0];
        this.publish(
          connectedExternalEvm(
            ++this.generation,
            current.wallet,
            accounts,
            selected,
            current.chainId,
            this.chains,
          ),
        );
      } else {
        this.publish(
          connectedExternalEvm(
            ++this.generation,
            current.wallet,
            current.accounts,
            current.account,
            parseChainId(value),
            this.chains,
          ),
        );
      }
    } catch {
      this.disconnect();
    }
  }

  selectAccount(
    connection: ExternalEvmConnection,
    address: string,
  ): ExternalEvmResult<ExternalEvmConnection> {
    if (this.snapshot.connection !== connection) return changed();
    if (typeof address !== 'string' || !isAddress(address)) {
      return externalEvmFailure(
        'invalid_input',
        'Enter an authorized account address.',
      );
    }
    const account = getAddress(address);
    if (!connection.accounts.includes(account)) {
      return externalEvmFailure(
        'unavailable',
        'Authorize this account in your wallet first.',
      );
    }
    const next = connectedExternalEvm(
      ++this.generation,
      connection.wallet,
      connection.accounts,
      account,
      connection.chainId,
      this.chains,
    );
    this.publish(next);
    return { ok: true, value: next };
  }

  private beginOperation(
    connection: ExternalEvmConnection,
  ): ExternalEvmResult<OperationLease> {
    if (this.activeRequestToken !== null) return pending();
    if (this.snapshot.connection !== connection || !this.binding) return changed();
    const lease = Object.freeze({
      token: Symbol('external EVM operation'),
      binding: this.binding,
    });
    this.activeRequestToken = lease.token;
    this.publish(connection);
    return { ok: true, value: lease };
  }

  private async validateOperation(
    connection: ExternalEvmConnection,
    lease: OperationLease,
  ): Promise<ExternalEvmResult<true>> {
    const version = this.eventVersion;
    const observed = await readExternalProviderState(lease.binding.detail.provider);
    if (!this.isCurrentOperation(connection, lease) || version !== this.eventVersion) {
      return changed();
    }
    if (!observed.ok) return observed;
    if (
      observed.value.kind === 'unauthorized' ||
      !observed.value.accounts.includes(connection.account) ||
      observed.value.chainId !== connection.chainId
    ) {
      this.disconnect();
      return changed();
    }
    return { ok: true, value: true };
  }

  private isCurrentOperation(
    connection: ExternalEvmConnection,
    lease: OperationLease,
  ): boolean {
    return (
      this.activeRequestToken === lease.token &&
      this.binding === lease.binding &&
      this.snapshot.connection === connection
    );
  }

  private finishRequest(token: symbol): void {
    if (this.activeRequestToken !== token) return;
    this.activeRequestToken = null;
    this.publish(this.snapshot.connection);
  }

  async switchChain(
    connection: ExternalEvmConnection,
    chainId: number,
  ): Promise<ExternalEvmResult<ExternalEvmConnection>> {
    const configuredChain = this.chains.find((chain) => chain.chainId === chainId);
    if (!configuredChain) {
      return externalEvmFailure('unsupported_chain', 'Choose a configured network.');
    }
    const started = this.beginOperation(connection);
    if (!started.ok) return started;
    const lease = started.value;
    try {
      const validated = await this.validateOperation(connection, lease);
      if (!validated.ok) return validated;
      if (!this.isCurrentOperation(connection, lease)) return changed();
      try {
        await lease.binding.detail.provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: numberToHex(configuredChain.chainId) }],
        });
      } catch (error) {
        return providerFailure(error);
      }
      const version = this.eventVersion;
      const observed = await readExternalProviderState(lease.binding.detail.provider);
      const current = this.snapshot.connection;
      if (
        this.activeRequestToken !== lease.token ||
        this.binding !== lease.binding ||
        current.kind !== 'connected' ||
        current.account !== connection.account ||
        version !== this.eventVersion
      ) {
        return changed();
      }
      if (!observed.ok) return observed;
      if (
        observed.value.kind === 'unauthorized' ||
        !observed.value.accounts.includes(connection.account)
      ) {
        this.disconnect();
        return changed();
      }
      if (observed.value.chainId !== configuredChain.chainId) {
        this.disconnect();
        return externalEvmFailure(
          'unsupported_chain',
          'The wallet did not switch to the requested network.',
        );
      }
      const next = connectedExternalEvm(
        ++this.generation,
        current.wallet,
        observed.value.accounts,
        current.account,
        observed.value.chainId,
        this.chains,
      );
      this.publish(next);
      return { ok: true, value: next };
    } finally {
      this.finishRequest(lease.token);
    }
  }

  async signMessage(
    connection: ExternalEvmConnection,
    message: Uint8Array,
  ): Promise<ExternalEvmResult<Hex>> {
    if (!(message instanceof Uint8Array)) {
      return externalEvmFailure('invalid_input', 'Provide message bytes.');
    }
    return this.sign(connection, 'personal_sign', [bytesToHex(message), connection.account]);
  }

  async signTypedData(
    connection: ExternalEvmConnection,
    data: unknown,
  ): Promise<ExternalEvmResult<Hex>> {
    let serialized: string;
    try {
      serialized = parseTypedData(data, connection.chainId);
    } catch (error) {
      return inputFailure(error);
    }
    return this.sign(connection, 'eth_signTypedData_v4', [connection.account, serialized]);
  }

  private async sign(
    connection: ExternalEvmConnection,
    method: string,
    params: readonly unknown[],
  ): Promise<ExternalEvmResult<Hex>> {
    const started = this.beginOperation(connection);
    if (!started.ok) return started;
    const lease = started.value;
    try {
      const validated = await this.validateOperation(connection, lease);
      if (!validated.ok) return validated;
      if (!this.isCurrentOperation(connection, lease)) return changed();
      let raw: unknown;
      try {
        raw = await lease.binding.detail.provider.request({ method, params });
      } catch (error) {
        return providerFailure(error);
      }
      if (!this.isCurrentOperation(connection, lease)) return changed();
      try {
        return { ok: true, value: parseHex(raw, 65) };
      } catch {
        return malformedProviderResponse();
      }
    } finally {
      this.finishRequest(lease.token);
    }
  }

  async sendTransaction(
    connection: ExternalEvmConnection,
    input: ExternalEvmTransactionInput,
  ): Promise<ExternalEvmResult<ExternalEvmSubmission>> {
    if (connection.network.kind !== 'configured') {
      return externalEvmFailure(
        'unsupported_chain',
        'Switch to a configured network first.',
      );
    }
    let transaction: Record<string, Hex>;
    try {
      transaction = parseTransaction(input, connection.account, connection.chainId);
    } catch (error) {
      return inputFailure(error);
    }
    const started = this.beginOperation(connection);
    if (!started.ok) return started;
    const lease = started.value;
    let dispatched = false;
    try {
      const validated = await this.validateOperation(connection, lease);
      if (!validated.ok) return validated;
      if (!this.isCurrentOperation(connection, lease)) return changed();
      dispatched = true;
      const raw = await lease.binding.detail.provider.request({
        method: 'eth_sendTransaction',
        params: [transaction],
      });
      try {
        return {
          ok: true,
          value: Object.freeze({
            kind: 'submitted',
            hash: parseHex(raw, 32),
            account: connection.account,
            chainId: connection.chainId,
          }),
        };
      } catch {
        return unknownSubmission();
      }
    } catch (error) {
      const failure = providerFailure(error);
      if (
        !dispatched ||
        ['rejected', 'unsupported_method', 'unsupported_chain', 'pending_request'].includes(
          failure.code,
        )
      ) {
        return failure;
      }
      return unknownSubmission();
    } finally {
      this.finishRequest(lease.token);
    }
  }

  async observeReceipt(submission: ExternalEvmSubmission): Promise<ExternalEvmReceipt> {
    const chain = this.chains.find((candidate) => candidate.chainId === submission.chainId);
    if (!chain) {
      return {
        kind: 'unresolved',
        submission,
        reason: 'Chain RPC is not configured.',
      };
    }
    try {
      const client = createEvmClient({ rpcUrl: chain.rpcUrl, requestTimeoutMs: 15_000 });
      const actualChain = parseChainId(
        await client.request({ method: 'eth_chainId', params: [] }),
      );
      if (actualChain !== submission.chainId) throw new Error('RPC chain mismatch.');
      const receipt = await client.getTransactionReceipt({
        txHash: parseHex(submission.hash, 32),
      });
      if (receipt === null) {
        return {
          kind: 'unresolved',
          submission,
          reason: 'Transaction receipt is pending.',
        };
      }
      if (
        parseHex(receipt.transactionHash, 32).toLowerCase() !== submission.hash.toLowerCase() ||
        typeof receipt.from !== 'string' ||
        !isAddress(receipt.from) ||
        getAddress(receipt.from) !== submission.account ||
        (receipt.status !== '0x1' && receipt.status !== '0x0') ||
        typeof receipt.blockNumber !== 'string'
      ) {
        throw new Error('Invalid receipt.');
      }
      return {
        kind: receipt.status === '0x1' ? 'confirmed' : 'reverted',
        submission,
        blockNumber: BigInt(receipt.blockNumber),
      };
    } catch {
      return {
        kind: 'unresolved',
        submission,
        reason: 'Receipt could not be verified. Check the wallet before retrying.',
      };
    }
  }
}

function changed(): ExternalEvmFailure {
  return externalEvmFailure(
    'connection_changed',
    'Your wallet connection changed. Review the account and network, then try again.',
  );
}

function pending(): ExternalEvmFailure {
  return externalEvmFailure('pending_request', 'Complete the pending wallet request.');
}

function unknownSubmission(): ExternalEvmFailure {
  return externalEvmFailure(
    'submission_unknown',
    'Submission outcome is unknown. Check your wallet activity before sending again.',
  );
}
