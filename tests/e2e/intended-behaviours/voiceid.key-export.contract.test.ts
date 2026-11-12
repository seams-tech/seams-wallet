import { expect, type Page, type Response } from '@playwright/test';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';
import {
  allowBrowserMicrophone,
  enrollBrowserMicrophone,
  requireActivatedVoiceId,
  voiceIdBrowserAudio,
} from './voiceid-browser-audio';
import { beginDirectVoiceUnlock, microphoneCount, session } from './voiceid-selection';
import type {} from '../../fixtures/ui/VoiceIdMicrophoneObservation';
import type {} from '../../intended-app/src/voiceIdHelpers';

test.use({ ...voiceIdBrowserAudio, video: 'off', trace: 'off' });
test.setTimeout(240_000);

const EXPORTS = [
  {
    curve: 'ed25519',
    register: (harness: IntendedBehaviourHarness) => harness.registerPasskeyEd25519YaoWallet(),
    button: 'intended-export-ed25519',
    action: 'exportEd25519Key',
    authorization: isEd25519ExportAdmission,
  },
  {
    curve: 'ecdsa',
    register: (harness: IntendedBehaviourHarness) => harness.registerPasskeyEcdsaOnlyWallet(),
    button: 'intended-export-ecdsa',
    action: 'exportEcdsaKey',
    authorization: isEcdsaExportStepUp,
  },
] as const;

for (const exported of EXPORTS) {
  test(`VoiceID exports the ${exported.curve} key after a fresh voice check`, async ({
    harness,
    page,
    context,
  }) => {
    await allowBrowserMicrophone(context);
    harness.enableVoiceIdPlugin();
    await exported.register(harness);
    const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
    const activation = page.evaluate(activate);
    await wallet.locator('body').evaluate(useNaturalPhrases);
    await enrollBrowserMicrophone(page);
    const method = requireActivatedVoiceId(await activation);
    await harness.lockWallet();
    const unlocked = page.evaluate(unlock, method.walletAuthMethodId);
    await beginDirectVoiceUnlock(page);
    expect(await unlocked).toMatchObject({ success: true, walletId: method.walletId });
    expect((await page.evaluate(session)).authentication).toMatchObject({
      kind: 'authenticated',
      authMethod: 'voiceid',
    });

    // The unlocked VoiceID session is not enough: export asks for one more voice check.
    const capturesBefore = await wallet.locator('body').evaluate(microphoneCount);
    const passkeysBefore = await wallet.locator('body').evaluate(readPasskeyRequests);
    const authorization = page.waitForResponse(exported.authorization, { timeout: 120_000 });
    await page.getByTestId(exported.button).click();
    const voiceCheck = wallet.getByRole('dialog', { name: 'Export keys with VoiceID' });
    await expect(voiceCheck).toBeVisible({ timeout: 15_000 });
    const exportButton = wallet.getByRole('button', {
      name: 'Export keys with VoiceID',
      exact: true,
    });
    await expect(exportButton).toBeEnabled({ timeout: 45_000 });
    await exportButton.click();
    const authorized = await authorization;
    expect(authorized.status()).toBe(200);
    await expect(voiceCheck).toHaveCount(0, { timeout: 30_000 });
    await waitForAction(page, exported.action);
    await expect(wallet.getByRole('button', { name: 'Close' }).first()).toBeVisible();
    expect(await wallet.locator('body').evaluate(microphoneCount)).toBe(capturesBefore + 1);
    expect(await wallet.locator('body').evaluate(readPasskeyRequests)).toBe(passkeysBefore);
    const body = await authorized.json();
    if (exported.curve === 'ed25519') {
      // The admission releases the VoiceID seed envelope only after the voice check.
      expect(body).toHaveProperty('voiceIdCustodyEnvelope.factor.kind', 'voiceid');
    } else {
      expect(body).toMatchObject({ authorization: { unseal: { kind: 'not_requested' } } });
    }
    await wallet.getByRole('button', { name: 'Close' }).first().click();
  });
}

test('an interrupted VoiceID Ed25519 admission returns its envelope to the exact retry', async ({
  harness,
  page,
  context,
}) => {
  await allowBrowserMicrophone(context);
  harness.enableVoiceIdPlugin();
  await harness.registerPasskeyEd25519YaoWallet();
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  const activation = page.evaluate(activate);
  await wallet.locator('body').evaluate(useNaturalPhrases);
  await enrollBrowserMicrophone(page);
  const method = requireActivatedVoiceId(await activation);
  await harness.lockWallet();
  const unlocked = page.evaluate(unlock, method.walletAuthMethodId);
  await beginDirectVoiceUnlock(page);
  expect(await unlocked).toMatchObject({ success: true });
  // The Gateway loses storage after the export authorization commits, then
  // answers the identical request from that authorization.
  const assertRetriedAdmission = harness.armInterruptedEd25519ExportAuthorization();
  const passkeysBefore = await wallet.locator('body').evaluate(readPasskeyRequests);
  const authorization = page.waitForResponse(isEd25519ExportAdmission, { timeout: 120_000 });
  await page.getByTestId('intended-export-ed25519').click();
  const exportButton = wallet.getByRole('button', {
    name: 'Export keys with VoiceID',
    exact: true,
  });
  await expect(exportButton).toBeEnabled({ timeout: 45_000 });
  await exportButton.click();
  const authorized = await authorization;
  expect(authorized.status()).toBe(200);
  expect(await authorized.json()).toHaveProperty('voiceIdCustodyEnvelope.factor.kind', 'voiceid');
  await waitForAction(page, 'exportEd25519Key');
  await expect(page.getByTestId('intended-result-json')).toContainText('key_export.viewer.opened');
  assertRetriedAdmission();
  expect(await wallet.locator('body').evaluate(readPasskeyRequests)).toBe(passkeysBefore);
  await wallet.getByRole('button', { name: 'Close' }).first().click();
});

test('cancelling the VoiceID export check exports nothing', async ({
  harness,
  page,
  context,
}) => {
  await allowBrowserMicrophone(context);
  harness.enableVoiceIdPlugin();
  await harness.registerPasskeyEd25519YaoWallet();
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  const activation = page.evaluate(activate);
  await wallet.locator('body').evaluate(useNaturalPhrases);
  await enrollBrowserMicrophone(page);
  const method = requireActivatedVoiceId(await activation);
  await harness.lockWallet();
  const unlocked = page.evaluate(unlock, method.walletAuthMethodId);
  await beginDirectVoiceUnlock(page);
  expect(await unlocked).toMatchObject({ success: true });
  const admissions: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/export/admit')) admissions.push(request.url());
  });
  const passkeysBefore = await wallet.locator('body').evaluate(readPasskeyRequests);
  await page.getByTestId('intended-export-ed25519').click();
  const voiceCheck = wallet.getByRole('dialog', { name: 'Export keys with VoiceID' });
  await expect(voiceCheck).toBeVisible({ timeout: 15_000 });
  await voiceCheck.getByRole('button', { name: 'Cancel' }).click();
  await expect(voiceCheck).toHaveCount(0);
  // Key export reports its outcome as lifecycle events; the cancel is a failed export.
  const result = page.getByTestId('intended-result-json');
  await expect(result).toContainText('key_export.failed', { timeout: 30_000 });
  await expect(result).toContainText('VoiceID capture was cancelled.');
  await expect(result).not.toContainText('key_export.viewer.opened');
  expect(admissions).toHaveLength(0);
  expect(await wallet.locator('body').evaluate(readPasskeyRequests)).toBe(passkeysBefore);
});

async function waitForAction(page: Page, action: string): Promise<void> {
  const status = page.getByTestId('intended-action-status');
  await expect(status).toHaveAttribute('data-action', action);
  await expect(status).toHaveAttribute('data-state', /success|error/, { timeout: 120_000 });
  await expect(status).toHaveAttribute('data-state', 'success');
}

function isEd25519ExportAdmission(response: Response): boolean {
  return (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/router-ab/ed25519/yao/export/admit'
  );
}

function isEcdsaExportStepUp(response: Response): boolean {
  return (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/router-ab/ecdsa-derivation/operation-step-up'
  );
}

function activate() {
  if (!window.__seamsIntendedVoiceId) throw new Error('Missing VoiceID helper');
  return window.__seamsIntendedVoiceId.activate();
}

function unlock(id: string) {
  if (!window.__seamsIntendedVoiceId) throw new Error('Missing VoiceID helper');
  return window.__seamsIntendedVoiceId.unlock(id);
}

function useNaturalPhrases(): void {
  window.voiceIdUseNaturalPhrases();
}

function readPasskeyRequests(): number {
  return window.voiceIdPasskeyRequests();
}
