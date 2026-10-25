import phrases from '../../fixtures/audio/aurora/phrases.json' with { type: 'json' };
import {
  voiceIdBrowserAudio,
  allowBrowserMicrophone,
  enrollBrowserMicrophone,
} from './voiceid-browser-audio';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {} from '../../fixtures/ui/VoiceIdMicrophoneObservation';
import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';
import {
  readNearIdentity,
  startReviewedTransfer,
  VoiceIdNearSigningEvidence,
} from './voiceid-near-signing';
import type {} from '../../intended-app/src/voiceIdHelpers';
import { WorkerDeferred } from '@/core/signingEngine/workerManager/workerDeferred';
import type { Route } from '@playwright/test';

test('VoiceID issues a fresh Wallet Session and signs a reviewed NEAR transfer', verifyUnlock);
test.use(voiceIdBrowserAudio);
test.use({ video: 'off', trace: 'off' });
test.setTimeout(180_000);

async function verifyUnlock(
  {
    harness,
    page,
    context,
  }: {
    harness: IntendedBehaviourHarness;
    page: Page;
    context: BrowserContext;
  },
  testInfo: TestInfo,
): Promise<void> {
  await allowBrowserMicrophone(context);
  harness.enableVoiceIdPlugin();
  await harness.registerPasskeyEd25519YaoWallet();
  await harness.assertRegistrationOwnerSessionIsActive();
  const identity = await readNearIdentity(page);
  const ownerSession = await page.evaluate(readSession);
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  const activationStarted = performance.now();
  const activation = page.evaluate(activate);
  await expect(wallet.getByRole('dialog', { name: 'Activate VoiceID', exact: true })).toBeVisible();
  await expectPaintedPrompt(page);
  const activationDialogMs = performance.now() - activationStarted;
  expect(activationDialogMs).toBeLessThan(1_000);
  await wallet.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await enrollBrowserMicrophone(page);
  const method = await activation;
  expect(method.walletId).toBe(identity.walletId);

  await page.evaluate(lock);
  expect((await page.evaluate(readSession)).authentication.kind).toBe('signed_out');
  await page.reload();
  await expect(page.getByTestId('intended-register-passkey')).toBeVisible();
  const coldPreparation = await measureColdPreparation(
    context,
    page,
    method.walletAuthMethodId,
    testInfo,
  );
  const preparation = await verifyPreparationCancellation(context, page, method.walletAuthMethodId);
  await verifyLockDuringUnlock(context, page, method.walletAuthMethodId);
  const qualityRequests = new QualityRetryRequests();
  context.on('request', qualityRequests.observe);
  const verifiedResponse = page.waitForResponse(isVerifyResponse);
  const unlocked = page.evaluate(unlock, method.walletAuthMethodId);
  const shortAudio = await readFile(
    path.resolve(import.meta.dirname, '../../fixtures/audio/aurora/short.wav'),
  );
  await wallet.locator('body').evaluate(useNextAudio, shortAudio.toString('base64'));
  await wallet.getByRole('button', { name: 'Unlock with VoiceID', exact: true }).click();
  await expect(wallet.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled({
    timeout: 15_000,
  });
  const shortQuality = await readQuality(page);
  expect(shortQuality.voicedMs).toBeGreaterThan(0);
  expect(shortQuality.voicedMs).toBeLessThan(600);
  expect(shortQuality.endedBy).toBe('pause');
  expect(shortQuality.recordingMs).toBeLessThan(3_500);
  expect(shortQuality.peakFrameRms).toBeGreaterThan(shortQuality.levelThreshold);
  expect(qualityRequests.verifies).toBe(0);
  expect((await page.evaluate(readSession)).authentication.kind).toBe('signed_out');
  const retryPhrase = await wallet
    .locator('[data-voiceid-phrase]')
    .getAttribute('data-voiceid-phrase');
  if (retryPhrase === null) throw new Error('Retry phrase is unavailable');
  const quietAudio = await readFile(
    path.resolve(import.meta.dirname, '../../fixtures/audio/aurora/quiet.wav'),
  );
  await wallet.locator('body').evaluate(useNextAudio, quietAudio.toString('base64'));
  await wallet.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(wallet.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled({
    timeout: 15_000,
  });
  const quietQuality = await readQuality(page);
  expect(quietQuality.attemptId).not.toBe(shortQuality.attemptId);
  expect(quietQuality.voicedMs).toBe(0);
  expect(quietQuality.endedBy).toBe('limit');
  expect(quietQuality.recordingMs).toBeGreaterThanOrEqual(7_900);
  expect(quietQuality.peakFrameRms).toBeLessThan(quietQuality.levelThreshold);
  expect(qualityRequests.verifies).toBe(0);
  expect(qualityRequests.challenges).toBe(1);
  await expect(wallet.locator('[data-voiceid-phrase]')).not.toHaveAttribute(
    'data-voiceid-phrase',
    retryPhrase,
  );
  await wallet.getByText('Recording details', { exact: true }).click();
  await wallet
    .locator('.seams-voiceid-prompt')
    .screenshot({ path: testInfo.outputPath('voiceid-quality-retry.png') });
  const naturalAudio = await phraseAudio(page);
  await wallet.locator('body').evaluate(useNextDelayedAudio, naturalAudio.toString('base64'));
  await wallet.getByRole('button', { name: 'Try again', exact: true }).click();
  await unlocked;
  const naturalQuality = await readLastQuality(page);
  expect(naturalQuality.voicedMs).toBeGreaterThanOrEqual(600);
  expect(naturalQuality.voicedMs).toBeLessThan(2_000);
  expect(naturalQuality.endedBy).toBe('pause');
  expect(naturalQuality.recordingMs).toBeGreaterThan(3_500);
  expect(naturalQuality.recordingMs).toBeLessThan(6_000);
  expect(await unlocked).toMatchObject({
    success: true,
    kind: 'near_wallet_unlocked',
    walletId: identity.walletId,
    operationalPublicKey: identity.publicKey,
  });
  expect(qualityRequests.verifies).toBe(1);
  expect(qualityRequests.challenges).toBe(1);
  context.off('request', qualityRequests.observe);
  const verified = requireRecord(await (await verifiedResponse).json(), 'VoiceID response');
  const freshSession = requireRecord(verified.walletSession, 'fresh Wallet Session');
  expect(freshSession.authMethodId).toBe(method.walletAuthMethodId);
  const credential = requireRecord(verified.operationCredential, 'operation credential');
  const freshSessionId = requireCanonicalString(credential.walletSessionId, 'fresh session ID');
  const session = await page.evaluate(readSession);
  expect(session.authentication).toMatchObject({
    kind: 'authenticated',
    walletId: identity.walletId,
    authMethod: 'voiceid',
  });
  expect(session.appIdentity.kind).toBe('resolved');
  if (session.appIdentity.kind !== 'resolved') throw new Error('Wallet identity is unavailable');
  expect(session.appIdentity.authMethods).toContainEqual(
    expect.objectContaining({
      kind: 'voiceid',
      walletAuthMethodId: method.walletAuthMethodId,
    }),
  );

  const evidence = new VoiceIdNearSigningEvidence(
    process.env.SEAMS_INTENDED_ROUTER_URL || 'http://127.0.0.1:4100',
    identity,
    'available',
  );
  await evidence.observe(context);
  await wallet.locator('body').evaluate(useNaturalPhrases);
  await startReviewedTransfer(page);
  await wallet.locator('button.confirm').click();
  await expect(page.getByTestId('reviewed-near-result')).toHaveAttribute(
    'data-state',
    'submitted',
    {
      timeout: 60_000,
    },
  );
  const signingQuality = await readLastQuality(page);
  expect(signingQuality.voicedMs).toBeGreaterThanOrEqual(600);
  expect(signingQuality.voicedMs).toBeLessThan(2_000);
  expect(signingQuality.endedBy).toBe('pause');
  expect(signingQuality.recordingMs).toBeLessThan(4_500);
  expect(evidence.transfers).toHaveLength(1);
  expect(evidence.snapshot().finalizations).toBeGreaterThan(0);
  const budget = await harness.readCurrentWalletSessionStatus();
  expect(budget.status).toBe('active');
  const report = testInfo.outputPath('voiceid-unlock-near.json');
  await writeFile(
    report,
    JSON.stringify(
      {
        status: 'passed',
        nativeHost: 'none',
        microphone: 'synthetic_wav_through_browser_mediarecorder',
        keychainUsed: false,
        speakerInference: 'real_redimnet_b1_onnx_webassembly',
        priorAuthentication: ownerSession.authentication,
        voiceIdMethodId: method.walletAuthMethodId,
        freshSessionId,
        concurrentLockRejectedStaleUnlock: true,
        preparation,
        coldPreparation,
        activationDialogMs,
        naturalCapture: naturalQuality,
        naturalSigningCapture: signingQuality,
        qualityRetries: {
          shortQuality,
          quietQuality,
          oneChallenge: true,
          verifiesBeforeGoodAudio: 0,
        },
        authentication: session.authentication,
        signing: 'real_ed25519_yao_mpc',
        signatureVerification: 'registered_wallet_public_key',
        identity,
        chain: 'deterministic_near_rpc',
        onChainConfirmed: false,
        remainingUses: budget.remainingUses,
        transfers: evidence.transfers,
      },
      null,
      2,
    ),
  );
  await testInfo.attach('voiceid-unlock-near.json', {
    path: report,
    contentType: 'application/json',
  });
}

class DelayedChallenge {
  readonly requested = new WorkerDeferred<void>();
  readonly finished = new WorkerDeferred<void>();
  readonly serve = async (route: Route): Promise<void> => {
    const response = await route.fetch();
    this.requested.resolve();
    await new Promise(waitFiveSeconds);
    try {
      await route.fulfill({ response });
    } finally {
      this.finished.resolve();
    }
  };
}

function waitFiveSeconds(resolve: (value: void) => void): void {
  setTimeout(resolve, 5_000);
}

async function verifyPreparationCancellation(
  context: BrowserContext,
  page: Page,
  methodId: string,
): Promise<{
  dialogVisibleMs: number;
  delayedChallengeMs: number;
  cancelDuringPreparation: boolean;
}> {
  const challenge = new DelayedChallenge();
  await context.route('**/wallet/voiceid/challenge', challenge.serve);
  const started = performance.now();
  const operation = page.evaluate(unlock, methodId).then(unexpectedUnlock, rejectedUnlock);
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  await expect(
    wallet.getByRole('dialog', { name: 'Unlock with VoiceID', exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  await expectPaintedPrompt(page);
  const dialogVisibleMs = performance.now() - started;
  await challenge.requested.promise;
  const disabledWhilePreparing = !(await wallet
    .getByRole('button', { name: 'Unlock with VoiceID', exact: true })
    .isEnabled());
  await wallet.getByRole('button', { name: 'Cancel', exact: true }).click();
  const cancelled = await operation;
  await challenge.finished.promise;
  await context.unroute('**/wallet/voiceid/challenge', challenge.serve);
  await expect(
    wallet.getByRole('dialog', { name: 'Unlock with VoiceID', exact: true }),
  ).toHaveCount(0);
  expect(cancelled.kind).toBe('rejected');
  expect((await page.evaluate(readSession)).authentication.kind).toBe('signed_out');
  console.log(
    JSON.stringify({ dialogVisibleMs, delayedChallengeMs: 5000, disabledWhilePreparing }),
  );
  expect(dialogVisibleMs).toBeLessThan(2_000);
  expect(disabledWhilePreparing).toBe(true);
  return { dialogVisibleMs, delayedChallengeMs: 5000, cancelDuringPreparation: true };
}

class HeldVerification {
  readonly captured = new WorkerDeferred<void>();
  readonly release = new WorkerDeferred<void>();

  async serve(route: Route): Promise<void> {
    const response = await route.fetch();
    this.captured.resolve();
    await this.release.promise;
    await route.fulfill({ response });
  }
}

async function verifyLockDuringUnlock(
  context: BrowserContext,
  page: Page,
  walletAuthMethodId: string,
): Promise<void> {
  const held = new HeldVerification();
  const handler = held.serve.bind(held);
  await context.route('**/wallet/voiceid/verify', handler);
  const result = page.evaluate(unlock, walletAuthMethodId).then(unexpectedUnlock, rejectedUnlock);
  await page
    .frameLocator('iframe.seams-wallet-overlay-iframe')
    .getByRole('button', { name: 'Unlock with VoiceID', exact: true })
    .click();
  await held.captured.promise;
  await page.evaluate(lock);
  held.release.resolve();
  const rejected = await result;
  expect(rejected.kind).toBe('rejected');
  if (rejected.kind !== 'rejected') throw new Error('A stale unlock overrode the wallet lock');
  expect(rejected.message).toContain('Wallet lock state changed during unlock');
  await context.unroute('**/wallet/voiceid/verify', handler);
  expect((await page.evaluate(readSession)).authentication.kind).toBe('signed_out');
}

function unexpectedUnlock(): { kind: 'succeeded' } {
  return { kind: 'succeeded' };
}
function rejectedUnlock(error: unknown): { kind: 'rejected'; message: string } {
  return { kind: 'rejected', message: error instanceof Error ? error.message : String(error) };
}

function activate() {
  if (!window.__seamsIntendedVoiceId) throw new Error('VoiceID acceptance helper is unavailable');
  return window.__seamsIntendedVoiceId.activate();
}
function unlock(walletAuthMethodId: string) {
  if (!window.__seamsIntendedVoiceId) throw new Error('VoiceID acceptance helper is unavailable');
  return window.__seamsIntendedVoiceId.unlock(walletAuthMethodId);
}
function readSession() {
  if (!window.__seamsIntendedVoiceId) throw new Error('VoiceID acceptance helper is unavailable');
  return window.__seamsIntendedVoiceId.session();
}
async function lock(): Promise<void> {
  if (!window.__seamsIntendedE2ELockWallet) throw new Error('Wallet lock helper is unavailable');
  await window.__seamsIntendedE2ELockWallet();
}
function isVerifyResponse(response: import('@playwright/test').Response): boolean {
  return new URL(response.url()).pathname === '/wallet/voiceid/verify';
}

function useNextAudio(_: HTMLElement, base64: string): void {
  window.voiceIdNextAudio(base64);
}

async function readQuality(page: Page): Promise<{
  attemptId: string;
  voicedMs: number;
  durationMs: number;
  peakFrameRms: number;
  levelThreshold: number;
  recordingMs: number;
  endedBy: string;
}> {
  const value = await page
    .frameLocator('iframe.seams-wallet-overlay-iframe')
    .locator('[data-voice-capture-quality]')
    .getAttribute('data-voice-capture-quality');
  if (value === null) throw new Error('Capture quality is unavailable');
  const raw = requireRecord(JSON.parse(value), 'capture quality');
  if (
    typeof raw.attemptId !== 'string' ||
    typeof raw.voicedMs !== 'number' ||
    typeof raw.durationMs !== 'number' ||
    typeof raw.peakFrameRms !== 'number' ||
    typeof raw.levelThreshold !== 'number' ||
    typeof raw.recordingMs !== 'number' ||
    typeof raw.endedBy !== 'string'
  ) {
    throw new Error('Capture quality has invalid fields');
  }
  return {
    attemptId: raw.attemptId,
    voicedMs: raw.voicedMs,
    durationMs: raw.durationMs,
    peakFrameRms: raw.peakFrameRms,
    levelThreshold: raw.levelThreshold,
    recordingMs: raw.recordingMs,
    endedBy: raw.endedBy,
  };
}

class QualityRetryRequests {
  challenges = 0;
  verifies = 0;
  readonly observe = (request: import('@playwright/test').Request): void => {
    const path = new URL(request.url()).pathname;
    if (path === '/wallet/voiceid/challenge') this.challenges += 1;
    if (path === '/wallet/voiceid/verify') this.verifies += 1;
  };
}

async function phraseAudio(page: Page): Promise<Buffer> {
  const phrase = await page
    .frameLocator('iframe.seams-wallet-overlay-iframe')
    .locator('[data-voiceid-phrase]')
    .getAttribute('data-voiceid-phrase');
  const index = phrase === null ? -1 : phrases.indexOf(phrase);
  if (index < 0) throw new Error('Natural speech fixture phrase is unavailable');
  return await readFile(
    path.resolve(import.meta.dirname, `../../fixtures/audio/aurora/natural/${index}.wav`),
  );
}

function useNextDelayedAudio(_: HTMLElement, base64: string): void {
  window.voiceIdNextDelayedAudio(base64);
}

function useNaturalPhrases(): void {
  window.voiceIdUseNaturalPhrases();
}

async function readLastQuality(page: Page) {
  const value = await page
    .frameLocator('iframe.seams-wallet-overlay-iframe')
    .locator('body')
    .getAttribute('data-voice-verification');
  if (value === null) throw new Error('Verification quality is unavailable');
  const raw = requireRecord(JSON.parse(value), 'verification quality');
  if (
    typeof raw.voicedMs !== 'number' ||
    typeof raw.recordingMs !== 'number' ||
    typeof raw.endedBy !== 'string' ||
    typeof raw.similarity !== 'number' ||
    typeof raw.phraseMatched !== 'boolean'
  )
    throw new Error('Invalid verification quality');
  return {
    voicedMs: raw.voicedMs,
    recordingMs: raw.recordingMs,
    endedBy: raw.endedBy,
    similarity: raw.similarity,
    phraseMatched: raw.phraseMatched,
  };
}

class DelayedPreparationAsset {
  readonly requested = new WorkerDeferred<void>();
  readonly finished = new WorkerDeferred<void>();
  readonly serve = async (route: Route): Promise<void> => {
    const response = await route.fetch();
    this.requested.resolve();
    await new Promise<void>(waitFourSeconds);
    try {
      await route.fulfill({ response });
    } finally {
      this.finished.resolve();
    }
  };
}
function waitFourSeconds(resolve: () => void): void {
  setTimeout(resolve, 4_000);
}

async function measureColdPreparation(
  context: BrowserContext,
  page: Page,
  methodId: string,
  testInfo: TestInfo,
) {
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  const dialog = wallet.getByRole('dialog', { name: 'Unlock with VoiceID', exact: true });
  const module = new DelayedPreparationAsset();
  await context.route('**/unlock-*.js', module.serve);
  const requests = new QualityRetryRequests();
  context.on('request', requests.observe);
  const started = performance.now();
  const operation = page.evaluate(unlock, methodId).then(unexpectedUnlock, rejectedUnlock);
  await expect(dialog).toBeVisible({ timeout: 1_500 });
  await expectPaintedPrompt(page);
  const moduleVisibleMs = performance.now() - started;
  expect(moduleVisibleMs).toBeLessThan(1_000);
  await module.requested.promise;
  await expect(dialog).toHaveAttribute('data-preparation', 'loading');
  await expect(
    wallet.getByRole('button', { name: 'Unlock with VoiceID', exact: true }),
  ).toBeDisabled();
  await dialog.screenshot({ path: testInfo.outputPath('voiceid-loading-module.png') });
  const cancelledAt = performance.now();
  await wallet.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await operation).kind).toBe('rejected');
  const cancellationMs = performance.now() - cancelledAt;
  expect(cancellationMs).toBeLessThan(1_000);
  await module.finished.promise;
  await context.unroute('**/unlock-*.js', module.serve);
  await expect(dialog).toHaveCount(0);
  expect(requests.challenges).toBe(0);
  expect(requests.verifies).toBe(0);

  const runtime = new DelayedPreparationAsset();
  await context.route('**/ort.wasm.bundle.min-*.js', runtime.serve);
  const runtimeStarted = performance.now();
  const retry = page.evaluate(unlock, methodId).then(unexpectedUnlock, rejectedUnlock);
  await expect(dialog).toBeVisible({ timeout: 1_500 });
  await expectPaintedPrompt(page);
  const runtimeVisibleMs = performance.now() - runtimeStarted;
  expect(runtimeVisibleMs).toBeLessThan(1_000);
  await runtime.requested.promise;
  await expect(dialog).toHaveAttribute('data-preparation', 'loading');
  await expect(dialog.locator('.seams-voiceid-prompt .seams-voiceid-model-download')).toBeVisible();
  await expect(
    wallet.getByRole('button', { name: 'Unlock with VoiceID', exact: true }),
  ).toBeDisabled();
  await dialog.screenshot({ path: testInfo.outputPath('voiceid-loading-runtime.png') });
  await runtime.finished.promise;
  await expect(
    wallet.getByRole('button', { name: 'Unlock with VoiceID', exact: true }),
  ).toBeEnabled({ timeout: 20_000 });
  const readyMs = performance.now() - runtimeStarted;
  expect(readyMs).toBeGreaterThanOrEqual(4_000);
  expect(requests.challenges).toBe(1);
  expect(await wallet.locator('body').evaluate(readMicrophoneStates)).toEqual([]);
  await wallet.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await retry).kind).toBe('rejected');
  await context.unroute('**/ort.wasm.bundle.min-*.js', runtime.serve);
  context.off('request', requests.observe);
  return {
    moduleVisibleMs,
    runtimeVisibleMs,
    cancellationMs,
    readyMs,
    injectedDelayMs: 4_000,
    cancelledModuleStartedNoChallenge: true,
    microphoneStartedDuringPreparation: false,
  };
}
function readMicrophoneStates(): MediaStreamTrackState[] {
  return window.voiceIdMicrophoneStates();
}

async function expectPaintedPrompt(page: Page): Promise<void> {
  const overlay = page.locator('dialog.seams-wallet-overlay-dialog[open]');
  await expect(overlay).toHaveCSS('opacity', '1', { timeout: 1_500 });
  await expect(overlay).toHaveCSS('pointer-events', 'auto');
  await expect(overlay).not.toHaveClass(/is-provisional|is-viewport-fallback|is-reveal-pending/);
}
