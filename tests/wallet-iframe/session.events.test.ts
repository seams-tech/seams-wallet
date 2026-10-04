import { expect, test, type Route } from '@playwright/test';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setupBasicPasskeyTest } from '../setup';

const probeSource = `
import { IndexedDBManager, configureIndexedDB } from './packages/wallet/src/core/indexedDB';
import { walletSessionAuthorizations } from './packages/wallet/src/core/indexedDB/seamsWalletDB/walletSessionAuthorizationStore';
import { UserPreferencesManager } from './packages/wallet/src/core/signingEngine/session/userPreferences';
import { WalletHostSessionObserver } from './packages/wallet/src/SeamsWeb/walletIframe/host/sessionObserver';
import { buildEmailOtpEcdsaWalletSessionFixture } from './tests/unit/helpers/linkedDeviceManagement.fixtures';
let fixture;
let observer;
let query;
let held = null;
let holdNext = true;
const messages = [];
const expired = new Map();
const originalFetch = globalThis.fetch;
function hold(resolve) { held = resolve; }
async function statusFetch(input, init) {
  if (String(input) !== 'https://relay.example.test/wallet/session/status') return originalFetch(input, init);
  if (holdNext) {
    holdNext = false;
    await new Promise(hold);
  }
  return new Response(JSON.stringify({
    ok: true, status: 'active', walletSessionId: fixture.operationCredential.walletSessionId,
    quotaId: fixture.activeWalletSession.quotaId, authorization: fixture.activeWalletSession,
    expiresAtMs: fixture.activeWalletSession.expiresAtMs, remainingUses: 10, quotaLifecycle: 'active',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
function post(message) { messages.push(message); }
function publishQuery(snapshot) { messages.push({ type: 'QUERY', payload: snapshot }); }
function readFailed(error) { return { kind: 'rejected', message: error.message }; }
function readSucceeded() { return { kind: 'resolved' }; }
function beginRead() {
  query = observer.observe({ authenticationRead: 'current', wallet: { kind: 'current' } }, publishQuery)
    .then(readSucceeded, readFailed);
}
export async function start() {
  configureIndexedDB({ mode: 'wallet' });
  fixture = await buildEmailOtpEcdsaWalletSessionFixture({
    label: 'session-events', walletId: 'wallet:session-events', expiresAtMs: Date.now() + 60000,
  });
  await IndexedDBManager.persistFoundingWalletAuthority({ authority: fixture.authority, authMethod: fixture.authMethod });
  await walletSessionAuthorizations.writeExactWithOperationCredential({
    record: fixture.activeWalletSession, operationCredential: fixture.operationCredential,
  });
  const preferences = new UserPreferencesManager({ store: IndexedDBManager });
  preferences.setCurrentWallet(fixture.authority.walletId);
  globalThis.fetch = statusFetch;
  observer = new WalletHostSessionObserver({
    preferences, configs: { network: { relayer: { url: 'https://relay.example.test' } } },
  }, post, expired);
  beginRead();
}
export function state() { return { held: held !== null, messages }; }
export function expire() {
  expired.set(fixture.authority.walletId, new Set([fixture.operationCredential.walletSessionId]));
  observer.onLifecycleEvent({
    version: 1, event: 'signing_session.expired', walletId: fixture.authority.walletId,
    walletSessionId: fixture.operationCredential.walletSessionId, authMethod: 'email_otp',
    expiresAtMs: fixture.activeWalletSession.expiresAtMs,
    detectedAtMs: fixture.activeWalletSession.expiresAtMs + 1, source: 'server_rejection',
  });
}
export async function finish() {
  const release = held;
  held = null;
  release();
  return query;
}
export async function lock() {
  await IndexedDBManager.advanceWalletLockGeneration({ walletId: fixture.authority.walletId, lockedAtMs: Date.now() });
}
export async function unlock() {
  fixture = await buildEmailOtpEcdsaWalletSessionFixture({
    label: 'session-events-renewed', walletId: fixture.authority.walletId, expiresAtMs: Date.now() + 60000,
  });
  await IndexedDBManager.persistFoundingWalletAuthority({ authority: fixture.authority, authMethod: fixture.authMethod });
  await walletSessionAuthorizations.writeExactWithOperationCredential({
    record: fixture.activeWalletSession, operationCredential: fixture.operationCredential,
  });
}
export function beginDisposalRead() { holdNext = true; beginRead(); }
export async function dispose() {
  observer.dispose();
  const count = messages.length;
  const result = await finish();
  await lock();
  return { result, count, messages };
}
`;

async function serveProbe(bundle: string, route: Route): Promise<void> {
  await route.fulfill({ contentType: 'text/javascript', body: bundle });
}

async function startObserver(): Promise<void> {
  const probePath = '/__session-events.js';
  const probe = await import(probePath);
  (window as any).sessionEvents = probe;
  await probe.start();
}

function readObserver(): unknown {
  return (window as any).sessionEvents.state();
}

function expireObserver(): void {
  (window as any).sessionEvents.expire();
}

function releaseObserver(): Promise<unknown> {
  return (window as any).sessionEvents.finish();
}

function lockObserver(): Promise<void> {
  return (window as any).sessionEvents.lock();
}

function unlockObserver(): Promise<void> {
  return (window as any).sessionEvents.unlock();
}

function beginDisposalRead(): void {
  (window as any).sessionEvents.beginDisposalRead();
}

function disposeObserver(): Promise<{ result: unknown; count: number; messages: unknown[] }> {
  return (window as any).sessionEvents.dispose();
}

test('host session events preserve expiry across delayed status and stop after disposal', async ({
  page,
}, info) => {
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({
    stdin: { contents: probeSource, resolveDir: root },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    tsconfig: path.join(root, 'packages/wallet/tsconfig.json'),
  });
  await setupBasicPasskeyTest(page, { skipSeamsWebInit: true });
  await page.route('**/__session-events.js', serveProbe.bind(null, bundle.outputFiles[0]!.text));
  await page.evaluate(startObserver);
  await expect.poll(page.evaluate.bind(page, readObserver)).toMatchObject({ held: true });
  await page.evaluate(expireObserver);
  await expect.poll(page.evaluate.bind(page, readObserver)).toMatchObject({
    messages: expect.arrayContaining([
      {
        type: 'SESSION_CHANGED',
        payload: expect.objectContaining({
          state: expect.objectContaining({ kind: 'expired_session' }),
        }),
      },
    ]),
  });
  expect(await page.evaluate(releaseObserver)).toEqual({ kind: 'resolved' });
  const afterExpiry = await page.evaluate(readObserver);
  expect(afterExpiry).toMatchObject({
    messages: expect.arrayContaining([
      {
        type: 'QUERY',
        payload: expect.objectContaining({
          state: expect.objectContaining({ kind: 'expired_session' }),
        }),
      },
    ]),
  });
  await page.evaluate(lockObserver);
  await expect.poll(page.evaluate.bind(page, readObserver)).toMatchObject({
    messages: expect.arrayContaining([
      {
        type: 'SESSION_CHANGED',
        payload: expect.objectContaining({ state: { kind: 'wallet_locked' } }),
      },
    ]),
  });
  await page.evaluate(unlockObserver);
  await expect.poll(page.evaluate.bind(page, readObserver)).toMatchObject({
    messages: expect.arrayContaining([
      {
        type: 'SESSION_CHANGED',
        payload: expect.objectContaining({
          state: expect.objectContaining({ kind: 'active_session' }),
        }),
      },
    ]),
  });
  await page.evaluate(beginDisposalRead);
  await expect.poll(page.evaluate.bind(page, readObserver)).toMatchObject({ held: true });
  const disposed = await page.evaluate(disposeObserver);
  expect(disposed.result).toEqual({
    kind: 'rejected',
    message: 'Wallet session observer is disposed',
  });
  expect(disposed.messages).toHaveLength(disposed.count);
  await writeFile(
    info.outputPath('host-session-events.json'),
    JSON.stringify({ afterExpiry, disposed }, null, 2),
  );
});
