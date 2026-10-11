import { expect, test, type Route } from '@playwright/test';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setupBasicPasskeyTest } from '../setup';
import { buildWalletServiceHtml, registerWalletServiceRoute } from './harness';

const hostScript = `
const selectionAdopt = adoptPort;
let selectionReady;
let selectionHandlers;
let selectionManager;
let selectionOriginalMessage;
let releaseInventory = null;
let inventoryReads = 0;
let selectionEvents = [];
let selectionDatabase;
let selectionSdk;
let originalAuthorityRead;
let authorityReads = 0;
let heldAuthority = null;
function holdAuthority(resolve) { heldAuthority = resolve; }
async function readSelectedAuthority(walletId) {
  authorityReads++;
  const result = await originalAuthorityRead(walletId);
  if (authorityReads === 2) await new Promise(holdAuthority);
  return result;
}
function holdInventory(resolve) { releaseInventory = resolve; }
async function getRecentUnlocks() {
  inventoryReads++;
  await new Promise(holdInventory);
  return { walletIds: ['alice.testnet'], accountIds: [], accounts: [], lastUsedAccount: null };
}
function recordSelection(walletId) { selectionEvents.push(walletId); adoptedPort.postMessage({ type: 'PREFERENCES_CHANGED', payload: readSelectionPreferences() }); }
function selectionPost(message) { adoptedPort.postMessage(message); }
function noCancellation() { return false; }
async function noPrefill() {}
async function readSession(walletId) {
  return publicSessionForState({
    kind: 'wallet_authenticated_identity_unresolvable',
    walletId,
    reason: 'missing_wallet_profile',
  });
}
let selectionRuntime;
let sessionObserver;
function getSelectionRuntime() { return selectionRuntime; }
function readSelectionPreferences() {
  return { walletId: selectionManager.getCurrentWalletId(), confirmationConfig: selectionManager.getConfirmationConfig(), revision: selectionEvents.length };
}
async function initializeSelection() {
  const sdk = await import('/__session-selection.js');
  sdk.configureIndexedDB({ mode: 'wallet' });
  selectionSdk = sdk;
  selectionDatabase = sdk.IndexedDBManager;
  selectionManager = new sdk.UserPreferencesManager({ store: sdk.IndexedDBManager });
  selectionManager.onCurrentWalletChange(recordSelection);
  if (window.holdAuthorityObservation) {
    selectionManager.setCurrentWallet('alice.testnet');
    originalAuthorityRead = selectionDatabase.resolveSelectedWalletAuthority.bind(selectionDatabase);
    selectionDatabase.resolveSelectedWalletAuthority = readSelectedAuthority;
  }
  selectionRuntime = {
    preferences: selectionManager,
    auth: { getRecentUnlocks },
    configs: { network: { relayer: { url: 'https://relay.example.localhost' } } },
    prefillRestoredWalletSession: noPrefill,
  };
  sessionObserver = new sdk.WalletHostSessionObserver(selectionRuntime, selectionPost, new Map(), readSession);
  selectionHandlers = sdk.createAuthWalletIframeHandlers({
    observeSession: sessionObserver.observe.bind(sessionObserver),
    publishCurrentSession: sessionObserver.publishCurrentSession.bind(sessionObserver),
    getWalletRuntime: getSelectionRuntime, readPreferences: readSelectionPreferences,
    post: selectionPost, postProgress: noCancellation,
    isCancelled: noCancellation, respondIfCancelled: noCancellation,
  });
}
async function selectionMessage(event) {
  await selectionReady;
  if (event.data.type === 'PM_GET_CONFIRMATION_CONFIG') {
    postResult(event.data.requestId, readSelectionPreferences());
    return;
  }
  const handler = selectionHandlers[event.data.type];
  if (!handler) return selectionOriginalMessage(event);
  try { await handler(event.data); }
  catch (error) { adoptedPort.postMessage({ type: 'ERROR', requestId: event.data.requestId, payload: { code: 'selection_failed', message: error.message } }); }
}
function selectionAdoptPort(port) {
  selectionAdopt(port);
  selectionOriginalMessage = adoptedPort.onmessage;
  selectionReady = initializeSelection();
  adoptedPort.onmessage = selectionMessage;
}
adoptPort = selectionAdoptPort;
window.selectionState = function() {
  return { walletId: selectionManager?.getCurrentWalletId(), inventoryHeld: releaseInventory !== null, inventoryReads, selectionEvents };
};
window.selectBob = function() { selectionManager.setCurrentWallet('bob.testnet'); };
window.deleteBob = async function() { await selectionDatabase.deleteProfileData('bob.testnet', { eventAccountId: 'bob.testnet' }); };
window.authorityObservationState = function() { return { held: heldAuthority !== null, reads: authorityReads }; };
window.commitMissingAuthority = async function() {
  const fixture = await selectionSdk.buildEmailOtpEcdsaWalletSessionFixture({
    label: 'host-authority-observation', walletId: 'alice.testnet', expiresAtMs: 10000,
  });
  await selectionDatabase.persistFoundingWalletAuthority({ authority: fixture.authority, authMethod: fixture.authMethod });
};
window.releaseAuthorityObservation = function() { const release = heldAuthority; heldAuthority = null; release(); };
window.releaseInventory = function() { const release = releaseInventory; releaseInventory = null; release(); };
`;

async function serveBundle(bundle: string, route: Route): Promise<void> {
  await route.fulfill({ contentType: 'text/javascript', body: bundle });
}

async function beginClient(): Promise<void> {
  const modulePath = '/_test-sdk/esm/SeamsWeb/walletIframe/client/router.js';
  const { WalletIframeRouter } = await import(modulePath);
  const router = new WalletIframeRouter({
    hostConfig: (window as any).__SEAMS_TEST_HOST_CONFIG__,
    walletOrigin: 'https://wallet.example.localhost',
    servicePath: '/wallet-service',
    sdkBasePath: '/sdk',
  });
  (window as any).selectionClient = { router, ready: router.init() };
}

async function finishClient(): Promise<unknown> {
  const client = (window as any).selectionClient;
  await client.ready;
  return client.router.getMirroredExactSessionState();
}

function readSelection(): unknown {
  return (window as any).selectionState();
}

function selectBob(): void {
  (window as any).selectBob();
}

function releaseInventory(): void {
  (window as any).releaseInventory();
}

async function deleteBob(): Promise<void> {
  await (window as any).deleteBob();
}

function walletFrame(frame: { url(): string }): boolean {
  return frame.url().startsWith('https://wallet.example.localhost/wallet-service');
}

for (const selectionChange of ['none', 'select', 'delete', 'authority'] as const) {
  test(`session bootstrap with selection change: ${selectionChange}`, async ({ page }, info) => {
    const root = path.resolve(import.meta.dirname, '../..');
    const bundle = await build({
      stdin: {
        contents: `
          export { UserPreferencesManager } from './packages/wallet/src/core/signingEngine/session/userPreferences.ts';
          export { IndexedDBManager, configureIndexedDB } from './packages/wallet/src/core/indexedDB/index.ts';
          export { buildEmailOtpEcdsaWalletSessionFixture } from './tests/unit/helpers/linkedDeviceManagement.fixtures.ts';
          export { WalletHostSessionObserver } from './packages/wallet/src/SeamsWeb/walletIframe/host/sessionObserver.ts';
          export { createAuthWalletIframeHandlers } from './packages/wallet/src/SeamsWeb/walletIframe/host/handlers/auth.ts';
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
      '**/__session-selection.js',
      serveBundle.bind(null, bundle.outputFiles[0]!.text),
    );
    await registerWalletServiceRoute(
      page,
      buildWalletServiceHtml({
        extraScript:
          `window.holdAuthorityObservation = ${selectionChange === 'authority'};\n` + hostScript,
      }),
      '**://wallet.example.localhost/wallet-service*',
    );
    const frameReady = page.waitForEvent('framenavigated', { predicate: walletFrame });
    await page.evaluate(beginClient);
    const frame = await frameReady;
    if (selectionChange === 'authority') {
      await expect
        .poll(frame.evaluate.bind(frame, readAuthorityObservation))
        .toMatchObject({ held: true });
      await frame.evaluate(commitMissingAuthority);
      await frame.evaluate(releaseAuthorityObservation);
      await expect.poll(page.evaluate.bind(page, finishClient)).toMatchObject({
        kind: 'wallet_unlocked_without_signing_session',
        walletId: 'alice.testnet',
        reason: 'absent',
      });
      const session = await page.evaluate(finishClient);
      const observation = await frame.evaluate(readAuthorityObservation);
      await writeFile(
        info.outputPath('authority-observation.json'),
        JSON.stringify({ session, observation }, null, 2),
      );
      return;
    }
    await expect
      .poll(frame.evaluate.bind(frame, readSelection))
      .toMatchObject({ inventoryHeld: true });
    if (selectionChange !== 'none') await frame.evaluate(selectBob);
    if (selectionChange === 'delete') await frame.evaluate(deleteBob);
    await frame.evaluate(releaseInventory);
    const session = await page.evaluate(finishClient);
    expect(session).toEqual({ kind: 'wallet_locked' });
    let selectedWallet: string | null = 'alice.testnet';
    let selectionEvents: Array<string | null> = ['alice.testnet'];
    if (selectionChange === 'select') {
      selectedWallet = 'bob.testnet';
      selectionEvents = ['bob.testnet'];
    }
    if (selectionChange === 'delete') {
      selectedWallet = null;
      selectionEvents = ['bob.testnet', null];
    }
    const selection = await frame.evaluate(readSelection);
    expect(selection).toEqual({
      walletId: selectedWallet,
      inventoryHeld: false,
      inventoryReads: 1,
      selectionEvents,
    });
    await writeFile(
      info.outputPath('session-selection.json'),
      JSON.stringify({ session, selection }, null, 2),
    );
  });
}

function readAuthorityObservation(): unknown {
  return (window as any).authorityObservationState();
}

function commitMissingAuthority(): Promise<void> {
  return (window as any).commitMissingAuthority();
}

function releaseAuthorityObservation(): void {
  (window as any).releaseAuthorityObservation();
}
