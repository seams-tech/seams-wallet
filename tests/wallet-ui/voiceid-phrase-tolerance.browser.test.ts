import { test, expect, type Page, type Route, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type {} from '../fixtures/ui/VoiceIdPhraseToleranceProbe';
import { SPOKEN_PHRASES } from '../../packages/voiceid/src/browser/phraseVocabulary';

type Chunk = { fileName: string; code: string };
let chunks: Chunk[];
const fixtures = path.resolve(import.meta.dirname, '../fixtures/audio/aurora');
const assets = path.resolve(import.meta.dirname, '../../packages/voiceid/dist/public/sdk');

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
      'voiceid/ort-wasm-simd-threaded.mjs',
      'voiceid/ort-wasm-simd-threaded.wasm',
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
async function run(
  { page, browserName }: { page: Page; browserName: string },
  testInfo: TestInfo,
): Promise<void> {
  // Firefox takes about 110 ms per check and Chromium about 10 ms, across 1,925 checks.
  testInfo.setTimeout(browserName === 'firefox' ? 600_000 : 180_000);
  await page.route('**/phrase-probe/*', serveChunk);
  await page.route('**/sdk/**', serveAsset);
  await page.route('**/phrase-tolerance', servePage);
  await page.goto('/phrase-tolerance');
  await page.waitForFunction(ready);
  const results = [];
  for (let spoken = 0; spoken < SPOKEN_PHRASES.length; spoken++) {
    const file = path.join(fixtures, 'natural', `${spoken}.wav`);
    for (let expected = 0; expected < SPOKEN_PHRASES.length; expected++) {
      const result = await check(page, file, expected);
      results.push({ spoken, expected, result });
      expect
        .soft(result.kind, `spoken ${spoken}, challenge ${expected}`)
        .toBe(spoken === expected ? 'matched' : 'mismatch');
    }
  }
  const extras = [
    { file: 'omitted-articles', expected: 7, outcome: 'matched' },
    { file: 'rough-quote', expected: 9, outcome: 'matched' },
    { file: 'outside-bound-quote', expected: 9, outcome: 'mismatch' },
    { file: 'ambiguous', expected: 0, outcome: 'mismatch' },
    { file: 'ambiguous', expected: 7, outcome: 'mismatch' },
    { file: 'unrelated', expected: 9, outcome: 'mismatch' },
    { file: 'reordered', expected: 9, outcome: 'mismatch' },
    { file: 'negated', expected: 2, outcome: 'mismatch' },
    { file: 'fragment', expected: 9, outcome: 'mismatch' },
    { file: 'missing-negation', expected: 11, outcome: 'mismatch' },
    { file: 'changed-negation', expected: 11, outcome: 'mismatch' },
    { file: 'extra-negation', expected: 13, outcome: 'mismatch' },
    { file: 'ambiguous-ending', expected: 24, outcome: 'mismatch' },
    { file: 'sale-homophone', expected: 31, outcome: 'matched' },
  ];
  const extraResults = [];
  for (const item of extras) {
    const result = await check(
      page,
      path.join(fixtures, 'tolerance', `${item.file}.wav`),
      item.expected,
    );
    extraResults.push({ ...item, result });
    expect.soft(result.kind, `${item.file}: ${JSON.stringify(result)}`).toBe(item.outcome);
    if (item.file === 'ambiguous-ending') {
      expect.soft(result.recognition).toMatchObject({ kind: 'uncertain', reason: 'ambiguous' });
    }
  }
  const recordings: { file: string; spoken: string; voice: string; rate: number }[] = JSON.parse(
    fs.readFileSync(path.join(fixtures, 'tolerance', 'generation.json'), 'utf8'),
  );
  const speakerResults = [];
  let speakerMatches = 0;
  let speakerTrials = 0;
  for (const recording of recordings) {
    if (recording.voice === 'Samantha') continue;
    const spoken = SPOKEN_PHRASES.findIndex(sameSpokenPhrase.bind(null, recording.spoken));
    if (spoken < 0) throw new Error(`Unknown phrase recording: ${recording.file}`);
    for (let expected = 0; expected < SPOKEN_PHRASES.length; expected += 1) {
      const result = await check(page, path.join(fixtures, 'tolerance', recording.file), expected);
      speakerResults.push({ ...recording, spoken, expected, result });
      if (spoken === expected) {
        speakerTrials += 1;
        if (result.kind === 'matched') speakerMatches += 1;
      } else {
        expect.soft(result.kind, `${recording.file}, challenge ${expected}: ${JSON.stringify(result)}`)
          .toBe('mismatch');
      }
    }
  }
  expect.soft(speakerMatches / speakerTrials, 'Additional synthetic voices must exceed 90% own-phrase acceptance')
    .toBeGreaterThan(0.9);
  const report = testInfo.outputPath('phrase-tolerance.json');
  fs.writeFileSync(
    report,
    JSON.stringify(
      {
        status: testInfo.errors.length === 0 ? 'passed' : 'failed',
        realAurora: true,
        humanAccuracyMeasured: false,
        naturalRate: 160,
        results,
        extraResults,
        speakerResults,
        speakerAcceptance: { matched: speakerMatches, trials: speakerTrials },
      },
      null,
      2,
    ),
  );
  await testInfo.attach('phrase-tolerance.json', { path: report, contentType: 'application/json' });
}
function ready(): boolean {
  return typeof window.voicePhraseCheck === 'function';
}

function sameSpokenPhrase(spoken: string, phrase: string): boolean {
  return spoken === phrase;
}
