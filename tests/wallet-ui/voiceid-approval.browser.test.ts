import { test, expect, type Page, type Route, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type {} from '../fixtures/ui/VoiceIdWalletHostProbe';
import type {} from '../fixtures/ui/VoiceIdBridgeProbe';

type ProbeChunk = { fileName: string; code: string };
let walletChunks: ProbeChunk[];
let bridgeCode: string;

function buildProbe(name: string): ProbeChunk[] {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve(import.meta.dirname, '../scripts/build-preact-probe.mjs'), name],
      { encoding: 'utf8' },
    ),
  );
}

test.beforeAll(prepareProbes);
function prepareProbes(): void {
  walletChunks = buildProbe('VoiceIdWalletHostProbe.ts');
  bridgeCode = buildProbe('VoiceIdBridgeProbe.ts')[0].code;
}

async function routeWalletProbe(route: Route): Promise<void> {
  const file = path.basename(new URL(route.request().url()).pathname);
  const chunk = walletChunks.find(matchesChunk.bind(null, file));
  await route.fulfill({
    status: chunk ? 200 : 404,
    contentType: 'application/javascript',
    body: chunk?.code ?? '',
  });
}
function matchesChunk(name: string, chunk: ProbeChunk): boolean {
  return chunk.fileName === name;
}
async function routePage(route: Route): Promise<void> {
  await route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html lang="en"><head><link rel="stylesheet" href="/wallet-ui.css"></head><body><script type="module" src="/voiceid-probe/probe.js"></script></body></html>',
  });
}
async function routeCss(route: Route): Promise<void> {
  const file = path.resolve(
    import.meta.dirname,
    '../../packages/wallet/dist/esm/sdk/wallet-ui.css',
  );
  await route.fulfill({ contentType: 'text/css', body: fs.readFileSync(file, 'utf8') });
}

test(
  'a wallet review consumes only its current voice approval at the signing boundary',
  runVoiceJourney,
);
async function runVoiceJourney({ page }: { page: Page }, testInfo: TestInfo): Promise<void> {
  await page.addInitScript({ content: bridgeCode });
  await page.route('**/voiceid-probe/*', routeWalletProbe);
  await page.route('**/voiceid-wallet', routePage);
  await page.route('**/wallet-ui.css', routeCss);
  await page.goto('/voiceid-wallet');
  await page.evaluate(requireVoice);
  const cases: string[] = [];

  await expect(page.evaluate(mainnetApproval)).rejects.toThrow('requires NEAR testnet');
  await expect(page.evaluate(unreviewedApproval)).rejects.toThrow(
    'requires a reviewed NEAR transfer',
  );
  cases.push('mainnet_and_unreviewed_requests_rejected');

  await begin(page, 10_000);
  expect(await page.evaluate(tryBypass)).toContain('current voice approval is required');
  await page.evaluate(cancelReview);
  await settled(page, 'cancelled', 0);
  cases.push('signing_without_voice_rejected');

  await begin(page, 10_000);
  expect(await page.evaluate(tryChange)).toBe(true);
  await page.locator('button.confirm').click();
  await settled(page, 'ready_to_sign', 1);
  expect(await page.evaluate(tryReuse)).toContain('current voice approval is required');
  cases.push('operation_frozen_approval_consumed_once');

  await page.evaluate(differentOperation);
  await begin(page, 10_000);
  await page.locator('button.confirm').click();
  await settled(page, 'cancelled', 1);
  cases.push('different_operation_result_rejected');

  await page.evaluate(holdReply);
  await begin(page, 10_000);
  await page.locator('button.confirm').click();
  await page.evaluate(cancelReview);
  await settled(page, 'cancelled', 1);
  await page.evaluate(releaseReply);
  expect((await page.evaluate(snapshot)).signingBoundaryCount).toBe(1);
  cases.push('late_result_after_cancel_ignored');

  await begin(page, 10_000);
  await page.locator('button.confirm').click();
  expect(await page.evaluate(tryBypass)).toContain('current voice approval is required');
  await page.evaluate(releaseReply);
  await settled(page, 'cancelled', 1);
  cases.push('late_result_cannot_restore_consumed_attempt');

  await page.evaluate(approveReply);
  await page.evaluate(delaySigning);
  await begin(page, 700);
  await page.locator('button.confirm').click();
  await settled(page, 'cancelled', 1);
  cases.push('approval_expires_before_signing');

  await page.evaluate(normalSigning);
  await begin(page, 10_000);
  await page.locator('button.confirm').click();
  await settled(page, 'ready_to_sign', 2);
  cases.push('replacement_requires_fresh_approval');
  await testInfo.attach('voiceid-wallet-gate.json', {
    body: JSON.stringify(
      {
        status: 'passed',
        transport: 'deterministic_perception_boundary',
        transactionBroadcast: false,
        cases,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
}

function requireVoice(): void {
  localStorage.setItem('seams.voiceid.required.v1', 'required');
}
function mainnetApproval(): Promise<void> {
  return window.voiceJourney.requestMainnetApproval();
}
function unreviewedApproval(): Promise<void> {
  return window.voiceJourney.requestWithoutReview();
}
function tryBypass(): string {
  return window.voiceJourney.trySigningWithoutVoice();
}
function tryChange(): boolean {
  return window.voiceJourney.tryChangingOperation();
}
function tryReuse(): string {
  return window.voiceJourney.trySecondConsumption();
}
function cancelReview(): void {
  window.voiceJourney.cancel();
}
function differentOperation(): void {
  window.voiceBridgeProbe.setMode('different_operation');
}
function holdReply(): void {
  window.voiceBridgeProbe.setMode('held');
}
function approveReply(): void {
  window.voiceBridgeProbe.setMode('approved');
}
function releaseReply(): void {
  window.voiceBridgeProbe.releasePrevious();
}
function delaySigning(): void {
  window.voiceJourney.setSigningDelay(1000);
}
function normalSigning(): void {
  window.voiceJourney.setSigningDelay(0);
}
function snapshot() {
  return window.voiceJourney.snapshot();
}
function startReview(timeoutMs: number): Promise<void> {
  return window.voiceJourney.begin(timeoutMs, '1000000000000000000000');
}
async function begin(page: Page, timeoutMs: number): Promise<void> {
  await page.evaluate(startReview, timeoutMs);
  await expect(page.locator('button.confirm')).toBeVisible();
  await expect(page.locator('.seams-confirmation-surface')).not.toHaveAttribute('inert', '');
}
async function settled(page: Page, result: string, count: number): Promise<void> {
  await expect
    .poll(page.evaluate.bind(page, snapshot))
    .toMatchObject({ kind: 'settled', result, signingBoundaryCount: count });
}
