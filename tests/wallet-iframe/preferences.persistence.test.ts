import { expect, test, type Route } from '@playwright/test';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setupBasicPasskeyTest } from '../setup';
import { buildWalletServiceHtml, registerWalletServiceRoute } from './harness';

const hostScript = `
const persistenceAdopt = adoptPort;
let persistenceReady;
let preferenceHandlers;
let preferenceManager;
let database;
let persistenceOriginalMessage;
let heldRead = null;
let heldWrite = null;
let holdReadWallet = null;
let holdWrite = false;
let rejectWrite = false;
let preferenceRevision = 0;
function preferenceSnapshot() {
  return { walletId: preferenceManager.getCurrentWalletId(), confirmationConfig: preferenceManager.getConfirmationConfig(), revision: preferenceRevision };
}
function publishPreference() {
  preferenceRevision++;
  adoptedPort.postMessage({ type: 'PREFERENCES_CHANGED', payload: preferenceSnapshot() });
}
async function readPreferences(walletId) {
  const captured = await database.getWalletPreferences(walletId);
  if (holdReadWallet === walletId) {
    holdReadWallet = null;
    await new Promise(holdReadRelease);
  }
  return captured;
}
function holdReadRelease(resolve) { heldRead = resolve; }
function holdWriteRelease(resolve) { heldWrite = resolve; }
async function writePreferences(input) {
  if (holdWrite) {
    holdWrite = false;
    await new Promise(holdWriteRelease);
  }
  if (rejectWrite) {
    rejectWrite = false;
    throw new Error('Injected preference storage failure');
  }
  return database.updateWalletPreferences(input);
}
function storeProperty(target, key) {
  if (key === 'getWalletPreferences') return readPreferences;
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
    heldRead: heldRead !== null, heldWrite: heldWrite !== null,
  };
};
window.delayAliceReadThenSelectBob = function() {
  holdReadWallet = 'alice.testnet';
  preferenceManager.setCurrentWallet('alice.testnet');
  preferenceManager.setCurrentWallet('bob.testnet');
};
window.releasePreferenceRead = function() { const release = heldRead; heldRead = null; release(); };
window.holdPreferenceWrite = function() { holdWrite = true; };
window.failPreferenceWrite = function() { rejectWrite = true; };
window.releasePreferenceWrite = function() { const release = heldWrite; heldWrite = null; release(); };
window.selectBob = function() { preferenceManager.setCurrentWallet('bob.testnet'); };
`;

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
function readHost() {
  return (window as any).preferencePersistenceState();
}
function delayRead(): void {
  (window as any).delayAliceReadThenSelectBob();
}
function releaseRead(): void {
  (window as any).releasePreferenceRead();
}
function holdWrite(): void {
  (window as any).holdPreferenceWrite();
}
function releaseWrite(): void {
  (window as any).releasePreferenceWrite();
}
function failWrite(): void {
  (window as any).failPreferenceWrite();
}
function selectBob(): void {
  (window as any).selectBob();
}
function disposeClient(): void {
  (window as any).persistenceClient.router.dispose();
}
function walletFrame(frame: { url(): string }): boolean {
  return frame.url().startsWith('https://wallet.example.localhost/wallet-service');
}

test('preference acknowledgements await durable storage and delayed reads retain their wallet', async ({
  page,
}, info) => {
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
    buildWalletServiceHtml({ extraScript: hostScript }),
    '**://wallet.example.localhost/wallet-service*',
  );
  await page.addScriptTag({ content: writeSucceeded.toString() + '\n' + writeFailed.toString() });
  await page.evaluate(initializeClient);
  const frame = page.frames().find(walletFrame)!;
  await frame.evaluate(delayRead);
  await expect.poll(frame.evaluate.bind(frame, readHost)).toMatchObject({
    heldRead: true,
    current: { walletId: 'bob.testnet', confirmationConfig: { autoProceedDelay: 7 } },
  });
  await frame.evaluate(releaseRead);
  const afterRead = await frame.evaluate(readHost);
  expect(afterRead.current).toMatchObject({
    walletId: 'bob.testnet',
    confirmationConfig: { autoProceedDelay: 7 },
  });
  await frame.evaluate(holdWrite);
  await page.evaluate(beginWrite, 11);
  await expect.poll(frame.evaluate.bind(frame, readHost)).toMatchObject({ heldWrite: true });
  expect(await page.evaluate(readResult)).toBe('pending');
  expect((await frame.evaluate(readHost)).alice).toEqual({});
  await frame.evaluate(selectBob);
  await frame.evaluate(releaseWrite);
  await expect.poll(page.evaluate.bind(page, readResult)).toBe('saved');
  const committed = await frame.evaluate(readHost);
  expect(committed).toMatchObject({
    current: { walletId: 'bob.testnet', confirmationConfig: { autoProceedDelay: 7 } },
    alice: { confirmationConfig: { autoProceedDelay: 11 } },
    bob: { confirmationConfig: { autoProceedDelay: 7 } },
  });
  await frame.evaluate(failWrite);
  await page.evaluate(beginWrite, 15);
  await expect
    .poll(page.evaluate.bind(page, readResult))
    .toBe('Injected preference storage failure');
  const failed = await frame.evaluate(readHost);
  expect(failed.alice).toEqual(committed.alice);
  expect(failed.bob).toEqual(committed.bob);
  await page.evaluate(beginWrite, 19);
  await expect.poll(page.evaluate.bind(page, readResult)).toBe('saved');
  const recovered = await frame.evaluate(readHost);
  expect(recovered.alice.confirmationConfig.autoProceedDelay).toBe(19);
  expect(recovered.bob).toEqual(committed.bob);
  await page.evaluate(disposeClient);
  const artifact = info.outputPath('preference-persistence.json');
  await writeFile(artifact, JSON.stringify({ afterRead, committed, failed, recovered }, null, 2));
  await info.attach('preference-persistence', { path: artifact, contentType: 'application/json' });
});
