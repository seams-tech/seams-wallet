import { expect, test, type Route } from '@playwright/test';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setupBasicPasskeyTest } from '../setup';
import { registerWalletServiceRoute } from './harness';

const loaderSource = `
import { handleWalletHostRuntimeRequestWithHandlers } from './runtimeContext';
const probe = window.executionProbe = {
  holdWork: false, holdLoad: false, work: new Map(), load: null,
  runtimeIds: new WeakMap(), nextRuntimeId: 0, started: [], finished: [],
};
function holdLoad(resolve) { probe.load = resolve; }
function holdWork(requestId, resolve) { probe.work.set(requestId, resolve); }
function runtimeId(runtime) {
  if (!probe.runtimeIds.has(runtime)) probe.runtimeIds.set(runtime, ++probe.nextRuntimeId);
  return probe.runtimeIds.get(runtime);
}
async function readInventory(deps, req) {
  const before = runtimeId(deps.getWalletRuntime());
  probe.started.push({ requestId: req.requestId, runtimeId: before });
  if (probe.holdWork) {
    probe.holdWork = false;
    await new Promise(holdWork.bind(null, req.requestId));
  }
  let after;
  try { after = runtimeId(deps.getWalletRuntime()); }
  catch (error) { after = error.message; }
  probe.finished.push({ requestId: req.requestId, before, after });
  deps.post({ type: 'PM_RESULT', requestId: req.requestId, payload: { ok: true, result: { before, after } } });
}
function handlers(deps) { return { PM_GET_RECENT_UNLOCKS: readInventory.bind(null, deps) }; }
async function handleWalletHostRuntimeRequest(input) {
  await handleWalletHostRuntimeRequestWithHandlers(input, handlers);
}
export async function loadWalletHostRuntime() {
  if (probe.holdLoad) {
    probe.holdLoad = false;
    await new Promise(holdLoad);
  }
  return { handleWalletHostRuntimeRequest };
}
export async function preloadWalletHostRecoveryCodeSurface() {}
`;

function requestCount(requests: string[]): number {
  return requests.length;
}

async function recordSetupWarmup(requests: string[], route: Route): Promise<void> {
  const request = route.request();
  expect(request.method()).toBe('OPTIONS');
  expect(request.postData()).toBeNull();
  expect(request.headers().authorization).toBeUndefined();
  requests.push(request.url());
  await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
}

async function serveBundle(bundle: string, route: Route): Promise<void> {
  await route.fulfill({ contentType: 'text/javascript', body: bundle });
}

function mountHost(): void {
  const frame = document.createElement('iframe');
  frame.id = 'execution-host';
  frame.src = 'https://wallet.example.localhost/wallet-service';
  document.body.append(frame);
}

function recordMessage(event: MessageEvent): void {
  (window as any).executionClient.messages.push(event.data);
}

async function connectHost(): Promise<void> {
  const path = '/_test-sdk/esm/SeamsWeb/walletIframe/shared/messages.js';
  const { WALLET_PROTOCOL_VERSION } = await import(path);
  const frame = document.querySelector<HTMLIFrameElement>('#execution-host')!;
  const channel = new MessageChannel();
  (window as any).executionClient = {
    messages: [],
    port: channel.port1,
    config: structuredClone((window as any).__SEAMS_TEST_HOST_CONFIG__),
    revision: 0,
  };
  channel.port1.onmessage = recordMessage;
  frame.contentWindow!.postMessage(
    { type: 'CONNECT', payload: { protocolVersion: WALLET_PROTOCOL_VERSION } },
    'https://wallet.example.localhost',
    [channel.port2],
  );
}

function readMessages(): unknown[] {
  return (window as any).executionClient.messages;
}

function configure(kind: 'initial' | 'appearance' | 'replacement' | 'invalid'): void {
  const client = (window as any).executionClient;
  const config = structuredClone(client.config);
  client.revision++;
  let payload;
  if (kind === 'appearance') {
    config.ui.appearance.theme.mode = 'light';
    payload = { kind: 'appearance', appearance: config.ui.appearance };
  } else {
    if (kind === 'replacement')
      config.network.relayer.url = `https://relay-${client.revision}.example.localhost`;
    if (kind === 'invalid') delete config.wallet.rpId;
    payload = { kind: 'configure', config, assetsBaseUrl: 'https://wallet.example.localhost/sdk/' };
  }
  if (kind !== 'invalid') client.config = config;
  client.port.postMessage({
    type: 'PM_SET_CONFIG',
    requestId: `${kind}-${client.revision}`,
    payload,
  });
}

function startRequest(requestId: string): void {
  (window as any).executionClient.port.postMessage({ type: 'PM_GET_RECENT_UNLOCKS', requestId });
}

function holdWork(): void {
  (window as any).executionProbe.holdWork = true;
}

function releaseWork(requestId: string): void {
  const probe = (window as any).executionProbe;
  const release = probe.work.get(requestId);
  probe.work.delete(requestId);
  release();
}

function holdLoad(): void {
  (window as any).executionProbe.holdLoad = true;
}

function releaseLoad(): void {
  const probe = (window as any).executionProbe;
  const release = probe.load;
  probe.load = null;
  release();
}

function readHost(): unknown {
  const probe = (window as any).executionProbe;
  if (!probe) return null;
  return {
    heldWork: [...probe.work.keys()],
    heldLoad: probe.load !== null,
    started: probe.started,
    finished: probe.finished,
  };
}

function walletFrame(frame: { url(): string }): boolean {
  return frame.url().startsWith('https://wallet.example.localhost/wallet-service');
}

test('execution replacement fences loading and active host requests while appearance preserves work', async ({
  page,
}, info) => {
  const root = path.resolve(import.meta.dirname, '../..');
  const result = await build({
    entryPoints: [path.join(root, 'packages/wallet/src/SeamsWeb/walletIframe/host/index.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    tsconfig: path.join(root, 'packages/wallet/tsconfig.json'),
    plugins: [
      {
        name: 'controlled-runtime-loader',
        setup(build) {
          build.onLoad(
            { filter: /walletIframe\/host\/runtimeLoader\.ts$/ },
            function loadRuntimeFixture(args) {
              return { contents: loaderSource, loader: 'ts', resolveDir: path.dirname(args.path) };
            },
          );
        },
      },
    ],
  });
  await setupBasicPasskeyTest(page, { skipSeamsWebInit: true });
  const setupWarmups: string[] = [];
  await page.route('**/wallets/register/setup', recordSetupWarmup.bind(null, setupWarmups));
  await page.route('**/__execution-host.js', serveBundle.bind(null, result.outputFiles[0]!.text));
  await registerWalletServiceRoute(
    page,
    '<!doctype html><html><body><script type="module" src="/__execution-host.js"></script></body></html>',
    '**://wallet.example.localhost/wallet-service*',
  );
  await page.addScriptTag({ content: recordMessage.toString() });
  const frameReady = page.waitForEvent('framenavigated', { predicate: walletFrame });
  await page.evaluate(mountHost);
  const frame = await frameReady;
  await expect.poll(frame.evaluate.bind(frame, readHost)).toMatchObject({ heldLoad: false });
  await page.evaluate(connectHost);
  await expect
    .poll(page.evaluate.bind(page, readMessages))
    .toContainEqual(expect.objectContaining({ type: 'READY' }));
  await page.evaluate(configure, 'initial' as const);
  await expect
    .poll(page.evaluate.bind(page, readMessages))
    .toContainEqual({ type: 'PONG', requestId: 'initial-1' });
  await expect.poll(requestCount.bind(null, setupWarmups)).toBe(1);
  expect(await frame.evaluate(readHost)).toMatchObject({ started: [] });

  await frame.evaluate(holdWork);
  await page.evaluate(startRequest, 'appearance-work');
  await expect
    .poll(frame.evaluate.bind(frame, readHost))
    .toMatchObject({ heldWork: ['appearance-work'] });
  await page.evaluate(configure, 'appearance' as const);
  await expect
    .poll(page.evaluate.bind(page, readMessages))
    .toContainEqual({ type: 'PONG', requestId: 'appearance-2' });
  await page.evaluate(configure, 'invalid' as const);
  await expect
    .poll(page.evaluate.bind(page, readMessages))
    .toContainEqual(expect.objectContaining({ type: 'ERROR', requestId: 'invalid-3' }));
  expect(setupWarmups).toHaveLength(1);
  await frame.evaluate(releaseWork, 'appearance-work');
  await expect
    .poll(page.evaluate.bind(page, readMessages))
    .toContainEqual({
      type: 'PM_RESULT',
      requestId: 'appearance-work',
      payload: { ok: true, result: { before: 1, after: 1 } },
    });

  await frame.evaluate(holdWork);
  await page.evaluate(startRequest, 'replaced-work');
  await expect
    .poll(frame.evaluate.bind(frame, readHost))
    .toMatchObject({ heldWork: ['replaced-work'] });
  await page.evaluate(configure, 'replacement' as const);
  await expect
    .poll(page.evaluate.bind(page, readMessages))
    .toContainEqual(
      expect.objectContaining({
        type: 'ERROR',
        requestId: 'replaced-work',
        payload: {
          code: 'wallet_configuration_changed',
          message: 'Wallet configuration changed during request',
        },
      }),
    );
  await page.evaluate(startRequest, 'new-work');
  await expect
    .poll(page.evaluate.bind(page, readMessages))
    .toContainEqual({
      type: 'PM_RESULT',
      requestId: 'new-work',
      payload: { ok: true, result: { before: 2, after: 2 } },
    });
  await frame.evaluate(releaseWork, 'replaced-work');
  await expect
    .poll(frame.evaluate.bind(frame, readHost))
    .toMatchObject({
      finished: expect.arrayContaining([
        {
          requestId: 'replaced-work',
          before: 1,
          after: 'Wallet configuration changed during request',
        },
      ]),
    });

  await frame.evaluate(holdLoad);
  await page.evaluate(startRequest, 'replaced-load');
  await expect.poll(frame.evaluate.bind(frame, readHost)).toMatchObject({ heldLoad: true });
  await page.evaluate(configure, 'replacement' as const);
  await expect
    .poll(page.evaluate.bind(page, readMessages))
    .toContainEqual(expect.objectContaining({ type: 'ERROR', requestId: 'replaced-load' }));
  await frame.evaluate(releaseLoad);
  await page.evaluate(startRequest, 'final-work');
  await expect
    .poll(page.evaluate.bind(page, readMessages))
    .toContainEqual({
      type: 'PM_RESULT',
      requestId: 'final-work',
      payload: { ok: true, result: { before: 3, after: 3 } },
    });
  const messages = await page.evaluate(readMessages);
  const host = await frame.evaluate(readHost);
  expect(messages).not.toContainEqual(
    expect.objectContaining({ type: 'PM_RESULT', requestId: 'replaced-work' }),
  );
  expect(messages).not.toContainEqual(
    expect.objectContaining({ type: 'PM_RESULT', requestId: 'replaced-load' }),
  );
  expect(host).toMatchObject({
    started: expect.not.arrayContaining([expect.objectContaining({ requestId: 'replaced-load' })]),
  });
  await writeFile(
    info.outputPath('execution-generation.json'),
    JSON.stringify({ messages, host, setupWarmups }, null, 2),
  );
});
