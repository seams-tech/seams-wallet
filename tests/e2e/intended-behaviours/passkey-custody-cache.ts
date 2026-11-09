import {
  expect,
  type BrowserContext,
  type Page,
  type Response,
  type Route,
  type TestInfo,
} from '@playwright/test';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { autoConfirmWalletIframeUntil, type IntendedBehaviourHarness } from './harness';
import { walletFrame } from './session-restore-lock';
import type { AuthoritySnapshot } from './passkey-custody-cache-probe';
import { requireRecord } from '../../../packages/shared-ts/src/utils/validation';

const PROBE_PATH = '/__e2e-custody-cache-probe.js';

async function serveProbe(source: string, route: Route): Promise<void> {
  await route.fulfill({ contentType: 'text/javascript', body: source });
}

async function readAuthorityInBrowser(walletId: string): Promise<AuthoritySnapshot> {
  const modulePath = '/__e2e-custody-cache-probe.js';
  const probe = await import(modulePath);
  return probe.readAuthority(walletId);
}

export async function removeCustodyCacheInBrowser(walletId: string): Promise<number> {
  const modulePath = '/__e2e-custody-cache-probe.js';
  const probe = await import(modulePath);
  return probe.removeCustodyCache(walletId);
}

async function lockWalletInBrowser(): Promise<void> {
  if (!window.__seamsIntendedE2ELockWallet) throw new Error('Wallet lock action is unavailable');
  await window.__seamsIntendedE2ELockWallet();
}

export async function routeCustodyCacheProbe(context: BrowserContext): Promise<void> {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./passkey-custody-cache-probe.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    tsconfig: fileURLToPath(new URL('../../../packages/wallet/tsconfig.json', import.meta.url)),
  });
  const source = bundle.outputFiles[0]?.text;
  if (!source) throw new Error('Custody cache probe did not build');
  await context.route(`**${PROBE_PATH}`, serveProbe.bind(null, source));
}

export async function readCustodyCacheEpochsInBrowser(walletId: string): Promise<string[]> {
  const modulePath = '/__e2e-custody-cache-probe.js';
  const probe = await import(modulePath);
  return probe.readCustodyCacheEpochs(walletId);
}

async function readCustodyCacheRowsInBrowser(walletId: string): Promise<unknown[]> {
  const modulePath = '/__e2e-custody-cache-probe.js';
  const probe = await import(modulePath);
  return probe.readCustodyCacheRows(walletId);
}

async function restoreCustodyCacheRowsInBrowser(rows: unknown[]): Promise<number> {
  const modulePath = '/__e2e-custody-cache-probe.js';
  const probe = await import(modulePath);
  return probe.restoreCustodyCacheRows(rows);
}

/** The Gateway's Ed25519 recovery and reissue answers, in order. */
export class YaoCustodyResponses {
  readonly responses: { path: string; status: number }[] = [];

  observe(response: Response): void {
    const path = new URL(response.url()).pathname;
    if (
      response.request().method() === 'POST' &&
      (path.includes('/ed25519/yao/recovery/') || path.includes('/ed25519/yao/reissue/'))
    ) {
      this.responses.push({ path, status: response.status() });
    }
  }
}

async function waitForUnlockAction(page: Page): Promise<{ status: string; error: string | null }> {
  const completed = page.locator(
    '[data-testid="intended-action-status"][data-action="unlockPasskeyWallet"][data-state="success"], ' +
      '[data-testid="intended-action-status"][data-action="unlockPasskeyWallet"][data-state="error"]',
  );
  await completed.waitFor({ state: 'visible', timeout: 90_000 });
  const snapshot = requireRecord(
    JSON.parse((await page.getByTestId('intended-result-json').textContent()) ?? ''),
    'unlock snapshot',
  );
  const action = requireRecord(snapshot.action, 'unlock action');
  return {
    status: String(action.status),
    error: typeof action.error === 'string' ? action.error : null,
  };
}

/**
 * A site with no custody cache row (a new site, or a cleared one) reissues
 * the current Client share. The reissue keeps the material activation and the
 * state epoch, so the authority does not change and no recovery runs.
 */
export async function verifyColdCustodyReissueThenUnlock(
  {
    harness,
    page,
    context,
  }: { harness: IntendedBehaviourHarness; page: Page; context: BrowserContext },
  testInfo: TestInfo,
): Promise<void> {
  await routeCustodyCacheProbe(context);
  const yao = new YaoCustodyResponses();
  page.on('response', yao.observe.bind(yao));
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  const walletId = await page.getByTestId('intended-e2e-page').getAttribute('data-wallet-id');
  if (!walletId) throw new Error('Registered wallet identity is unavailable');
  await page.evaluate(lockWalletInBrowser);
  const frame = await walletFrame(page);
  const before = await frame.evaluate(readAuthorityInBrowser, walletId);
  const epochsBefore = await frame.evaluate(readCustodyCacheEpochsInBrowser, walletId);
  expect(await frame.evaluate(removeCustodyCacheInBrowser, walletId)).toBe(1);
  yao.responses.length = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('intended-unlock-passkey').click();
  const firstUnlock = await autoConfirmWalletIframeUntil(page, waitForUnlockAction(page), {
    timeoutMs: 100_000,
  });
  const reissuedFrame = await walletFrame(page);
  const afterReissue = await reissuedFrame.evaluate(readAuthorityInBrowser, walletId);
  const epochsAfterReissue = await reissuedFrame.evaluate(
    readCustodyCacheEpochsInBrowser,
    walletId,
  );
  const evidence = {
    kind: 'cold_custody_reissue_evidence_v1',
    reproduce:
      "SEAMS_INTENDED_SKIP_BUILD=1 node tests/scripts/run-wallet-intended-isolated.mjs -- e2e/intended-behaviours/passkey.unlock.contract.test.ts --grep 'no custody cache reissues'",
    walletId,
    before,
    afterReissue,
    epochsBefore,
    epochsAfterReissue,
    yaoResponses: [...yao.responses],
    firstUnlock,
  };
  await writeFile(
    testInfo.outputPath('cold-custody-reissue.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  );
  await expect(page.getByTestId('intended-action-status')).toHaveAttribute('data-state', 'success');
  expect(yao.responses).toEqual([
    { path: '/router-ab/ed25519/yao/reissue/admit', status: 200 },
    { path: '/router-ab/ed25519/yao/reissue/execute', status: 200 },
  ]);
  expect(afterReissue).toEqual(before);
  expect(epochsAfterReissue).toEqual(epochsBefore);
  yao.responses.length = 0;
  await harness.unlockPasskeyWallet();
  expect(yao.responses).toEqual([]);
  await harness.signNearTransaction('post_unlock');
  await harness.signTempoAndArcEvmConcurrently('post_unlock');
  await writeFile(
    testInfo.outputPath('cold-custody-reissue.json'),
    JSON.stringify(
      { ...evidence, secondUnlock: 'cache_hit', nearSigning: 'verified', evmSigning: 'verified' },
      null,
      2,
    ) + '\n',
  );
}

/**
 * A recovery on another site or device moves the state epoch. This site still
 * holds the row from the older epoch. A recovery keeps the shares, so the next
 * unlock here must re-bind that row with no Router round, and the re-bound
 * share must sign.
 */
export async function verifyOlderCustodyCacheRebindsWithoutRecovery(
  {
    harness,
    page,
    context,
  }: { harness: IntendedBehaviourHarness; page: Page; context: BrowserContext },
  testInfo: TestInfo,
): Promise<void> {
  await routeCustodyCacheProbe(context);
  const yao = new YaoCustodyResponses();
  page.on('response', yao.observe.bind(yao));
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  const walletId = await page.getByTestId('intended-e2e-page').getAttribute('data-wallet-id');
  if (!walletId) throw new Error('Registered wallet identity is unavailable');
  await page.evaluate(lockWalletInBrowser);
  const frame = await walletFrame(page);
  const epochsAtRegistration = await frame.evaluate(readCustodyCacheEpochsInBrowser, walletId);
  const olderRows = await frame.evaluate(readCustodyCacheRowsInBrowser, walletId);
  expect(olderRows.length).toBeGreaterThan(0);

  // Another device: a recovery with a recovery code moves the state epoch.
  await harness.recoverPasskeyWalletFromFreshBrowser();
  const recoveredFrame = await walletFrame(page);
  const epochsAfterRecovery = await recoveredFrame.evaluate(
    readCustodyCacheEpochsInBrowser,
    walletId,
  );

  // This site: the row from the older epoch comes back.
  await page.evaluate(lockWalletInBrowser);
  const staleFrame = await walletFrame(page);
  await staleFrame.evaluate(removeCustodyCacheInBrowser, walletId);
  expect(await staleFrame.evaluate(restoreCustodyCacheRowsInBrowser, olderRows)).toBe(
    olderRows.length,
  );
  expect(await staleFrame.evaluate(readCustodyCacheEpochsInBrowser, walletId)).toEqual(
    epochsAtRegistration,
  );
  yao.responses.length = 0;
  await harness.unlockPasskeyWallet();
  const epochsAfterRebind = await (
    await walletFrame(page)
  ).evaluate(readCustodyCacheEpochsInBrowser, walletId);
  await harness.signNearTransaction('post_unlock');
  await writeFile(
    testInfo.outputPath('older-custody-cache-rebind.json'),
    JSON.stringify(
      {
        kind: 'older_custody_cache_rebind_evidence_v1',
        walletId,
        epochsAtRegistration,
        epochsAfterRecovery,
        epochsAfterRebind,
        yaoResponsesDuringRebind: yao.responses,
        nearSigning: 'verified',
      },
      null,
      2,
    ) + '\n',
  );
  expect(epochsAfterRecovery).not.toEqual(epochsAtRegistration);
  expect(yao.responses).toEqual([]);
  expect(epochsAfterRebind).toEqual(epochsAfterRecovery);
}
