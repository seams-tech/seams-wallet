import { expect, type Page, type WebSocketRoute } from '@playwright/test';
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
test.setTimeout(300_000);
for (const passkeyAlgorithm of ['es256', 'rs256'] as const) {
  test(`${passkeyAlgorithm} passkey manages VoiceID, voice unlocks and signs, and enrollment changes stay bounded`, async ({
    page,
    context,
    harness,
  }, testInfo) => {
    await context.routeWebSocket(isDevelopmentReloadSocket, holdDevelopmentReload);
    await allowBrowserMicrophone(context, passkeyAlgorithm);
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
    const originalEnrollment = await wallet
      .locator('body')
      .evaluate(readEnrollmentSummary, identity.walletId);
    await wallet.locator('body').evaluate(changeAdaptationBoundary, {
      walletId: identity.walletId,
      action: 'legacy' as const,
    });
    await expect(
      wallet.locator('body').evaluate(readEnrollmentSummary, identity.walletId),
    ).rejects.toThrow('Scoped voice enrollment is unavailable');
    await page.getByRole('button', { name: 'Manage voice', exact: true }).click();
    await wallet.getByRole('button', { name: 'Use saved enrollment', exact: true }).click();
    await expect(wallet.locator('.seams-voiceid-management')).toHaveCount(0);
    const importedEnrollment = await wallet
      .locator('body')
      .evaluate(readEnrollmentSummary, identity.walletId);
    expect(importedEnrollment).toMatchObject({
      baselineHash: originalEnrollment.baselineHash,
      legacyPresent: false,
    });
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
    await voiceDialog.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(voiceDialog).toHaveCount(0);
    await expect(wallet.locator('.seams-auth-menu-surface')).toBeVisible();
    await wallet.locator('body').evaluate(watchMenuStates);
    await wallet.locator('[data-auth-menu-voiceid]').click();
    await expect(wallet.locator('.seams-voiceid-prompt')).toHaveAttribute(
      'data-capture',
      'succeeded',
      { timeout: 20_000 },
    );
    // The success sits in the middle of the card below the origin, not low under an empty top.
    expect(await wallet.locator('.seams-voiceid-unlock').evaluate(readSealedOffset)).toBeLessThan(
      2,
    );
    await wallet
      .locator('.seams-voiceid-unlock')
      .screenshot({ path: testInfo.outputPath('voiceid-unlock-sealed.png') });
    await expect.poll(readAuthentication.bind(null, page)).toBe('voiceid');
    await expect(page.locator('[data-seams-auth-menu-host="true"]')).toHaveCount(0);
    // The unlock plays its own success, so the login menu never returns behind or after it.
    const menuStates = await wallet.locator('body').evaluate(readMenuStates);
    const succeeded = menuStates.indexOf('no-menu:succeeded');
    expect(succeeded).toBeGreaterThan(0);
    expect(menuStates.slice(succeeded).filter(isMenuVisible)).toEqual([]);
    await startReviewedTransfer(page);
    await expect(wallet.locator('button.confirm')).toHaveText('Confirm with VoiceID');
    await wallet.locator('body').evaluate(useWrongPhrase);
    await wallet.locator('button.confirm').click();
    await expect(wallet.locator('.seams-voiceid-prompt')).toHaveAttribute(
      'data-capture',
      'listening',
    );
    await wallet
      .locator('.seams-voiceid-prompt')
      .screenshot({ path: testInfo.outputPath('voiceid-signing.png') });
    // A missed phrase keeps the VoiceID card open with a new phrase, not the review.
    const tryAgain = wallet
      .locator('.seams-voiceid-prompt')
      .getByRole('button', { name: 'Try again', exact: true });
    await expect(tryAgain).toBeVisible({ timeout: 20_000 });
    await expect(wallet.locator('.seams-review-content')).toHaveCount(0);
    await wallet
      .locator('.seams-voiceid-prompt')
      .screenshot({ path: testInfo.outputPath('voiceid-signing-retry.png') });
    await tryAgain.click();
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
    const baseline = await wallet
      .locator('body')
      .evaluate(readEnrollmentSummary, identity.walletId);
    const voiceRow = page.locator('[data-auth-method="voiceid"]');
    await expect(voiceRow.getByRole('switch')).toBeVisible();
    await voiceRow.getByRole('button', { name: 'Manage voice', exact: true }).click();
    await wallet
      .locator('.seams-voiceid-management')
      .getByRole('button', { name: 'Back', exact: true })
      .click();
    await expect(voiceRow.getByRole('status')).toHaveText('On in this browser');
    await wallet.locator('body').evaluate(useNaturalPhrases);
    await page.getByRole('button', { name: 'Manage voice', exact: true }).click();
    const enrollmentState = wallet.locator('.seams-voiceid-management-enrollment');
    await expect(enrollmentState).toContainText('Original');
    await expect(
      wallet.getByRole('button', { name: 'Reset improvements', exact: true }),
    ).toHaveCount(0);
    await wallet.getByRole('button', { name: 'Improve recognition', exact: true }).click();
    await expect(wallet.getByRole('button', { name: 'Record sample 1', exact: true })).toBeEnabled({
      timeout: 30_000,
    });
    await wallet.getByRole('button', { name: 'Record sample 1', exact: true }).click();
    await wallet.getByRole('button', { name: 'Cancel enrollment', exact: true }).click();
    await expect(
      wallet.getByRole('button', { name: 'Improve recognition', exact: true }),
    ).toBeEnabled();
    expect(await wallet.locator('body').evaluate(readEnrollmentSummary, identity.walletId)).toEqual(
      baseline,
    );
    await wallet.locator('body').evaluate(replayPasskey);
    await wallet.getByRole('button', { name: 'Improve recognition', exact: true }).click();
    await expect(wallet.locator('.seams-voiceid-management [role="status"]')).toHaveText(
      'The passkey confirmation belongs to another operation.',
    );
    await wallet.locator('body').evaluate(corruptPasskey);
    await wallet.getByRole('button', { name: 'Improve recognition', exact: true }).click();
    await expect(wallet.locator('.seams-voiceid-management [role="status"]')).toHaveText(
      'Passkey confirmation signature is invalid.',
    );
    expect(await wallet.locator('body').evaluate(readEnrollmentSummary, identity.walletId)).toEqual(
      baseline,
    );
    await wallet.getByRole('button', { name: 'Improve recognition', exact: true }).click();
    await wallet.getByRole('button', { name: 'Record sample 1', exact: true }).click();
    await expect
      .poll(wallet.locator('body').evaluate.bind(wallet.locator('body'), microphoneStates))
      .toContain('live');
    await harness.lockWallet();
    await expect
      .poll(wallet.locator('body').evaluate.bind(wallet.locator('body'), microphoneStates))
      .not.toContain('live');
    expect(await wallet.locator('body').evaluate(readEnrollmentSummary, identity.walletId)).toEqual(
      baseline,
    );
    const cancelManagement = wallet
      .locator('.seams-voiceid-management')
      .getByRole('button', { name: 'Back', exact: true });
    if (await cancelManagement.isVisible()) await cancelManagement.click();
    const settingsClose = page.getByRole('button', { name: 'Close wallet settings', exact: true });
    if (await settingsClose.isVisible()) await settingsClose.click();
    await page.getByTestId('asset-open-auth-menu').click();
    await wallet.getByRole('button', { name: 'Unlock with passkey', exact: true }).click();
    await expect.poll(readAuthentication.bind(null, page)).toBe('passkey');
    await openSettings(page);
    await page.getByRole('button', { name: 'Manage voice', exact: true }).click();
    const ownerSession = (await page.evaluate(session)).authentication;
    await wallet.getByRole('button', { name: 'Improve recognition', exact: true }).click();
    await enrollBrowserMicrophone(page);
    const improved = await wallet
      .locator('body')
      .evaluate(readEnrollmentSummary, identity.walletId);
    expect(improved).toMatchObject({
      baselineHash: baseline.baselineHash,
      generation: baseline.generation,
      adaptation: 'adapted',
      samples: 3,
      hasLifetimeLimits: false,
    });
    expect(improved.serializedBytes).toBeLessThanOrEqual(32_768);
    expect(await readAuthentication(page)).toBe('passkey');
    expect((await page.evaluate(session)).authentication).toEqual(ownerSession);
    await wallet
      .locator('body')
      .evaluate(changeAdaptationBoundary, { walletId: identity.walletId, action: 'save' as const });
    await page.getByRole('button', { name: 'Close wallet settings', exact: true }).click();
    await harness.lockWallet();
    await page.getByTestId('asset-open-auth-menu').click();
    await wallet.locator('[data-auth-menu-voiceid]').click();
    await expect.poll(readAuthentication.bind(null, page)).toBe('voiceid');
    await startReviewedTransfer(page);
    await wallet.locator('button.confirm').click();
    await expect(page.getByTestId('reviewed-near-result')).toHaveAttribute(
      'data-state',
      'submitted',
      { timeout: 60_000 },
    );
    expect(evidence.transfers).toHaveLength(2);
    const used = await wallet.locator('body').evaluate(readEnrollmentSummary, identity.walletId);
    expect(used).toEqual(improved);
    await waitForWalletIframeConfirmationSettlement(page);
    await harness.lockWallet();
    await page.getByTestId('asset-open-auth-menu').click();
    await wallet.getByRole('button', { name: 'Unlock with passkey', exact: true }).click();
    await expect.poll(readAuthentication.bind(null, page)).toBe('passkey');
    await openSettings(page);
    await page.getByRole('button', { name: 'Manage voice', exact: true }).click();
    await expect(enrollmentState).toContainText('Improved');
    await expect(enrollmentState).toContainText('Saved on this device');
    await expect(wallet.getByRole('button', { name: 'Improve again', exact: true })).toBeVisible();
    await expect(wallet.locator('.seams-voiceid-activation-surface')).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );
    await wallet.locator('.seams-voiceid-activation-surface').screenshot({
      path: testInfo.outputPath('voiceid-adaptation-management.png'),
      animations: 'disabled',
    });
    await wallet.getByRole('button', { name: 'Reset improvements', exact: true }).click();
    await expect(wallet.locator('.seams-voiceid-management')).toHaveCount(0);
    const reset = await wallet.locator('body').evaluate(readEnrollmentSummary, identity.walletId);
    expect(reset).toMatchObject({
      baselineHash: baseline.baselineHash,
      generation: baseline.generation,
      adaptation: 'baseline',
      samples: 0,
    });
    await page.getByRole('button', { name: 'Close wallet settings', exact: true }).click();
    await wallet.locator('body').evaluate(changeAdaptationBoundary, {
      walletId: identity.walletId,
      action: 'last_use' as const,
    });
    await harness.lockWallet();
    await unlockVoiceFromMenu(page);
    const retainedAfterLastUse = await wallet
      .locator('body')
      .evaluate(readEnrollmentSummary, identity.walletId);
    expect(retainedAfterLastUse).toMatchObject({
      baselineHash: baseline.baselineHash,
      samplesHash: improved.samplesHash,
      adaptation: 'adapted',
      samples: 3,
      hasLifetimeLimits: false,
    });
    await wallet.locator('body').evaluate(changeAdaptationBoundary, {
      walletId: identity.walletId,
      action: 'expired' as const,
    });
    await harness.lockWallet();
    await unlockVoiceFromMenu(page);
    const retainedAfterExpiry = await wallet
      .locator('body')
      .evaluate(readEnrollmentSummary, identity.walletId);
    expect(retainedAfterExpiry).toMatchObject({
      baselineHash: baseline.baselineHash,
      samplesHash: improved.samplesHash,
      adaptation: 'adapted',
      samples: 3,
      hasLifetimeLimits: false,
    });
    await page.reload();
    await wallet.locator('body').waitFor({ state: 'attached', timeout: 15_000 });
    await wallet.locator('body').evaluate(useNaturalPhrases);
    expect(await wallet.locator('body').evaluate(readEnrollmentSummary, identity.walletId)).toEqual(
      retainedAfterExpiry,
    );
    await harness.lockWallet();
    await page.getByTestId('asset-open-auth-menu').click();
    await wallet.getByRole('button', { name: 'Unlock with passkey', exact: true }).click();
    await expect.poll(readAuthentication.bind(null, page)).toBe('passkey');
    await openSettings(page);
    await page.getByRole('button', { name: 'Manage voice', exact: true }).click();
    await wallet.getByRole('button', { name: 'Record voice again', exact: true }).click();
    await enrollBrowserMicrophone(page);
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(readVoiceMethodId)).toBe(voiceMethodId);
    await page.getByRole('button', { name: 'Remove VoiceID', exact: true }).click();
    await page.getByRole('button', { name: 'Remove method', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Remove VoiceID', exact: true })).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(
      wallet.locator('body').evaluate(readEnrollmentSummary, identity.walletId),
    ).rejects.toThrow('Scoped voice enrollment is unavailable');
    await saveEvidence(testInfo, 'voiceid-ui-flows.json', {
      status: 'passed',
      passkeyCredentialAlgorithm: passkeyAlgorithm,
      walletSigner: 'ed25519_yao',
      passkeyCoseAlgorithm: passkeyAlgorithm === 'rs256' ? -257 : -7,
      settings: 'enroll_disable_reenable_and_lock_active_voice_session',
      managementBackLeavesNoMessage: true,
      login: 'one_wallet_with_method_choices_and_cancel_restores_menu',
      menuStatesThroughVoiceUnlock: menuStates,
      disabledSdkUnlockRejected: true,
      reenrollmentPreservedMethodId: true,
      explicitImport: { originalEnrollment, importedEnrollment, obsoleteRecordRemoved: true },
      adaptation: {
        baseline,
        improved,
        used,
        reset,
        retainedAfterLastUse,
        retainedAfterExpiry,
        reloadPreservedSamples: true,
        cancellationPreservedEnrollment: true,
        replayedPasskeyRejected: true,
        invalidPasskeySignatureRejected: true,
        lockDuringCaptureReleasedMicrophone: true,
        ownerSessionUnchanged: true,
        removalDeletedEnrollment: true,
        lifetimeBoundarySetup:
          'existing samples survive retired expiry/count metadata and remain across reload',
      },
      signing: 'minimal_voice_prompt',
      transfers: evidence.transfers,
      chain: 'deterministic_near_rpc',
    });
  });
}
function readEnrollmentSummary(_body: HTMLElement, walletId: string) {
  return window.voiceIdEnrollmentSummary(walletId);
}
function replayPasskey(): void {
  window.voiceIdReplayNextPasskey();
}
function corruptPasskey(): void {
  window.voiceIdCorruptNextPasskey();
}
function microphoneStates(): MediaStreamTrackState[] {
  return window.voiceIdMicrophoneStates();
}
function useNaturalPhrases(): void {
  window.voiceIdUseNaturalPhrases();
}
function useWrongPhrase(): void {
  window.voiceIdUseNextWrongPhrase();
}
function changeAdaptationBoundary(
  _body: HTMLElement,
  input: { walletId: string; action: 'save' | 'last_use' | 'expired' | 'legacy' },
): Promise<void> {
  return window.voiceIdAdaptationBoundary(input);
}
function watchMenuStates(): void {
  const states: string[] = [];
  window.voiceIdMenuStates = states;
  const record = (): void => {
    const menu = document.querySelector<HTMLElement>('.seams-auth-menu-surface');
    const capture = document.querySelector<HTMLElement>('.seams-voiceid-prompt')?.dataset.capture;
    const state = `${menu && !menu.hidden ? 'menu' : 'no-menu'}:${capture ?? 'none'}`;
    if (states.at(-1) !== state) states.push(state);
  };
  new MutationObserver(record).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden', 'data-capture'],
  });
  record();
}
function readMenuStates(): string[] {
  if (!window.voiceIdMenuStates) throw new Error('Menu watcher is unavailable');
  return window.voiceIdMenuStates;
}
/** Resolves on the frame the seal settles, before the card fades, with the seal's distance from the card middle. */
function readSealedOffset(card: Element): Promise<number> {
  return new Promise((resolve) => {
    const settle = (): void => {
      const seal = card.querySelectorAll('.seams-voiceid-ribbon circle')[2];
      const back = card.querySelector('.seams-voiceid-unlock-back');
      const footer = card.querySelector('.seams-voiceid-unlock-footer');
      if (!seal || !back || !footer || seal.getAttribute('r') !== '22.50') return;
      observer.disconnect();
      const [sealBox, backBox, footerBox] = [seal, back, footer].map((part) =>
        part.getBoundingClientRect(),
      );
      resolve(Math.abs(sealBox.top + sealBox.height / 2 - (backBox.top + footerBox.top) / 2));
    };
    const observer = new MutationObserver(settle);
    observer.observe(card, { subtree: true, attributes: true, attributeFilter: ['r'] });
    settle();
  });
}
function isMenuVisible(state: string): boolean {
  return state.startsWith('menu:');
}
declare global {
  interface Window {
    voiceIdMenuStates?: string[];
  }
}
async function unlockVoiceFromMenu(page: Page): Promise<void> {
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  await expect(page.getByTestId('intended-e2e-page')).toHaveAttribute(
    'data-login-state',
    'logged_out',
  );
  await page.getByTestId('asset-open-auth-menu').click();
  await expect(wallet.locator('[data-auth-menu-voiceid]')).toBeVisible();
  await wallet.locator('[data-auth-menu-voiceid]').click();
  await expect.poll(readAuthentication.bind(null, page)).toBe('voiceid');
  await expect(page.locator('[data-seams-auth-menu-host="true"]')).toHaveCount(0);
}
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

function isDevelopmentReloadSocket(url: URL): boolean {
  const app = new URL(process.env.SEAMS_INTENDED_APP_URL || 'http://localhost:4201');
  const wallet = new URL(process.env.SEAMS_INTENDED_WALLET_ORIGIN || 'http://localhost:4202');
  return (
    url.pathname === '/' &&
    url.searchParams.has('token') &&
    (url.host === app.host || url.host === wallet.host)
  );
}

function holdDevelopmentReload(socket: WebSocketRoute): void {
  // Keep this long capture journey stable while shared development files change.
  socket.send(JSON.stringify({ type: 'connected' }));
}
