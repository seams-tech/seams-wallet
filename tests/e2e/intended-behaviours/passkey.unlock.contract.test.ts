import {
  expect,
  type BrowserContext,
  type Page,
  type Route,
  type TestInfo,
} from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WalletSessionStatusEvidence } from './walletSessionStatusEvidence';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';
import { verifyFreshUnlockWins, verifyLockWins } from './session-restore-lock';

test('a cross-tab lock prevents delayed restoration from recreating its credential', verifyLockWins);
test('a fresh unlock survives a delayed restoration response from another tab', verifyFreshUnlockWins);

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

async function verifyPasskeyUnlockImmediateLifecycle(
  {
    harness,
    page,
  }: {
    harness: IntendedBehaviourHarness;
    page: Page;
  },
  testInfo: TestInfo,
): Promise<void> {
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

async function verifyPasskeyPageRefreshHydration(
  {
    harness,
    page,
  }: {
    harness: IntendedBehaviourHarness;
    page: Page;
  },
  testInfo: TestInfo,
): Promise<void> {
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

class InterruptedUnlock {
  requests = 0;
  visibleError = '';

  async route(route: Route): Promise<void> {
    this.requests += 1;
    if (this.requests === 1) {
      await route.abort('connectionclosed');
      return;
    }
    await route.continue();
  }

  async retryFromVisibleError(page: Page): Promise<void> {
    const frame = page.locator('iframe[allow*="publickey-credentials-get"]').last().contentFrame();
    const alert = frame.locator('.seams-auth-footer[data-state="notice"] .seams-auth-footer-text');
    await expect(alert).toBeVisible({ timeout: 30_000 });
    this.visibleError = (await alert.innerText()).trim();
    expect(this.visibleError.length).toBeGreaterThan(0);
    const retry = frame.locator('[data-auth-menu-primary]');
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect(alert).toBeHidden();
    await expect(retry).toBeEnabled();
    await retry.click();
  }
}

async function verifyUnlockNetworkFailureRecovery(
  {
    harness,
    context,
    page,
  }: { harness: IntendedBehaviourHarness; context: BrowserContext; page: Page },
  testInfo: TestInfo,
): Promise<void> {
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  const failure = new InterruptedUnlock();
  const route = failure.route.bind(failure);
  const url = '**/wallet/unlock/verify';
  await context.route(url, route);
  try {
    await Promise.all([harness.unlockPasskeyWallet(), failure.retryFromVisibleError(page)]);
  } finally {
    await context.unroute(url, route);
  }
  expect(failure.requests).toBe(2);
  await harness.signNearTransaction('post_unlock');
  await harness.signTempoTransaction('post_unlock');
  const evidence = {
    kind: 'passkey_unlock_network_failure_recovery_v1',
    fault: 'first_verify_request_interrupted_before_forwarding',
    visibleError: failure.visibleError,
    verificationRequests: failure.requests,
    retry: 'user_reprepares_then_confirms_a_new_passkey_attempt',
    verifiedSignatures: 2,
  };
  const artifactName = 'passkey-unlock-network-failure-recovery.json';
  const artifactPath = path.resolve(testInfo.config.rootDir, '../.artifacts/r151', artifactName);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  const body = JSON.stringify(evidence, null, 2);
  await writeFile(artifactPath, body, 'utf8');
  await testInfo.attach(artifactName, { body, contentType: 'application/json' });
}

test(
  'an interrupted unlock shows an error and permits a user retry',
  verifyUnlockNetworkFailureRecovery,
);
