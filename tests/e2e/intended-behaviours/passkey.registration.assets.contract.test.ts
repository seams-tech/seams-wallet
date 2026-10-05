import { expect, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { IntendedBehaviourHarness } from './harness';
import { walletAssetTest as test } from './wallet-asset-fixture';
import { WalletAssetEvidence } from './wallet-asset-evidence';

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
  // Observe deferred activity after the provider connects.
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

async function observeUnselectedRegistrationMenu(page: Page): Promise<void> {
  await page.getByTestId('asset-open-registration-menu').click();
  const wallet = page.frameLocator('iframe.seams-wallet-overlay');
  await expect(wallet.locator('[data-auth-menu-primary]').first()).toBeVisible();
  await expect(wallet.locator('input').first()).toHaveValue('');
  await page.waitForTimeout(2_000);
}

function isSigningImplementationUrl(url: string): boolean {
  return /\/(?:runtime-ecdsa-tempo|signEvmWithUiConfirm|signEvmFamilyWithUiConfirmForTempo|webauthnP256|secp256k1)-[^/]+\.js$/u.test(
    new URL(url).pathname,
  );
}

async function measureUnselectedRegistrationAssets({
  page,
  assets,
}: {
  page: Page;
  assets: WalletAssetEvidence;
}): Promise<void> {
  test.skip(process.env.SEAMS_INTENDED_PRODUCTION !== '1', 'Requires production app assets');
  assets.setCachePolicy('enabled');
  assets.setPhase('cold-registration-mount');
  await observeSignedOutMount(page);
  assets.setPhase('cold-unselected-registration-menu');
  await observeUnselectedRegistrationMenu(page);
  expect(
    (await assets.getAssetUrlsForPhase('cold-unselected-registration-menu')).filter(
      isSigningImplementationUrl,
    ),
  ).toEqual([]);
  expect(assets.getWorkerUrls().filter(isCryptoWorkerUrl)).toEqual([]);
  await page.goto('about:blank');
  assets.setPhase('warm-registration-mount');
  await observeSignedOutMount(page);
  assets.setPhase('warm-unselected-registration-menu');
  await observeUnselectedRegistrationMenu(page);
  expect(
    (await assets.getAssetUrlsForPhase('warm-unselected-registration-menu')).filter(
      isSigningImplementationUrl,
    ),
  ).toEqual([]);
  expect(assets.getWorkerUrls().filter(isCryptoWorkerUrl)).toEqual([]);
  assets.setPhase('completed');
}

test(
  'production registration menu awaits input with cold and warm caches',
  measureUnselectedRegistrationAssets,
);

function isEvmOperationModuleUrl(url: string): boolean {
  return /\/(?:signEvmWithUiConfirm|signEvmFamilyWithUiConfirmForTempo|webauthnP256|secp256k1)-[^/]+\.js$/u.test(
    new URL(url).pathname,
  );
}

async function measureNearOnlyAssets({
  harness,
  assets,
  page,
}: {
  harness: IntendedBehaviourHarness;
  assets: WalletAssetEvidence;
  page: Page;
}): Promise<void> {
  test.skip(process.env.SEAMS_INTENDED_PRODUCTION !== '1', 'Requires production app assets');
  assets.setCachePolicy('disabled_by_routing');
  assets.setPhase('near-only-registration');
  await harness.registerPasskeyEd25519YaoWallet();
  expect(assets.getRequestedAssetUrlsForPhase('near-only-registration')).toContainEqual(
    expect.stringMatching(/\/wallet_custody_ceremony_bg\.wasm$/u),
  );
  assets.setPhase('locked-reload');
  await harness.lockWallet();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('intended-e2e-page')).toHaveAttribute(
    'data-login-state',
    'logged_out',
  );
  assets.setPhase('near-only-unlock');
  await harness.unlockPasskeyWallet();
  expect(assets.getRequestedAssetUrlsForPhase('near-only-unlock')).not.toContainEqual(
    expect.stringMatching(/\/wallet_custody_ceremony_bg\.wasm$/u),
  );
  assets.setPhase('near-only-sign');
  await harness.signNearTransaction('post_unlock');
  assets.setPhase('near-only-restored-sign');
  await harness.refreshPagePreservingWalletStorage();
  await harness.signNearTransactionAfterRefresh();
  for (const workerUrl of assets.getWorkerUrls()) {
    expect(workerUrl).not.toMatch(/\/(?:ecdsa-[^/]+|email-otp)\.worker\.js$/u);
  }
  for (const phase of [
    'near-only-registration',
    'near-only-unlock',
    'near-only-sign',
    'near-only-restored-sign',
  ]) {
    expect(assets.getRequestedAssetUrlsForPhase(phase).filter(isEvmOperationModuleUrl)).toEqual([]);
  }
  assets.setPhase('completed');
}

test(
  'production NEAR-only wallet records unlock and restored signing assets',
  measureNearOnlyAssets,
);

async function measureEcdsaOnlyAssets({
  harness,
  assets,
  page,
}: {
  harness: IntendedBehaviourHarness;
  assets: WalletAssetEvidence;
  page: Page;
}): Promise<void> {
  test.skip(process.env.SEAMS_INTENDED_PRODUCTION !== '1', 'Requires production app assets');
  assets.setCachePolicy('disabled_by_routing');
  assets.setPhase('ecdsa-only-registration');
  await harness.registerPasskeyEcdsaOnlyWallet();
  expect(assets.getRequestedAssetUrlsForPhase('ecdsa-only-registration')).toContainEqual(
    expect.stringMatching(/\/wallet_custody_ceremony_bg\.wasm$/u),
  );
  assets.setPhase('locked-reload');
  await harness.lockWallet();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('intended-e2e-page')).toHaveAttribute(
    'data-login-state',
    'logged_out',
  );
  assets.setPhase('ecdsa-only-unlock');
  await harness.unlockPasskeyWallet();
  expect(assets.getRequestedAssetUrlsForPhase('ecdsa-only-unlock')).not.toContainEqual(
    expect.stringMatching(/\/wallet_custody_ceremony_bg\.wasm$/u),
  );
  assets.setPhase('tempo-sign');
  await harness.signTempoTransaction('post_unlock');
  assets.setPhase('evm-sign');
  await harness.signArcEvmTransaction('post_unlock');
  assets.setPhase('ecdsa-restored-sign');
  await harness.refreshPagePreservingWalletStorage();
  await harness.signTempoTransaction('after_refresh_recovery');
  const status = await harness.readCurrentWalletSessionStatus();
  expect(status.status).toBe('exhausted');
  assets.setPhase('ecdsa-evm-step-up-sign');
  await harness.signArcEvmTransaction('step_up_required');
  assets.setPhase('completed');
}

test(
  'production ECDSA-only wallet records unlock and restored signing assets',
  measureEcdsaOnlyAssets,
);
