import {
  expect,
  type BrowserContext,
  type Page,
  type Request,
  type Route,
  type TestInfo,
} from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROUTER_AB_ECDSA_DERIVATION_OPERATION_STEP_UP_PATH } from '../../../packages/shared-ts/src/utils/routerAbEcdsaDerivation';
import { isPlainObject } from '../../../packages/shared-ts/src/utils/validation';
import { WalletSessionStatusEvidence } from './walletSessionStatusEvidence';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';
import { verifyFreshUnlockWins, verifyLockWins } from './session-restore-lock';
import { verifyPassiveWalletLock } from './session-passive-lock';
import { verifyLockPreservesPresignatures } from './session-presign-retention';
import { verifyBrowserSecurityFailureAndRetry } from './passkey-browser-security';

// Export flows retain sanitized evidence instead of secret-bearing DOM or network captures.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('browser security failures remain visible and a cancelled retry can unlock the same wallet', verifyBrowserSecurityFailureAndRetry);

test('lock retains durable presignatures across a fresh unlock', verifyLockPreservesPresignatures);
test('locking a wallet updates an idle tab without a session query', verifyPassiveWalletLock);
test('a cross-tab lock prevents delayed restoration from recreating its credential', verifyLockWins);
test('a fresh unlock survives a delayed restoration response from another tab', verifyFreshUnlockWins);

type EcdsaStepUpWireObservation = {
  readonly operationKind: string;
  readonly extensionsRedacted: boolean;
};

function recordEcdsaStepUpWireObservation(
  observations: EcdsaStepUpWireObservation[],
  request: Request,
): void {
  if (
    request.method() !== 'POST' ||
    new URL(request.url()).pathname !== ROUTER_AB_ECDSA_DERIVATION_OPERATION_STEP_UP_PATH
  ) {
    return;
  }
  let body: unknown;
  try {
    body = request.postDataJSON();
  } catch {
    observations.push({ operationKind: 'invalid', extensionsRedacted: false });
    return;
  }
  if (!isPlainObject(body) || !isPlainObject(body.proof)) {
    observations.push({ operationKind: 'invalid', extensionsRedacted: false });
    return;
  }
  if (body.proof.kind !== 'passkey') return;
  const credential = body.proof.webauthn_authentication;
  const response = isPlainObject(credential) ? credential.response : null;
  const operationKind = isPlainObject(body.operation)
    ? String(body.operation.operation_kind)
    : 'invalid';
  observations.push({
    operationKind,
    extensionsRedacted:
      isPlainObject(credential) &&
      credential.clientExtensionResults === null &&
      isPlainObject(response) &&
      response.clientExtensionResults === undefined,
  });
}

function summarizeEcdsaStepUpWire(observations: readonly EcdsaStepUpWireObservation[]): {
  readonly exportProofs: number;
  readonly signingProofs: number;
  readonly unredactedProofs: number;
} {
  let exportProofs = 0;
  let signingProofs = 0;
  let unredactedProofs = 0;
  for (const observation of observations) {
    if (observation.operationKind === 'evm.export_key') exportProofs += 1;
    if (observation.operationKind === 'evm.sign_transaction') signingProofs += 1;
    if (!observation.extensionsRedacted) unredactedProofs += 1;
  }
  return { exportProofs, signingProofs, unredactedProofs };
}

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
  const stepUpWireObservations: EcdsaStepUpWireObservation[] = [];
  page.on('request', recordEcdsaStepUpWireObservation.bind(null, stepUpWireObservations));
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
  const stepUpWireSummary = summarizeEcdsaStepUpWire(stepUpWireObservations);
  expect(stepUpWireSummary.exportProofs).toBeGreaterThan(0);
  expect(stepUpWireSummary.signingProofs).toBeGreaterThan(0);
  expect(stepUpWireSummary.unredactedProofs).toBe(0);
  const artifactPath = testInfo.outputPath('ecdsa-step-up-prf-boundary.json');
  await writeFile(artifactPath, JSON.stringify(stepUpWireSummary, null, 2) + '\n', 'utf8');
  await testInfo.attach('ecdsa-step-up-prf-boundary', {
    path: artifactPath,
    contentType: 'application/json',
  });
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
    await Promise.all([
      harness.unlockPasskeyWallet({ stopAfterClick: true }),
      failure.retryFromVisibleError(page),
    ]);
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
