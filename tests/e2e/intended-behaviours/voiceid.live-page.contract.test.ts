import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type {} from '../../fixtures/ui/VoiceIdMicrophoneObservation';
import {
  voiceIdBrowserAudio,
  allowBrowserMicrophone,
  enrollBrowserMicrophone,
} from './voiceid-browser-audio';
import { readFile, writeFile } from 'node:fs/promises';
import {
  expect,
  type BrowserContext,
  type Page,
  type TestInfo,
  type Request,
} from '@playwright/test';
import { base58Encode } from '@shared/utils/base58';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';
import { startReviewedTransfer, VoiceIdNearSigningEvidence } from './voiceid-near-signing';

test('manual VoiceID page allocates its wallet and signs after voice unlock', verifyLivePage);
test.use(voiceIdBrowserAudio);
test.use({ video: 'off', trace: 'off', screenshot: 'off' });
test.setTimeout(180_000);

async function verifyLivePage(
  {
    page,
    context,
    harness,
  }: { page: Page; context: BrowserContext; harness: IntendedBehaviourHarness },
  testInfo: TestInfo,
): Promise<void> {
  await allowBrowserMicrophone(context);
  const observation = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve(import.meta.dirname, '../../scripts/build-preact-probe.mjs'),
        'VoiceIdMicrophoneObservation.ts',
      ],
      { encoding: 'utf8' },
    ),
  );
  await context.addInitScript({ content: observation[0].code });
  const assets = new VoiceAssetRequests();
  context.on('request', assets.observe);
  const initialId = 'voiceid-live-20261024';
  const url = new URL('/voiceid', process.env.SEAMS_INTENDED_APP_URL || 'http://localhost:4201');
  url.searchParams.set('authMethod', 'voiceid');
  url.searchParams.set('walletId', initialId);
  await page.goto(url.href);
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  await expect(
    page.getByRole('button', { name: 'Unlock with passkey', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Create test wallet', exact: true }).click();
  await wallet.getByRole('button', { name: 'Create passkey', exact: true }).click();
  const status = page.getByTestId('live-voiceid-operation');
  await expect(status).toHaveAttribute('data-state', 'succeeded', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Save recovery codes', exact: true }).click();
  await wallet.getByRole('button', { name: 'View recovery codes', exact: true }).click();
  await wallet
    .locator('[data-seams-wallet-recovery-backup-acknowledgement]')
    .check({ timeout: 60_000 });
  await wallet.locator('[data-seams-wallet-recovery-backup-close]').click();
  await expect(status).toHaveAttribute('data-state', 'succeeded', { timeout: 60_000 });
  const walletId = await page.getByTestId('live-voiceid-wallet').innerText();
  expect(walletId).not.toBe(initialId);
  expect(new URL(page.url()).searchParams.get('walletId')).toBe(walletId);
  await expect(
    page.getByRole('button', { name: 'Create test wallet', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Unlock with passkey', exact: true }),
  ).toBeEnabled();
  await expect(page.getByTestId('live-voiceid-auth')).toHaveText('passkey');
  const accountId = await page.getByTestId('live-voiceid-account').innerText();
  expect(accountId).toMatch(/^[a-f0-9]{64}$/);
  const identity = {
    walletId,
    accountId,
    publicKey: `ed25519:${base58Encode(Buffer.from(accountId, 'hex'))}`,
  };
  await page.getByRole('button', { name: 'Lock wallet', exact: true }).click();
  await expect(page.getByTestId('live-voiceid-auth')).toHaveText('locked');
  await expect(page.getByTestId('live-voiceid-method')).toHaveText(
    'Unlock with passkey, then activate VoiceID',
  );
  await expect(
    page.getByRole('button', { name: 'Unlock with VoiceID', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Lock wallet', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Unlock with passkey', exact: true }).click();
  await expect(page.getByTestId('live-voiceid-auth')).toHaveText('passkey', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await wallet.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await wallet.getByRole('button', { name: 'Record sample 1', exact: true }).click();
  await expect
    .poll(wallet.locator('body').evaluate.bind(wallet.locator('body'), microphoneStates))
    .toContain('live');
  await wallet.getByRole('button', { name: 'Cancel enrollment', exact: true }).click();
  await expect(status).toHaveAttribute('data-state', 'failed');
  expect(await wallet.locator('body').evaluate(microphoneStates)).not.toContain('live');
  expect(assets.inference).toHaveLength(0);
  await wallet.locator('body').evaluate(cancelNextEnrollmentSave);
  await page.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await wallet.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await enrollBrowserMicrophone(page);
  await expect(status).toHaveAttribute('data-state', 'failed', { timeout: 60_000 });
  await expect(page.getByTestId('live-voiceid-method')).toHaveText(
    'Select Activate VoiceID to finish setup',
  );

  await page.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await wallet.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await enrollBrowserMicrophone(page);
  await expect(status).toHaveText('VoiceID activated. Lock the wallet, then unlock with VoiceID.');
  await page.getByRole('button', { name: 'Lock wallet', exact: true }).click();
  await expect(page.getByTestId('live-voiceid-auth')).toHaveText('locked');
  await page.getByRole('button', { name: 'Unlock with VoiceID', exact: true }).click();
  await wallet.getByRole('button', { name: 'Unlock with VoiceID', exact: true }).click();
  await expect(page.getByTestId('live-voiceid-auth')).toHaveText('voiceid');
  const evidence = new VoiceIdNearSigningEvidence(
    process.env.SEAMS_INTENDED_ROUTER_URL || 'http://127.0.0.1:4100',
    identity,
    'available',
  );
  await evidence.observe(context);
  await startReviewedTransfer(page);
  const otherSpeaker = await readFile(
    path.resolve(import.meta.dirname, '../../fixtures/audio/voiceid-other.wav'),
  );
  await wallet.locator('body').evaluate(useOtherSpeaker, otherSpeaker.toString('base64'));
  const beforeMismatch = evidence.snapshot();
  await wallet.locator('button.confirm').click();
  await expect(
    wallet.getByText('VoiceID did not match the enrolled voice.', { exact: false }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(wallet.locator('button.confirm')).toBeEnabled();
  expect(evidence.snapshot()).toEqual(beforeMismatch);
  const mismatchCapture = await wallet.locator('body').getAttribute('data-voice-verification');
  if (mismatchCapture === null) throw new Error('Voice verification measurement is missing');
  const mismatch = JSON.parse(mismatchCapture);
  expect(mismatch.similarity).toBeLessThan(mismatch.threshold);
  await wallet.locator('button.confirm').click();
  await expect(page.getByTestId('reviewed-near-result')).toHaveAttribute(
    'data-state',
    'submitted',
    {
      timeout: 60_000,
    },
  );
  expect(evidence.transfers).toHaveLength(1);
  const budget = await harness.readCurrentWalletSessionStatus();
  expect(budget.status).toBe('active');
  expect(budget.remainingUses).toBe(2);
  expect(assets.native).toHaveLength(0);
  expect(assets.inference.length).toBeGreaterThan(0);
  const report = testInfo.outputPath('voiceid-live-page.json');
  await writeFile(
    report,
    JSON.stringify(
      {
        status: 'passed',
        initialRequestedId: initialId,
        sdkAllocatedWalletId: walletId,
        defaultAllocationUsed: true,
        pageUrlRetainsAllocatedId: true,
        setupRequiredBeforeUnlock: true,
        ownerLockBeforeActivationRecovered: true,
        nativeHost: 'none',
        nativeRequests: assets.native,
        inferenceLoadedOnlyAfterActivation: true,
        mismatchCapture: mismatch,
        mismatchPreventsSigning: true,
        explicitRetrySignsSameReview: true,
        cancellationStopsMicrophone: true,
        cancellationAbortsEnrollmentCommit: true,
        inferenceAssets: assets.inference,
        microphone: 'synthetic_wav_through_browser_mediarecorder',
        keychainUsed: false,
        speakerInference: 'real_ecapa_onnx_webassembly',
        authentication: 'voiceid',
        remainingUses: budget.remainingUses,
        signing: 'real_ed25519_yao_mpc',
        chain: 'deterministic_near_rpc',
        identity,
        transfers: evidence.transfers,
      },
      null,
      2,
    ),
  );
  await testInfo.attach('voiceid-live-page.json', {
    path: report,
    contentType: 'application/json',
  });
}

class VoiceAssetRequests {
  readonly inference: string[] = [];
  readonly native: string[] = [];
  readonly observe = (request: Request): void => {
    const url = new URL(request.url());
    if (url.port === '4318') this.native.push(url.pathname);
    if (url.pathname.includes('ort-wasm') || url.pathname.endsWith('ecapa.onnx')) {
      this.inference.push(url.pathname);
    }
  };
}

function microphoneStates(): MediaStreamTrackState[] {
  return window.voiceIdMicrophoneStates();
}

function cancelNextEnrollmentSave(): void {
  window.voiceIdCancelNextEnrollmentSave();
}

function useOtherSpeaker(_element: Element, base64: string): void {
  window.voiceIdNextAudio(base64);
}
