import {
  expect,
  type Page,
  type BrowserContext,
  type TestInfo,
  type Route,
} from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import phrases from '../../fixtures/audio/aurora/phrases.json' with { type: 'json' };
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';
import {
  voiceIdBrowserAudio,
  allowBrowserMicrophone,
  enrollBrowserMicrophone,
} from './voiceid-browser-audio';
import {
  readNearIdentity,
  startReviewedTransfer,
  VoiceIdNearSigningEvidence,
} from './voiceid-near-signing';
import type {} from '../../fixtures/ui/VoiceIdMicrophoneObservation';
import type {} from '../../intended-app/src/voiceIdHelpers';

test.use({ ...voiceIdBrowserAudio, video: 'off', trace: 'off' });
test.setTimeout(150_000);
test('noise alone cannot unlock; speech over steady noise unlocks and signs', verifyNoise);

async function verifyNoise(
  {
    page,
    context,
    harness,
  }: { page: Page; context: BrowserContext; harness: IntendedBehaviourHarness },
  testInfo: TestInfo,
): Promise<void> {
  await allowBrowserMicrophone(context);
  harness.enableVoiceIdPlugin();
  await harness.registerPasskeyEd25519YaoWallet();
  const identity = await readNearIdentity(page);
  const evidence = new VoiceIdNearSigningEvidence(
    process.env.SEAMS_INTENDED_ROUTER_URL || 'http://127.0.0.1:4100',
    identity,
    'available',
  );
  await evidence.observe(context);
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  const activation = page.evaluate(activate);
  await wallet.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await enrollBrowserMicrophone(page);
  const method = await activation;
  await harness.lockWallet();
  await wallet.locator('body').evaluate(holdNextWorklet);
  const cancelledUnlock = page
    .evaluate(unlock, method.walletAuthMethodId)
    .then(unexpectedUnlock, cancelledUnlockResult);
  await wallet.getByRole('button', { name: 'Unlock with VoiceID', exact: true }).click();
  await expect(wallet.locator('body')).toHaveAttribute('data-voice-test-worklet', 'waiting');
  await wallet.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await cancelledUnlock).toContain('cancelled');
  expect(await wallet.locator('body').evaluate(microphoneStates)).not.toContain('live');
  await wallet.locator('body').evaluate(releaseHeldWorklet);
  const unlocked = page.evaluate(unlock, method.walletAuthMethodId);
  const noise = await readFile(
    path.resolve(import.meta.dirname, '../../fixtures/audio/voiceid-noise/noise.wav'),
  );
  await wallet.locator('body').evaluate(injectAudio, noise.toString('base64'));
  await wallet.getByRole('button', { name: 'Unlock with VoiceID', exact: true }).click();
  await expect(wallet.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled({
    timeout: 20_000,
  });
  expect((await page.evaluate(session)).authentication.kind).toBe('signed_out');
  await expect(wallet.getByText('Background noise is high.', { exact: false })).toBeVisible();
  const noiseQuality = await wallet
    .locator('[data-voice-capture-quality]')
    .getAttribute('data-voice-capture-quality');
  if (!noiseQuality) throw new Error('Noise measurement missing');
  expect(JSON.parse(noiseQuality)).toMatchObject({ voicedMs: 0, noise: 'high', endedBy: 'limit' });
  await wallet
    .locator('.seams-voiceid-prompt')
    .screenshot({ path: testInfo.outputPath('noise-guidance.png') });
  const phrase = await wallet.locator('[data-voiceid-phrase]').getAttribute('data-voiceid-phrase');
  const index = phrases.indexOf(phrase ?? '');
  if (index < 0) throw new Error('Phrase unavailable');
  const mixture = await readFile(
    path.resolve(import.meta.dirname, `../../fixtures/audio/voiceid-noise/${index}.wav`),
  );
  await wallet.locator('body').evaluate(injectAudio, mixture.toString('base64'));
  await wallet.getByRole('button', { name: 'Try again', exact: true }).click();
  await unlocked;
  expect((await page.evaluate(session)).authentication).toMatchObject({
    kind: 'authenticated',
    authMethod: 'voiceid',
  });
  const measurement = await wallet.locator('body').getAttribute('data-voice-verification');
  if (!measurement) throw new Error('Speech measurement missing');
  const speech = JSON.parse(measurement);
  expect(speech.endedBy).toBe('pause');
  expect(speech.recordingMs).toBeLessThan(6500);
  expect(speech.threshold).toBe(0.5);
  await context.route(/\/voiceid-test-audio\/\d+\.wav$/, serveNoisyPhrase);
  await startReviewedTransfer(page);
  await wallet.locator('button.confirm').click();
  await expect(page.getByTestId('reviewed-near-result')).toHaveAttribute(
    'data-state',
    'submitted',
    { timeout: 60_000 },
  );
  expect(evidence.transfers).toHaveLength(1);
  await context.unroute(/\/voiceid-test-audio\/\d+\.wav$/, serveNoisyPhrase);
  await writeFile(
    testInfo.outputPath('noise-capture.json'),
    JSON.stringify(
      {
        status: 'passed',
        startupCancellationStopsMicrophone: true,
        noise: JSON.parse(noiseQuality),
        speech,
        transfers: evidence.transfers,
        chain: 'deterministic_near_rpc',
      },
      null,
      2,
    ),
  );
}
function activate() {
  if (!window.__seamsIntendedVoiceId) throw new Error('VoiceID unavailable');
  return window.__seamsIntendedVoiceId.activate();
}
function unlock(method: string) {
  if (!window.__seamsIntendedVoiceId) throw new Error('VoiceID unavailable');
  return window.__seamsIntendedVoiceId.unlock(method);
}
function session() {
  if (!window.__seamsIntendedVoiceId) throw new Error('VoiceID unavailable');
  return window.__seamsIntendedVoiceId.session();
}
function injectAudio(_: HTMLElement, audio: string): void {
  window.voiceIdNextAudio(audio);
}

async function serveNoisyPhrase(route: Route): Promise<void> {
  const index = new URL(route.request().url()).pathname.match(/\/(\d+)\.wav$/)?.[1];
  if (index === undefined || Number(index) >= 16) throw new Error('Unknown noise fixture');
  const body = await readFile(
    path.resolve(import.meta.dirname, `../../fixtures/audio/voiceid-noise/${index}.wav`),
  );
  await route.fulfill({ contentType: 'audio/wav', body });
}

function microphoneStates(): MediaStreamTrackState[] {
  return window.voiceIdMicrophoneStates();
}
function unexpectedUnlock(): string {
  throw new Error('Cancelled recording unlocked the wallet');
}
function cancelledUnlockResult(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function holdNextWorklet(): void {
  window.voiceIdHoldNextWorklet();
}
function releaseHeldWorklet(): void {
  window.voiceIdReleaseWorklet();
}
