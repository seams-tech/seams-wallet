import { expect } from '@playwright/test';
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
