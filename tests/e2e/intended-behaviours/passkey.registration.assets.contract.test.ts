import type { BrowserContext, Page, TestInfo } from '@playwright/test';
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
