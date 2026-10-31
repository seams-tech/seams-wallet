import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { WalletIframeRouter } from '@/SeamsWeb/walletIframe/client/router';
import type { WalletHostConfig } from '@/SeamsWeb/walletIframe/shared/configuration';
import type { TransactionReviewReservation } from '@/SeamsWeb/walletIframe/client/transactionReviewReservation';
import type { OwnerNearOperation, OwnerNearOutcome } from '@/SeamsWeb/publicApi/ownerNearOperation';
import { setupBasicPasskeyTest, SDK_ESM_PATHS } from '../setup';
import { DEFAULT_TEST_CONFIG } from '../setup/config';
import { createTestWalletHostConfig } from '../setup/walletHostConfig';
import { buildWalletServiceHtml, registerWalletServiceRoute } from './harness';

declare global {
  interface Window {
    __ownerRecoveryReview: TransactionReviewReservation;
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
  let firstRecoveryRequest = null;
  let currentRecoveryRequest = null;

  function observeOwnerRequest(event) {
    const request = event.data;
    if (request.type !== 'PM_OWNER_NEAR_TRANSACTION') return;
    const marker = document.createElement('li');
    marker.dataset.action = request.payload.action;
    marker.textContent = request.requestId;
    document.body.append(marker);
    if (request.payload.action === 'approve') {
      approvalRequestId = request.requestId;
      return;
    }
    recoveryAttempts += 1;
    currentRecoveryRequest = request;
    if (recoveryAttempts === 1) firstRecoveryRequest = request;
    if (recoveryAttempts === 2) {
      postOwnerSubmission(request);
    }
    if (recoveryAttempts === 4) {
      postResult(request.requestId, {
        kind: 'reverted',
        transactionId: '${TRANSACTION_ID}',
        error: 'Confirmed test revert',
      });
    }
  }

  function postOwnerSubmission(request) {
    adoptedPort.postMessage({
      type: 'PROGRESS',
      requestId: request.requestId,
      payload: {
        event: 'owner_near_submitting',
        operationId: request.payload.recovery.operationId,
        transactionId: '${TRANSACTION_ID}',
      },
    });
    const submissionCount = Number(document.body.dataset.submissionCount ?? '0');
    document.body.dataset.submissionCount = String(submissionCount + 1);
  }

  function reportLateProgress(event) {
    if (event.data?.type === 'TEST_LATE_PROGRESS' && currentRecoveryRequest) {
      postOwnerSubmission(currentRecoveryRequest);
    }
  }

  function showOwnerApproval(event) {
    if (event.data?.type === 'TEST_SHOW_APPROVAL' && approvalRequestId) {
      adoptedPort.postMessage({
        type: 'SURFACE_MEASUREMENT',
        payload: {
          kind: 'measured_v1',
          requestId: approvalRequestId,
          sequence: 1,
          widthCssPx: 420,
          heightCssPx: 380,
        },
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

  function finishLateRecovery(event) {
    if (event.data?.type === 'TEST_LATE_RECOVERY' && firstRecoveryRequest) {
      postResult(firstRecoveryRequest.requestId, { kind: 'cancelled' });
    }
  }

  window.addEventListener('message', connectOwnerObserver);
  window.addEventListener('message', showOwnerApproval);
  window.addEventListener('message', finishOwnerApproval);
  window.addEventListener('message', finishLateRecovery);
  window.addEventListener('message', reportLateProgress);
`;

test(
  'owner recovery stays in the background and times out without losing retry state',
  verifyRecovery,
);

async function verifyRecovery({ page }: { page: Page }, testInfo: TestInfo): Promise<void> {
  await setupBasicPasskeyTest(page, { skipSeamsWebInit: true });
  await registerWalletServiceRoute(
    page,
    buildWalletServiceHtml({
      extraScript: OWNER_SERVICE_SCRIPT,
      exactSessionState: {
        kind: 'wallet_unlocked_without_signing_session',
        walletId: 'owner.testnet',
        reason: 'absent',
      },
    }),
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
  const preparing = await page.evaluate(readDialogState);
  await testInfo.attach('approval-before-content', {
    body: JSON.stringify(preparing, null, 2),
    contentType: 'application/json',
  });
  expect(preparing).toMatchObject({ modal: false, opacity: '0' });
  await backgroundButton.click({ timeout: 2_000 });
  // Slow preparation must not turn into a blank modal after the old four-second fallback.
  await page.clock.fastForward(5_001);
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  await backgroundButton.click({ timeout: 2_000 });
  await wallet.locator('body').evaluate(showApproval);
  await expect(page.locator('dialog[data-seams-root]')).toHaveCSS('width', '420px');
  await page.clock.runFor(32);
  await expect(page.locator('dialog:modal')).toHaveCount(1);
  await page.clock.fastForward(25_000);
  expect(await page.evaluate(readRecoveryState)).toBe('unknown');
  await page.clock.fastForward(5_000);
  const unavailable = await page.evaluate(readRequestOutcome, 'recover' as const);
  expect(unavailable).toMatchObject({ kind: 'recovery_unavailable', recovery });
  expect(unavailable.error).toContain('Wallet request timeout');
  expect(await page.evaluate(readApprovalState)).toBe('approval');
  await expect(page.locator('dialog:modal')).toHaveCount(1);
  await wallet.locator('body').evaluate(finishLateRecovery);
  await page.clock.runFor(32);
  expect(await page.evaluate(readApprovalState)).toBe('approval');
  await expect(page.locator('dialog:modal')).toHaveCount(1);

  // Recovery also bypasses an occupied queue and retains a newly observed hash.
  await page.evaluate(startRecovery);
  await expect(wallet.locator('[data-action="recover"]')).toHaveCount(2);
  await expect.poll(page.evaluate.bind(page, readRecoveryState)).toBe('submitting');
  await page.clock.fastForward(30_000);
  await wallet.locator('body').evaluate(reportLateProgress);
  await expect(wallet.locator('body')).toHaveAttribute('data-submission-count', '2');
  await page.clock.runFor(32);
  await page.clock.fastForward(5_001);
  const unresolved = await page.evaluate(readRequestOutcome, 'recover' as const);
  expect(unresolved).toMatchObject({ kind: 'unresolved', recovery, transactionId: TRANSACTION_ID });
  expect(unresolved.error).toContain('Wallet request timeout');

  // A later timeout without progress must preserve the handle's known hash.
  await page.evaluate(startRecovery);
  await expect(wallet.locator('[data-action="recover"]')).toHaveCount(3);
  await page.clock.fastForward(35_001);
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

  await page.clock.resume();
  await page.evaluate(reserveEmptyReview);
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  await backgroundButton.click({ timeout: 2_000 });
  await page.evaluate(mountReviewContent);
  await expect(page.getByRole('heading', { name: 'Ready purchase review' })).toBeVisible();
  await expect(page.locator('dialog:modal')).toHaveCount(1);
  await page.getByRole('button', { name: 'Cancel reserved review' }).click();
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  await backgroundButton.click({ timeout: 2_000 });

  const artifact = testInfo.outputPath('owner-recovery.json');
  await writeFile(
    artifact,
    JSON.stringify(
      {
        status: 'passed',
        transport: 'built SDK and MessageChannel with a controlled wallet host',
        clock: 'browser clock advances across the fixed 35000 ms recovery deadline',
        recovery,
        preparing,
        unavailable,
        unresolved,
        retried,
        settled,
        checks: [
          'background page accepts clicks during pending recovery',
          'approval preparation remains nonmodal until content is measured',
          'recovery does not reserve the approval queue',
          'recovery bypasses an active approval',
          'recovery timeout does not close or expire an approval',
          'late recovery replies cannot disturb a concurrent approval',
          'late progress cannot extend recovery beyond its 35-second deadline',
          'operation identity and known hash survive timeouts and retries',
          'an empty application review does not block the page before content mounts',
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

function showApproval(): void {
  window.postMessage({ type: 'TEST_SHOW_APPROVAL' }, window.location.origin);
}

function finishLateRecovery(): void {
  window.postMessage({ type: 'TEST_LATE_RECOVERY' }, window.location.origin);
}

function reportLateProgress(): void {
  window.postMessage({ type: 'TEST_LATE_PROGRESS' }, window.location.origin);
}

function readDialogState() {
  const dialog = document.querySelector('dialog[data-seams-root]');
  if (!(dialog instanceof HTMLDialogElement)) throw new Error('Missing wallet dialog.');
  return { modal: dialog.matches(':modal'), opacity: getComputedStyle(dialog).opacity };
}

function disposeRouter(): void {
  window.__ownerRecoveryTest.router.dispose();
}

async function reserveEmptyReview(): Promise<void> {
  const controller = new AbortController();
  window.__ownerRecoveryReview = await window.__ownerRecoveryTest.router.reserveTransactionReview({
    walletId: 'owner.testnet',
    title: 'Purchase review',
    validity: { kind: 'unbounded' },
    confirmationConfig: undefined,
    signal: controller.signal,
    onCancel: controller.abort.bind(controller),
  });
}

function mountReviewContent(): void {
  const reservation = window.__ownerRecoveryReview;
  const article = document.createElement('article');
  const heading = document.createElement('h2');
  heading.textContent = 'Ready purchase review';
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel reserved review';
  cancel.addEventListener(
    'click',
    reservation.cancel.bind(reservation, new Error('Review cancelled')),
  );
  article.append(heading, cancel);
  reservation.slot.append(article);
}
