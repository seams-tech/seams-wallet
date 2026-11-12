import { expect, type Page, type Request } from '@playwright/test';
import { ActionType } from '@shared/near/actions';
import type {} from '../../intended-app/src/nearSigningHelpers';
import {
  autoConfirmWalletIframeUntil,
  intendedTest as test,
  waitForWalletIframeConfirmationSettlement,
} from './harness';
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
  await expect(dialog).toBeHidden();
  const unlockedCaptureCount = await wallet.locator('body').evaluate(microphoneCount);
  // A VoiceID session signs like a passkey session: messages, delegates and
  // transfers without a review, each with the confirm click and no voice check.
  const message = await autoConfirmWalletIframeUntil(
    page,
    page.evaluate(signMessage, identity.accountId),
  );
  expect(message).toMatchObject({ success: true, accountId: identity.accountId });
  await waitForWalletIframeConfirmationSettlement(page);
  const delegate: Parameters<NonNullable<Window['__seamsIntendedE2ESignDelegate']>>[0] = {
    senderId: identity.accountId,
    receiverId: 'receiver.testnet',
    actions: [{ type: ActionType.Transfer, amount: '1' }],
    nonce: '1',
    maxBlockHeight: '999999999',
    publicKey: identity.publicKey,
  };
  const delegated = await autoConfirmWalletIframeUntil(page, page.evaluate(signDelegate, delegate));
  expect(delegated.nearAccountId).toBe(identity.accountId);
  await waitForWalletIframeConfirmationSettlement(page);
  const sent = await autoConfirmWalletIframeUntil(
    page,
    page.evaluate(sendUnreviewedTransfer, identity.accountId),
  );
  expect(sent).toMatchObject({ success: true });
  await waitForWalletIframeConfirmationSettlement(page);
  // The test session allows three signatures; these three use it up.
  expect(evidence.transfers).toHaveLength(3);
  expect(await wallet.locator('body').evaluate(microphoneCount)).toBe(unlockedCaptureCount);

  // The next signature steps up with VoiceID inside its own confirm card, never with a
  // passkey: the card asks to confirm with VoiceID, the capture replaces the review in
  // the same card, and the signature follows without a second click.
  const passkeyUnlocks = new PasskeyUnlockRequests();
  context.on('request', passkeyUnlocks.observe);
  const steppedUp = page.evaluate(sendUnreviewedTransfer, identity.accountId);
  const card = wallet.locator('.seams-confirmation-surface');
  const confirmWithVoice = card.getByRole('button', { name: 'Confirm with VoiceID', exact: true });
  await expect(confirmWithVoice).toBeEnabled({ timeout: 45_000 });
  await wallet.locator('body').evaluate(watchUnlockSuccess);
  await expect(wallet.locator('.seams-voiceid-activation-surface')).toHaveCount(0);
  await confirmWithVoice.click();
  await expect(card.locator('.seams-auth-method-capture .seams-voiceid-prompt')).toBeVisible();
  await expect(wallet.locator('.seams-voiceid-unlock')).toHaveCount(0);
  const afterStepUp = await steppedUp;
  context.off('request', passkeyUnlocks.observe);
  expect(afterStepUp).toMatchObject({ success: true });
  await waitForWalletIframeConfirmationSettlement(page);
  expect(passkeyUnlocks.count).toBe(0);
  // A step-up returns to the operation; only a wallet unlock shows its success.
  expect(await wallet.locator('body').evaluate(sawUnlockSuccess)).toBe(false);
  expect(evidence.transfers).toHaveLength(4);
  expect(await wallet.locator('body').evaluate(microphoneCount)).toBe(unlockedCaptureCount + 1);
  expect((await page.evaluate(session)).authentication).toMatchObject({
    kind: 'authenticated',
    authMethod: 'voiceid',
  });

  const beforeOwnerUnlock = downloads.requests.length;
  await harness.unlockPasskeyWallet();
  expect((await page.evaluate(session)).authentication).toMatchObject({
    kind: 'authenticated',
    authMethod: 'passkey',
  });
  await signTransfer(page);
  expect(downloads.requests.slice(beforeOwnerUnlock)).toEqual([]);
  expect(await wallet.locator('body').evaluate(microphoneCount)).toBe(0);
  expect(evidence.transfers).toHaveLength(5);
  await saveEvidence(testInfo, 'voiceid-session-selection.json', {
    status: 'passed',
    cases: [
      'enabled_unenrolled_passkey_signs_without_voice_downloads',
      'enrollment_does_not_select_voice',
      'voice_unlock_selects_voice_approval',
      'first_click_starts_listening_with_back_and_footer',
      'back_stops_microphone_and_restores_menu',
      'voice_session_signs_message_delegate_and_unreviewed_transfer_without_capture',
      'used_up_voice_session_steps_up_with_voice_not_passkey',
      'fresh_passkey_unlock_skips_voice_even_when_enrolled',
    ],
    downloads: downloads.requests,
    voiceCaptureForVoiceSigning: false,
    coldPasskeyDownloadsAfterVoiceUse: 0,
    transfers: evidence.transfers,
    chain: 'deterministic_near_rpc',
    inference: 'real_browser_redimnet_b1_and_citrinet',
    signing: 'real_ed25519_yao_mpc',
  });
});

function watchUnlockSuccess(): void {
  const state = { seen: false };
  Reflect.set(window, '__seamsUnlockSuccessSeen', state);
  const observer = new MutationObserver(() => {
    if (document.body.textContent?.includes('You’re in')) state.seen = true;
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function sawUnlockSuccess(): boolean {
  const state = Reflect.get(window, '__seamsUnlockSuccessSeen') as { seen: boolean } | undefined;
  if (!state) throw new Error('The unlock success watcher is not installed.');
  return state.seen;
}

/** Counts passkey unlock requests; a VoiceID step-up must never make one. */
class PasskeyUnlockRequests {
  count = 0;
  readonly observe = (request: Request): void => {
    if (new URL(request.url()).pathname.startsWith('/wallet/unlock/')) this.count += 1;
  };
}

function useNaturalPhrases(): void {
  window.voiceIdUseNaturalPhrases();
}
function isSpeakerModel(value: string): boolean {
  return value.endsWith('redimnet-b1.onnx');
}
function isPhraseModel(value: string): boolean {
  return value.endsWith('citrinet-int8.onnx');
}
function activate() {
  if (!window.__seamsIntendedVoiceId) throw new Error('VoiceID helper is unavailable');
  return window.__seamsIntendedVoiceId.activate();
}

function signMessage(nearAccountId: string) {
  const sign = window.__seamsIntendedE2ESignMessage;
  if (!sign) throw new Error('The message-signing helper is unavailable');
  return sign({
    nearAccountId,
    params: { message: 'Check signing policy', recipient: 'wallet.example' },
  });
}

function signDelegate(
  delegate: Parameters<NonNullable<Window['__seamsIntendedE2ESignDelegate']>>[0],
) {
  const sign = window.__seamsIntendedE2ESignDelegate;
  if (!sign) throw new Error('The delegate-signing helper is unavailable');
  return sign(delegate);
}

function sendUnreviewedTransfer(accountId: string) {
  const send = window.__seamsIntendedE2ESendNear;
  if (!send) throw new Error('The transaction helper is unavailable');
  return send(accountId);
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
