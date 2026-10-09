import type { WalletSession } from '@/core/types/seams';
import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { SeamsWeb, ClientConnectionState } from '@/SeamsWeb';
import { setupBasicPasskeyTest } from '../setup';
import { buildWalletServiceHtml, registerWalletServiceRoute } from './harness';

const WALLET_ORIGIN = 'https://wallet.example.localhost';
const SERVICE_ROUTE = '**://wallet.example.localhost/wallet-service*';
const SESSION_READ = `
  const sessionAdopt = adoptPort;
  let holdSessionRead = false;
  let heldSessionRead = null;
  let sessionReadCount = 0;
  let sessionWallet = null;
  function publicSession() {
    if (sessionWallet === null) return { appIdentity: { kind: 'anonymous' }, authentication: { kind: 'signed_out' }, capabilityProjection: { kind: 'not_requested' }, nonceDiagnostics: null };
    return {
      appIdentity: { kind: 'resolved', walletId: sessionWallet, nearAccountId: sessionWallet,
        nearOperationalPublicKey: null, userData: null, authMethods: [],
        thresholdEcdsaEthereumAddress: null, thresholdEcdsaPublicKeyB64u: null },
      authentication: { kind: 'authenticated', walletId: sessionWallet, authMethod: 'passkey' },
      capabilityProjection: { kind: 'not_requested' }, nonceDiagnostics: null,
    };
  }
  adoptPort = function(port) {
    sessionAdopt(port);
    const receive = port.onmessage;
    port.onmessage = function(event) {
      if (event.data.type === 'PM_GET_WALLET_SESSION') {
        sessionReadCount++;
        const response = { requestId: event.data.requestId, result: publicSession() };
        if (holdSessionRead) { holdSessionRead = false; heldSessionRead = response; }
        else postResult(response.requestId, response.result);
        return;
      }
      receive(event);
    };
  };
  window.holdSessionRead = function() { holdSessionRead = true; };
  window.sessionReadState = function() { return { held: heldSessionRead !== null, count: sessionReadCount }; };
  window.releaseSessionRead = function() { const response = heldSessionRead; heldSessionRead = null; postResult(response.requestId, response.result); };
  window.publishSession = function(walletId) {
    sessionWallet = walletId;
    exactSessionState = walletId === null ? { kind: 'wallet_locked' } : { kind: 'wallet_unlocked_without_signing_session', walletId, reason: 'absent' };
    basePreferenceSnapshot = { ...basePreferenceSnapshot, walletId, revision: basePreferenceSnapshot.revision + 1 };
    adoptedPort.postMessage({ type: 'PREFERENCES_CHANGED', payload: basePreferenceSnapshot });
    adoptedPort.postMessage({ type: 'SESSION_CHANGED', payload: { revision: ++sessionObservationRevision, walletId, state: exactSessionState, session: publicSession() } });
  };
`;
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

function recordLoginSession(
  logins: Array<{ isLoggedIn: boolean; walletId: string | null }>,
  session: WalletSession,
): void {
  logins.push({
    isLoggedIn: session.authentication.kind === 'authenticated',
    walletId:
      session.authentication.kind === 'authenticated' ? session.authentication.walletId : null,
  });
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
  seams.auth.onSessionChange(recordLoginSession.bind(null, logins));
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
    `const recordLoginSession = ${recordLoginSession.toString()}; const connectionSucceeded = ${connectionSucceeded.toString()}; const connectionFailed = ${connectionFailed.toString()}; (${startClient.toString()})()`,
  );
  expect(await page.evaluate(() => window.connectionProbe.completion)).toBe('rejected');
  expect((await page.evaluate(connectionSnapshot)).state.kind).toBe('failed');

  await page.unroute(SERVICE_ROUTE);
  await registerWalletServiceRoute(
    page,
    buildWalletServiceHtml({ extraScript: SESSION_READ + HELD_PREFERENCES }),
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
  await registerWalletServiceRoute(
    page,
    buildWalletServiceHtml({ extraScript: SESSION_READ }),
    SERVICE_ROUTE,
  );
  expect(await page.evaluate(retryClient)).toBe('connected');
  await expect.poll(async () => (await page.evaluate(connectionSnapshot)).logins.length).toBe(2);
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
    `const recordLoginSession = ${recordLoginSession.toString()}; const connectionSucceeded = ${connectionSucceeded.toString()}; const connectionFailed = ${connectionFailed.toString()}; (${startClient.toString()})()`,
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

function recordSession(session: unknown): void {
  (window as any).subscriptionProbe.sessions.push(session);
}

function rejectSessionListener(): void {
  throw new Error('Consumer listener failed');
}

function recordLateSession(session: unknown): void {
  (window as any).subscriptionProbe.late.push(session);
}

function subscribeSessions(): void {
  const seams = window.connectionProbe.seams;
  const probe = { sessions: [], late: [], stop: seams.auth.onSessionChange(rejectSessionListener) };
  (window as any).subscriptionProbe = probe;
  probe.stop = seams.auth.onSessionChange(recordSession);
}

function subscribeLate(): void {
  window.connectionProbe.seams.auth.onSessionChange(recordLateSession);
}

function publicSessions() {
  const probe = (window as any).subscriptionProbe;
  return { sessions: probe.sessions, late: probe.late };
}

test('public session subscriptions deliver full state and fence delayed reads, unsubscribe, and disposal', async ({
  page,
}, testInfo) => {
  await registerWalletServiceRoute(
    page,
    buildWalletServiceHtml({ extraScript: SESSION_READ }),
    SERVICE_ROUTE,
  );
  await page.addScriptTag({
    content: [
      recordLoginSession,
      connectionSucceeded,
      connectionFailed,
      recordSession,
      recordLateSession,
      rejectSessionListener,
    ]
      .map(String)
      .join('\n'),
  });
  await page.evaluate(startClient);
  expect(await page.evaluate(() => window.connectionProbe.completion)).toBe('connected');
  await page.evaluate(subscribeSessions);
  await expect
    .poll(page.evaluate.bind(page, publicSessions))
    .toMatchObject({ sessions: [{ authentication: { kind: 'signed_out' } }] });
  const host = page.frames().find((frame) => frame.url().startsWith(WALLET_ORIGIN))!;
  await host.evaluate(() => (window as any).publishSession('alice.testnet'));
  await expect
    .poll(page.evaluate.bind(page, publicSessions))
    .toMatchObject({
      sessions: [
        { authentication: { kind: 'signed_out' } },
        { authentication: { walletId: 'alice.testnet' } },
      ],
    });
  await host.evaluate(() => (window as any).holdSessionRead());
  await page.evaluate(subscribeLate);
  await host.waitForFunction(() => (window as any).sessionReadState().held);
  await host.evaluate(() => (window as any).publishSession('bob.testnet'));
  await expect.poll(page.evaluate.bind(page, publicSessions)).toMatchObject({
    sessions: [
      { authentication: { kind: 'signed_out' } },
      { authentication: { walletId: 'alice.testnet' } },
      {
        authentication: { kind: 'authenticated', walletId: 'bob.testnet' },
        appIdentity: { kind: 'resolved', walletId: 'bob.testnet' },
        capabilityProjection: { kind: 'not_requested' },
      },
    ],
    late: [{ authentication: { kind: 'authenticated', walletId: 'bob.testnet' } }],
  });
  await host.evaluate(() => (window as any).releaseSessionRead());
  await page.evaluate(() => (window as any).subscriptionProbe.stop());
  await host.evaluate(() => (window as any).publishSession(null));
  await expect.poll(page.evaluate.bind(page, publicSessions)).toMatchObject({
    late: [
      { authentication: { kind: 'authenticated' } },
      { authentication: { kind: 'signed_out' } },
    ],
  });
  const afterUnsubscribe = await page.evaluate(publicSessions);
  expect(afterUnsubscribe.sessions).toHaveLength(3);
  await host.evaluate(() => (window as any).holdSessionRead());
  await host.evaluate(() => (window as any).publishSession('carol.testnet'));
  await page.evaluate(subscribeLate);
  await host.waitForFunction(() => (window as any).sessionReadState().held);
  const beforeDisposal = await page.evaluate(publicSessions);
  await page.evaluate(() => window.connectionProbe.seams.connection.dispose());
  const disposed = await page.evaluate(publicSessions);
  expect(disposed).toEqual(beforeDisposal);
  await writeFile(
    testInfo.outputPath('public-session-subscription.json'),
    JSON.stringify({ afterUnsubscribe, disposed }, null, 2),
  );
});
