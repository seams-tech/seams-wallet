import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { setupBasicPasskeyTest } from '../setup';
import { buildWalletServiceHtml, registerWalletServiceRoute } from './harness';

const hostScript = `
const sessionAdopt = adoptPort;
let currentWallet = 'alice.testnet';
let selectionRevision = 0;
let holdNextSession = false;
let heldSession = null;
let sessionRequests = [];
function currentSession(walletId) {
  return walletId === null ? { kind: 'wallet_locked' } : { kind: 'wallet_unlocked_without_signing_session', walletId, reason: 'absent' };
}
function preferences() {
  return { walletId: currentWallet, revision: selectionRevision, confirmationConfig: { uiMode: 'modal', behavior: 'requireClick', autoProceedDelay: 0 } };
}
let originalSessionMessage;
function sessionMessage(event) {
  const message = event.data;
  if (message.type === 'PM_GET_EXACT_WALLET_SESSION_STATE') {
    sessionRequests.push(message.payload);
    const walletId = message.payload.wallet.kind === 'exact' ? message.payload.wallet.walletId : currentWallet;
    const result = currentSession(walletId);
    if (holdNextSession) {
      holdNextSession = false;
      heldSession = { requestId: message.requestId, result };
    } else postResult(message.requestId, result);
    return;
  }
  if (message.type === 'PM_GET_CONFIRMATION_CONFIG') {
    postResult(message.requestId, preferences());
    return;
  }
  return originalSessionMessage(event);
}
function sessionAdoptPort(port) {
  sessionAdopt(port);
  originalSessionMessage = adoptedPort.onmessage;
  adoptedPort.onmessage = sessionMessage;
}
adoptPort = sessionAdoptPort;
window.holdNextSession = function() { holdNextSession = true; };
window.releaseSession = function() { const held = heldSession; heldSession = null; postResult(held.requestId, held.result); };
window.selectWallet = function(walletId) {
  currentWallet = walletId;
  selectionRevision++;
  adoptedPort.postMessage({ type: 'PREFERENCES_CHANGED', payload: preferences() });
};
window.sessionHostState = function() { return { held: heldSession !== null, requests: sessionRequests }; };
`;

function recordLoginStatus(status: unknown): void {
  (window as any).sessionProbe.events.push(status);
}

async function initializeClient(): Promise<void> {
  const path = '/_test-sdk/esm/SeamsWeb/walletIframe/client/router.js';
  const { WalletIframeRouter } = await import(path);
  const router = new WalletIframeRouter({
    hostConfig: (window as any).__SEAMS_TEST_HOST_CONFIG__,
    walletOrigin: 'https://wallet.example.localhost',
    servicePath: '/wallet-service',
    sdkBasePath: '/sdk',
  });
  (window as any).sessionProbe = { router, events: [], read: null };
  router.onLoginStatusChanged(recordLoginStatus);
  await router.init();
  await router.getExactSessionState();
}

function beginRead(): void {
  const probe = (window as any).sessionProbe;
  probe.read = probe.router.getExactSessionState().then(readSucceeded, readFailed);
}

function readSucceeded(state: unknown): unknown {
  return { kind: 'resolved', state };
}

function readFailed(error: Error): unknown {
  return { kind: 'rejected', message: error.message };
}

function finishRead(): Promise<unknown> {
  return (window as any).sessionProbe.read;
}

function readClient(): unknown {
  const probe = (window as any).sessionProbe;
  return { state: probe.router.getMirroredExactSessionState(), events: probe.events };
}

function readDisposedClient(): unknown {
  try {
    return readClient();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function disposeClient(): void {
  (window as any).sessionProbe.router.dispose();
}

function reinitializeClient(): Promise<unknown> {
  return (window as any).sessionProbe.router.init().then(readSucceeded, readFailed);
}

function holdSession(): void {
  (window as any).holdNextSession();
}

function releaseSession(): void {
  (window as any).releaseSession();
}

function selectWallet(walletId: string | null): void {
  (window as any).selectWallet(walletId);
}

function readHost(): unknown {
  return (window as any).sessionHostState();
}

function walletFrame(frame: { url(): string }): boolean {
  return frame.url().startsWith('https://wallet.example.localhost/wallet-service');
}

test('delayed session reads follow the current wallet and cannot revive disconnected state', async ({
  page,
}, info) => {
  await setupBasicPasskeyTest(page, { skipSeamsWebInit: true });
  await registerWalletServiceRoute(
    page,
    buildWalletServiceHtml({ extraScript: hostScript }),
    '**://wallet.example.localhost/wallet-service*',
  );
  await page.addScriptTag({
    content: [recordLoginStatus, readSucceeded, readFailed, readClient].map(String).join('\n'),
  });
  await page.evaluate(initializeClient);
  const frame = page.frames().find(walletFrame)!;
  await frame.evaluate(holdSession);
  await page.evaluate(beginRead);
  await expect.poll(frame.evaluate.bind(frame, readHost)).toMatchObject({ held: true });
  await frame.evaluate(selectWallet, 'bob.testnet');
  await expect.poll(page.evaluate.bind(page, readClient)).toMatchObject({
    state: { walletId: 'bob.testnet' },
  });
  const afterBob = await page.evaluate(readClient);
  await frame.evaluate(releaseSession);
  const delayedRead = await page.evaluate(finishRead);
  expect(delayedRead).toMatchObject({ kind: 'resolved', state: { walletId: 'bob.testnet' } });
  expect(await page.evaluate(readClient)).toEqual(afterBob);

  await frame.evaluate(holdSession);
  await page.evaluate(beginRead);
  await expect.poll(frame.evaluate.bind(frame, readHost)).toMatchObject({ held: true });
  await frame.evaluate(selectWallet, null);
  await expect.poll(page.evaluate.bind(page, readClient)).toMatchObject({
    state: { kind: 'wallet_locked' },
  });
  await frame.evaluate(releaseSession);
  const removedRead = await page.evaluate(finishRead);
  expect(removedRead).toEqual({ kind: 'resolved', state: { kind: 'wallet_locked' } });

  await frame.evaluate(selectWallet, 'bob.testnet');
  await expect.poll(page.evaluate.bind(page, readClient)).toMatchObject({
    state: { walletId: 'bob.testnet' },
  });
  await frame.evaluate(holdSession);
  await page.evaluate(beginRead);
  await expect.poll(frame.evaluate.bind(frame, readHost)).toMatchObject({ held: true });
  const host = await frame.evaluate(readHost);
  await page.evaluate(disposeClient);
  const disposedRead = await page.evaluate(finishRead);
  expect(disposedRead).toMatchObject({ kind: 'rejected' });
  const disposedClient = await page.evaluate(readDisposedClient);
  expect(disposedClient).toEqual({
    error: 'Wallet iframe exact session state has not been initialized',
  });
  const reinitialization = await page.evaluate(reinitializeClient);
  expect(reinitialization).toEqual({
    kind: 'rejected',
    message: 'Wallet iframe router is disposed',
  });
  await writeFile(
    info.outputPath('session-ordering.json'),
    JSON.stringify(
      { afterBob, delayedRead, removedRead, disposedRead, disposedClient, reinitialization, host },
      null,
      2,
    ),
  );
});
