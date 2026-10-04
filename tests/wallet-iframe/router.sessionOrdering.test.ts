import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { setupBasicPasskeyTest } from '../setup';
import { buildWalletServiceHtml, registerWalletServiceRoute } from './harness';

const hostScript = `
const sessionAdopt = adoptPort;
let currentWallet = 'alice.testnet';
let selectionRevision = 0;
let observationRevision = 0;
let sessionReason = 'absent';
let currentProjection = null;
let holdNextSession = false;
let heldSession = null;
let sessionRequests = [];
function currentSession(walletId) {
  if (currentProjection && currentProjection.walletId === walletId) return currentProjection;
  return walletId === null ? { kind: 'wallet_locked' } : { kind: 'wallet_unlocked_without_signing_session', walletId, reason: sessionReason };
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
    const result = { revision: ++observationRevision, walletId, state: currentSession(walletId) };
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
window.changeSessionReason = function(reason) { sessionReason = reason; };
window.holdNextSession = function() { holdNextSession = true; };
window.releaseSession = function() { const held = heldSession; heldSession = null; postResult(held.requestId, held.result); };
window.selectWallet = function(walletId) {
  currentWallet = walletId;
  selectionRevision++;
  adoptedPort.postMessage({ type: 'PREFERENCES_CHANGED', payload: preferences() });
  publishSessionProjection(currentSession(currentWallet), currentWallet);
};
function publishSessionProjection(state, walletId) {
  adoptedPort.postMessage({ type: 'SESSION_CHANGED', payload: { revision: ++observationRevision, walletId, state } });
}
window.publishCurrentSession = function() { publishSessionProjection(currentSession(currentWallet), currentWallet); };
window.setSessionProjection = function(state) { currentProjection = state; publishSessionProjection(state, state.walletId); };
window.publishOtherWalletLock = function() { publishSessionProjection({ kind: 'wallet_locked' }, 'bob.testnet'); };
window.emitExpiry = function(session) {
  const event = {
    version: 1, event: 'signing_session.expired', walletId: session.walletId,
    walletSessionId: session.walletSessionId, authMethod: session.authMethod,
    expiresAtMs: session.expiresAtMs, detectedAtMs: session.expiresAtMs + 1,
    source: 'server_rejection',
  };
  adoptedPort.postMessage({ type: 'SDK_LIFECYCLE_EVENT', payload: { revision: ++observationRevision, event } });
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
  router.onSessionChange(recordLoginStatus);
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

function changeSessionReason(reason: string): void {
  (window as any).changeSessionReason(reason);
}

function readFreshSession(): Promise<unknown> {
  return (window as any).sessionProbe.router.getExactSessionState();
}

test('an older same-wallet snapshot cannot replace a newer session observation', async ({
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
  await frame.evaluate(changeSessionReason, 'unavailable');
  const current = await page.evaluate(readFreshSession);
  expect(current).toMatchObject({ walletId: 'alice.testnet', reason: 'unavailable' });
  await frame.evaluate(releaseSession);
  const delayed = await page.evaluate(finishRead);
  expect(delayed).toMatchObject({ kind: 'resolved', state: current });
  const mirrored = await page.evaluate(readClient);
  expect(mirrored).toMatchObject({ state: current });
  await writeFile(
    info.outputPath('same-wallet-ordering.json'),
    JSON.stringify({ current, delayed, mirrored }, null, 2),
  );
});

function publishCurrentSession(): void {
  (window as any).publishCurrentSession();
}

function setSessionProjection(state: unknown): void {
  (window as any).setSessionProjection(state);
}

function publishOtherWalletLock(): void {
  (window as any).publishOtherWalletLock();
}

function emitExpiry(state: unknown): void {
  (window as any).emitExpiry(state);
}

test('session and expiry events outrank delayed reads and retain a newer unlock', async ({
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
  await frame.evaluate(changeSessionReason, 'unavailable');
  await frame.evaluate(publishCurrentSession);
  await expect.poll(page.evaluate.bind(page, readClient)).toMatchObject({
    state: { walletId: 'alice.testnet', reason: 'unavailable' },
  });
  await frame.evaluate(releaseSession);
  const eventWon = await page.evaluate(finishRead);
  expect(eventWon).toMatchObject({ state: { reason: 'unavailable' } });

  const active = {
    kind: 'active_session',
    status: 'active',
    walletId: 'alice.testnet',
    authorizationId: 'wsa_event_ordering_original',
    walletSessionId: 'wss_event_ordering_original',
    authMethod: 'passkey',
    expiresAtMs: 4102444800000,
  };
  await frame.evaluate(setSessionProjection, active);
  await expect
    .poll(page.evaluate.bind(page, readClient))
    .toMatchObject({ state: { kind: 'active_session' } });
  await frame.evaluate(holdSession);
  await page.evaluate(beginRead);
  await expect.poll(frame.evaluate.bind(frame, readHost)).toMatchObject({ held: true });
  await frame.evaluate(emitExpiry, active);
  await expect
    .poll(page.evaluate.bind(page, readClient))
    .toMatchObject({ state: { kind: 'expired_session' } });
  await frame.evaluate(releaseSession);
  const expiryWon = await page.evaluate(finishRead);
  expect(expiryWon).toMatchObject({
    state: { kind: 'expired_session', walletSessionId: active.walletSessionId },
  });

  const renewed = {
    kind: 'active_session',
    status: 'active',
    walletId: 'alice.testnet',
    authorizationId: 'wsa_event_ordering_renewed',
    walletSessionId: 'wss_event_ordering_renewed',
    authMethod: 'passkey',
    expiresAtMs: 4102444900000,
  };
  await frame.evaluate(setSessionProjection, renewed);
  await expect
    .poll(page.evaluate.bind(page, readClient))
    .toMatchObject({ state: { walletSessionId: renewed.walletSessionId } });
  await frame.evaluate(emitExpiry, active);
  await frame.evaluate(publishOtherWalletLock);
  // A new same-wallet read is also a delivery barrier for the earlier notifications.
  const afterOldEvents = await page.evaluate(readFreshSession);
  expect(afterOldEvents).toMatchObject({
    kind: 'active_session',
    walletSessionId: renewed.walletSessionId,
  });
  await writeFile(
    info.outputPath('session-events.json'),
    JSON.stringify({ eventWon, expiryWon, afterOldEvents }, null, 2),
  );
});

const richSessionScript = `
const richAdopt = adoptPort;
let heldRich = null;
let holdRich = false;
let richRequests = 0;
let richAuthenticated = true;
function richSessionMessage(receive, event) {
  const message = event.data;
  if (message.type !== 'PM_GET_WALLET_SESSION') return receive(event);
  richRequests++;
  const walletId = message.payload?.walletId ?? currentWallet;
  // Raw wire responses exercise the production session parser.
  const result = {
    appIdentity: { kind: 'resolved', walletId, nearAccountId: walletId,
      nearOperationalPublicKey: null, userData: null, authMethods: [],
      thresholdEcdsaEthereumAddress: null, thresholdEcdsaPublicKeyB64u: null },
    authentication: richAuthenticated ? { kind: 'authenticated', walletId, authMethod: 'passkey' } : { kind: 'signed_out' },
    capabilityProjection: { kind: 'not_requested' }, nonceDiagnostics: null,
  };
  if (holdRich) {
    holdRich = false;
    heldRich = { requestId: message.requestId, result };
  } else postResult(message.requestId, result);
}
function richAdoptPort(port) {
  richAdopt(port);
  adoptedPort.onmessage = richSessionMessage.bind(null, adoptedPort.onmessage);
}
adoptPort = richAdoptPort;
window.holdRich = function() { holdRich = true; };
window.richState = function() { return { held: heldRich !== null, requests: richRequests }; };
window.releaseRich = function() { const held = heldRich; heldRich = null; postResult(held.requestId, held.result); };
window.lockRich = function() { richAuthenticated = false; publishSessionProjection({ kind: 'wallet_locked' }, currentWallet); };
`;

function beginRichRead(walletId: string | null): void {
  const probe = (window as any).sessionProbe;
  probe.read = probe.router.getWalletSession(walletId ?? undefined).then(readSucceeded, readFailed);
}

function holdRich(): void {
  (window as any).holdRich();
}

function releaseRich(): void {
  (window as any).releaseRich();
}

function richState(): unknown {
  return (window as any).richState();
}

function lockRich(): void {
  (window as any).lockRich();
}

test('rich session reads reconcile selection and authority changes while preserving explicit wallet queries', async ({
  page,
}, info) => {
  await setupBasicPasskeyTest(page, { skipSeamsWebInit: true });
  await registerWalletServiceRoute(
    page,
    buildWalletServiceHtml({ extraScript: hostScript + richSessionScript }),
    '**://wallet.example.localhost/wallet-service*',
  );
  await page.addScriptTag({
    content: [recordLoginStatus, readSucceeded, readFailed, readClient].map(String).join('\n'),
  });
  await page.evaluate(initializeClient);
  const frame = page.frames().find(walletFrame)!;
  await frame.evaluate(holdRich);
  await page.evaluate(beginRichRead, null);
  await expect.poll(frame.evaluate.bind(frame, richState)).toMatchObject({ held: true });
  await frame.evaluate(selectWallet, 'bob.testnet');
  await expect
    .poll(page.evaluate.bind(page, readClient))
    .toMatchObject({ state: { walletId: 'bob.testnet' } });
  await frame.evaluate(releaseRich);
  const selected = await page.evaluate(finishRead);
  expect(selected).toMatchObject({
    kind: 'resolved',
    state: { authentication: { walletId: 'bob.testnet' } },
  });

  await frame.evaluate(holdRich);
  await page.evaluate(beginRichRead, 'alice.testnet');
  await expect.poll(frame.evaluate.bind(frame, richState)).toMatchObject({ held: true });
  await frame.evaluate(lockRich);
  await expect
    .poll(page.evaluate.bind(page, readClient))
    .toMatchObject({ state: { kind: 'wallet_locked' } });
  await frame.evaluate(releaseRich);
  const explicit = await page.evaluate(finishRead);
  expect(explicit).toMatchObject({
    kind: 'resolved',
    state: { appIdentity: { walletId: 'alice.testnet' }, authentication: { kind: 'signed_out' } },
  });

  await frame.evaluate(holdRich);
  await page.evaluate(beginRichRead, null);
  await expect.poll(frame.evaluate.bind(frame, richState)).toMatchObject({ held: true });
  await page.evaluate(disposeClient);
  const disposed = await page.evaluate(finishRead);
  expect(disposed).toMatchObject({ kind: 'rejected' });
  await writeFile(
    info.outputPath('rich-session-ordering.json'),
    JSON.stringify({ selected, explicit, disposed }, null, 2),
  );
});
