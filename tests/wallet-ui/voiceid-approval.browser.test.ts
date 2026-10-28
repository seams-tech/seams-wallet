import { test, expect, type Page, type Route, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type {} from '../fixtures/ui/VoiceIdWalletHostProbe';

type ProbeChunk = { fileName: string; code: string };
let walletChunks: ProbeChunk[];

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

async function routeVoiceAsset(route: Route): Promise<void> {
  const file = path.basename(new URL(route.request().url()).pathname);
  if (file.endsWith('.wasm')) await delay(1_000);
  const bytes = fs.readFileSync(
    path.resolve(import.meta.dirname, '../../packages/voiceid/dist/public/sdk/voiceid', file),
  );
  await route.fulfill({
    contentType: file.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream',
    body: bytes,
  });
}

test(
  'a wallet review consumes only its current voice approval at the signing boundary',
  runVoiceJourney,
);
async function runVoiceJourney({ page }: { page: Page }, testInfo: TestInfo): Promise<void> {
  await page.route('**/voiceid-probe/*', routeWalletProbe);
  await page.route('**/voiceid-wallet', routePage);
  await page.route('**/wallet-ui.css', routeCss);
  await page.route('**/sdk/voiceid/*', routeVoiceAsset);
  await page.goto('/voiceid-wallet');
  const cases: string[] = [];

  await expect(page.evaluate(mainnetApproval)).rejects.toThrow('requires NEAR testnet');
  await expect(page.evaluate(unreviewedApproval)).rejects.toThrow(
    'requires a reviewed NEAR or Arc testnet transfer',
  );
  cases.push('mainnet_and_unreviewed_requests_rejected');
  const arc = await page.evaluate(checkArcPolicy, 'transfer');
  expect(arc.accepted).toBe(true);
  expect(arc.frozen).toBe(true);
  expect(arc.error).toContain('current voice approval');
  for (const mode of ['mainnet', 'wrong_chain', 'calldata', 'creation', 'access_list', 'unreviewed'] as const) {
    expect((await page.evaluate(checkArcPolicy, mode)).accepted).toBe(false);
    cases.push(`arc_${mode}_rejected`);
  }
  cases.push('arc_transfer_frozen_and_requires_fresh_voice');


  await page.evaluate(startReview, 500);
  await expect(page.locator('button.confirm')).not.toBeVisible();
  await settled(page, 'cancelled', 0);
  cases.push('confirm_unavailable_during_preparation', 'expired_review_cannot_finish_preparation');

  await begin(page, 60_000);
  expect(await page.evaluate(tryPasskeySelection)).toContain('authentication method changed');
  expect(await page.evaluate(tryBypass)).toContain('current voice approval is required');
  await page.evaluate(cancelReview);
  await settled(page, 'cancelled', 0);
  cases.push('signing_without_voice_rejected', 'voice_review_cannot_prepare_a_passkey_lane');

  await begin(page, 60_000);
  expect(await page.evaluate(tryChange)).toBe(true);
  expect(await page.evaluate(tryBypass)).toContain('current voice approval is required');
  await page.evaluate(cancelReview);
  await settled(page, 'cancelled', 0);
  cases.push('operation_frozen_before_voice_approval');
  const report = testInfo.outputPath('voiceid-wallet-gate.json');
  fs.writeFileSync(
    report,
    JSON.stringify(
      {
        status: 'passed',
        transport: 'deterministic_perception_boundary',
        transactionBroadcast: false,
        cases,
      },
      null,
      2,
    ),
  );
  await testInfo.attach('voiceid-wallet-gate.json', {
    path: report,
    contentType: 'application/json',
  });
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
function cancelReview(): void {
  window.voiceJourney.cancel();
}
function snapshot() {
  return window.voiceJourney.snapshot();
}
function startReview(timeoutMs: number): Promise<void> {
  return window.voiceJourney.begin(timeoutMs, '1000000000000000000000');
}
async function begin(page: Page, timeoutMs: number): Promise<void> {
  await page.evaluate(startReview, timeoutMs);
  await expect(page.locator('button.confirm')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('button.confirm')).toBeEnabled();
  await expect(page.locator('.seams-confirmation-surface')).not.toHaveAttribute('inert', '');
}
async function settled(page: Page, result: string, count: number): Promise<void> {
  await expect
    .poll(page.evaluate.bind(page, snapshot))
    .toMatchObject({ kind: 'settled', result, signingBoundaryCount: count });
}

function tryPasskeySelection(): string {
  return window.voiceJourney.trySelectingPasskey();
}

function checkArcPolicy(mode: Parameters<Window['voiceJourney']['checkArcPolicy']>[0]) {
  return window.voiceJourney.checkArcPolicy(mode);
}
