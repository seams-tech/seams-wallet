import { expect, test, type Route } from '@playwright/test';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setupBasicPasskeyTest } from '../setup';
import type { WalletIframeExactSessionState } from '../../packages/wallet/src/SeamsWeb/walletIframe/shared/exactSessionState';

const probeSource = `
import { IndexedDBManager, configureIndexedDB } from './packages/wallet/src/core/indexedDB';
import { walletSessionAuthorizations } from './packages/wallet/src/core/indexedDB/seamsWalletDB/walletSessionAuthorizationStore';
import { readSelectedWalletIframeExactSessionState } from './packages/wallet/src/SeamsWeb/walletIframe/shared/exactSessionState';
import { buildEmailOtpEcdsaWalletSessionFixture } from './tests/unit/helpers/linkedDeviceManagement.fixtures';
let clock = 1000;
let fixture;
let held = null;
let holdNext = true;
let statusReads = 0;
let replaceEveryRead = false;
let observation;
function nowMs() { return clock; }
function hold(resolve) { held = resolve; }
async function readStatus(input) {
  statusReads++;
  if (holdNext) {
    holdNext = false;
    await new Promise(hold);
  }
  if (replaceEveryRead) await install('churn-' + statusReads);
  return {
    status: 'active', authorization: input.authorization,
    walletSessionId: input.operationCredential.walletSessionId,
    quotaId: input.authorization.quotaId, remainingUses: 10,
    expiresAtMs: input.authorization.expiresAtMs, quotaLifecycle: 'active',
  };
}
async function install(label) {
  fixture = await buildEmailOtpEcdsaWalletSessionFixture({
    label, walletId: 'wallet:session-observation', expiresAtMs: 10000,
  });
  await IndexedDBManager.persistFoundingWalletAuthority({ authority: fixture.authority, authMethod: fixture.authMethod });
  await walletSessionAuthorizations.writeExactWithOperationCredential({
    record: fixture.activeWalletSession, operationCredential: fixture.operationCredential,
  });
}
export async function start() {
  configureIndexedDB({ mode: 'wallet' });
  await install('original');
  observation = readSelectedWalletIframeExactSessionState({ walletId: fixture.authority.walletId }, {
    resolveSelectedWalletAuthority: IndexedDBManager.resolveSelectedWalletAuthority.bind(IndexedDBManager),
    readExactActiveForWallet: walletSessionAuthorizations.readExactActiveForWallet.bind(walletSessionAuthorizations),
    readStatus, nowMs,
  });
}
export function state() { return { held: held !== null, statusReads, expectedSessionId: fixture.operationCredential.walletSessionId }; }
export async function mutate(kind) {
  if (kind === 'lock') await IndexedDBManager.advanceWalletLockGeneration({ walletId: fixture.authority.walletId, lockedAtMs: clock });
  if (kind === 'replace') await install('replacement');
  if (kind === 'retire') await walletSessionAuthorizations.clearWallet(fixture.authority.walletId);
  if (kind === 'expire') clock = 10001;
  if (kind === 'churn') replaceEveryRead = true;
}
export async function finish() {
  const release = held;
  held = null;
  release();
  const result = await observation;
  return { result, statusReads, expectedSessionId: fixture.operationCredential.walletSessionId };
}
`;

async function serveProbe(bundle: string, route: Route): Promise<void> {
  await route.fulfill({ contentType: 'text/javascript', body: bundle });
}

async function startObservation(): Promise<void> {
  const path = '/__session-authority.js';
  const probe = await import(path);
  (window as any).sessionAuthority = probe;
  await probe.start();
}

function readProbe(): unknown {
  return (window as any).sessionAuthority.state();
}

function mutateAuthority(kind: string): Promise<void> {
  return (window as any).sessionAuthority.mutate(kind);
}

function finishObservation(): Promise<{
  result: WalletIframeExactSessionState;
  statusReads: number;
  expectedSessionId: string;
}> {
  return (window as any).sessionAuthority.finish();
}

for (const mutation of ['none', 'lock', 'replace', 'retire', 'expire', 'churn']) {
  test(`session observation rechecks authority after status: ${mutation}`, async ({
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
    await page.route(
      '**/__session-authority.js',
      serveProbe.bind(null, bundle.outputFiles[0]!.text),
    );
    await page.evaluate(startObservation);
    await expect.poll(page.evaluate.bind(page, readProbe)).toMatchObject({ held: true });
    await page.evaluate(mutateAuthority, mutation);
    const receipt = await page.evaluate(finishObservation);
    if (mutation === 'lock') {
      expect(receipt.result).toEqual({ kind: 'wallet_locked' });
    } else if (mutation === 'churn') {
      expect(receipt.result).toMatchObject({
        kind: 'wallet_unlocked_without_signing_session',
        reason: 'superseded',
      });
    } else if (mutation === 'retire') {
      expect(receipt.result).toMatchObject({
        kind: 'wallet_unlocked_without_signing_session',
        reason: 'absent',
      });
    } else if (mutation === 'expire') {
      expect(receipt.result).toMatchObject({
        kind: 'expired_session',
        walletSessionId: receipt.expectedSessionId,
      });
    } else {
      expect(receipt.result).toMatchObject({
        kind: 'active_session',
        walletSessionId: receipt.expectedSessionId,
      });
    }
    await writeFile(
      info.outputPath('session-authority.json'),
      JSON.stringify({ mutation, ...receipt }, null, 2),
    );
  });
}
