import { expect } from '@playwright/test';
import { intendedTest as test } from './harness';
import {
  allowBrowserMicrophone,
  enrollBrowserMicrophone,
  requireActivatedVoiceId,
  voiceIdBrowserAudio,
} from './voiceid-browser-audio';
import { session, saveEvidence } from './voiceid-selection';

test.use({ ...voiceIdBrowserAudio, video: 'off', trace: 'off' });
test.setTimeout(180_000);

test('a VoiceID session adds Email OTP with one action-level passkey proof', async ({
  harness,
  page,
  context,
}, testInfo) => {
  await allowBrowserMicrophone(context);
  harness.enableVoiceIdPlugin();
  await harness.registerPasskeyWallet();
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  const activation = page.evaluate(activate);
  await wallet.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await enrollBrowserMicrophone(page);
  const method = requireActivatedVoiceId(await activation);
  await harness.lockWallet();
  expect(await page.evaluate(unlock, method.walletAuthMethodId)).toMatchObject({ success: true });
  const before = (await page.evaluate(session)).authentication;
  expect(before).toMatchObject({ kind: 'authenticated', authMethod: 'voiceid' });
  const requestsBefore = await wallet.locator('body').evaluate(readPasskeyRequests);
  await harness.addEmailOtpAuthMethod({ loseFinalizeResponseOnce: true });
  const requestsAfter = await wallet.locator('body').evaluate(readPasskeyRequests);
  expect(requestsAfter).toBe(requestsBefore + 1);
  expect((await page.evaluate(session)).authentication).toEqual(before);
  await harness.assertRepeatAdditionIsAlreadyConfigured('addEmailOtpAuthMethod');
  await harness.lockWallet();
  await harness.unlockWithAddedEmailOtp();
  expect((await page.evaluate(session)).authentication).toMatchObject({
    kind: 'authenticated',
    authMethod: 'email_otp',
  });
  await saveEvidence(testInfo, 'voiceid-action-level-addition.json', {
    walletId: method.walletId,
    actionPasskeyPrompts: requestsAfter - requestsBefore,
    selectedVoiceSessionPreserved: true,
    lostFinalizeResponseRecovered: true,
    repeatAdditionRejected: true,
    addedEmailUnlockSucceeded: true,
  });
});

function activate() {
  if (!window.__seamsIntendedVoiceId) throw new Error('Missing VoiceID helper');
  return window.__seamsIntendedVoiceId.activate();
}
function unlock(id: string) {
  if (!window.__seamsIntendedVoiceId) throw new Error('Missing VoiceID helper');
  return window.__seamsIntendedVoiceId.unlock(id);
}
function readPasskeyRequests(): number {
  return window.voiceIdPasskeyRequests();
}
