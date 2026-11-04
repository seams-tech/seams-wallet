import { expect, test } from '@playwright/test';
import { ExternalEvmController } from '@/externalEvm';
import type { ExternalProvider } from '@/externalEvm/boundary';

const ICON = 'data:image/png;base64,AA==';
const WALLET_ID = '00000000-0000-4000-8000-000000000001';
const FIRST_ACCOUNT = '0x1111111111111111111111111111111111111111';
const SECOND_ACCOUNT = '0x2222222222222222222222222222222222222222';
const SIGNATURE = `0x${'11'.repeat(65)}`;
const TRANSACTION_HASH = `0x${'22'.repeat(32)}`;

type Request = { method: string; params?: readonly unknown[] };

type Deferred<T> = Readonly<{ promise: Promise<T>; resolve: (value: T) => void }>;

function requestedSwitchChainId(request: Request, currentChainId: unknown): unknown {
  const firstParameter = request.params?.[0];
  if (
    typeof firstParameter === 'object' &&
    firstParameter !== null &&
    'chainId' in firstParameter
  ) {
    return firstParameter.chainId;
  }
  return currentChainId;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function waitForProviderCall(
  provider: MockProvider,
  method: string,
  expectedCount = 1,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (provider.calls.filter((call) => call.method === method).length >= expectedCount) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${method}.`);
}

class MockProvider implements ExternalProvider {
  readonly calls: Request[] = [];
  private readonly listeners = new Map<string, Set<(value: unknown) => void>>();
  private pendingRequest: {
    method: string;
    deferred: Deferred<unknown>;
    consumed: boolean;
  } | null = null;
  accounts: unknown = [FIRST_ACCOUNT];
  chainId: unknown = '0x1';
  accountsAfterSwitch: unknown = undefined;
  chainIdAfterSwitch: unknown = undefined;
  requestError: unknown = null;
  sendTransactionError: unknown = null;

  holdNextRequest(method: string): Deferred<unknown> {
    this.pendingRequest = { method, deferred: deferred<unknown>(), consumed: false };
    return this.pendingRequest.deferred;
  }

  resolvePendingRequest(value: unknown): void {
    const pending = this.pendingRequest;
    this.pendingRequest = null;
    pending?.deferred.resolve(value);
  }

  async request(request: Request): Promise<unknown> {
    this.calls.push(request);
    if (this.requestError !== null) throw this.requestError;
    if (this.pendingRequest?.method === request.method && !this.pendingRequest.consumed) {
      const pending = this.pendingRequest;
      pending.consumed = true;
      return pending.deferred.promise;
    }
    switch (request.method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return this.accounts;
      case 'eth_chainId':
        return this.chainId;
      case 'personal_sign':
      case 'eth_signTypedData_v4':
        return SIGNATURE;
      case 'wallet_switchEthereumChain':
        if (this.chainIdAfterSwitch === undefined) {
          this.chainId = requestedSwitchChainId(request, this.chainId);
        } else {
          this.chainId = this.chainIdAfterSwitch;
        }
        if (this.accountsAfterSwitch !== undefined) {
          this.accounts = this.accountsAfterSwitch;
        }
        return null;
      case 'eth_sendTransaction':
        if (this.sendTransactionError !== null) throw this.sendTransactionError;
        return TRANSACTION_HASH;
      default:
        throw { code: -32601 };
    }
  }

  on(event: string, listener: (value: unknown) => void): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  removeListener(event: string, listener: (value: unknown) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }
}

function announce(target: EventTarget, provider: MockProvider): void {
  target.dispatchEvent(
    new CustomEvent('eip6963:announceProvider', {
      detail: {
        info: { uuid: WALLET_ID, name: 'Test Wallet', icon: ICON, rdns: 'test.wallet' },
        provider,
      },
    }),
  );
}

function controllerWithProvider(provider: MockProvider): {
  controller: ExternalEvmController;
  target: EventTarget;
} {
  const controller = new ExternalEvmController([
    { chainId: 1, name: 'Ethereum', rpcUrl: 'https://rpc.example.test' },
  ]);
  const target = new EventTarget();
  controller.start(target);
  announce(target, provider);
  return { controller, target };
}

test('switches only to configured chains and verifies the provider result', async () => {
  const provider = new MockProvider();
  const controller = new ExternalEvmController([
    { chainId: 1, name: 'Ethereum', rpcUrl: 'https://rpc.example.test' },
    { chainId: 11_155_111, name: 'Sepolia', rpcUrl: 'https://sepolia.example.test' },
  ]);
  const target = new EventTarget();
  controller.start(target);
  announce(target, provider);
  const connected = await controller.connect(WALLET_ID);
  expect(connected.ok).toBe(true);
  if (!connected.ok) return;
  const unsupported = await controller.switchChain(connected.value, 137);
  expect(unsupported).toMatchObject({ ok: false, code: 'unsupported_chain' });
  const switched = await controller.switchChain(connected.value, 11_155_111);
  expect(switched.ok).toBe(true);
  if (switched.ok) expect(switched.value.chainId).toBe(11_155_111);
});

test('disconnects when post-switch authorization no longer matches', async () => {
  const provider = new MockProvider();
  const controller = new ExternalEvmController([
    { chainId: 1, name: 'Ethereum', rpcUrl: 'https://rpc.example.test' },
    { chainId: 11_155_111, name: 'Sepolia', rpcUrl: 'https://sepolia.example.test' },
  ]);
  const target = new EventTarget();
  controller.start(target);
  announce(target, provider);
  const connected = await controller.connect(WALLET_ID);
  expect(connected.ok).toBe(true);
  if (!connected.ok) return;

  provider.accountsAfterSwitch = [SECOND_ACCOUNT];
  const switched = await controller.switchChain(connected.value, 11_155_111);

  expect(switched).toMatchObject({ ok: false, code: 'connection_changed' });
  expect(controller.getSnapshot().connection.kind).toBe('disconnected');
});

test('disconnects when the provider reports the wrong chain after switching', async () => {
  const provider = new MockProvider();
  const controller = new ExternalEvmController([
    { chainId: 1, name: 'Ethereum', rpcUrl: 'https://rpc.example.test' },
    { chainId: 11_155_111, name: 'Sepolia', rpcUrl: 'https://sepolia.example.test' },
  ]);
  const target = new EventTarget();
  controller.start(target);
  announce(target, provider);
  const connected = await controller.connect(WALLET_ID);
  expect(connected.ok).toBe(true);
  if (!connected.ok) return;

  provider.chainIdAfterSwitch = '0x2';
  const switched = await controller.switchChain(connected.value, 11_155_111);

  expect(switched).toMatchObject({ ok: false, code: 'unsupported_chain' });
  expect(controller.getSnapshot().connection.kind).toBe('disconnected');
});

test('rejects stale connections and wallet approval failures', async () => {
  const provider = new MockProvider();
  const { controller } = controllerWithProvider(provider);
  provider.requestError = { code: 4001 };
  const rejected = await controller.connect(WALLET_ID);
  expect(rejected).toMatchObject({ ok: false, code: 'rejected' });
  expect(controller.getSnapshot().connection.kind).toBe('disconnected');

  provider.requestError = null;
  provider.accounts = [FIRST_ACCOUNT, SECOND_ACCOUNT];
  const connected = await controller.connect(WALLET_ID);
  expect(connected.ok).toBe(true);
  if (!connected.ok) return;
  const stale = controller.selectAccount(connected.value, SECOND_ACCOUNT);
  expect(stale.ok).toBe(true);
  const oldSign = await controller.signMessage(connected.value, new Uint8Array([1]));
  expect(oldSign.ok).toBe(false);
  if (!oldSign.ok) expect(oldSign.code).toBe('connection_changed');
});

test('invalidates signing when the provider chain changes during approval', async () => {
  const provider = new MockProvider();
  const { controller } = controllerWithProvider(provider);
  const connected = await controller.connect(WALLET_ID);
  expect(connected.ok).toBe(true);
  if (!connected.ok) return;

  provider.holdNextRequest('personal_sign');
  const pending = controller.signMessage(connected.value, new Uint8Array([7]));
  await waitForProviderCall(provider, 'personal_sign');
  provider.emit('chainChanged', '0x2');
  provider.resolvePendingRequest(SIGNATURE);

  expect(await pending).toMatchObject({ ok: false, code: 'connection_changed' });
  expect(controller.getSnapshot().busy).toBe(false);
  const current = controller.getSnapshot().connection;
  expect(current.kind).toBe('connected');
  if (current.kind === 'connected') expect(current.chainId).toBe(2);
});

test('keeps transaction evidence when the provider account changes during approval', async () => {
  const provider = new MockProvider();
  provider.accounts = [FIRST_ACCOUNT, SECOND_ACCOUNT];
  const { controller } = controllerWithProvider(provider);
  const connected = await controller.connect(WALLET_ID);
  expect(connected.ok).toBe(true);
  if (!connected.ok) return;

  provider.holdNextRequest('eth_sendTransaction');
  const pending = controller.sendTransaction(connected.value, {
    to: SECOND_ACCOUNT,
    data: '0x',
    value: 0n,
    gas: { kind: 'wallet' },
    fees: { kind: 'wallet' },
  });
  await waitForProviderCall(provider, 'eth_sendTransaction');
  provider.emit('accountsChanged', [SECOND_ACCOUNT]);
  provider.resolvePendingRequest(TRANSACTION_HASH);

  expect(await pending).toEqual({
    ok: true,
    value: { kind: 'submitted', hash: TRANSACTION_HASH, account: FIRST_ACCOUNT, chainId: 1 },
  });
  expect(controller.getSnapshot().busy).toBe(false);
});

test('reports an unknown outcome for an unclassified post-dispatch failure', async () => {
  const provider = new MockProvider();
  provider.sendTransactionError = new Error('transport lost after dispatch');
  const { controller } = controllerWithProvider(provider);
  const connected = await controller.connect(WALLET_ID);
  expect(connected.ok).toBe(true);
  if (!connected.ok) return;

  const result = await controller.sendTransaction(connected.value, {
    to: FIRST_ACCOUNT,
    data: '0x',
    value: 0n,
    gas: { kind: 'wallet' },
    fees: { kind: 'wallet' },
  });

  expect(result).toMatchObject({ ok: false, code: 'submission_unknown' });
  expect(provider.calls.filter((call) => call.method === 'eth_sendTransaction')).toHaveLength(1);
  expect(controller.getSnapshot().busy).toBe(false);
});

test('requires the configured chain for transaction submission', async () => {
  const provider = new MockProvider();
  provider.chainId = '0x2';
  const { controller } = controllerWithProvider(provider);
  const connected = await controller.connect(WALLET_ID);
  expect(connected.ok).toBe(true);
  if (!connected.ok) return;
  const result = await controller.sendTransaction(connected.value, {
    to: FIRST_ACCOUNT,
    data: '0x',
    value: 0n,
    gas: { kind: 'wallet' },
    fees: { kind: 'wallet' },
  });
  expect(result).toMatchObject({ ok: false, code: 'unsupported_chain' });
});
