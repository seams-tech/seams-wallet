import { expect } from '@playwright/test';
import { intendedTest as test } from './harness';
import { allowBrowserMicrophone, voiceIdBrowserAudio } from './voiceid-browser-audio';
import { VoiceIdNearSigningEvidence } from './voiceid-near-signing';
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

test('VoiceID availability does not load voice assets for Email OTP signing', async ({
  harness,
  page,
  context,
}, testInfo) => {
  const downloads = new VoiceDownloads(await voiceEntryName());
  context.on('request', downloads.observe);
  await allowBrowserMicrophone(context);
  harness.enableVoiceIdPlugin();
  await harness.registerEmailOtpEd25519OnlyWallet();
  await harness.awaitNearReady();
  const owner = await page.evaluate(session);
  if (
    owner.appIdentity.kind !== 'resolved' ||
    !owner.appIdentity.nearAccountId ||
    !owner.appIdentity.nearOperationalPublicKey
  ) {
    throw new Error('Email wallet NEAR identity is unavailable');
  }
  const identity = {
    walletId: owner.appIdentity.walletId,
    accountId: owner.appIdentity.nearAccountId,
    publicKey: owner.appIdentity.nearOperationalPublicKey,
  };
  const evidence = new VoiceIdNearSigningEvidence(
    process.env.SEAMS_INTENDED_ROUTER_URL || 'http://127.0.0.1:4100',
    identity,
    'available',
  );
  await evidence.observe(context);
  expect((await page.evaluate(session)).authentication).toMatchObject({
    kind: 'authenticated',
    authMethod: 'email_otp',
  });
  await signTransfer(page);
  expect(downloads.requests).toEqual([]);
  expect(
    await page
      .frameLocator('iframe.seams-wallet-overlay-iframe')
      .locator('body')
      .evaluate(microphoneCount),
  ).toBe(0);
  expect(evidence.transfers).toHaveLength(1);
  await saveEvidence(testInfo, 'voiceid-email-selection.json', {
    status: 'passed',
    downloads: downloads.requests,
    microphoneCaptures: 0,
    authentication: 'email_otp',
    transfers: evidence.transfers,
    chain: 'deterministic_near_rpc',
    signing: 'real_ed25519_yao_mpc',
  });
});
