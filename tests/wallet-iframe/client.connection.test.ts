import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { SeamsWeb, ClientConnectionState } from '@/SeamsWeb';
import { setupBasicPasskeyTest } from '../setup';
import { buildWalletServiceHtml, registerWalletServiceRoute } from './harness';

const WALLET_ORIGIN = 'https://wallet.example.localhost';
const SERVICE_ROUTE = '**://wallet.example.localhost/wallet-service*';
const HELD_PREFERENCES = `
  const originalAdoptPort = adoptPort;
  adoptPort = function (port) {
    originalAdoptPort(port);
    const receive = port.onmessage;
    port.onmessage = function (event) {
      if (event.data.type === 'PM_GET_CONFIRMATION_CONFIG') {
        window.releasePreferences = postResult.bind(null, event.data.requestId, basePreferenceSnapshot);
        return;
      }
      receive(event);
    };
  };
`;

declare global {
  interface Window {
    connectionProbe: {
      seams: SeamsWeb;
      states: ClientConnectionState[];
      logins: Array<{ isLoggedIn: boolean; walletId: string | null }>;
      completion: Promise<string>;
      shared: boolean;
      stop: () => void;
    };
  }
}

async function startClient(): Promise<void> {
  const { SeamsWeb } = await import('/_test-sdk/esm/SeamsWeb/SeamsWeb.js');
  const seams = new SeamsWeb({
    chains: [{ network: 'near-testnet', rpcUrl: 'https://test.rpc.fastnear.com' }],
    relayer: { url: 'http://localhost:3000' },
    iframeWallet: {
      walletOrigin: 'https://wallet.example.localhost',
      walletServicePath: '/wallet-service',
      sdkBasePath: '/sdk',
    },
  });
  const states: ClientConnectionState[] = [];
  const stop = seams.connection.onChange(states.push.bind(states));
  const logins: Array<{ isLoggedIn: boolean; walletId: string | null }> = [];
  seams.onWalletIframeLoginStatusChanged(logins.push.bind(logins));
  const first = seams.connection.connect();
  window.connectionProbe = {
    seams,
    states,
    logins,
    completion: first.then(connectionSucceeded, connectionFailed),
    shared: first === seams.connection.connect(),
    stop,
  };
}

function connectionSucceeded(): string {
  return 'connected';
}

function connectionFailed(): string {
  return 'rejected';
}

async function retryClient(): Promise<string> {
  try {
    await window.connectionProbe.seams.connection.connect();
    return 'connected';
  } catch {
    return 'rejected';
  }
}

function connectionSnapshot() {
  const probe = window.connectionProbe;
  return {
    state: probe.seams.connection.getState(),
    states: probe.states.map((state) => ({ kind: state.kind, generation: state.generation })),
    shared: probe.shared,
    logins: probe.logins,
    iframes: document.querySelectorAll('iframe').length,
  };
}

test.beforeEach(async ({ page }) => {
  await setupBasicPasskeyTest(page, { skipSeamsWebInit: true });
});

test('connection retries, waits for reconciliation, reconnects, and disposes permanently', async ({
  page,
}, testInfo) => {
  await registerWalletServiceRoute(
    page,
    buildWalletServiceHtml({ protocolVersion: 'incompatible' }),
    SERVICE_ROUTE,
  );
  await page.evaluate(
    `const connectionSucceeded = ${connectionSucceeded.toString()}; const connectionFailed = ${connectionFailed.toString()}; (${startClient.toString()})()`,
  );
  expect(await page.evaluate(() => window.connectionProbe.completion)).toBe('rejected');
  expect((await page.evaluate(connectionSnapshot)).state.kind).toBe('failed');

  await page.unroute(SERVICE_ROUTE);
  await registerWalletServiceRoute(
    page,
    buildWalletServiceHtml({ extraScript: HELD_PREFERENCES }),
    SERVICE_ROUTE,
  );
  const retry = page.evaluate(retryClient);
  await expect
    .poll(async () => (await page.evaluate(connectionSnapshot)).state.kind)
    .toBe('connecting');
  await expect
    .poll(async () => page.frames().filter((frame) => frame.url().startsWith(WALLET_ORIGIN)).length)
    .toBe(1);
  const host = page.frames().find((frame) => frame.url().startsWith(WALLET_ORIGIN))!;
  await host.waitForFunction(() => typeof (window as any).releasePreferences === 'function');
  expect((await page.evaluate(connectionSnapshot)).state.kind).toBe('connecting');
  await host.evaluate(() => (window as any).releasePreferences());
  expect(await retry).toBe('connected');
  expect((await page.evaluate(connectionSnapshot)).state).toEqual({ kind: 'ready', generation: 2 });

  await page.locator('iframe').evaluate((iframe) => {
    (iframe as HTMLIFrameElement).src += '?reload';
  });
  await expect
    .poll(async () => (await page.evaluate(connectionSnapshot)).state.kind)
    .toBe('failed');
  await page.unroute(SERVICE_ROUTE);
  await registerWalletServiceRoute(page, buildWalletServiceHtml(), SERVICE_ROUTE);
  expect(await page.evaluate(retryClient)).toBe('connected');
  const ready = await page.evaluate(connectionSnapshot);
  expect(ready.state).toEqual({ kind: 'ready', generation: 3 });
  expect(ready.shared).toBe(true);
  expect(ready.logins).toEqual([
    { isLoggedIn: false, walletId: null },
    { isLoggedIn: false, walletId: null },
  ]);
  expect(ready.iframes).toBe(1);
  await page.evaluate(() => window.connectionProbe.seams.connection.dispose());
  expect(await page.evaluate(retryClient)).toBe('rejected');
  const disposed = await page.evaluate(connectionSnapshot);
  expect(disposed.state.kind).toBe('disposed');
  expect(disposed.iframes).toBe(0);
  expect(disposed.states.map((state) => state.kind)).toEqual([
    'idle',
    'connecting',
    'failed',
    'connecting',
    'ready',
    'failed',
    'connecting',
    'ready',
    'disposed',
  ]);
  await writeFile(
    testInfo.outputPath('connection-lifecycle.json'),
    JSON.stringify(disposed, null, 2),
  );
});

test('disposal rejects connection before a delayed router import completes', async ({
  page,
}, testInfo) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/_test-sdk/esm/SeamsWeb/walletIframe/client/router.js', async (route) => {
    await gate;
    await route.fallback();
  });
  const requested = page.waitForRequest('**/_test-sdk/esm/SeamsWeb/walletIframe/client/router.js');
  await page.evaluate(
    `const connectionSucceeded = ${connectionSucceeded.toString()}; const connectionFailed = ${connectionFailed.toString()}; (${startClient.toString()})()`,
  );
  await requested;
  await page.evaluate(() => window.connectionProbe.seams.connection.dispose());
  expect(await page.evaluate(() => window.connectionProbe.completion)).toBe('rejected');
  release();
  await page.evaluate(async () => {
    await import('/_test-sdk/esm/SeamsWeb/walletIframe/client/router.js');
  });
  expect(await page.evaluate(retryClient)).toBe('rejected');
  const result = await page.evaluate(connectionSnapshot);
  expect(result.states.map((state) => state.kind)).toEqual(['idle', 'connecting', 'disposed']);
  expect(result.iframes).toBe(0);
  await writeFile(
    testInfo.outputPath('connection-disposed-import.json'),
    JSON.stringify(result, null, 2),
  );
});
