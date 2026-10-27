import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {} from '../../fixtures/ui/VoicePromptProbe';

test('shared VoiceID visual reacts, settles, changes theme and disposes', runVisualJourney);
test('silent VoiceID line breathes, is drawn into the loading ring and seals in place', runSuccessJourney);

async function openProbe(page: Page): Promise<string[]> {
  const chunks: { fileName: string; code: string }[] = JSON.parse(execFileSync(process.execPath, [
    path.resolve(import.meta.dirname, '../../scripts/build-preact-probe.mjs'),
    'VoicePromptProbe.ts',
  ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
  const errors: string[] = [];
  page.on('pageerror', recordError.bind(null, errors));
  await page.route('http://voice-visual.test/**', serveProbe.bind(null, chunks));
  await page.goto('http://voice-visual.test/');
  await page.waitForFunction(probeReady);
  await page.evaluate(mount);
  return errors;
}

async function runSuccessJourney({ page }: { page: Page }, testInfo: TestInfo): Promise<void> {
  const errors = await openProbe(page);
  const prompt = page.locator('.seams-voiceid-prompt');
  const ribbon = page.locator('.seams-voiceid-ribbon');
  const mainLine = ribbon.locator('path').last();
  const [track, seal] = [ribbon.locator('circle').nth(1), ribbon.locator('circle').nth(2)];
  await page.evaluate(silent);
  const silentLine = await mainLine.getAttribute('d');
  // With no voice, the line still moves, so the card does not look stalled.
  await expect(mainLine).not.toHaveAttribute('d', silentLine!);
  const listeningBox = await prompt.boundingBox();
  await page.evaluate(checking);
  await expect(mainLine).toHaveAttribute('opacity', '0');
  await page.waitForTimeout(360);
  await prompt.screenshot({ path: testInfo.outputPath('voiceid-capture.png') });
  await expect(track).toHaveAttribute('opacity', '0.1');
  await page.waitForTimeout(700);
  await prompt.screenshot({ path: testInfo.outputPath('voiceid-spinner.png') });
  await page.evaluate(succeed);
  await expect(prompt.getByText('You’re in', { exact: true })).toBeVisible();
  await expect(prompt.getByRole('status')).toHaveText('Your wallet is unlocked.');
  await expect(seal).toHaveAttribute('r', '22.50');
  await prompt.screenshot({ path: testInfo.outputPath('voiceid-sealed.png') });
  // The card keeps its height from listening to the seal, so the frame never jumps.
  expect((await prompt.boundingBox())?.height).toBeCloseTo(listeningBox?.height ?? 0, 1);
  expect(errors).toEqual([]);
  expect(await page.evaluate(readViolations)).toEqual([]);
  await writeFile(testInfo.outputPath('voiceid-success-motion.json'), JSON.stringify({
    status: 'passed', activity: 'synthetic_recorder_events', microphoneRequests: 0,
    states: ['silent_listening', 'capture', 'spinner', 'sealed'],
    heightPx: listeningBox?.height, authorizationTested: false, strictStyleCsp: true,
  }, null, 2));
}

async function runVisualJourney({ page }: { page: Page }, testInfo: TestInfo): Promise<void> {
  const errors = await openProbe(page);
  const ribbon = page.locator('.seams-voiceid-ribbon');
  const mainLine = ribbon.locator('path').last();
  const resting = await mainLine.getAttribute('d');
  await page.evaluate(listen);
  await expect(ribbon).toHaveAttribute('data-speech', 'true');
  await expect(page.locator('[data-voice-beam][data-active]')).toHaveCount(1);
  await expect(mainLine).not.toHaveAttribute('d', resting!);
  await expect(mainLine).toHaveAttribute('stroke-width', '1');
  await page.locator('.seams-voiceid-prompt').screenshot({ path: testInfo.outputPath('glow-ribbon-listening.png') });
  await page.evaluate(checking);
  await expect(page.locator('[data-voice-beam][data-processing]')).toHaveCount(1);
  await page.evaluate(retry);
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeEnabled();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(light);
  await page.evaluate(listen);
  await expect(ribbon).toHaveAttribute('data-phase', 'listening');
  await page.locator('.seams-voiceid-prompt').screenshot({ path: testInfo.outputPath('glow-ribbon-reduced-light.png') });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.seams-voiceid-prompt')).toHaveCount(0);
  await expect(page.locator('[data-voice-beam]')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(await page.evaluate(readViolations)).toEqual([]);
  await writeFile(testInfo.outputPath('voiceid-visuals.json'), JSON.stringify({
    status: 'passed', activity: 'synthetic_recorder_events', microphoneRequests: 0,
    actualComponent: 'voice-glow@0.2.1', renderer: 'preact',
    states: ['listening', 'processing', 'retry', 'reduced_motion', 'light_theme', 'disposed'],
    authorizationTested: false, strictStyleCsp: true,
  }, null, 2));
}

async function serveProbe(chunks: { fileName: string; code: string }[], route: import('@playwright/test').Route): Promise<void> {
  const name = new URL(route.request().url()).pathname.slice(1);
  if (!name) {
    await route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'nonce-voice-visual'; style-src 'nonce-voice-visual'; img-src 'self' data:" }, body: '<!doctype html><script nonce="voice-visual">window.seamsNonce="voice-visual"</script><style nonce="voice-visual">:root{--seams-colors-colorBackground:#11181c;--seams-colors-textPrimary:#eff2f3;--seams-colors-textSecondary:#9cabb3} :root[data-theme="light"]{--seams-colors-colorBackground:#fff;--seams-colors-textPrimary:#11181c;--seams-colors-textSecondary:#53636b}</style><script type="module" src="/probe.js"></script>' });
    return;
  }
  const chunk = chunks.find(hasName.bind(null, name));
  if (!chunk) { await route.abort(); return; }
  await route.fulfill({ contentType: 'text/javascript', body: chunk.code });
}
function hasName(name: string, chunk: { fileName: string }): boolean { return chunk.fileName === name; }
function recordError(errors: string[], error: Error): void { errors.push(error.message); }
function probeReady(): boolean { return Boolean(window.voicePromptProbe); }
function mount(): void { window.voicePromptProbe.mount(); }
function listen(): void { window.voicePromptProbe.listen(); }
function silent(): void { window.voicePromptProbe.silent(); }
function checking(): void { window.voicePromptProbe.checking(); }
function succeed(): Promise<void> { return window.voicePromptProbe.succeed(); }
function retry(): void { window.voicePromptProbe.retry(); }
function light(): void { window.voicePromptProbe.light(); }

function readViolations(): readonly string[] { return window.voicePromptProbe.securityViolations(); }
