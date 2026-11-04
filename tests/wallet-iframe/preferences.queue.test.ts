import { test, expect, type Page, type Route, type TestInfo } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setupBasicPasskeyTest } from '../setup';
import { buildWalletServiceHtml, registerWalletServiceRoute } from './harness';

const origin = 'https://wallet.example.localhost';
const host = `
let pendingPreferences = [];
let preferenceRevision = 0;
let observedPreferenceWrites = [];
let observedSignatures = 0;
const originalPreferenceAdopt = adoptPort;
function interceptPreferences(event) {
  const message = event.data;
  if (message.type === 'PM_SET_CONFIRMATION_CONFIG') {
    pendingPreferences.push(message);
    observedPreferenceWrites.push(message.payload);
    return;
  }
  if (message.type === 'PM_GET_CONFIRMATION_CONFIG') {
    postResult(message.requestId, { walletId: null, revision: preferenceRevision, confirmationConfig: { behavior: 'requireClick', uiMode: 'modal', autoProceedDelay: 0 } });
    return;
  }
  if (message.type === 'PM_SIGN_AND_SEND_TX') { observedSignatures++; postResult(message.requestId, {}); return; }
  window.originalPreferenceMessage(event);
}
function adoptPreferencePort(port) {
  originalPreferenceAdopt(port);
  window.originalPreferenceMessage = adoptedPort.onmessage;
  adoptedPort.onmessage = interceptPreferences;
}
adoptPort = adoptPreferencePort;
window.preferenceSnapshot = () => ({ pending: pendingPreferences.length, writes: observedPreferenceWrites, signatures: observedSignatures });
window.answerPreference = function(ok) {
  const message = pendingPreferences.shift();
  if (!message) throw new Error('No preference write pending');
  if (ok) postResult(message.requestId, { walletId: message.payload.walletId ?? null, revision: ++preferenceRevision, confirmationConfig: { behavior: 'requireClick', uiMode: 'modal', autoProceedDelay: 0, ...message.payload.config } });
  else adoptedPort.postMessage({ type: 'ERROR', requestId: message.requestId, payload: { code: 'preference_refused', message: 'Preference refused' } });
};
window.pushPreference = function() {
  adoptedPort.postMessage({ type: 'PREFERENCES_CHANGED', payload: {
    walletId: 'alice.testnet', confirmationConfig: { behavior: 'requireClick', uiMode: 'modal', autoProceedDelay: 7 }, revision: ++preferenceRevision
  } });
};
`;

const persistenceHost = `
const persistenceAdopt = adoptPort;
let persistenceReady;
let preferenceHandlers;
let preferenceManager;
let database;
let persistenceOriginalMessage;
let rejectWrite = false;
let preferenceRevision = 0;
function preferenceSnapshot() {
  return { walletId: preferenceManager.getCurrentWalletId(), confirmationConfig: preferenceManager.getConfirmationConfig(), revision: preferenceRevision };
}
function publishPreference() {
  preferenceRevision++;
  basePreferenceSnapshot = preferenceSnapshot();
  adoptedPort.postMessage({ type: 'PREFERENCES_CHANGED', payload: basePreferenceSnapshot });
}
async function writePreferences(input) {
  if (rejectWrite) {
    rejectWrite = false;
    throw new Error('Injected preference storage failure');
  }
  return database.updateWalletPreferences(input);
}
function storeProperty(target, key) {
  if (key === 'updateWalletPreferences') return writePreferences;
  const value = Reflect.get(target, key);
  return typeof value === 'function' ? value.bind(target) : value;
}
function getPreferenceRuntime() { return { preferences: preferenceManager }; }
function preferencePost(message) { adoptedPort.postMessage(message); }
function noCancellation() { return false; }
async function initializePersistence() {
  const sdk = await import('/__preference-persistence.js');
  sdk.configureIndexedDB({ mode: 'wallet' });
  database = sdk.IndexedDBManager;
  await database.upsertProfile({ profileId: 'alice.testnet' });
  await database.upsertProfile({ profileId: 'bob.testnet', preferences: { useRelayer: true, useNetwork: 'testnet', confirmationConfig: { uiMode: 'drawer', behavior: 'requireClick', autoProceedDelay: 7 } } });
  preferenceManager = new sdk.UserPreferencesManager({ store: new Proxy(database, { get: storeProperty }) });
  preferenceManager.onConfirmationConfigChange(publishPreference);
  preferenceManager.onCurrentWalletChange(publishPreference);
  preferenceManager.setCurrentWallet('alice.testnet');
  await preferenceManager.reloadUserSettings();
  preferenceHandlers = sdk.createPreferencesWalletIframeHandlers({
    getWalletRuntime: getPreferenceRuntime, readPreferences: preferenceSnapshot,
    post: preferencePost, postProgress: noCancellation,
    isCancelled: noCancellation, respondIfCancelled: noCancellation,
  });
}
async function persistenceMessage(event) {
  await persistenceReady;
  const handler = preferenceHandlers[event.data.type];
  if (!handler) return persistenceOriginalMessage(event);
  try { await handler(event.data); }
  catch (error) { adoptedPort.postMessage({ type: 'ERROR', requestId: event.data.requestId, payload: { code: 'preference_write_failed', message: error.message } }); }
}
function persistenceAdoptPort(port) {
  persistenceAdopt(port);
  persistenceOriginalMessage = adoptedPort.onmessage;
  persistenceReady = initializePersistence();
  adoptedPort.onmessage = persistenceMessage;
}
adoptPort = persistenceAdoptPort;
window.preferencePersistenceState = async function() {
  await persistenceReady;
  return {
    current: preferenceSnapshot(),
    alice: await database.getWalletPreferences('alice.testnet'),
    bob: await database.getWalletPreferences('bob.testnet'),
  };
};
window.failPreferenceWrite = function() { rejectWrite = true; };
`;

function succeeded(label: string): void {
  (window as any).preferenceProbe.results[label] = 'ok';
}
function failed(label: string, error: Error): void {
  (window as any).preferenceProbe.results[label] = error.message;
}
async function initialize(): Promise<void> {
  const sdkPath = '/_test-sdk/esm/SeamsWeb/index.js';
  const refsPath = '/_test-sdk/esm/core/signingEngine/interfaces/ecdsaChainTarget.js';
  const { SeamsWeb } = await import(sdkPath);
  const refs = await import(refsPath);
  const seams = new SeamsWeb({
    chains: [
      {
        network: 'near-testnet',
        rpcUrl: 'https://test.rpc.fastnear.com',
        explorerUrl: 'https://testnet.nearblocks.io',
      },
    ],
    relayer: { url: 'http://localhost:3000' },
    routerAb: { normalSigning: { mode: 'enabled', signingWorkerId: 'test-worker' } },
    iframeWallet: {
      walletOrigin: 'https://wallet.example.localhost',
      walletServicePath: '/wallet-service',
      sdkBasePath: '/sdk',
    },
  });
  await seams.connection.connect();
  (window as any).preferenceProbe = { seams, refs, results: {} };
}
function startWrites(): void {
  const { seams, refs } = (window as any).preferenceProbe;
  seams.preferences.setCurrentWallet(refs.toWalletId('alice.testnet'));
  seams.preferences.setConfirmationConfig({ uiMode: 'drawer' });
  seams.preferences
    .flush()
    .then(
      (window as any).prefSucceeded.bind(null, 'first'),
      (window as any).prefFailed.bind(null, 'first'),
    );
  seams.preferences
    .flush()
    .then(
      (window as any).prefSucceeded.bind(null, 'concurrent'),
      (window as any).prefFailed.bind(null, 'concurrent'),
    );
  seams.preferences.setCurrentWallet(refs.toWalletId('bob.testnet'));
  seams.preferences.setConfirmationBehavior('skipClick');
}
function readProjection() {
  const { seams, results } = (window as any).preferenceProbe;
  return {
    walletId: seams.preferences.getCurrentWalletId(),
    config: seams.preferences.getConfirmationConfig(),
    results,
  };
}
async function projection(page: Page) {
  return await page.evaluate(readProjection);
}
function observeHost() {
  return (window as any).preferenceSnapshot();
}
function answerHost(ok: boolean): void {
  (window as any).answerPreference(ok);
}
function pushHost(): void {
  (window as any).pushPreference();
}
function startSigning(): void {
  const { seams, refs } = (window as any).preferenceProbe;
  seams.preferences.setCurrentWallet(refs.toWalletId('alice.testnet'));
  seams.preferences.setConfirmationConfig({ uiMode: 'drawer' });
  seams.near
    .signAndSendTransaction({
      walletSession: refs.walletSessionRefFromSession({
        walletId: 'alice.testnet',
        walletSessionUserId: 'alice.testnet',
      }),
      nearAccount: refs.nearAccountRefFromAccountId('alice.testnet'),
      receiverId: 'alice.testnet',
      actions: [{ type: 'Transfer', amount: '0' }],
    })
    .then((result: { success: boolean; error?: string }) => {
      if (result.success) (window as any).prefSucceeded('sign');
      else (window as any).prefFailed('sign', new Error(result.error));
    });
}
function startDisposal(): void {
  const { seams } = (window as any).preferenceProbe;
  seams.preferences.setConfirmationConfig({ autoProceedDelay: 8 });
  seams.preferences
    .flush()
    .then(
      (window as any).prefSucceeded.bind(null, 'dispose'),
      (window as any).prefFailed.bind(null, 'dispose'),
    );
}
function disposeBrowser(): void {
  (window as any).preferenceProbe.seams.connection.dispose();
}
async function flushBrowser(): Promise<void> {
  await (window as any).preferenceProbe.seams.preferences.flush();
}

async function verifyQueue({ page }: { page: Page }, info: TestInfo): Promise<void> {
  await setupBasicPasskeyTest(page, { skipSeamsWebInit: true });
  await registerWalletServiceRoute(
    page,
    buildWalletServiceHtml({ extraScript: host }),
    '**://wallet.example.localhost/wallet-service*',
  );
  await page.addScriptTag({
    content: `window.prefSucceeded = ${succeeded.toString()}; window.prefFailed = ${failed.toString()};`,
  });
  await page.evaluate(initialize);
  const frame = page.frames().find(isWalletFrame)!;
  await page.evaluate(startWrites);
  await expect.poll(frame.evaluate.bind(frame, observeHost)).toMatchObject({ pending: 1 });
  await frame.evaluate(pushHost);
  await expect
    .poll(projection.bind(null, page))
    .toMatchObject({ walletId: 'bob.testnet', config: { behavior: 'skipClick' } });
  await frame.evaluate(answerHost, false);
  await expect
    .poll(projection.bind(null, page))
    .toMatchObject({ results: { first: 'Preference refused', concurrent: 'Preference refused' } });
  await expect.poll(frame.evaluate.bind(frame, observeHost)).toMatchObject({ pending: 1 });
  const beforeSecondReply = await page.evaluate(readProjection);
  expect(beforeSecondReply.results).toEqual({
    first: 'Preference refused',
    concurrent: 'Preference refused',
  });
  await frame.evaluate(answerHost, true);
  await page.evaluate(flushBrowser);
  const writes = await frame.evaluate(observeHost);
  expect(writes.writes.map(readWalletId)).toEqual(['alice.testnet', 'bob.testnet']);
  await page.evaluate(startSigning);
  await expect
    .poll(frame.evaluate.bind(frame, observeHost))
    .toMatchObject({ pending: 1, signatures: 0 });
  await frame.evaluate(answerHost, false);
  await expect.poll(projection.bind(null, page)).toMatchObject({
    config: { uiMode: 'modal', autoProceedDelay: 7 },
    results: { sign: 'Preference refused' },
  });
  expect((await frame.evaluate(observeHost)).signatures).toBe(0);
  await page.evaluate(flushBrowser);
  await page.evaluate(startDisposal);
  await expect.poll(frame.evaluate.bind(frame, observeHost)).toMatchObject({ pending: 1 });
  await page.evaluate(disposeBrowser);
  await expect
    .poll(projection.bind(null, page))
    .toMatchObject({ results: { dispose: 'Wallet preference synchronization is disposed' } });
  const receipt = {
    kind: 'preference_queue_browser_v1',
    writes: writes.writes,
    results: (await page.evaluate(readProjection)).results,
    signaturesDispatched: 0,
  };
  const artifact = path.resolve(
    info.config.rootDir,
    '../.artifacts/r170-preference-queue/browser-receipt.json',
  );
  await mkdir(path.dirname(artifact), { recursive: true });
  await writeFile(artifact, JSON.stringify(receipt, null, 2));
  await info.attach('preference-queue-receipt', {
    body: JSON.stringify(receipt),
    contentType: 'application/json',
  });
}
function isWalletFrame(frame: { url(): string }): boolean {
  return frame.url().startsWith(origin);
}
function readWalletId(write: { walletId: string }): string {
  return write.walletId;
}

test(
  'preference writes preserve targets, rollback, flush boundaries, signing admission, and disposal',
  verifyQueue,
);

async function serveBundle(bundle: string, route: Route): Promise<void> {
  await route.fulfill({ contentType: 'text/javascript', body: bundle });
}
async function initializeClient(): Promise<void> {
  const modulePath = '/_test-sdk/esm/SeamsWeb/walletIframe/client/router.js';
  const { WalletIframeRouter } = await import(modulePath);
  const router = new WalletIframeRouter({
    hostConfig: (window as any).__SEAMS_TEST_HOST_CONFIG__,
    walletOrigin: 'https://wallet.example.localhost',
    servicePath: '/wallet-service',
    sdkBasePath: '/sdk',
  });
  (window as any).persistenceClient = { router, result: 'idle' };
  await router.init();
}
function beginWrite(delay: number): void {
  const probe = (window as any).persistenceClient;
  probe.result = 'pending';
  void probe.router
    .setConfirmationConfig({ autoProceedDelay: delay }, 'alice.testnet')
    .then(writeSucceeded, writeFailed);
}
function writeSucceeded(): void {
  (window as any).persistenceClient.result = 'saved';
}
function writeFailed(error: Error): void {
  (window as any).persistenceClient.result = error.message;
}
function readResult(): string {
  return (window as any).persistenceClient.result;
}
function readPersistedHost() {
  return (window as any).preferencePersistenceState();
}
function failWrite(): void {
  (window as any).failPreferenceWrite();
}
function disposeClient(): void {
  (window as any).persistenceClient.router.dispose();
}

async function verifyFailedWrite({ page }: { page: Page }, info: TestInfo): Promise<void> {
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({
    stdin: {
      contents: `
        export { UserPreferencesManager } from './packages/wallet/src/core/signingEngine/session/userPreferences.ts';
        export { IndexedDBManager, configureIndexedDB } from './packages/wallet/src/core/indexedDB/index.ts';
        export { createPreferencesWalletIframeHandlers } from './packages/wallet/src/SeamsWeb/walletIframe/host/handlers/preferences.ts';
      `,
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    tsconfig: path.join(root, 'packages/wallet/tsconfig.json'),
  });
  await setupBasicPasskeyTest(page, { skipSeamsWebInit: true });
  await page.route(
    '**/__preference-persistence.js',
    serveBundle.bind(null, bundle.outputFiles[0]!.text),
  );
  await registerWalletServiceRoute(
    page,
    buildWalletServiceHtml({ extraScript: persistenceHost }),
    '**://wallet.example.localhost/wallet-service*',
  );
  await page.addScriptTag({ content: writeSucceeded.toString() + '\n' + writeFailed.toString() });
  await page.evaluate(initializeClient);
  const frame = page.frames().find(isWalletFrame)!;
  await page.evaluate(beginWrite, 11);
  await expect.poll(page.evaluate.bind(page, readResult)).toBe('saved');
  const committed = await frame.evaluate(readPersistedHost);
  expect(committed).toMatchObject({
    alice: { confirmationConfig: { autoProceedDelay: 11 } },
    bob: { confirmationConfig: { autoProceedDelay: 7 } },
  });
  await frame.evaluate(failWrite);
  await page.evaluate(beginWrite, 15);
  await expect
    .poll(page.evaluate.bind(page, readResult))
    .toBe('Injected preference storage failure');
  const failed = await frame.evaluate(readPersistedHost);
  expect(failed.alice).toEqual(committed.alice);
  expect(failed.bob).toEqual(committed.bob);
  await page.evaluate(beginWrite, 19);
  await expect.poll(page.evaluate.bind(page, readResult)).toBe('saved');
  const recovered = await frame.evaluate(readPersistedHost);
  expect(recovered.alice.confirmationConfig.autoProceedDelay).toBe(19);
  expect(recovered.bob).toEqual(committed.bob);
  await page.evaluate(disposeClient);
  const artifact = info.outputPath('preference-persistence.json');
  await writeFile(artifact, JSON.stringify({ committed, failed, recovered }, null, 2));
  await info.attach('preference-persistence', { path: artifact, contentType: 'application/json' });
}

test(
  'a failed durable preference write leaves stored preferences unchanged and a retry saves',
  verifyFailedWrite,
);
