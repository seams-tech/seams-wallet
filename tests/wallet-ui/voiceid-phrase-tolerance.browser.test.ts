import { test, expect, type Page, type Route, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type {} from '../fixtures/ui/VoiceIdPhraseToleranceProbe';

type Chunk = { fileName: string; code: string };
let chunks: Chunk[];
const fixtures = path.resolve(import.meta.dirname, '../fixtures/audio/aurora');
const assets = path.resolve(import.meta.dirname, '../../packages/wallet/dist/public/sdk');

test.beforeAll(build);
function build(): void {
  chunks = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve(import.meta.dirname, '../scripts/build-preact-probe.mjs'),
        'VoiceIdPhraseToleranceProbe.ts',
      ],
      { encoding: 'utf8' },
    ),
  );
}
function matchesChunk(fileName: string, chunk: Chunk): boolean {
  return chunk.fileName === fileName;
}
async function serveChunk(route: Route): Promise<void> {
  const name = path.basename(new URL(route.request().url()).pathname);
  const chunk = chunks.find(matchesChunk.bind(null, name));
  await route.fulfill({
    status: chunk ? 200 : 404,
    contentType: 'text/javascript',
    body: chunk?.code ?? '',
  });
}
async function serveAsset(route: Route): Promise<void> {
  const name = new URL(route.request().url()).pathname.slice('/sdk/'.length);
  if (
    ![
      'voiceid/aurora-int8.onnx',
      'ort-wasm-simd-threaded.mjs',
      'ort-wasm-simd-threaded.wasm',
    ].includes(name)
  )
    throw new Error('Unexpected model asset');
  await route.fulfill({
    path: path.join(assets, name),
    contentType: name.endsWith('.mjs')
      ? 'text/javascript'
      : name.endsWith('.wasm')
        ? 'application/wasm'
        : 'application/octet-stream',
  });
}
async function servePage(route: Route): Promise<void> {
  await route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>VoiceID phrase tolerance</title><script type="module" src="/phrase-probe/probe.js"></script>',
  });
}
function checkInBrowser(input: { audio: string; expected: number }) {
  return window.voicePhraseCheck(input.audio, input.expected);
}
async function check(page: Page, file: string, expected: number) {
  return page.evaluate(checkInBrowser, {
    audio: fs.readFileSync(file).toString('base64'),
    expected,
  });
}

test('natural speech matches its challenge and rejects other challenges and unrelated speech', run);
async function run({ page }: { page: Page }, testInfo: TestInfo): Promise<void> {
  testInfo.setTimeout(180_000);
  await page.route('**/phrase-probe/*', serveChunk);
  await page.route('**/sdk/**', serveAsset);
  await page.route('**/phrase-tolerance', servePage);
  await page.goto('/phrase-tolerance');
  await page.waitForFunction(ready);
  const results = [];
  for (let spoken = 0; spoken < 16; spoken++) {
    const file = path.join(fixtures, 'natural', `${spoken}.wav`);
    for (let expected = 0; expected < 16; expected++) {
      const result = await check(page, file, expected);
      results.push({ spoken, expected, result });
      expect(result.kind, `spoken ${spoken}, challenge ${expected}`).toBe(
        spoken === expected ? 'matched' : 'mismatch',
      );
    }
  }
  const extras = [
    { file: 'omitted-articles', expected: 12, outcome: 'matched' },
    { file: 'rough-window', expected: 15, outcome: 'matched' },
    { file: 'outside-bound-window', expected: 15, outcome: 'mismatch' },
    { file: 'ambiguous', expected: 3, outcome: 'mismatch' },
    { file: 'ambiguous', expected: 4, outcome: 'mismatch' },
    { file: 'unrelated', expected: 15, outcome: 'mismatch' },
    { file: 'reordered', expected: 15, outcome: 'mismatch' },
    { file: 'negated', expected: 2, outcome: 'mismatch' },
    { file: 'fragment', expected: 15, outcome: 'mismatch' },
  ];
  const extraResults = [];
  for (const item of extras) {
    const result = await check(
      page,
      path.join(fixtures, 'tolerance', `${item.file}.wav`),
      item.expected,
    );
    extraResults.push({ ...item, result });
    expect(result.kind, `${item.file}: ${JSON.stringify(result)}`).toBe(item.outcome);
  }
  const report = testInfo.outputPath('phrase-tolerance.json');
  fs.writeFileSync(
    report,
    JSON.stringify(
      { status: 'passed', realAurora: true, naturalRate: 160, results, extraResults },
      null,
      2,
    ),
  );
  await testInfo.attach('phrase-tolerance.json', { path: report, contentType: 'application/json' });
}
function ready(): boolean {
  return typeof window.voicePhraseCheck === 'function';
}
