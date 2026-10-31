import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { WalletIframeRouter } from '@/SeamsWeb/walletIframe/client/router';
import type { WalletHostConfig } from '@/SeamsWeb/walletIframe/shared/configuration';
import type { OwnerNearOperation, OwnerNearOutcome } from '@/SeamsWeb/publicApi/ownerNearOperation';
import { setupBasicPasskeyTest, SDK_ESM_PATHS } from '../setup';
import { DEFAULT_TEST_CONFIG } from '../setup/config';
import { createTestWalletHostConfig } from '../setup/walletHostConfig';
import { buildWalletServiceHtml, registerWalletServiceRoute } from './harness';

declare global {
  interface Window {
    __ownerRecoveryTest: {
      router: WalletIframeRouter;
      recovery: OwnerNearOperation;
      approval: OwnerNearOperation;
      requests: Map<'recover' | 'approve', Promise<OwnerNearOutcome>>;
    };
  }
}

const WALLET_ORIGIN = 'https://wallet.example.localhost';
const TRANSACTION_ID = 'owner-recovery-browser-test-hash';
const OWNER_SERVICE_SCRIPT = `
  let recoveryAttempts = 0;
  let approvalRequestId = null;

  function observeOwnerRequest(event) {
    const request = event.data;
    if (request.type !== 'PM_OWNER_NEAR_TRANSACTION') return;
    const marker = document.createElement('li');
    marker.dataset.action = request.payload.action;
    marker.textContent = request.requestId;
    document.body.append(marker);
    if (request.payload.action === 'approve') {
      approvalRequestId = request.requestId;
      adoptedPort.postMessage({
        type: 'SURFACE_MEASUREMENT',
        payload: {
          kind: 'measured_v1',
          requestId: request.requestId,
          sequence: 1,
          widthCssPx: 420,
          heightCssPx: 380,
        },
      });
      return;
    }
    recoveryAttempts += 1;
    if (recoveryAttempts === 2) {
      adoptedPort.postMessage({
        type: 'PROGRESS',
        requestId: request.requestId,
        payload: {
          event: 'owner_near_submitting',
          operationId: request.payload.recovery.operationId,
          transactionId: '${TRANSACTION_ID}',
        },
      });
    }
    if (recoveryAttempts === 4) {
      postResult(request.requestId, {
        kind: 'reverted',
        transactionId: '${TRANSACTION_ID}',
        error: 'Confirmed test revert',
      });
    }
  }

  function connectOwnerObserver(event) {
    if (event.data?.type === 'CONNECT' && event.ports[0]) {
      event.ports[0].addEventListener('message', observeOwnerRequest);
    }
  }

  function finishOwnerApproval(event) {
    if (event.data?.type === 'TEST_FINISH_APPROVAL' && approvalRequestId) {
      pendingRequests.delete(approvalRequestId);
      postResult(approvalRequestId, { kind: 'cancelled' });
    }
  }

  window.addEventListener('message', connectOwnerObserver);
  window.addEventListener('message', finishOwnerApproval);
`;

test(
  'owner recovery stays in the background and times out without losing retry state',
  verifyRecovery,
);

async function verifyRecovery({ page }: { page: Page }, testInfo: TestInfo): Promise<void> {
  await setupBasicPasskeyTest(page, { skipSeamsWebInit: true });
  await registerWalletServiceRoute(
    page,
    buildWalletServiceHtml({ extraScript: OWNER_SERVICE_SCRIPT }),
    '**://wallet.example.localhost/wallet-service*',
  );
  await page.evaluate(initializeOwnerOperations, {
    routerPath: SDK_ESM_PATHS.walletIframeRouter,
    walletOrigin: WALLET_ORIGIN,
    hostConfig: createTestWalletHostConfig(DEFAULT_TEST_CONFIG),
  });
  await page.clock.pauseAt(new Date());
  const wallet = page.frameLocator('iframe[data-seams-owner="owner-recovery-test"]');
  const backgroundButton = page.getByRole('button', { name: 'Check background clicks' });
  const recovery = await page.evaluate(readRecoveryIdentity);

  await page.evaluate(startRecovery);
  await expect(wallet.locator('[data-action="recover"]')).toHaveCount(1);
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  await backgroundButton.click({ timeout: 2_000 });
  await expect(backgroundButton).toHaveAttribute('data-clicked', 'true');
  await page.screenshot({ path: testInfo.outputPath('background-recovery.png') });

  // A pending recovery cannot reserve the approval queue.
  await page.evaluate(startApproval);
  await expect(wallet.locator('[data-action="approve"]')).toHaveCount(1);
  await expect(page.locator('dialog:modal')).toHaveCount(1);
  await page.clock.fastForward(1_001);
  const unavailable = await page.evaluate(readRequestOutcome, 'recover' as const);
  expect(unavailable).toMatchObject({ kind: 'recovery_unavailable', recovery });
  expect(unavailable.error).toContain('Wallet request timeout');
  expect(await page.evaluate(readApprovalState)).toBe('approval');
  await expect(page.locator('dialog:modal')).toHaveCount(1);

  // Recovery also bypasses an occupied queue and retains a newly observed hash.
  await page.evaluate(startRecovery);
  await expect(wallet.locator('[data-action="recover"]')).toHaveCount(2);
  await expect.poll(page.evaluate.bind(page, readRecoveryState)).toBe('submitting');
  await page.clock.fastForward(1_001);
  const unresolved = await page.evaluate(readRequestOutcome, 'recover' as const);
  expect(unresolved).toMatchObject({ kind: 'unresolved', recovery, transactionId: TRANSACTION_ID });
  expect(unresolved.error).toContain('Wallet request timeout');

  // A later timeout without progress must preserve the handle's known hash.
  await page.evaluate(startRecovery);
  await expect(wallet.locator('[data-action="recover"]')).toHaveCount(3);
  await page.clock.fastForward(1_001);
  const retried = await page.evaluate(readRequestOutcome, 'recover' as const);
  expect(retried).toMatchObject({ kind: 'unresolved', recovery, transactionId: TRANSACTION_ID });
  expect(await page.evaluate(readApprovalState)).toBe('approval');
  await expect(page.locator('dialog:modal')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('approval-after-recovery-timeouts.png') });

  await wallet.locator('body').evaluate(finishApproval);
  expect(await page.evaluate(readRequestOutcome, 'approve' as const)).toEqual({
    kind: 'cancelled',
  });
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  await backgroundButton.click({ timeout: 2_000 });
  await page.evaluate(startRecovery);
  const settled = await page.evaluate(readRequestOutcome, 'recover' as const);
  expect(settled).toEqual({
    kind: 'reverted',
    transactionId: TRANSACTION_ID,
    error: 'Confirmed test revert',
  });
  await expect(page.locator('dialog:modal')).toHaveCount(0);

  const artifact = testInfo.outputPath('owner-recovery.json');
  await writeFile(
    artifact,
    JSON.stringify(
      {
        status: 'passed',
        transport: 'built SDK and MessageChannel with a controlled wallet host',
        clock: 'browser clock advances across the configured 1000 ms request timeout',
        recovery,
        unavailable,
        unresolved,
        retried,
        settled,
        checks: [
          'background page accepts clicks during pending recovery',
          'recovery does not reserve the approval queue',
          'recovery bypasses an active approval',
          'recovery timeout does not close or expire an approval',
          'operation identity and known hash survive timeouts and retries',
        ],
        reproduce:
          'pnpm -C tests test:wallet-browser wallet-iframe/ownerNearOperation.browser.test.ts',
      },
      null,
      2,
    ) + '\n',
  );
  await testInfo.attach('owner-recovery', { path: artifact, contentType: 'application/json' });
  await page.evaluate(disposeRouter);
}

async function initializeOwnerOperations(args: {
  routerPath: string;
  walletOrigin: string;
  hostConfig: WalletHostConfig;
}): Promise<void> {
  const { WalletIframeRouter }: typeof import('@/SeamsWeb/walletIframe/client/router') =
    await import(args.routerPath);
  const {
    parseOwnerNearCommand,
  }: typeof import('@/SeamsWeb/walletIframe/shared/ownerNearOperation') =
    await import('/_test-sdk/esm/SeamsWeb/walletIframe/shared/ownerNearOperation.js');
  const {
    prepareOwnerNearTransaction,
    resumeOwnerNearTransaction,
  }: typeof import('@/SeamsWeb/publicApi/ownerNearOperation') =
    await import('/_test-sdk/esm/SeamsWeb/publicApi/ownerNearOperation.js');
  const { ActionType }: typeof import('@/core/types/actions') =
    await import('/_test-sdk/esm/index.js');
  const command = parseOwnerNearCommand({
    action: 'recover',
    authentication: {
      kind: 'external_authenticated',
      walletId: 'owner.testnet',
      sessionId: 'owner-session',
      associationId: 'owner-association',
      environmentId: 'owner-environment',
      provider: 'application',
      permission: 'wallet_settings_read',
      expiresAtMs: Date.now() + 3_600_000,
    },
    recovery: {
      operationId: 'owner-near:' + 'a'.repeat(32),
      walletId: 'owner.testnet',
      nearAccountId: 'owner.testnet',
    },
  });
  const router = new WalletIframeRouter({
    hostConfig: args.hostConfig,
    walletOrigin: args.walletOrigin,
    servicePath: '/wallet-service',
    requestTimeoutMs: 1_000,
    testOptions: { ownerTag: 'owner-recovery-test' },
  });
  await router.init();
  window.__ownerRecoveryTest = {
    router,
    recovery: resumeOwnerNearTransaction(router.ownerNearOperation.bind(router), {
      authentication: command.authentication,
      recovery: command.recovery,
    }),
    approval: prepareOwnerNearTransaction(router.ownerNearOperation.bind(router), {
      authentication: command.authentication,
      nearAccountId: 'owner.testnet',
      transaction: {
        receiverId: 'receiver.testnet',
        actions: [{ type: ActionType.Transfer, amount: '1' }],
      },
    }),
    requests: new Map(),
  };
  const button = document.createElement('button');
  button.textContent = 'Check background clicks';
  button.addEventListener('click', button.setAttribute.bind(button, 'data-clicked', 'true'));
  document.body.append(button);
}

function startRecovery(): void {
  const state = window.__ownerRecoveryTest;
  state.requests.set('recover', state.recovery.recover());
}

function startApproval(): void {
  const state = window.__ownerRecoveryTest;
  state.requests.set('approve', state.approval.approve());
}

function readRequestOutcome(action: 'recover' | 'approve'): Promise<OwnerNearOutcome> {
  const request = window.__ownerRecoveryTest.requests.get(action);
  if (!request) throw new Error('The owner request did not start.');
  return request;
}

function readRecoveryIdentity() {
  return window.__ownerRecoveryTest.recovery.getState().recovery;
}

function readRecoveryState(): string {
  return window.__ownerRecoveryTest.recovery.getState().kind;
}

function readApprovalState(): string {
  return window.__ownerRecoveryTest.approval.getState().kind;
}

function finishApproval(): void {
  window.postMessage({ type: 'TEST_FINISH_APPROVAL' }, window.location.origin);
}

function disposeRouter(): void {
  window.__ownerRecoveryTest.router.dispose();
}
