import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { intendedTest, type IntendedBehaviourHarness } from './harness';
import { WalletAssetEvidence } from './wallet-asset-evidence';

type AssetFixtures = { assets: WalletAssetEvidence };

async function assetFixture(
  { context, page }: { context: BrowserContext; page: Page },
  use: (evidence: WalletAssetEvidence) => Promise<void>,
  testInfo: TestInfo,
): Promise<void> {
  const evidence = new WalletAssetEvidence(context);
  await evidence.observeNetwork(page);
  try {
    await use(evidence);
  } finally {
    await evidence.finish(testInfo);
  }
}

const test = intendedTest.extend<AssetFixtures>({
  assets: [assetFixture, { auto: true }],
});

// Capture static-asset metadata only; custody responses must never enter traces.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function measureWalletAssets({
  harness,
  assets,
}: {
  harness: IntendedBehaviourHarness;
  assets: WalletAssetEvidence;
}): Promise<void> {
  test.skip(process.env.SEAMS_INTENDED_PRODUCTION !== '1', 'Requires production app assets');
  assets.setCachePolicy('disabled_by_routing');
  assets.setPhase('register');
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  assets.setPhase('first-near-sign');
  await harness.signNearTransaction('post_registration');
  assets.setPhase('first-evm-sign');
  await harness.signArcEvmTransaction('post_registration');
  assets.setPhase('lock');
  await harness.lockWallet();
  assets.setPhase('unlock');
  await harness.unlockPasskeyWallet();
  assets.setPhase('repeat-near-sign');
  await harness.signNearTransaction('post_unlock');
  assets.setPhase('repeat-evm-sign');
  await harness.signArcEvmTransaction('post_unlock');
  assets.setPhase('completed');
}

test(
  'production wallet records asset traffic across registration, signing, and unlock',
  measureWalletAssets,
);

async function observeSignedOutMount(page: Page): Promise<void> {
  await page.goto('/__intended-e2e', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('intended-e2e-page')).toHaveAttribute(
    'data-login-state',
    'logged_out',
  );
  await page
    .frameLocator('iframe.seams-wallet-overlay')
    .locator('body')
    .waitFor({ state: 'attached' });
  // A fixed observation window includes the provider's idle preparation.
  await page.waitForTimeout(2_000);
}

async function observeGenericMenu(page: Page): Promise<void> {
  await page.getByTestId('asset-open-auth-menu').click();
  await expect(
    page.frameLocator('iframe.seams-wallet-overlay').locator('[data-auth-menu-primary]').first(),
  ).toBeVisible();
  await page.waitForTimeout(2_000);
}

function isCryptoWorkerUrl(url: string): boolean {
  return !url.endsWith('/passkey-confirm.worker.js');
}

async function measureSignedOutAssets(
  { page, assets }: { page: Page; assets: WalletAssetEvidence },
  testInfo: TestInfo,
): Promise<void> {
  test.skip(process.env.SEAMS_INTENDED_PRODUCTION !== '1', 'Requires production app assets');
  assets.setCachePolicy('enabled');
  const tracePath = path.resolve(
    testInfo.config.rootDir,
    '../.artifacts/wallet-assets/signed-out-trace.zip',
  );
  await mkdir(path.dirname(tracePath), { recursive: true });
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
  try {
    assets.setPhase('cold-signed-out-mount-idle');
    await observeSignedOutMount(page);
    assets.setPhase('cold-generic-menu');
    await observeGenericMenu(page);
    expect(assets.getWorkerUrls().filter(isCryptoWorkerUrl)).toEqual([]);
    await page.goto('about:blank');
    assets.setPhase('warm-signed-out-mount-idle');
    await observeSignedOutMount(page);
    assets.setPhase('warm-generic-menu');
    await observeGenericMenu(page);
    expect(assets.getWorkerUrls().filter(isCryptoWorkerUrl)).toEqual([]);
    assets.setPhase('completed');
  } finally {
    await page.context().tracing.stop({ path: tracePath });
    await testInfo.attach('signed-out-trace.zip', {
      path: tracePath,
      contentType: 'application/zip',
    });
  }
}

test(
  'production signed-out mount and menu record cold and warm cache traffic',
  measureSignedOutAssets,
);
