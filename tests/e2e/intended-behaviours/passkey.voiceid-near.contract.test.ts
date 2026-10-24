import { writeFile } from 'node:fs/promises';
import { expect, type Page, type BrowserContext, type TestInfo } from '@playwright/test';
import {
  intendedTest as test,
  type IntendedBehaviourHarness,
  waitForWalletIframeConfirmationSettlement,
} from './harness';
import {
  allowBrowserMicrophone,
  enrollBrowserMicrophone,
  voiceIdBrowserAudio,
} from './voiceid-browser-audio';
import {
  readNearIdentity,
  startReviewedTransfer,
  VoiceIdNearSigningEvidence,
} from './voiceid-near-signing';
import type {} from '../../intended-app/src/voiceIdHelpers';

test.use({ ...voiceIdBrowserAudio, video: 'off', trace: 'off', screenshot: 'off' });
test('browser VoiceID requires a new review after a NEAR broadcast failure', verifyTransfer);

async function verifyTransfer(
  {
    harness,
    page,
    context,
  }: { harness: IntendedBehaviourHarness; page: Page; context: BrowserContext },
  testInfo: TestInfo,
): Promise<void> {
  await allowBrowserMicrophone(context);
  harness.enableVoiceIdPlugin();
  await harness.registerPasskeyEd25519YaoWallet();
  const identity = await readNearIdentity(page);
  const activation = page.evaluate(activate);
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  await wallet.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await enrollBrowserMicrophone(page);
  await activation;
  const evidence = new VoiceIdNearSigningEvidence(
    process.env.SEAMS_INTENDED_ROUTER_URL || 'http://127.0.0.1:4100',
    identity,
    'unavailable',
  );
  await evidence.observe(context);
  await startReviewedTransfer(page);
  await wallet.locator('button.confirm').click();
  await expect(page.getByTestId('reviewed-near-result')).toHaveAttribute('data-state', 'failed', {
    timeout: 60_000,
  });
  expect(evidence.snapshot().finalizations).toBe(1);
  expect(evidence.transfers.length).toBeGreaterThan(0);
  expect(new Set(evidence.transfers.map(transactionHash)).size).toBe(1);
  await waitForWalletIframeConfirmationSettlement(page);
  const afterFailure = evidence.snapshot();
  await startReviewedTransfer(page);
  await wallet.getByRole('button', { name: 'Cancel', exact: true }).click({ timeout: 10_000 });
  await expect(page.getByTestId('reviewed-near-result')).toHaveAttribute('data-state', 'failed');
  expect(evidence.snapshot()).toEqual(afterFailure);
  const report = testInfo.outputPath('voiceid-browser-broadcast-failure.json');
  await writeFile(
    report,
    JSON.stringify(
      {
        status: 'passed',
        nativeHost: 'none',
        speakerInference: 'real_ecapa_onnx_webassembly',
        signing: 'real_ed25519_yao_mpc',
        chain: 'deterministic_near_rpc',
        identity,
        oneSignatureAcrossBroadcastRetries: true,
        newReviewCancellationPreventedSigning: true,
        transfers: evidence.transfers,
      },
      null,
      2,
    ),
  );
  await testInfo.attach('voiceid-browser-broadcast-failure.json', {
    path: report,
    contentType: 'application/json',
  });
}
function activate() {
  if (!window.__seamsIntendedVoiceId) throw new Error('VoiceID test helper is unavailable');
  return window.__seamsIntendedVoiceId.activate();
}
function transactionHash(transfer: { signedTransactionSha256: string }): string {
  return transfer.signedTransactionSha256;
}
