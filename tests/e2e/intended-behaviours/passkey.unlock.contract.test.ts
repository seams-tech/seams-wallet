import type { Page, TestInfo } from '@playwright/test';
import { WalletSessionStatusEvidence } from './walletSessionStatusEvidence';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';

async function observePasskeyUnlock(
  harness: IntendedBehaviourHarness,
  page: Page,
): Promise<WalletSessionStatusEvidence> {
  const evidence = await WalletSessionStatusEvidence.start(page);
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  evidence.setStage('unlock');
  await harness.unlockPasskeyWallet();
  return evidence;
}

async function verifyPasskeyUnlockImmediateLifecycle({
  harness,
  page,
}: {
  harness: IntendedBehaviourHarness;
  page: Page;
}, testInfo: TestInfo): Promise<void> {
  const evidence = await observePasskeyUnlock(harness, page);
  evidence.setStage('export-and-near-signing');
  await harness.exportEd25519Key();
  await harness.exportEcdsaKey();
  await harness.signNearTransaction('post_unlock');
  evidence.setStage('concurrent-signing');
  await harness.signTempoAndArcEvmConcurrently('post_unlock');
  evidence.setStage('step-up');
  await harness.signNearTransaction('step_up_required');
  await evidence.finish(testInfo);
}

test(
  'passkey unlock restores immediate export and shared-budget signing',
  verifyPasskeyUnlockImmediateLifecycle,
);

async function verifyPasskeyPageRefreshHydration({
  harness,
  page,
}: {
  harness: IntendedBehaviourHarness;
  page: Page;
}, testInfo: TestInfo): Promise<void> {
  const evidence = await observePasskeyUnlock(harness, page);
  evidence.setStage('refresh-and-export');
  await harness.refreshPagePreservingWalletStorage();
  await harness.exportEd25519Key();
  await harness.exportEcdsaKey();
  evidence.setStage('warm-signing');
  await harness.signNearTransactionAfterRefresh();
  await harness.signTempoTransaction('after_refresh_recovery');
  await harness.signArcEvmTransaction('after_refresh_recovery');
  evidence.setStage('quota-exhaustion');
  await harness.exhaustSigningBudget();
  evidence.setStage('step-up');
  await harness.signNearTransaction('step_up_required');
  await harness.signTempoTransaction('step_up_required');
  await harness.signArcEvmTransaction('step_up_required');
  await evidence.finish(testInfo);
}

test(
  'page refresh hydrates warm signing, one-use step-up, and key export',
  verifyPasskeyPageRefreshHydration,
);

async function verifyPasskeyColdSyncFromEmptyStorage({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  await harness.syncPasskeyWalletFromEmptyStorage();
  await harness.signNearTransaction('post_unlock');
  await harness.signTempoAndArcEvmConcurrently('post_unlock');
}

test(
  'synced passkey cold unlock restores mixed-wallet signing from empty browser storage',
  verifyPasskeyColdSyncFromEmptyStorage,
);
