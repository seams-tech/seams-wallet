import { expect, test, type Frame, type Page, type Route, type TestInfo } from '@playwright/test';
import { build, type PluginBuild, type OnLoadArgs } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setupBasicPasskeyTest } from '../setup';
import { registerWalletServiceRoute } from './harness';
import { WALLET_PROTOCOL_VERSION } from '../../packages/wallet/src/SeamsWeb/walletIframe/shared/messages';

// This campaign tests the real host, commands, signing flow, retry loop and HTTP.
// Custody authorization, codec and Gateway results are controlled fixtures.
const runtimeSource = `
import { createNearWalletIframeHandlers } from './handlers/near';
import { createWalletHostNearCommands } from './createNearCommands';
import { signMlDsaNearTransaction } from '../../../core/signingEngine/flows/signNear/mlDsaTransaction';
const probe = (window.mlDsaProbe = {
  mode: 'ready',
  deadlineMs: 5000,
  reserved: 0,
  released: 0,
  signed: 0,
  responses: 0,
  succeeded: 0,
  broadcast: 0,
  settled: [],
  confirmation: null,
});
function holdConfirmation(resolve) {
  probe.confirmation = resolve;
}
async function confirm() {
  if (probe.mode === 'confirmation' || probe.mode === 'expired_confirmation')
    await new Promise(holdConfirmation);
  return { confirmed: true };
}
async function reserveNearContext(input) {
  probe.reserved++;
  return {
    context: { txBlockHash: '11111111111111111111111111111111' },
    leases: [
      {
        lane: input.lane,
        leaseId: 'lease-' + probe.reserved,
        operationId: input.operation.operationId,
        operationFingerprint: input.operation.operationFingerprint,
        nonce: 1n,
      },
    ],
  };
}
async function release() {
  probe.released++;
}
async function markSigned() {
  probe.signed++;
}
function postProgress(input, requestId, payload) {
  if (payload.phase === 'signing.transaction.signed') probe.succeeded++;
  input.post({ type: 'PROGRESS', requestId, payload });
}
async function handleWalletHostRuntimeRequest(input) {
  const config = input.state.configuration.config;
  const deps = {
    configs: config,
    nearClient: {},
    nonceCoordinator: { reserveNearContext, release, markSigned },
    confirm: { requestUserConfirmation: confirm },
  };
  const context = {
    configs: config,
    signingEngine: {
      signMlDsaNearTransaction: signMlDsaNearTransaction.bind(null, deps),
    },
  };
  const near = createWalletHostNearCommands(readContext.bind(null, context));
  const handlers = createNearWalletIframeHandlers({
    getWalletRuntime: readRuntime.bind(null, near),
    post: input.post,
    postProgress: postProgress.bind(null, input),
    isCancelled: input.isCancelled,
    respondIfCancelled: input.respondIfCancelled,
  });
  try {
    await handlers[input.req.type](input.req);
  } finally {
    probe.settled.push(input.req.requestId);
  }
}
function readContext(context) {
  return context;
}
function readRuntime(near) {
  return { near };
}
export async function loadWalletHostRuntime() {
  return { handleWalletHostRuntimeRequest };
}
export async function preloadWalletHostRecoveryCodeSurface() {}
export function preloadWalletHostRuntime() {}
`;

const custodySource = `
export async function resolveMlDsaPasskeyOwner() {
  return {
    kind: 'owner',
    authMethod: { rpId: 'example.localhost', credentialIdB64u: 'AQ' },
    authority: { authorityDigestB64u: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
  };
}
export async function prepareMlDsaTransactionApproval(input) {
  return { kind: 'passkey', challengeB64u: input.preparation.challengeB64u };
}
export function authorizeMlDsaTransaction() {
  return { kind: 'passkey', credential: {} };
}
export function forgetMlDsaTransactionApproval() {}
`;

const rpcSource = `
export async function initializeMlDsaCodec() {}
export async function prepareMlDsaNearSigning(input) {
  return {
    kind: 'prepared',
    preparation: {
      request: input.request,
      transaction: { publicKeyB64u: input.publicKeyB64u },
      challengeB64u: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      expiresAtMs: Date.now() + window.mlDsaProbe.deadlineMs,
    },
  };
}
export async function executeMlDsaNearSigning(input) {
  const response = await fetch('/__ml-dsa-execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const result = await response.json();
  window.mlDsaProbe.responses++;
  return result;
}
`;

const codecSource = `
export function ml_dsa65_build_near_transaction() {
  return 'AQ';
}
export function ml_dsa65_near_key_identifiers() {
  return JSON.stringify({ publicKey: 'ml-dsa-65:fixture' });
}
export function threshold_ed25519_decode_signed_near_tx_borsh() {
  return {
    signedTransaction: { transaction: { signerId: 'alice.testnet', nonce: '1' }, signature: {} },
  };
}
`;

const broadcastSource = `
export async function sendTransaction() {
  window.mlDsaProbe.broadcast++;
  return { success: true, transactionId: 'fixture' };
}
export function signTransaction() {
  throw new Error('Unexpected Ed25519 signing');
}
export function signAndSendTransaction() {
  throw new Error('Unexpected Ed25519 signing');
}
`;

function loadFixture(args: OnLoadArgs) {
  return { contents: runtimeSource, loader: 'ts' as const, resolveDir: path.dirname(args.path) };
}

function resolveControl(args: { path: string; importer: string }) {
  const importer = args.importer;
  if (/\/mlDsaTransaction\.ts$/.test(importer)) {
    if (args.path.endsWith('/mlDsaOwner') || args.path.endsWith('/mlDsaSigningSessions'))
      return { path: 'custody', namespace: 'ml-dsa-control' };
    if (args.path.endsWith('/wasm_signer_worker.js'))
      return { path: 'codec', namespace: 'ml-dsa-control' };
  }
  if (
    /\/mlDsa(Transaction|SigningExecution)\.ts$/.test(importer) &&
    args.path.endsWith('/mlDsaSigning')
  )
    return { path: 'rpc', namespace: 'ml-dsa-control' };
  if (/\/host\/createNearCommands\.ts$/.test(importer) && args.path.endsWith('/near/actions'))
    return { path: 'broadcast', namespace: 'ml-dsa-control' };
  return null;
}

function loadControl(args: OnLoadArgs) {
  switch (args.path) {
    case 'custody':
      return { contents: custodySource, loader: 'js' as const };
    case 'codec':
      return { contents: codecSource, loader: 'js' as const };
    case 'rpc':
      return { contents: rpcSource, loader: 'js' as const };
    case 'broadcast':
      return { contents: broadcastSource, loader: 'js' as const };
    default:
      throw new Error(`Unexpected fixture: ${args.path}`);
  }
}

function setupControls(builder: PluginBuild): void {
  builder.onLoad({ filter: /walletIframe\/host\/runtimeLoader\.ts$/ }, loadFixture);
  builder.onResolve({ filter: /.*/ }, resolveControl);
  builder.onLoad({ filter: /.*/, namespace: 'ml-dsa-control' }, loadControl);
}

async function serveBundle(bundle: string, route: Route): Promise<void> {
  await route.fulfill({ contentType: 'text/javascript', body: bundle });
}

function receiveMessage(event: MessageEvent): void {
  (window as any).mlDsaClient.messages.push(event.data);
}

function connectHost(protocolVersion: string): void {
  const frame = document.querySelector<HTMLIFrameElement>('#ml-dsa-host')!;
  const channel = new MessageChannel();
  (window as any).mlDsaClient = { port: channel.port1, messages: [] };
  channel.port1.onmessage = receiveMessage;
  frame.contentWindow!.postMessage(
    { type: 'CONNECT', payload: { protocolVersion } },
    'https://wallet.example.localhost',
    [channel.port2],
  );
}

function configureHost(): void {
  const client = (window as any).mlDsaClient;
  client.port.postMessage({
    type: 'PM_SET_CONFIG',
    requestId: 'config',
    payload: {
      kind: 'configure',
      config: (window as any).__SEAMS_TEST_HOST_CONFIG__,
      assetsBaseUrl: 'https://wallet.example.localhost/sdk/',
    },
  });
}

function readMessages(): Array<{ type: string; requestId: string; payload: any }> {
  return (window as any).mlDsaClient.messages;
}

function mountHost(): void {
  const frame = document.createElement('iframe');
  frame.id = 'ml-dsa-host';
  frame.src = 'https://wallet.example.localhost/wallet-service';
  document.body.append(frame);
}

function isWalletFrame(frame: Frame): boolean {
  return frame.url().startsWith('https://wallet.example.localhost/wallet-service');
}

function configureProbe(mode: string): void {
  const probe = (window as any).mlDsaProbe;
  probe.mode = mode;
  probe.deadlineMs = mode === 'expiry' || mode === 'expired_confirmation' ? 350 : 5000;
}

function releaseConfirmation(): void {
  const probe = (window as any).mlDsaProbe;
  if (probe.confirmation) probe.confirmation();
}

function readProbe() {
  const probe = (window as any).mlDsaProbe;
  if (!probe) return null;
  return {
    reserved: probe.reserved,
    released: probe.released,
    signed: probe.signed,
    responses: probe.responses,
    succeeded: probe.succeeded,
    broadcast: probe.broadcast,
    settled: probe.settled,
    confirming: probe.confirmation !== null,
  };
}

function beginSigning(requestId: string): void {
  (window as any).mlDsaClient.port.postMessage({
    type: 'PM_SIGN_AND_SEND_TX',
    requestId,
    payload: {
      walletId: 'wallet:cancellation',
      nearAccountId: 'alice.testnet',
      signer: {
        kind: 'near_ml_dsa_65',
        signingKeyId: 'near-ml-dsa-65:1',
        publicKeyB64u: 'AQ',
        keyManifestDigestB64u: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        materialEpoch: 1,
      },
      transaction: { receiverId: 'alice.testnet', actions: [{ type: 'Transfer', amount: '0' }] },
      options: {},
    },
  });
}

function cancelSigning(requestId: string): void {
  (window as any).mlDsaClient.port.postMessage({
    type: 'PM_CANCEL',
    requestId: 'cancel-' + requestId,
    payload: { requestId },
  });
}

type Execution = { operationId: string; body: string; receivedAtMs: number };
type Gateway = { mode: string; executions: Execution[]; held: Route | null };

async function respondSigned(route: Route): Promise<void> {
  await route.fulfill({
    json: {
      kind: 'signed',
      transaction: {
        signedTransactionBorshB64u: 'AQ',
        signatureB64u: 'AQ',
        transactionHash: 'fixture',
      },
    },
  });
}

async function executeGateway(gateway: Gateway, route: Route): Promise<void> {
  const body = route.request().postData()!;
  const request = JSON.parse(body);
  gateway.executions.push({
    operationId: request.preparation.request.operationIdB64u,
    body,
    receivedAtMs: Date.now(),
  });
  if (gateway.mode === 'in_flight') {
    gateway.held = route;
    return;
  }
  if (
    gateway.mode === 'ready' ||
    (gateway.mode === 'retry_control' && gateway.executions.length === 3)
  ) {
    await respondSigned(route);
    return;
  }
  await route.fulfill({
    json: {
      kind: 'retry',
      reason: 'unavailable',
      retryAtMs:
        Date.now() + (gateway.mode === 'stock_wait' || gateway.mode === 'rpc_timeout' ? 3000 : 100),
    },
  });
}

for (const mode of [
  'retry_control',
  'stock_wait',
  'expiry',
  'in_flight',
  'confirmation',
  'expired_confirmation',
  'rpc_timeout',
]) {
  test(`ML-DSA request cancellation and nonce settlement: ${mode}`, async ({ page }, info) => {
    const root = path.resolve(import.meta.dirname, '../..');
    const bundle = await build({
      entryPoints: [path.join(root, 'packages/wallet/src/SeamsWeb/walletIframe/host/index.ts')],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      tsconfig: path.join(root, 'packages/wallet/tsconfig.json'),
      plugins: [{ name: 'ml-dsa-lifecycle-controls', setup: setupControls }],
    });
    await setupBasicPasskeyTest(page, { skipSeamsWebInit: true });
    const gateway: Gateway = { mode, executions: [], held: null };
    await page.context().route('**/__ml-dsa-execute', executeGateway.bind(null, gateway));
    await page.route('**/__ml-dsa-host.js', serveBundle.bind(null, bundle.outputFiles[0]!.text));
    await registerWalletServiceRoute(
      page,
      '<!doctype html><html><body><script type="module" src="/__ml-dsa-host.js"></script></body></html>',
      '**://wallet.example.localhost/wallet-service*',
    );
    if (mode === 'rpc_timeout') {
      await runClientTimeoutCampaign(page, gateway, info, root);
      return;
    }
    await page.addScriptTag({ content: receiveMessage.toString() });
    const navigation = page.waitForEvent('framenavigated', { predicate: isWalletFrame });
    await page.evaluate(mountHost);
    const frame = await navigation;
    await expect.poll(frame.evaluate.bind(frame, readProbe)).toMatchObject({ reserved: 0 });
    await page.evaluate(connectHost, WALLET_PROTOCOL_VERSION);
    await expect
      .poll(page.evaluate.bind(page, readMessages))
      .toContainEqual(expect.objectContaining({ type: 'READY' }));
    await page.evaluate(configureHost);
    await expect
      .poll(page.evaluate.bind(page, readMessages))
      .toContainEqual(expect.objectContaining({ requestId: 'config', type: 'PONG' }));
    await frame.evaluate(configureProbe, mode);
    await page.evaluate(beginSigning, mode);
    if (mode === 'confirmation' || mode === 'expired_confirmation') {
      await expect.poll(frame.evaluate.bind(frame, readProbe)).toMatchObject({ confirming: true });
    } else {
      await expect.poll(gatewayExecutionCount.bind(null, gateway)).toBeGreaterThan(0);
    }
    if (mode === 'stock_wait') {
      await expect.poll(frame.evaluate.bind(frame, readProbe)).toMatchObject({ responses: 1 });
    }
    const cancelledAtMs = Date.now();
    if (mode === 'expired_confirmation') {
      await page.waitForTimeout(450);
      await frame.evaluate(releaseConfirmation);
    } else if (mode !== 'retry_control' && mode !== 'expiry') {
      await page.evaluate(cancelSigning, mode);
      await expect
        .poll(page.evaluate.bind(page, readMessages))
        .toContainEqual(expect.objectContaining({ requestId: mode, type: 'ERROR' }));
      if (mode === 'in_flight') await respondSigned(gateway.held!);
      await frame.evaluate(releaseConfirmation);
    }
    await expect.poll(frame.evaluate.bind(frame, readProbe)).toMatchObject({ settled: [mode] });
    const state = await frame.evaluate(readProbe);
    if (state === null) throw new Error('The ML-DSA fixture did not initialize');
    const settledExecutionCount = gateway.executions.length;
    const settledAtMs = Date.now();
    await page.waitForTimeout(500);
    expect(await frame.evaluate(readProbe)).toEqual(state);
    expect(gateway.executions).toHaveLength(settledExecutionCount);
    let count = 1;
    if (mode === 'confirmation' || mode === 'expired_confirmation') count = 0;
    else if (mode === 'retry_control') count = 3;
    else if (mode === 'expiry') count = settledExecutionCount;
    expect(gateway.executions).toHaveLength(count);
    expect(new Set(gateway.executions.map(executionBody)).size).toBe(count === 0 ? 0 : 1);
    expect(state.reserved).toBe(1);
    expect(state.released).toBe(mode === 'confirmation' || mode === 'expired_confirmation' ? 1 : 0);
    expect(state.signed).toBe(['retry_control', 'in_flight'].includes(mode) ? 1 : 0);
    expect(state.succeeded).toBe(mode === 'retry_control' ? 1 : 0);
    expect(state.broadcast).toBe(mode === 'retry_control' ? 1 : 0);
    if (mode === 'stock_wait') expect(settledAtMs - cancelledAtMs).toBeLessThan(1000);
    if (mode === 'expiry' || mode === 'expired_confirmation') {
      if (mode === 'expiry') {
        expect(count).toBeGreaterThanOrEqual(1);
        expect(count).toBeLessThanOrEqual(4);
      }
      await expect.poll(page.evaluate.bind(page, readMessages)).toContainEqual(
        expect.objectContaining({
          requestId: mode,
          type: 'ERROR',
          payload: expect.objectContaining({ message: 'ML-DSA signing approval expired' }),
        }),
      );
    }
    const artifact = info.outputPath('ml-dsa-cancellation.json');
    await writeFile(
      artifact,
      JSON.stringify(
        {
          mode,
          cancelledAtMs,
          settledAtMs,
          state,
          executions: gateway.executions,
          messages: await page.evaluate(readMessages),
          scope:
            'Chromium MessageChannel, production host/commands/ML-DSA signing lifecycle and HTTP retries. Controlled custody, codec, nonce storage and Gateway; no cryptographic or performance qualification.',
        },
        null,
        2,
      ),
    );
    await info.attach('ML-DSA cancellation receipt', {
      path: artifact,
      contentType: 'application/json',
    });
  });
}

function gatewayExecutionCount(gateway: Gateway): number {
  return gateway.executions.length;
}
function executionBody(execution: Execution): string {
  return execution.body;
}

async function startTimedClientSigning(): Promise<void> {
  const modulePath = '/__ml-dsa-client.js';
  const { WalletIframeRouter } = await import(modulePath);
  const router = new WalletIframeRouter({
    hostConfig: (window as any).__SEAMS_TEST_HOST_CONFIG__,
    walletOrigin: 'https://wallet.example.localhost',
    servicePath: '/wallet-service',
    connectTimeoutMs: 3000,
    requestTimeoutMs: 300,
    sdkBasePath: '/sdk',
  });
  await router.init();
  (window as any).mlDsaTimedClient = { error: null };
  void router
    .signAndSendTransaction({
      signer: {
        kind: 'near_ml_dsa_65',
        signingKeyId: 'near-ml-dsa-65:1',
        publicKeyB64u: 'AQ',
        keyManifestDigestB64u: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        materialEpoch: 1,
      },
      walletId: 'wallet:cancellation',
      nearAccountId: 'alice.testnet',
      transaction: { receiverId: 'alice.testnet', actions: [{ type: 'Transfer', amount: '0' }] },
      options: {},
    })
    .then(unexpectedTimedSuccess, recordClientTimeout);
}

function unexpectedTimedSuccess(): void {
  (window as any).mlDsaTimedClient.error = 'Unexpected success';
}

function recordClientTimeout(error: Error): void {
  (window as any).mlDsaTimedClient.error = error.message;
}

function readClientTimeout(): string | null {
  return (window as any).mlDsaTimedClient?.error ?? null;
}

async function runClientTimeoutCampaign(
  page: Page,
  gateway: Gateway,
  info: TestInfo,
  root: string,
): Promise<void> {
  const client = await build({
    entryPoints: [path.join(root, 'packages/wallet/src/SeamsWeb/walletIframe/client/router.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    tsconfig: path.join(root, 'packages/wallet/tsconfig.json'),
  });
  await page.route('**/__ml-dsa-client.js', serveBundle.bind(null, client.outputFiles[0]!.text));
  await page.addScriptTag({
    content: unexpectedTimedSuccess.toString() + '\n' + recordClientTimeout.toString(),
  });
  await page.evaluate(startTimedClientSigning);
  const frame = page.frames().find(isWalletFrame);
  if (!frame) throw new Error('The Wallet RPC did not create its host frame');
  await expect.poll(frame.evaluate.bind(frame, readProbe)).toMatchObject({ responses: 1 });
  await expect
    .poll(page.evaluate.bind(page, readClientTimeout))
    .toMatch(/Wallet request timeout for PM_SIGN_AND_SEND_TX/);
  await expect
    .poll(frame.evaluate.bind(frame, readProbe))
    .toMatchObject({ reserved: 1, released: 0, signed: 0, broadcast: 0 });
  await expect.poll(frame.evaluate.bind(frame, readProbe)).toHaveProperty('settled.0');
  const state = await frame.evaluate(readProbe);
  await page.waitForTimeout(500);
  expect(await frame.evaluate(readProbe)).toEqual(state);
  expect(gateway.executions).toHaveLength(1);
  const artifact = info.outputPath('ml-dsa-cancellation.json');
  await writeFile(
    artifact,
    JSON.stringify(
      {
        mode: gateway.mode,
        state,
        executions: gateway.executions,
        error: await page.evaluate(readClientTimeout),
        scope:
            'Chromium production client timeout sender, host, commands, signing flow and retry loop. A 300ms test RPC timeout replaces the normal 20s setting. Controlled custody, codec, nonce storage and Gateway; no cryptographic or performance qualification.',
      },
      null,
      2,
    ),
  );
  await info.attach('ML-DSA client timeout receipt', {
    path: artifact,
    contentType: 'application/json',
  });
}
