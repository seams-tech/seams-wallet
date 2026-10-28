import { expect, type Page, type Request, type Browser, type TestInfo } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { IntendedBehaviourHarness } from './harness';
import {
  parseQrLinkedDeviceSessionPayloadV5,
  serializeQrLinkedDeviceSessionPayloadV5,
  type QrLinkedDeviceSessionPayloadV5,
} from '../../../packages/shared-ts/src/device-linking';
import { requireRecord, requireNonEmptyString } from '../../../packages/shared-ts/src/utils/validation';

declare global {
  interface Window {
    __deviceLinkParentProbe: {
      port: MessagePort | null;
      requests: { type: string; requestId: string; payload: { qrData: unknown } }[];
      replies: { type: string; requestId: string; error: unknown }[];
    };
    __sendHostileDeviceLinkMessage: (message: unknown) => void;
  }
}

class LinkRequests {
  readonly paths: string[] = [];

  record(request: Request): void {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path.startsWith('/wallet/device-linking/v1/') &&
        !path.endsWith('/owner-authorization')) {
      this.paths.push(path);
    }
  }
}

async function snapshot(page: Page): Promise<Record<string, unknown>> {
  const text = await page.getByTestId('intended-result-json').textContent();
  return requireRecord(JSON.parse(text ?? ''), 'intended snapshot');
}

async function startTarget(page: Page): Promise<QrLinkedDeviceSessionPayloadV5> {
  await page.getByTestId('intended-device-link-start').click();
  await expect(page.getByTestId('intended-action-status')).toHaveAttribute('data-state', 'success');
  const state = await snapshot(page);
  const action = requireRecord(state.action, 'target action');
  const result = requireRecord(action.result, 'target result');
  return parseQrLinkedDeviceSessionPayloadV5(
    JSON.parse(requireNonEmptyString(result.qrPayloadJson, 'QR JSON')),
  );
}

function presentHostileQr(qr: QrLinkedDeviceSessionPayloadV5): void {
  window.__seamsIntendedE2EDeviceLinkQrPayloadJson = JSON.stringify(qr);
  const button = document.querySelector<HTMLButtonElement>('[data-testid="intended-device-link-scan"]');
  if (!button) throw new Error('Device-link action is absent');
  // A programmatic parent click has no trusted Wallet-origin gesture.
  button.click();
}

function forgeApproval(): void {
  const original = window.__deviceLinkParentProbe.requests[0];
  if (!original) throw new Error('The original request is absent');
  window.__sendHostileDeviceLinkMessage({
    type: 'PM_DEVICE_LINK_APPROVED',
    requestId: original.requestId + '-forged',
    payload: { approved: true, confirmed: true, qrData: original.payload.qrData },
  });
}

function submitChangedRequest(requestId: string): void {
  const original = window.__deviceLinkParentProbe.requests[0];
  if (!original) throw new Error('The original request is absent');
  const qr = structuredClone(original.payload.qrData);
  if (!qr || typeof qr !== 'object') throw new Error('Invalid recorded QR');
  Reflect.set(qr, 'requestedPermission', {
    kind: 'delegated_wallet_authority_v1', permissions: ['sign'],
  });
  window.__sendHostileDeviceLinkMessage({
    type: 'PM_SCAN_AND_LINK_DEVICE', requestId,
    payload: {
      qrData: qr,
      options: { confirmationConfig: { uiMode: 'none', behavior: 'skipClick' } },
    },
  });
}

function cancelParentRequest(): void {
  const request = window.__deviceLinkParentProbe.requests.at(-1);
  if (!request) throw new Error('The current request is absent');
  window.__sendHostileDeviceLinkMessage({
    type: 'PM_CANCEL', requestId: request.requestId,
    payload: { requestId: request.requestId },
  });
}

function hasErrorReply(requestId: string): boolean {
  for (const reply of window.__deviceLinkParentProbe.replies) {
    if (reply.requestId === requestId && reply.type === 'ERROR') return true;
  }
  return false;
}

function hasParentProbe(): boolean {
  return typeof window.__deviceLinkParentProbe !== 'undefined';
}

async function cancelTarget(): Promise<void> {
  if (!window.__seamsIntendedE2ECancelDeviceLink) throw new Error('Target cancellation is absent');
  await window.__seamsIntendedE2ECancelDeviceLink();
}

export async function runDeviceLinkConsentScenario({
  harness, page, browser,
}: { harness: IntendedBehaviourHarness; page: Page; browser: Browser }, testInfo: TestInfo): Promise<void> {
  await page.context().addInitScript({
    path: fileURLToPath(new URL('./device-link-consent-parent.js', import.meta.url)),
  });
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  if (!(await page.evaluate(hasParentProbe))) {
    await page.addScriptTag({
      path: fileURLToPath(new URL('./device-link-consent-parent.js', import.meta.url)),
    });
  }
  const previous = browser.contexts();
  const linked = await harness.openLinkedDevice(browser);
  const targetContext = browser.contexts().find(context => !previous.includes(context));
  if (!targetContext) throw new Error('The target browser context is absent');
  const target = targetContext.pages()[0];
  if (!target) throw new Error('The target page is absent');
  await target.goto(page.url(), { waitUntil: 'domcontentloaded' });
  await expect(target.getByTestId('intended-e2e-page')).toBeVisible();
  const qr = await startTarget(target);
  const fingerprint = createHash('sha256')
    .update(serializeQrLinkedDeviceSessionPayloadV5(qr)).digest('base64url');
  const requests = new LinkRequests();
  page.on('request', requests.record.bind(requests));
  await page.evaluate(presentHostileQr, qr);
  const surface = page.frameLocator('iframe[src*="/wallet-service"]').locator('[data-seams-device-link-approval]');
  try {
    await expect(surface).toBeVisible();
  } catch (error) {
    const sourceState = await snapshot(page);
    const targetState = await snapshot(target);
    await writeFile(testInfo.outputPath('consent-failure.json'), JSON.stringify({
      sourceAction: sourceState.action,
      targetAction: targetState.action,
      samePage: page === target,
      sameContext: page.context() === target.context(),
      sourceRequests: requests.paths,
    }, null, 2));
    throw error;
  }
  await expect(surface).toHaveAttribute('data-seams-device-link-approval', fingerprint);
  await expect(surface).toContainText('Export signing keys');
  await expect(surface).toContainText('Sign transactions');
  expect(requests.paths).toEqual([]);
  await page.evaluate(forgeApproval);
  const competingId = randomUUID();
  await page.evaluate(submitChangedRequest, competingId);
  await page.waitForFunction(hasErrorReply, competingId);
  await expect(surface).toHaveCount(1);
  await expect(surface).toHaveAttribute('data-seams-device-link-approval', fingerprint);
  expect(requests.paths).toEqual([]);
  await surface.screenshot({ path: testInfo.outputPath('wallet-origin-consent.png') });
  await surface.getByRole('button', { name: 'Cancel', exact: true }).click({ timeout: 10_000 });
  await expect(surface).toHaveCount(0);
  await expect(page.getByTestId('intended-action-status')).toHaveAttribute('data-state', 'error');
  expect(requests.paths).toEqual([]);
  await page.evaluate(presentHostileQr, qr);
  await expect(surface).toBeVisible();
  await page.evaluate(cancelParentRequest);
  await expect(surface).toHaveCount(0);
  await expect(page.getByTestId('intended-action-status')).toHaveAttribute('data-state', 'error');
  expect(requests.paths).toEqual([]);
  await target.evaluate(cancelTarget);

  // The same source still links normally after explicit Wallet approval.
  await harness.linkDeviceWithPasskey(linked);
  await linked.signNearTransaction('post_device_link');
  await linked.signTempoTransaction('post_device_link');
  await linked.exportEd25519Key();
  await linked.exportEcdsaKey();
  await writeFile(testInfo.outputPath('device-link-consent.json'), JSON.stringify({
    passed: true,
    displayedQrDigest: fingerprint,
    hostileParentBypassRejected: true,
    competingRequestRejected: true,
    walletCancellationBeforeClaim: true,
    parentCancellationBeforeClaim: true,
    claimsBeforeApproval: 0,
    explicitApprovalLinkedSameSignerKeys: true,
    ed25519AndEcdsaSigningAndExportPassed: true,
    approvedFlowRequestPaths: requests.paths,
  }, null, 2));
}
