import { test, expect, type Page, type Route, type TestInfo, type Request } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startCalibrationServer } from '../scripts/voiceid-human-calibration/serve.mjs';
import type {} from '../fixtures/ui/VoiceIdHumanCalibration';
import type {} from '../fixtures/ui/VoiceIdMicrophoneObservation';

test('local calibration keeps failed readings, separates cohorts, and exports scores without voice vectors', calibrationJourney);

async function calibrationJourney({ page }: { page: Page }, testInfo: TestInfo): Promise<void> {
  test.setTimeout(240_000);
  const running = await startCalibrationServer({ port: 0, source: 'synthetic_fixture' });
  const requests: { url: string; method: string }[] = [];
  page.context().on('request', observeRequest.bind(null, requests));
  try {
    const chunks = JSON.parse(execFileSync(process.execPath, [
      path.resolve(import.meta.dirname, '../scripts/build-preact-probe.mjs'),
      'VoiceIdMicrophoneObservation.ts',
    ], { encoding: 'utf8' }));
    await page.addInitScript({ content: chunks[0].code });
    await page.route(/\/voiceid-test-audio\/(\d+)\.wav$/, serveSpeech);
    await page.goto(running.url);
    await expect(page.getByRole('button', { name: 'Export scores' })).toBeDisabled();
    await page.getByRole('button', { name: 'Prepare VoiceID' }).click();
    await expect(page.getByRole('status').first()).toContainText('Confirm local participation');
    expect(running.state.requests.some(isModel)).toBe(false);
    await page.locator('#consent').check();
    await page.getByRole('button', { name: 'Prepare VoiceID' }).click();
    await expect(page.getByRole('button', { name: 'Select participant / session' })).toBeEnabled({ timeout: 60_000 });
    await select(page, 'p03', 'evaluation', 'early_session');
    await expect(page.locator('#status')).toContainText('Freeze calibration before adding evaluation');
    await page.getByRole('button', { name: 'Freeze calibration', exact: true }).click();
    await expect(page.locator('#status')).toContainText('at least two enrolled people');

    let attempts = 0;
    for (const [id, cohort] of [['p01', 'calibration'], ['p02', 'calibration'], ['p03', 'evaluation'], ['p04', 'evaluation']]) {
      if (id === 'p03') {
        await page.getByRole('button', { name: 'Freeze calibration', exact: true }).click();
        await expect(page.locator('#status')).toContainText('Calibration is frozen');
        await select(page, 'p02', 'calibration', 'another_day');
        await expect(page.locator('#status')).toContainText('Calibration is frozen');
      }
      await select(page, id, cohort, 'enrollment_day');
      if (id === 'p01') await page.evaluate(wrongPhrase);
      for (let index = 0; index < 3; index += 1) {
        await recordAndLabel(page, 'I read it correctly');
        attempts += 1;
      }
      await expect(page.locator('#capture')).toContainText('Enrollment complete · 3 of 3');
      await expect(page.locator('.seams-voiceid-prompt')).toHaveAttribute('data-capture', 'ready');
      if (id === 'p02') {
        await page.getByRole('button', { name: 'Freeze calibration', exact: true }).click();
        await expect(page.locator('#status')).toContainText('at least two enrolled people');
      }
      await page.getByRole('button', { name: 'Select participant / session' }).click();
      await expect(page.locator('#status')).toContainText('Use a new session label');
      await select(page, id, cohort, 'later_day');
      await recordAndLabel(page, 'I read it correctly');
      attempts += 1;
    }
    await recordAndLabel(page, 'I stumbled');
    attempts += 1;
    await page.evaluate(wrongPhrase);
    await recordAndLabel(page, 'I intentionally read different words');
    attempts += 1;
    await expect(page.locator('body')).toHaveAttribute('data-attempts', String(attempts));
    await expect(page.locator('#results')).toContainText('synthetic_only');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export scores' }).click();
    const file = testInfo.outputPath('calibration-scores.json');
    await (await download).saveAs(file);
    const report = JSON.parse(await readFile(file, 'utf8'));
    expect(report.source).toBe('synthetic_fixture');
    expect(report.attempts).toHaveLength(attempts);
    expect(report.attempts[0]).toMatchObject({ role: 'enrollment', reading: 'as_shown', result: { kind: 'captured', phraseMatched: false } });
    expect(report.scores.filter(isGenuine)).toHaveLength(5);
    expect(report.scores.filter(isOtherSpeaker)).toHaveLength(5);
    expect(report.summary.speakerCutoff.kind).toBe('synthetic_only');
    expect(report.fit.kind).toBe('frozen');
    expect(report.fit.attemptIds).toHaveLength(2);
    expect(report.summary.phrases).toHaveLength(40);
    expect(report.summary.phrases.some(isUnrated)).toBe(true);
    expect(report.summary.phrases.reduce(attemptTotal, 0)).toBe(5);
    expect(report.summary.phrases.reduce(wrongTotal, 0)).toBe(1);
    expect(forbiddenKeys(report)).toEqual([]);
    expect(running.state.posts).toBe(0);
    for (const request of requests) {
      expect(request.method).toBe('GET');
      expect(new URL(request.url).origin).toBe(new URL(running.url).origin);
    }
    expect(running.state.requests.some(isWalletOperation)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('calibration-report.png'), fullPage: true });
    await writeFile(testInfo.outputPath('calibration-validation.json'), JSON.stringify({
      status: 'passed',
      source: 'synthetic_fixture',
      humanAccuracyMeasured: false,
      realModels: true,
      labeledAttempts: attempts,
      enrolledParticipants: 4,
      scores: report.scores.length,
      networkUploads: running.state.posts,
      exportExcludesBiometricVectors: true,
      requests,
    }, null, 2));
    await page.evaluate(holdWorklet);
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(page.locator('body')).toHaveAttribute('data-voice-test-worklet', 'waiting');
    await page.evaluate(clearSession);
    await page.evaluate(releaseWorklet);
    await expect(page.locator('.seams-voiceid-prompt')).toHaveAttribute('data-capture', 'processing');
    await expect(page.locator('body')).toHaveAttribute('data-phase', 'closed');
    await expect(page.getByRole('button', { name: 'Export scores', exact: true })).toBeDisabled();
    await expect(page.locator('#status')).toContainText('session was cleared');
  } finally {
    running.server.closeAllConnections();
    running.server.close();
  }
}

function observeRequest(requests: { url: string; method: string }[], request: Request): void {
  requests.push({ url: request.url(), method: request.method() });
}

async function select(page: Page, participant: string, cohort: string, session: string): Promise<void> {
  await page.locator('#participant').fill(participant);
  await page.locator('#cohort').selectOption(cohort);
  await page.locator('#session').fill(session);
  await page.getByRole('button', { name: 'Select participant / session' }).click();
}

async function recordAndLabel(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible({ timeout: 25_000 });
  await page.getByRole('button', { name: label, exact: true }).click();
}

async function serveSpeech(route: Route): Promise<void> {
  const name = path.basename(new URL(route.request().url()).pathname);
  const body = await readFile(path.resolve(import.meta.dirname, '../fixtures/audio/aurora/natural', name));
  await route.fulfill({ contentType: 'audio/wav', body });
}

function wrongPhrase(): void {
  window.voiceIdUseNextWrongPhrase();
}
function clearSession(): void {
  window.dispatchEvent(new Event('pagehide'));
}
function holdWorklet(): void {
  window.voiceIdHoldNextWorklet();
}
function releaseWorklet(): void {
  window.voiceIdReleaseWorklet();
}
function isModel(url: string): boolean {
  return url.endsWith('.onnx') || url.endsWith('.wasm');
}
function isWalletOperation(url: string): boolean {
  return url.startsWith('/wallet/');
}
function isGenuine(trial: { genuine: boolean }): boolean {
  return trial.genuine;
}
function isOtherSpeaker(trial: { genuine: boolean }): boolean {
  return !trial.genuine;
}
function isUnrated(phrase: { status: string }): boolean {
  return phrase.status === 'unrated';
}
function attemptTotal(total: number, phrase: { promptedAttempts: number }): number {
  return total + phrase.promptedAttempts;
}
function wrongTotal(total: number, phrase: { differentWords: number }): number {
  return total + phrase.differentWords;
}

function forbiddenKeys(value: unknown): string[] {
  const found: string[] = [];
  if (typeof value !== 'object' || value === null) return found;
  for (const [key, child] of Object.entries(value)) {
    if (['embedding', 'template', 'samples', 'deviceId', 'decodedText', 'privateKey', 'walletId'].includes(key)) found.push(key);
    found.push(...forbiddenKeys(child));
  }
  return found;
}
