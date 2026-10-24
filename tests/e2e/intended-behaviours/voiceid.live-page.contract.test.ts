import phrases from '../../fixtures/audio/aurora/phrases.json' with { type: 'json' };
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
  type Route,
} from '@playwright/test';
import { WorkerDeferred } from '@/core/signingEngine/workerManager/workerDeferred';
import { base58Encode } from '@shared/utils/base58';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';
import { startReviewedTransfer, VoiceIdNearSigningEvidence } from './voiceid-near-signing';

test('manual VoiceID page allocates its wallet and signs after voice unlock', verifyLivePage);
test.use(voiceIdBrowserAudio);
test.use({ video: 'off', trace: 'off', screenshot: 'off' });
test.setTimeout(240_000);

async function verifyLivePage(
  {
    page,
    context,
    harness,
  }: { page: Page; context: BrowserContext; harness: IntendedBehaviourHarness },
  testInfo: TestInfo,
): Promise<void> {
  await allowBrowserMicrophone(context);
  const download = new ModelDownloadGate();
  await context.route('**/sdk/voiceid/redimnet-b1.onnx', download.hold);
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
  expect(assets.inference).toHaveLength(0);
  await page.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await wallet.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await expect(wallet.getByRole('progressbar', { name: 'VoiceID model download' })).toBeVisible();
  await expect(wallet.locator('.seams-voiceid-model-download')).toHaveAttribute('data-state', 'downloading');
  download.release();
  await wallet.getByRole('button', { name: 'Record sample 1', exact: true }).click();
  await expect
    .poll(wallet.locator('body').evaluate.bind(wallet.locator('body'), microphoneStates))
    .toContain('live');
  await wallet.getByRole('button', { name: 'Cancel enrollment', exact: true }).click();
  await expect(status).toHaveAttribute('data-state', 'failed');
  expect(await wallet.locator('body').evaluate(microphoneStates)).not.toContain('live');
  expect(assets.models).toBe(1);
  expect(assets.phraseModels).toBe(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Unlock with passkey', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Unlock with passkey', exact: true }).click();
  await expect(page.getByTestId('live-voiceid-auth')).toHaveText('passkey');
  await wallet.locator('body').evaluate(cancelNextEnrollmentSave);
  await page.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await wallet.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await enrollBrowserMicrophone(page);
  await expect(status).toHaveAttribute('data-state', 'failed', { timeout: 60_000 });
  await expect(page.getByTestId('live-voiceid-method')).toHaveText(
    'Select Activate VoiceID to finish setup',
  );

  await wallet.locator('body').evaluate(retireNextEnrollmentModel);
  await page.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await wallet.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await expect(wallet.getByRole('button', { name: 'Record sample 1', exact: true })).toBeEnabled();
  const enrollmentPhrase = await wallet.locator('[data-voiceid-phrase]').innerText();
  const wrongEnrollmentIndex = (phrases.indexOf(enrollmentPhrase) + 1) % phrases.length;
  const wrongEnrollment = await readFile(path.resolve(import.meta.dirname, `../../fixtures/audio/aurora/${wrongEnrollmentIndex}.wav`));
  await wallet.locator('body').evaluate(useOtherSpeaker, wrongEnrollment.toString('base64'));
  await wallet.getByRole('button', { name: 'Record sample 1', exact: true }).click();
  await expect(wallet.getByText('The words did not match.', { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(wallet.getByRole('button', { name: 'Record sample 1', exact: true })).toBeEnabled();
  await expect(wallet.locator('[data-voiceid-phrase]')).not.toHaveText(enrollmentPhrase);
  expect(assets.activations).toBe(0);
  await enrollBrowserMicrophone(page);
  await expect(status).toHaveText('VoiceID activated. Lock the wallet, then unlock with VoiceID.');
  expect(assets.activations).toBe(1);
  await page.getByRole('button', { name: 'Lock wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Unlock with VoiceID', exact: true }).click();
  await expect(status).toContainText('Enroll voice again');
  await expect(page.getByTestId('live-voiceid-auth')).toHaveText('locked');
  await expect(page.getByRole('button', { name: 'Enroll voice again', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Unlock with passkey', exact: true }).click();
  await expect(page.getByTestId('live-voiceid-auth')).toHaveText('passkey');
  await page.getByRole('button', { name: 'Enroll voice again', exact: true }).click();
  await wallet.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await enrollBrowserMicrophone(page);
  await expect(status).toHaveText('VoiceID activated. Lock the wallet, then unlock with VoiceID.');
  expect(assets.activations).toBe(1);
  expect(assets.models).toBe(1);
  expect(assets.phraseModels).toBe(1);
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
  const originalPrompt = await wallet.locator('.seams-voiceid-instructions').innerText();
  const originalPhrase = originalPrompt.match(/“([^”]+)”/)?.[1];
  if (!originalPhrase || !phrases.includes(originalPhrase)) throw new Error('Review phrase is unavailable');
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
  const stalePhrase = await readFile(path.resolve(import.meta.dirname, `../../fixtures/audio/aurora/${phrases.indexOf(originalPhrase)}.wav`));
  await wallet.locator('body').evaluate(useOtherSpeaker, stalePhrase.toString('base64'));
  await wallet.locator('button.confirm').click();
  await expect(wallet.getByText('The spoken words did not match.', { exact: false })).toBeVisible({ timeout: 20_000 });
  expect(evidence.snapshot()).toEqual(beforeMismatch);
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
        modelDownloadProgressVisible: true,
        modelFetchedOnceAcrossReload: true,
        phraseModelFetchedOnceAcrossReload: true,
        incorrectEnrollmentPhraseRejected: true,
        previousAttemptPhraseRejectedBeforeSigning: true,
        phraseRecognition: 'real_aurora_int8_constrained_ctc',
        ownerReenrollmentReusesDeviceCredential: true,
        mismatchCapture: mismatch,
        mismatchPreventsSigning: true,
        explicitRetrySignsSameReview: true,
        cancellationStopsMicrophone: true,
        cancellationAbortsEnrollmentCommit: true,
        inferenceAssets: assets.inference,
        microphone: 'synthetic_wav_through_browser_mediarecorder',
        keychainUsed: false,
        speakerInference: 'real_redimnet_b1_onnx_webassembly',
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
  models = 0;
  phraseModels = 0;
  activations = 0;
  readonly observe = (request: Request): void => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('aurora-int8.onnx')) this.phraseModels += 1;
    if (url.pathname.endsWith('redimnet-b1.onnx')) this.models += 1;
    if (url.pathname === '/wallet/voiceid/activate' && request.method() === 'POST') this.activations += 1;
    if (url.port === '4318') this.native.push(url.pathname);
    if (url.pathname.includes('ort-wasm') || url.pathname.endsWith('redimnet-b1.onnx') ||
        url.pathname.endsWith('aurora-int8.onnx')) {
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

function retireNextEnrollmentModel(): void {
  window.voiceIdRetireNextEnrollmentModel();
}

class ModelDownloadGate {
  private readonly pending = new WorkerDeferred<void>();
  readonly hold = async (route: Route): Promise<void> => {
    await this.pending.promise;
    await route.continue();
  };
  release(): void {
    this.pending.resolve();
  }
}
