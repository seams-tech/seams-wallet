import { expect, type Page } from '@playwright/test';
import { intendedTest as test, waitForWalletIframeConfirmationSettlement } from './harness';
import {
  allowBrowserMicrophone,
  enrollBrowserMicrophone,
  voiceIdBrowserAudio,
} from './voiceid-browser-audio';
import {
  readNearIdentity,
  VoiceIdNearSigningEvidence,
  startReviewedTransfer,
} from './voiceid-near-signing';
import { saveEvidence, session } from './voiceid-selection';

test.use({ ...voiceIdBrowserAudio, video: 'off', trace: 'off' });
test.setTimeout(180_000);
test('settings enrolls and toggles VoiceID, one-wallet menu unlocks, and voice confirms a transfer', async ({
  page,
  context,
  harness,
}, testInfo) => {
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
  await openSettings(page);
  const toggle = page.getByRole('switch', { name: 'Enable VoiceID in this browser' });
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await wallet.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await enrollBrowserMicrophone(page);
  await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });
  await page
    .locator('.seams-profile-button-morphable.open')
    .screenshot({ path: testInfo.outputPath('voiceid-settings-enabled.png') });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Close wallet settings', exact: true }).click();
  await harness.lockWallet();
  await page.getByTestId('asset-open-auth-menu').click();
  await expect(wallet.locator('[data-auth-menu-voiceid]')).toBeVisible({ timeout: 20_000 });
  await wallet.getByRole('button', { name: /Saved wallets/ }).click();
  await expect(
    wallet.locator('[role="option"][data-wallet-id="' + identity.walletId + '"]'),
  ).toHaveCount(1);
  await wallet.locator('[role="option"][data-wallet-id="' + identity.walletId + '"]').click();
  await expect(wallet.getByRole('listbox')).toBeHidden();
  await wallet
    .locator('.seams-auth-menu-surface')
    .screenshot({ path: testInfo.outputPath('voiceid-login-methods.png') });
  await wallet.locator('[data-auth-menu-voiceid]').click();
  const voiceDialog = wallet.getByRole('dialog', { name: 'Unlock with VoiceID', exact: true });
  await expect(voiceDialog).toBeVisible();
  await expect(wallet.locator('.seams-auth-menu-surface')).toBeHidden();
  await voiceDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(voiceDialog).toHaveCount(0);
  await expect(wallet.locator('.seams-auth-menu-surface')).toBeVisible();
  await wallet.locator('[data-auth-menu-voiceid]').click();
  await voiceDialog.getByRole('button', { name: 'Unlock with VoiceID', exact: true }).click();
  await expect.poll(readAuthentication.bind(null, page)).toBe('voiceid');
  await startReviewedTransfer(page);
  await expect(wallet.locator('button.confirm')).toHaveText('Confirm with VoiceID');
  await wallet.locator('button.confirm').click();
  await expect(wallet.locator('.seams-voiceid-prompt')).toHaveAttribute(
    'data-capture',
    'listening',
  );
  await wallet
    .locator('.seams-voiceid-prompt')
    .screenshot({ path: testInfo.outputPath('voiceid-signing.png') });
  await expect(page.getByTestId('reviewed-near-result')).toHaveAttribute(
    'data-state',
    'submitted',
    { timeout: 60_000 },
  );
  expect(evidence.transfers).toHaveLength(1);
  await waitForWalletIframeConfirmationSettlement(page);
  await openSettings(page);
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  const voiceMethodId = await page.evaluate(readVoiceMethodId);
  await toggle.click();
  await expect.poll(readAuthentication.bind(null, page)).toBe('locked');
  await expect(page.evaluate(attemptDisabledUnlock, voiceMethodId)).rejects.toThrow('turned off');
  const closeSettings = page.getByRole('button', { name: 'Close wallet settings', exact: true });
  if (await closeSettings.isVisible()) await closeSettings.click();
  await page.getByTestId('asset-open-auth-menu').click();
  await expect(wallet.locator('.seams-auth-menu-surface')).toBeVisible();
  await expect(wallet.locator('[data-auth-menu-voiceid]')).toHaveCount(0);
  await wallet.getByRole('button', { name: 'Unlock with passkey', exact: true }).click();
  await expect.poll(readAuthentication.bind(null, page)).toBe('passkey');
  await openSettings(page);
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Record voice again', exact: true }).click();
  await wallet.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await enrollBrowserMicrophone(page);
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(readVoiceMethodId)).toBe(voiceMethodId);
  await saveEvidence(testInfo, 'voiceid-ui-flows.json', {
    status: 'passed',
    settings: 'enroll_disable_reenable_and_lock_active_voice_session',
    login: 'one_wallet_with_method_choices_and_cancel_restores_menu',
    disabledSdkUnlockRejected: true,
    reenrollmentPreservedMethodId: true,
    signing: 'minimal_voice_prompt',
    transfers: evidence.transfers,
    chain: 'deterministic_near_rpc',
  });
});
async function openSettings(page: Page): Promise<void> {
  const menu = page.getByTestId('intended-account-menu');
  await menu.getByRole('button', { name: 'Show account menu', exact: true }).click();
  await menu.locator('[aria-haspopup="menu"]').click();
  await page.getByRole('button', { name: /Authentication methods/ }).click();
}
async function readAuthentication(page: Page): Promise<string> {
  const state = await page.evaluate(session);
  return state.authentication.kind === 'authenticated' ? state.authentication.authMethod : 'locked';
}

async function readVoiceMethodId(): Promise<string> {
  if (!window.__seamsIntendedVoiceId) throw new Error('VoiceID helper is unavailable');
  const value = await window.__seamsIntendedVoiceId.session();
  if (value.appIdentity.kind === 'resolved') {
    for (const method of value.appIdentity.authMethods)
      if (method.kind === 'voiceid') return method.walletAuthMethodId;
  }
  throw new Error('VoiceID method is unavailable');
}
function attemptDisabledUnlock(walletAuthMethodId: string) {
  if (!window.__seamsIntendedVoiceId) throw new Error('VoiceID helper is unavailable');
  return window.__seamsIntendedVoiceId.unlock(walletAuthMethodId);
}
