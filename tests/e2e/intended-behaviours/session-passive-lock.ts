import { expect, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { IntendedBehaviourHarness } from './harness';

function reportPassiveTabError(error: Error): void {
  console.error('[passive-lock-page-error]', error);
}

export async function verifyPassiveWalletLock(
  { harness, page }: { harness: IntendedBehaviourHarness; page: Page },
  testInfo: TestInfo,
): Promise<void> {
  testInfo.setTimeout(180_000);
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  const other = await page.context().newPage();
  other.on('pageerror', reportPassiveTabError);
  try {
    await other.goto(page.url(), { waitUntil: 'domcontentloaded' });
    const otherUi = other.getByTestId('intended-e2e-page');
    await expect(otherUi).toHaveAttribute('data-login-state', 'logged_in');
    await harness.lockWallet();
    await expect(otherUi).toHaveAttribute('data-login-state', 'logged_out');
    await expect(otherUi).toHaveAttribute('data-login-wallet-id', '');
    const artifact = testInfo.outputPath('passive-cross-tab-lock.json');
    await writeFile(
      artifact,
      JSON.stringify({ idleTabBeforeLock: 'logged_in', idleTabAfterLock: 'logged_out' }, null, 2),
    );
    await testInfo.attach('passive cross-tab lock', {
      path: artifact,
      contentType: 'application/json',
    });
  } finally {
    await other.close();
  }
  await harness.unlockPasskeyWallet();
  await harness.signNearTransaction('post_unlock');
  await harness.signTempoTransaction('post_unlock');
}
