import { expect, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { IntendedBehaviourHarness } from './harness';
import { walletAssetTest as test } from './wallet-asset-fixture';
import { WalletAssetEvidence } from './wallet-asset-evidence';
import { SEAMS_WALLET_DB_NAME } from '../../../packages/wallet/src/core/indexedDB/walletDbName';

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

async function observeSignInIntent(page: Page): Promise<void> {
  const runtimeLoaded = page.waitForResponse(isWalletRuntimeModuleResponse, { timeout: 30_000 });
  await page.getByTestId('asset-open-auth-menu').hover();
  await runtimeLoaded;
}

function isWalletRuntimeModuleResponse(response: { url(): string }): boolean {
  return isWalletRuntimeModuleUrl(response.url());
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

// The boot preloads the recovery-code surface for Email OTP; every other runtime
// module waits for a request that needs it.
function isWalletRuntimeModuleUrl(url: string): boolean {
  return /\/runtime-(?!recovery-codes-)[^/]+\.js$/u.test(new URL(url).pathname);
}

async function listIndexedDbNames(): Promise<string[]> {
  return (await indexedDB.databases()).map((database) => database.name ?? '');
}

async function walletDatabaseNames(page: Page): Promise<readonly string[]> {
  const iframe = await page.locator('iframe.seams-wallet-overlay').elementHandle();
  const frame = await iframe?.contentFrame();
  if (!frame) throw new Error('Wallet service frame is unavailable');
  return await frame.evaluate(listIndexedDbNames);
}

async function assertSignedOutMountSkipsWalletRuntime(
  assets: WalletAssetEvidence,
  phase: string,
): Promise<void> {
  expect((await assets.getAssetUrlsForPhase(phase)).filter(isWalletRuntimeModuleUrl)).toEqual([]);
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
    await assertSignedOutMountSkipsWalletRuntime(assets, 'cold-signed-out-mount-idle');
    expect(await walletDatabaseNames(page)).not.toContain(SEAMS_WALLET_DB_NAME);
    // Intent downloads the runtime; only the first request that needs it constructs it.
    assets.setPhase('cold-sign-in-intent');
    await observeSignInIntent(page);
    expect(await walletDatabaseNames(page)).not.toContain(SEAMS_WALLET_DB_NAME);
    assets.setPhase('cold-generic-menu');
    await observeGenericMenu(page);
    await assertNoDeferredOperationAssets(assets, [
      'cold-signed-out-mount-idle',
      'cold-sign-in-intent',
      'cold-generic-menu',
    ]);
    await page.goto('about:blank');
    assets.setPhase('warm-signed-out-mount-idle');
    await observeSignedOutMount(page);
    // The menu created the database; with no record in it the mount still skips the runtime.
    await assertSignedOutMountSkipsWalletRuntime(assets, 'warm-signed-out-mount-idle');
    assets.setPhase('warm-generic-menu');
    await observeGenericMenu(page);
    await assertNoDeferredOperationAssets(assets, [
      'warm-signed-out-mount-idle',
      'warm-generic-menu',
    ]);
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

function isDeferredOperationModuleUrl(url: string): boolean {
  return /\/(?:runtime-ecdsa-tempo|signEvmWithUiConfirm|signEvmFamilyWithUiConfirmForTempo|webauthnP256|secp256k1|exportKeypairOperation|ecdsaExportFlow|ed25519YaoExportFlow)-[^/]+\.js$/u.test(
    new URL(url).pathname,
  );
}

async function assertNoDeferredOperationAssets(
  assets: WalletAssetEvidence,
  phases: readonly string[],
): Promise<void> {
  for (const phase of phases) {
    expect((await assets.getAssetUrlsForPhase(phase)).filter(isDeferredOperationModuleUrl)).toEqual(
      [],
    );
  }
  expect(assets.getWorkerUrls().filter(isCryptoWorkerUrl)).toEqual([]);
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
  await assertNoDeferredOperationAssets(assets, [
    'cold-registration-mount',
    'cold-unselected-registration-menu',
  ]);
  await page.goto('about:blank');
  assets.setPhase('warm-registration-mount');
  await observeSignedOutMount(page);
  assets.setPhase('warm-unselected-registration-menu');
  await observeUnselectedRegistrationMenu(page);
  await assertNoDeferredOperationAssets(assets, [
    'warm-registration-mount',
    'warm-unselected-registration-menu',
  ]);
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
}: {
  harness: IntendedBehaviourHarness;
  assets: WalletAssetEvidence;
}): Promise<void> {
  test.skip(process.env.SEAMS_INTENDED_PRODUCTION !== '1', 'Requires production app assets');
  assets.setCachePolicy('disabled_by_routing');
  assets.setPhase('near-only-registration');
  await harness.registerPasskeyEd25519YaoWallet();
  expect(assets.getRequestedAssetUrlsForPhase('near-only-registration')).toContainEqual(
    expect.stringMatching(/\/wallet_custody_ceremony_bg\.wasm$/u),
  );
  assets.setPhase('locked-reload');
  await harness.assertLockedPageReloadStaysLocked();
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
  assets.setPhase('near-only-export');
  await harness.exportEd25519Key();
  for (const workerUrl of assets.getWorkerUrls()) {
    expect(workerUrl).not.toMatch(/\/(?:ecdsa-[^/]+|email-otp)\.worker\.js$/u);
  }
  for (const phase of [
    'near-only-registration',
    'near-only-unlock',
    'near-only-sign',
    'near-only-restored-sign',
    'near-only-export',
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
}: {
  harness: IntendedBehaviourHarness;
  assets: WalletAssetEvidence;
}): Promise<void> {
  test.skip(process.env.SEAMS_INTENDED_PRODUCTION !== '1', 'Requires production app assets');
  assets.setCachePolicy('disabled_by_routing');
  assets.setPhase('ecdsa-only-registration');
  await harness.registerPasskeyEcdsaOnlyWallet();
  expect(assets.getRequestedAssetUrlsForPhase('ecdsa-only-registration')).toContainEqual(
    expect.stringMatching(/\/wallet_custody_ceremony_bg\.wasm$/u),
  );
  assets.setPhase('locked-reload');
  await harness.assertLockedPageReloadStaysLocked();
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
  assets.setPhase('ecdsa-only-export');
  await harness.exportEcdsaKey();
  for (const assetUrl of assets.getRequestedAssetUrlsForPhase('ecdsa-only-export')) {
    expect(assetUrl).not.toMatch(/\/router_ab_ed25519_yao_client_bg\.wasm$/u);
  }
  assets.setPhase('completed');
}

test(
  'production ECDSA-only wallet records unlock and restored signing assets',
  measureEcdsaOnlyAssets,
);
