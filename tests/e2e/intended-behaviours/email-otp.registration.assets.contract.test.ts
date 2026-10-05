import {
  expect,
  type BrowserContext,
  type Page,
  type Route,
} from '@playwright/test';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IntendedBehaviourHarness } from './harness';
import type { WalletAssetEvidence } from './wallet-asset-evidence';
import { walletAssetTest as test } from './wallet-asset-fixture';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function measureEmailOtpEcdsaRegistration({
  harness,
  assets,
}: {
  harness: IntendedBehaviourHarness;
  assets: WalletAssetEvidence;
}): Promise<void> {
  test.skip(process.env.SEAMS_INTENDED_PRODUCTION !== '1', 'Requires production app assets');
  assets.setCachePolicy('disabled_by_routing');
  assets.setPhase('email-otp-ecdsa-registration');
  await harness.registerEmailOtpEcdsaOnlyWallet();
  expect(assets.getRequestedAssetUrlsForPhase('email-otp-ecdsa-registration')).not.toContainEqual(
    expect.stringMatching(/\/router_ab_ed25519_yao_client_bg\.wasm$/u),
  );
  assets.setPhase('email-otp-ecdsa-sign');
  await harness.signTempoTransaction('post_registration');
  await harness.signArcEvmTransaction('post_registration');
  assets.setPhase('completed');
}

async function measureEmailOtpNearRegistration({
  harness,
  assets,
}: {
  harness: IntendedBehaviourHarness;
  assets: WalletAssetEvidence;
}): Promise<void> {
  test.skip(process.env.SEAMS_INTENDED_PRODUCTION !== '1', 'Requires production app assets');
  assets.setCachePolicy('disabled_by_routing');
  assets.setPhase('email-otp-near-registration');
  await harness.registerEmailOtpEd25519OnlyWallet();
  await harness.awaitNearReady();
  expect(assets.getRequestedAssetUrlsForPhase('email-otp-near-registration')).toContainEqual(
    expect.stringMatching(/\/router_ab_ed25519_yao_client_bg\.wasm$/u),
  );
  assets.setPhase('email-otp-near-sign');
  await harness.signNearTransaction('post_registration');
  assets.setPhase('email-otp-near-restored-sign');
  await harness.refreshPagePreservingWalletStorage();
  await harness.signNearTransactionAfterRefresh();
  for (const workerUrl of assets.getWorkerUrls()) {
    expect(workerUrl).not.toMatch(/\/ecdsa-[^/]+\.worker\.js$/u);
  }
  assets.setPhase('completed');
}

test(
  'production Email OTP ECDSA-only registration loads selected signer assets',
  measureEmailOtpEcdsaRegistration,
);
test(
  'production Email OTP NEAR-only registration loads selected signer assets',
  measureEmailOtpNearRegistration,
);

class FailedEmailOtpPreparation {
  failedPreparations = 0;
  rejectedDownloads = 0;
  retriedDownloads = 0;

  observe(_source: unknown, outcome: unknown): void {
    if (outcome === 'failed') this.failedPreparations += 1;
  }

  async route(route: Route): Promise<void> {
    if (this.failedPreparations === 0) {
      this.rejectedDownloads += 1;
      await route.fulfill({
        status: 503,
        contentType: 'application/wasm',
        headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
        body: 'Injected WASM delivery failure',
      });
      return;
    }
    this.retriedDownloads += 1;
    await route.fallback();
  }
}

async function registerAfterPreparationFailure(
  {
    harness,
    assets,
    context,
    page,
  }: {
    harness: IntendedBehaviourHarness;
    assets: WalletAssetEvidence;
    context: BrowserContext;
    page: Page;
  },
  testInfo: import('@playwright/test').TestInfo,
): Promise<void> {
  test.skip(process.env.SEAMS_INTENDED_PRODUCTION !== '1', 'Requires production app assets');
  const fault = new FailedEmailOtpPreparation();
  const observer = await build({
    entryPoints: [fileURLToPath(new URL('./email-otp-preparation-observer.ts', import.meta.url))],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
  });
  await context.exposeBinding('observeEmailOtpPreparation', fault.observe.bind(fault));
  await context.addInitScript({ content: observer.outputFiles[0]!.text });
  const routePattern = '**/router_ab_ed25519_yao_client_bg.wasm';
  const handle = fault.route.bind(fault);
  await context.route(routePattern, handle);
  try {
    await page.reload();
    assets.setCachePolicy('disabled_by_routing');
    assets.setPhase('failed-preparation-then-registration');
    await harness.registerEmailOtpEd25519OnlyWallet();
    await harness.awaitNearReady();
    expect(fault.failedPreparations).toBe(1);
    expect(fault.rejectedDownloads).toBeGreaterThan(0);
    expect(assets.getWorkerUrls().filter(isEmailOtpWorker)).toHaveLength(1);
    assets.setPhase('sign-after-retried-preparation');
    await harness.signNearTransaction('post_registration');
    expect(fault.retriedDownloads).toBeGreaterThan(0);
    const downloadsAfterFirstSign = fault.retriedDownloads;
    assets.setPhase('repeat-sign');
    await harness.signNearTransaction('post_registration');
    expect(fault.retriedDownloads).toBe(downloadsAfterFirstSign);
    expect(assets.getWorkerUrls().filter(isEmailOtpWorker)).toHaveLength(1);
    assets.setPhase('completed');
    const artifactPath = testInfo.outputPath('email-otp-preparation-retry.json');
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          failedPreparations: fault.failedPreparations,
          rejectedDownloads: fault.rejectedDownloads,
          retriedDownloads: fault.retriedDownloads,
          emailOtpWorkerCreations: assets.getWorkerUrls().filter(isEmailOtpWorker).length,
          verifiedNearSignatures: 2,
          scope:
            'Real Google registration and emitted Email OTP worker; reject WASM delivery until its preparation response reports failure, then allow operation retry.',
        },
        null,
        2,
      ),
    );
    await testInfo.attach('email-otp-preparation-retry.json', {
      path: artifactPath,
      contentType: 'application/json',
    });
  } finally {
    await context.unroute(routePattern, handle);
  }
}

function isEmailOtpWorker(url: string): boolean {
  return new URL(url).pathname.endsWith('/email-otp.worker.js');
}

test(
  'production Google registration tolerates failed preparation and signing retries',
  registerAfterPreparationFailure,
);
