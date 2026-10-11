import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { intendedTest } from './harness';
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

export const walletAssetTest = intendedTest.extend<AssetFixtures>({
  assets: [assetFixture, { auto: true }],
});
