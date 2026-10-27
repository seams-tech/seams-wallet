import { expect, type Request } from '@playwright/test';
import { intendedTest as test } from './harness';
import {
  allowBrowserMicrophone,
  enrollBrowserMicrophone,
  requireActivatedVoiceId,
  voiceIdBrowserAudio,
} from './voiceid-browser-audio';
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

class VoicePasskeyAdditionEvidence {
  emailChallenges = 0;
  unlockRequests = 0;

  observe(request: Request): void {
    if (request.method() !== 'POST') return;
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/auth-methods/email-otp/challenge')) this.emailChallenges += 1;
    if (pathname === '/wallet/unlock/verify') this.unlockRequests += 1;
  }
}

test('an Email-backed VoiceID session adds its first passkey with one fresh email proof', async ({
  harness,
  page,
  context,
}, testInfo) => {
  await allowBrowserMicrophone(context);
  harness.enableVoiceIdPlugin();
  await harness.registerEmailOtpWallet();
  await harness.awaitNearReady();
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  const activation = page.evaluate(activateVoice);
  await wallet.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await enrollBrowserMicrophone(page);
  const method = requireActivatedVoiceId(await activation);
  await harness.lockWallet();
  expect(await page.evaluate(unlockVoice, method.walletAuthMethodId)).toMatchObject({
    success: true,
  });
  const before = (await page.evaluate(session)).authentication;
  expect(before).toMatchObject({ kind: 'authenticated', authMethod: 'voiceid' });
  const evidence = new VoicePasskeyAdditionEvidence();
  const observe = evidence.observe.bind(evidence);
  context.on('request', observe);
  try {
    await harness.addPasskeyAuthMethod({ loseFinalizeResponseOnce: true });
    expect(evidence.emailChallenges).toBe(1);
    expect(evidence.unlockRequests).toBe(0);
    expect((await page.evaluate(session)).authentication).toEqual(before);
    await harness.assertRepeatAdditionIsAlreadyConfigured('addPasskeyAuthMethod');
    expect(evidence.emailChallenges).toBe(1);
  } finally {
    context.off('request', observe);
  }
  await harness.assertLockedPageReloadStaysLocked();
  await harness.unlockWithAddedPasskey();
  await harness.signTempoTransaction('post_unlock');
  await harness.signNearTransaction('post_unlock');
  await saveEvidence(testInfo, 'voiceid-first-passkey.json', {
    status: 'passed',
    walletId: method.walletId,
    source: 'email_otp',
    selectedSession: 'voiceid',
    emailChallenges: evidence.emailChallenges,
    additionalUnlockRequests: evidence.unlockRequests,
    selectedSessionPreserved: true,
    lostFinalizeResponseRecovered: true,
    addedPasskeyUnlockedAfterReload: true,
    signedWithAddedPasskey: ['near', 'tempo'],
  });
});

function activateVoice() {
  if (!window.__seamsIntendedVoiceId) throw new Error('Missing VoiceID helper');
  return window.__seamsIntendedVoiceId.activate();
}
function unlockVoice(methodId: string) {
  if (!window.__seamsIntendedVoiceId) throw new Error('Missing VoiceID helper');
  return window.__seamsIntendedVoiceId.unlock(methodId);
}
