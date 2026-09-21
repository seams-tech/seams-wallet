import { expect, test } from '@playwright/test';
import { ExternalEvmController } from '@/externalEvm';
import { providerFailure, type ExternalProvider } from '@/externalEvm/boundary';
import type { ExternalEvmSubmission } from '@/externalEvm';

const ICON = 'data:image/png;base64,AA==';
const WALLET_ID = '00000000-0000-4000-8000-000000000001';
const SECOND_WALLET_ID = '00000000-0000-4000-8000-000000000002';
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
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
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
  switchChainErrors: unknown[] = [];

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
        if (this.switchChainErrors.length > 0) throw this.switchChainErrors.shift();
        if (this.chainIdAfterSwitch === undefined) {
          this.chainId = requestedSwitchChainId(request, this.chainId);
        } else {
          this.chainId = this.chainIdAfterSwitch;
        }
        if (this.accountsAfterSwitch !== undefined) {
          this.accounts = this.accountsAfterSwitch;
        }
        return null;
      case 'wallet_addEthereumChain':
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

function targetWithPhantom(provider: MockProvider): EventTarget {
  const target = new EventTarget();
  Object.defineProperty(provider, 'isPhantom', {
    value: true,
  });
  Object.defineProperty(target, 'phantom', {
    value: { ethereum: provider },
  });
  return target;
}

function announce(
  target: EventTarget,
  provider: MockProvider,
  name = 'Test Wallet',
  walletId = WALLET_ID,
): void {
  target.dispatchEvent(
    new CustomEvent('eip6963:announceProvider', {
      detail: {
        info: { uuid: walletId, name, icon: ICON, rdns: 'test.wallet' },
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

test('discovers providers, connects explicitly, and follows account changes', async () => {
  const provider = new MockProvider();
  const { controller, target } = controllerWithProvider(provider);
  const secondProvider = new MockProvider();
  announce(target, secondProvider, 'Second Wallet', SECOND_WALLET_ID);
  announce(target, secondProvider, 'Second Wallet', SECOND_WALLET_ID);

  expect(controller.getSnapshot().wallets).toHaveLength(2);
  const connected = await controller.connect(WALLET_ID);
  expect(connected.ok).toBe(true);
  if (!connected.ok) return;
  expect(connected.value.account).toBe(FIRST_ACCOUNT);
  expect(connected.value.network.kind).toBe('configured');

  provider.emit('accountsChanged', [SECOND_ACCOUNT]);
  expect(controller.getSnapshot().connection.kind).toBe('connected');
  if (controller.getSnapshot().connection.kind === 'connected') {
    expect(controller.getSnapshot().connection.account).toBe(SECOND_ACCOUNT);
  }
  controller.dispose();
  expect(controller.getSnapshot().wallets).toHaveLength(0);
});

test('discovers and deduplicates the namespaced Phantom provider', async () => {
  const provider = new MockProvider();
  const target = targetWithPhantom(provider);
  Object.defineProperty(target, 'ethereum', {
    value: new MockProvider(),
  });
  const controller = new ExternalEvmController([
    { chainId: 1, name: 'Ethereum', rpcUrl: 'https://rpc.example.test' },
  ]);

  controller.start(target);
  announce(target, provider, 'Phantom EVM', WALLET_ID);

  expect(controller.getSnapshot().wallets).toEqual([
    {
      id: 'phantom:ethereum',
      name: 'Phantom',
      icon: null,
      rdns: null,
    },
  ]);
  const connected = await controller.connect('phantom:ethereum');
  expect(connected.ok).toBe(true);
  if (connected.ok) expect(connected.value.account).toBe(FIRST_ACCOUNT);
});

test('releases discovery after replacing an explicit target during mount', () => {
  const controller = new ExternalEvmController([]);
  const mountedTarget = new EventTarget();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: mountedTarget });
  try {
    controller.start(new EventTarget());
    const release = controller.mount();
    release();
    announce(mountedTarget, new MockProvider());

    expect(controller.getSnapshot().wallets.some((wallet) => wallet.id === WALLET_ID)).toBe(false);
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});

test('keeps mount releases idempotent while another subscriber remains', () => {
  const controller = new ExternalEvmController([]);
  const target = new EventTarget();
  controller.start(target);

  const releaseFirst = controller.mount();
  const releaseSecond = controller.mount();
  releaseFirst();
  releaseFirst();
  announce(target, new MockProvider());
  expect(controller.getSnapshot().wallets).toHaveLength(1);

  releaseSecond();
  announce(target, new MockProvider(), 'Second Wallet', SECOND_WALLET_ID);
  expect(controller.getSnapshot().wallets).toHaveLength(0);
});

test('normalizes signing and transaction requests through the selected provider', async () => {
  const provider = new MockProvider();
  const { controller } = controllerWithProvider(provider);
  const connected = await controller.connect(WALLET_ID);
  expect(connected.ok).toBe(true);
  if (!connected.ok) return;

  const message = await controller.signMessage(connected.value, new Uint8Array([1, 2, 3]));
  expect(message).toEqual({ ok: true, value: SIGNATURE });
  const typedData = await controller.signTypedData(connected.value, {
    types: { Mail: [{ name: 'contents', type: 'string' }] },
    primaryType: 'Mail',
    domain: { name: 'Seams', version: '1', chainId: 1 },
    message: { contents: 'hello' },
  });
  expect(typedData).toEqual({ ok: true, value: SIGNATURE });
  const submission = await controller.sendTransaction(connected.value, {
    to: FIRST_ACCOUNT,
    data: '0x',
    value: 0n,
    gas: { kind: 'wallet' },
    fees: { kind: 'wallet' },
  });
  expect(submission).toEqual({
    ok: true,
    value: { kind: 'submitted', hash: TRANSACTION_HASH, account: FIRST_ACCOUNT, chainId: 1 },
  });
  expect(provider.calls.some((call) => call.method === 'eth_sendTransaction')).toBe(true);
});

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
  expect(unsupported).toEqual({
    ok: false,
    code: 'unsupported_chain',
    message: 'Choose a configured network.',
  });
  const switched = await controller.switchChain(connected.value, 11_155_111);
  expect(switched.ok).toBe(true);
  if (switched.ok) expect(switched.value.chainId).toBe(11_155_111);
});

test('adds a configured chain when the wallet reports it as unknown, then retries switching', async () => {
  const provider = new MockProvider();
  provider.switchChainErrors.push({
    code: -32603,
    data: { originalError: { code: 4902 } },
  });
  const controller = new ExternalEvmController([
    {
      chainId: 1,
      name: 'Ethereum',
      rpcUrl: 'https://rpc.example.test',
    },
    {
      chainId: 11_155_111,
      name: 'Sepolia',
      rpcUrl: 'https://sepolia.example.test',
      nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
      blockExplorerUrl: 'https://sepolia.example.test/explorer',
    },
  ]);
  const target = new EventTarget();
  controller.start(target);
  announce(target, provider);
  const connected = await controller.connect(WALLET_ID);
  expect(connected.ok).toBe(true);
  if (!connected.ok) return;

  const switched = await controller.switchChain(connected.value, 11_155_111);

  expect(switched.ok).toBe(true);
  expect(provider.calls.map((call) => call.method)).toContain('wallet_addEthereumChain');
  expect(provider.calls.filter((call) => call.method === 'wallet_switchEthereumChain')).toHaveLength(2);
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

  expect(switched).toEqual({
    ok: false,
    code: 'connection_changed',
    message: 'Your wallet connection changed. Review the account and network, then try again.',
  });
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

  expect(switched).toEqual({
    ok: false,
    code: 'unsupported_chain',
    message: 'The wallet did not switch to the requested network.',
  });
  expect(controller.getSnapshot().connection.kind).toBe('disconnected');
});

test('rejects stale connections and wallet approval failures', async () => {
  const provider = new MockProvider();
  const { controller } = controllerWithProvider(provider);
  provider.requestError = { code: 4001 };
  const rejected = await controller.connect(WALLET_ID);
  expect(rejected).toEqual({
    ok: false,
    code: 'rejected',
    message: 'Request declined in your wallet.',
  });
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

test('normalizes serialized and message-only wallet rejection errors', () => {
  expect(providerFailure({ code: '4001', message: 'User rejected the request.' })).toEqual({
    ok: false,
    code: 'rejected',
    message: 'Request declined in your wallet.',
  });
  expect(providerFailure({
    code: -32603,
    data: { originalError: { code: 4001 } },
  })).toEqual({
    ok: false,
    code: 'rejected',
    message: 'Request declined in your wallet.',
  });
  expect(providerFailure(new Error('User rejected signing'))).toEqual({
    ok: false,
    code: 'rejected',
    message: 'Request declined in your wallet.',
  });
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

  expect(await pending).toEqual({
    ok: false,
    code: 'connection_changed',
    message: 'Your wallet connection changed. Review the account and network, then try again.',
  });
  expect(controller.getSnapshot().busy).toBe(false);
  const current = controller.getSnapshot().connection;
  expect(current.kind).toBe('connected');
  if (current.kind === 'connected') expect(current.chainId).toBe(2);
});

test('does not let a stale request clear the busy state of a newer request', async () => {
  const provider = new MockProvider();
  const { controller } = controllerWithProvider(provider);
  const connected = await controller.connect(WALLET_ID);
  expect(connected.ok).toBe(true);
  if (!connected.ok) return;

  const staleRequest = provider.holdNextRequest('personal_sign');
  const staleSigning = controller.signMessage(connected.value, new Uint8Array([1]));
  await waitForProviderCall(provider, 'personal_sign');

  controller.disconnect();
  const reconnected = await controller.connect(WALLET_ID);
  expect(reconnected.ok).toBe(true);
  if (!reconnected.ok) return;

  const currentRequest = provider.holdNextRequest('personal_sign');
  const currentSigning = controller.signMessage(reconnected.value, new Uint8Array([2]));
  await waitForProviderCall(provider, 'personal_sign', 2);

  staleRequest.resolve(SIGNATURE);
  expect(await staleSigning).toEqual({
    ok: false,
    code: 'connection_changed',
    message: 'Your wallet connection changed. Review the account and network, then try again.',
  });
  expect(controller.getSnapshot().busy).toBe(true);

  currentRequest.resolve(SIGNATURE);
  expect(await currentSigning).toEqual({ ok: true, value: SIGNATURE });
  expect(controller.getSnapshot().busy).toBe(false);
});

test('reports provider transport failures separately from malformed responses', async () => {
  const provider = new MockProvider();
  const { controller } = controllerWithProvider(provider);
  const connected = await controller.connect(WALLET_ID);
  expect(connected.ok).toBe(true);
  if (!connected.ok) return;

  provider.requestError = new Error('transport unavailable');
  expect(await controller.signMessage(connected.value, new Uint8Array([1]))).toEqual({
    ok: false,
    code: 'provider_failure',
    message: 'The wallet request failed.',
  });
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

  expect(result).toEqual({
    ok: false,
    code: 'submission_unknown',
    message: 'Submission outcome is unknown. Check your wallet activity before sending again.',
  });
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
  expect(result).toEqual({
    ok: false,
    code: 'unsupported_chain',
    message: 'Switch to a configured network first.',
  });
});

test('verifies submitted receipts and keeps pending outcomes unresolved', async () => {
  const submission: ExternalEvmSubmission = {
    kind: 'submitted',
    hash: TRANSACTION_HASH,
    account: FIRST_ACCOUNT,
    chainId: 1,
  };
  let receiptAvailable = true;
  const methods: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string };
    if (body.method) methods.push(body.method);
    let result: unknown;
    if (body.method === 'eth_chainId') {
      result = '0x1';
    } else if (receiptAvailable) {
      result = {
        transactionHash: TRANSACTION_HASH,
        from: FIRST_ACCOUNT,
        status: '0x1',
        blockNumber: '0x10',
      };
    } else {
      result = null;
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const controller = new ExternalEvmController([
      { chainId: 1, name: 'Ethereum', rpcUrl: 'https://rpc.example.test' },
    ]);
    const confirmed = await controller.observeReceipt(submission);
    expect(methods).toEqual(['eth_chainId', 'eth_getTransactionReceipt']);
    expect(confirmed).toEqual({ kind: 'confirmed', submission, blockNumber: 16n });
    receiptAvailable = false;
    const pending = await controller.observeReceipt(submission);
    expect(pending).toEqual({
      kind: 'unresolved',
      submission,
      reason: 'Transaction receipt is pending.',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
