import { writeFile } from 'node:fs/promises';
import {
  expect,
  type BrowserContext,
  type Page,
  type Request,
  type Route,
  type TestInfo,
} from '@playwright/test';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';
import { readNearIdentity, verifyVoiceIdNearTransfer } from './voiceid-near-signing';
import type { ActionResult } from '@seams/wallet';
import type {} from '../../intended-app/src/nearSigningHelpers';
import { nearTransactionHash } from './near-transaction-hash';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test(
  'NEAR send outcomes permit a fresh review after cancellation and retain uncertain submissions',
  verifySubmissionOutcomes,
);

class SubmissionEvidence {
  signingRequests = 0;
  readonly broadcasts: string[] = [];
  loseBroadcastReply = false;

  observe(request: Request): void {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/router-ab/ed25519/sign'
    ) {
      this.signingRequests += 1;
    }
  }

  async route(route: Route): Promise<void> {
    const request = route.request();
    if (
      request.method() !== 'POST' ||
      new URL(request.url()).origin !== 'https://rpc.testnet.fastnear.com'
    ) {
      return route.fallback();
    }
    const body = request.postDataJSON();
    if (body.method !== 'send_tx') return route.fallback();
    this.broadcasts.push(body.params.signed_tx_base64);
    if (this.loseBroadcastReply) {
      await route.fulfill({ status: 503, body: 'Injected lost broadcast response' });
      return;
    }
    await route.fallback();
  }
}

async function verifySubmissionOutcomes(
  {
    harness,
    page,
    context,
  }: { harness: IntendedBehaviourHarness; page: Page; context: BrowserContext },
  testInfo: TestInfo,
): Promise<void> {
  await harness.registerPasskeyEd25519YaoWallet();
  const identity = await readNearIdentity(page);
  const evidence = new SubmissionEvidence();
  context.on('request', evidence.observe.bind(evidence));
  await context.route('**/*', evidence.route.bind(evidence));
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');

  const cancelling = page.evaluate(sendNear, identity.accountId);
  await wallet.getByRole('button', { name: 'Cancel', exact: true }).click();
  const cancelled = await cancelling;
  expect(cancelled).toMatchObject({ success: false, kind: 'not_submitted' });
  expect(evidence.signingRequests).toBe(0);
  expect(evidence.broadcasts).toHaveLength(0);

  const retrying = page.evaluate(sendNear, identity.accountId);
  await wallet.locator('button.confirm').click();
  const retried = await retrying;
  expect(retried.success).toBe(true);
  if (!retried.success) throw new Error(retried.error);
  expect(retried.transactionId).toBeTruthy();
  expect(evidence.signingRequests).toBe(1);
  const signed = evidence.broadcasts[0];
  if (!signed) throw new Error('The approved retry did not submit signed bytes');
  await verifyVoiceIdNearTransfer(identity, signed);
  expect(retried.transactionId).toBe(nearTransactionHash(signed));

  evidence.loseBroadcastReply = true;
  const broadcastsBeforeLoss = evidence.broadcasts.length;
  const uncertain = page.evaluate(sendNear, identity.accountId);
  await wallet.locator('button.confirm').click();
  const lostReply = await uncertain;
  expect(lostReply).toMatchObject({ success: false, kind: 'unresolved' });
  if (lostReply.success || lostReply.kind !== 'unresolved')
    throw new Error('Missing recoverable hash');
  expect(lostReply.transactionId).toBeTruthy();
  const repeatedBytes = evidence.broadcasts.slice(broadcastsBeforeLoss);
  expect(repeatedBytes.length).toBeGreaterThan(0);
  expect(new Set(repeatedBytes).size).toBe(1);
  expect(evidence.signingRequests).toBe(2);
  await verifyVoiceIdNearTransfer(identity, repeatedBytes[0]);
  expect(lostReply.transactionId).toBe(nearTransactionHash(repeatedBytes[0]));

  await harness.lockWallet();
  const locked = await page.evaluate(sendNear, identity.accountId);
  expect(locked).toMatchObject({ success: false, kind: 'not_submitted' });
  expect(evidence.signingRequests).toBe(2);

  await harness.unlockPasskeyWallet();
  const disconnecting = page.evaluate(sendNear, identity.accountId);
  await expect(wallet.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.locator('iframe.seams-wallet-overlay-iframe').evaluate(removeIframe);
  const disconnected = await disconnecting;
  expect(disconnected).toMatchObject({ success: false, kind: 'submission_unknown' });
  expect(evidence.signingRequests).toBe(2);

  const report = testInfo.outputPath('near-submission-outcomes.json');
  await writeFile(
    report,
    JSON.stringify(
      {
        status: 'passed',
        signing: 'real_ed25519_yao_mpc',
        chain: 'deterministic_near_rpc',
        progressObserver: 'none',
        applicationCompletionHook: 'throws',
        cancelled,
        approvedRetry: { success: retried.success, transactionId: retried.transactionId },
        lostReply,
        locked,
        disconnected,
        signingRequests: evidence.signingRequests,
        retriesUsedIdenticalSignedBytes: true,
      },
      null,
      2,
    ) + '\n',
  );
  await testInfo.attach('near-submission-outcomes.json', {
    path: report,
    contentType: 'application/json',
  });
}

function removeIframe(element: Element): void {
  element.remove();
}

function sendNear(accountId: string): Promise<ActionResult> {
  const send = window.__seamsIntendedE2ESendNear;
  if (!send) throw new Error('The public SDK submission helper is unavailable');
  return send(accountId);
}
