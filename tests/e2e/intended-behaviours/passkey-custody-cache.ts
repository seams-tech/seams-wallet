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

async function removeCustodyCacheInBrowser(walletId: string): Promise<number> {
  const modulePath = '/__e2e-custody-cache-probe.js';
  const probe = await import(modulePath);
  return probe.removeCustodyCache(walletId);
}

async function restoreAuthorityCheckpointInBrowser(walletId: string): Promise<void> {
  const modulePath = '/__e2e-custody-cache-probe.js';
  const probe = await import(modulePath);
  await probe.restoreAuthorityCheckpoint(walletId);
}

async function lockWalletInBrowser(): Promise<void> {
  if (!window.__seamsIntendedE2ELockWallet) throw new Error('Wallet lock action is unavailable');
  await window.__seamsIntendedE2ELockWallet();
}

class RecoveryResponses {
  readonly responses: { path: string; status: number }[] = [];

  observe(response: Response): void {
    const path = new URL(response.url()).pathname;
    if (response.request().method() === 'POST' && path.includes('/ed25519/yao/recovery/')) {
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

export async function verifyColdCustodyRecoveryThenUnlock(
  {
    harness,
    page,
    context,
  }: { harness: IntendedBehaviourHarness; page: Page; context: BrowserContext },
  testInfo: TestInfo,
): Promise<void> {
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
  const recovery = new RecoveryResponses();
  page.on('response', recovery.observe.bind(recovery));
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  const walletId = await page.getByTestId('intended-e2e-page').getAttribute('data-wallet-id');
  if (!walletId) throw new Error('Registered wallet identity is unavailable');
  await page.evaluate(lockWalletInBrowser);
  const frame = await walletFrame(page);
  const before = await frame.evaluate(readAuthorityInBrowser, walletId);
  expect(await frame.evaluate(removeCustodyCacheInBrowser, walletId)).toBe(1);
  expect(await frame.evaluate(readAuthorityInBrowser, walletId)).toEqual(before);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('intended-unlock-passkey').click();
  const firstUnlock = await autoConfirmWalletIframeUntil(page, waitForUnlockAction(page), {
    timeoutMs: 100_000,
  });
  const afterRecovery = await (await walletFrame(page)).evaluate(readAuthorityInBrowser, walletId);
  const evidence = {
    kind: 'cold_custody_authority_recovery_evidence_v1',
    reproduce: "SEAMS_INTENDED_SKIP_BUILD=1 node tests/scripts/run-wallet-intended-isolated.mjs -- e2e/intended-behaviours/passkey.unlock.contract.test.ts --grep 'cold custody recovery preserves authority'",
    walletId,
    before,
    afterRecovery,
    recoveryResponses: recovery.responses,
    firstUnlock,
  };
  await writeFile(
    testInfo.outputPath('cold-custody-authority.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  );
  await expect(page.getByTestId('intended-action-status')).toHaveAttribute('data-state', 'success');
  expect(recovery.responses).toContainEqual({
    path: '/router-ab/ed25519/yao/recovery/activate',
    status: 200,
  });
  expect(afterRecovery.authorityId).toBe(before.authorityId);
  expect(afterRecovery.epoch).toBe(before.epoch);
  expect(afterRecovery.activationId).not.toBe(before.activationId);
  expect(afterRecovery.digest).not.toBe(before.digest);
  const recoveredFrame = await walletFrame(page);
  await recoveredFrame.evaluate(restoreAuthorityCheckpointInBrowser, walletId);
  expect(await recoveredFrame.evaluate(readAuthorityInBrowser, walletId)).toEqual(before);
  await harness.unlockPasskeyWallet();
  const afterStaleUnlock = await (
    await walletFrame(page)
  ).evaluate(readAuthorityInBrowser, walletId);
  expect(afterStaleUnlock).toEqual(afterRecovery);
  await harness.signNearTransaction('post_unlock');
  await harness.signTempoAndArcEvmConcurrently('post_unlock');
  await writeFile(
    testInfo.outputPath('cold-custody-authority.json'),
    JSON.stringify(
      {
        ...evidence,
        afterStaleUnlock,
        secondUnlock: 'succeeded',
        nearSigning: 'verified',
        evmSigning: 'verified',
      },
      null,
      2,
    ) + '\n',
  );
}
