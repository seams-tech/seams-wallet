import { expect, type Page } from '@playwright/test';
import { intendedTest as test } from './harness';
import {
  allowBrowserMicrophone,
  voiceIdBrowserAudio,
  enrollBrowserMicrophone,
} from './voiceid-browser-audio';
import { readNearIdentity, VoiceIdNearSigningEvidence } from './voiceid-near-signing';
import {
  VoiceDownloads,
  voiceEntryName,
  signTransfer,
  microphoneCount,
  session,
  saveEvidence,
} from './voiceid-selection';

test.use({ ...voiceIdBrowserAudio, video: 'off', trace: 'off' });
test.setTimeout(180_000);

test('VoiceID availability preserves passkey signing and follows explicit session selection', async ({
  harness,
  page,
  context,
}, testInfo) => {
  const downloads = new VoiceDownloads(await voiceEntryName());
  context.on('request', downloads.observe);
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

  await signTransfer(page);
  expect(downloads.requests).toEqual([]);
  expect(await wallet.locator('body').evaluate(microphoneCount)).toBe(0);

  const activation = page.evaluate(activate);
  await wallet.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await wallet.locator('body').evaluate(useNaturalPhrases);
  await enrollBrowserMicrophone(page);
  await activation;
  expect(downloads.requests).toContain(`/sdk/${downloads.entryName}`);
  expect(downloads.requests.some(isSpeakerModel)).toBe(true);
  expect(downloads.requests.some(isPhraseModel)).toBe(true);
  expect((await page.evaluate(session)).authentication).toMatchObject({
    kind: 'authenticated',
    authMethod: 'passkey',
  });
  const enrolledCaptureCount = await wallet.locator('body').evaluate(microphoneCount);
  await signTransfer(page);
  expect(await wallet.locator('body').evaluate(microphoneCount)).toBe(enrolledCaptureCount);

  await harness.lockWallet();
  await page.getByTestId('asset-open-auth-menu').click();
  await wallet.locator('[data-auth-menu-voiceid]').click();
  const dialog = wallet.getByRole('dialog', { name: 'Unlock with VoiceID', exact: true });
  await expect(dialog.locator('.seams-voiceid-prompt')).toHaveAttribute(
    'data-capture',
    'listening',
  );
  await expect(
    dialog.getByRole('button', { name: 'Unlock with VoiceID', exact: true }),
  ).toBeHidden();
  await expect(dialog.getByText('Secured by', { exact: true })).toBeVisible();
  await dialog.screenshot({
    path: testInfo.outputPath('voiceid-auto-listening.png'),
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(wallet.locator('.seams-auth-menu-surface')).toBeVisible();
  expect(await wallet.locator('body').evaluate(microphoneStates)).not.toContain('live');
  await wallet.locator('[data-auth-menu-voiceid]').click();
  await expect.poll(readSelectedMethod.bind(null, page)).toBe('voiceid');
  expect((await page.evaluate(session)).authentication).toMatchObject({
    kind: 'authenticated',
    authMethod: 'voiceid',
  });
  const unlockedCaptureCount = await wallet.locator('body').evaluate(microphoneCount);
  await signTransfer(page);
  expect(await wallet.locator('body').evaluate(microphoneCount)).toBe(unlockedCaptureCount + 1);

  const beforeOwnerUnlock = downloads.requests.length;
  await harness.unlockPasskeyWallet();
  expect((await page.evaluate(session)).authentication).toMatchObject({
    kind: 'authenticated',
    authMethod: 'passkey',
  });
  await signTransfer(page);
  expect(downloads.requests.slice(beforeOwnerUnlock)).toEqual([]);
  expect(await wallet.locator('body').evaluate(microphoneCount)).toBe(0);
  expect(evidence.transfers).toHaveLength(4);
  await saveEvidence(testInfo, 'voiceid-session-selection.json', {
    status: 'passed',
    cases: [
      'enabled_unenrolled_passkey_signs_without_voice_downloads',
      'enrollment_does_not_select_voice',
      'voice_unlock_selects_voice_approval',
      'first_click_starts_listening_with_back_and_footer',
      'back_stops_microphone_and_restores_menu',
      'fresh_passkey_unlock_skips_voice_even_when_enrolled',
    ],
    downloads: downloads.requests,
    voiceCaptureForVoiceSigning: true,
    coldPasskeyDownloadsAfterVoiceUse: 0,
    transfers: evidence.transfers,
    chain: 'deterministic_near_rpc',
    inference: 'real_browser_redimnet_b1_and_aurora',
    signing: 'real_ed25519_yao_mpc',
  });
});

function useNaturalPhrases(): void {
  window.voiceIdUseNaturalPhrases();
}
function isSpeakerModel(value: string): boolean {
  return value.endsWith('redimnet-b1.onnx');
}
function isPhraseModel(value: string): boolean {
  return value.endsWith('aurora-int8.onnx');
}
function activate() {
  if (!window.__seamsIntendedVoiceId) throw new Error('VoiceID helper is unavailable');
  return window.__seamsIntendedVoiceId.activate();
}

function microphoneStates(): MediaStreamTrackState[] {
  return window.voiceIdMicrophoneStates();
}
async function readSelectedMethod(page: Page): Promise<string> {
  const current = await page.evaluate(session);
  return current.authentication.kind === 'authenticated'
    ? current.authentication.authMethod
    : 'locked';
}
