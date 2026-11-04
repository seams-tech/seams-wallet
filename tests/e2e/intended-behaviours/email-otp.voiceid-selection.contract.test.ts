import { expect, type Request } from '@playwright/test';
import { intendedTest as test } from './harness';
import {
  allowBrowserMicrophone,
  enrollBrowserMicrophone,
  requireActivatedVoiceId,
  voiceIdBrowserAudio,
} from './voiceid-browser-audio';
import { beginDirectVoiceUnlock, session, saveEvidence } from './voiceid-selection';

test.use({ ...voiceIdBrowserAudio, video: 'off', trace: 'off' });
test.setTimeout(180_000);

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
  const unlockOperation = page.evaluate(unlockVoice, method.walletAuthMethodId);
  await beginDirectVoiceUnlock(page);
  expect(await unlockOperation).toMatchObject({
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
