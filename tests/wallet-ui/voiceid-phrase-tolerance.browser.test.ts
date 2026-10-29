import { test, expect, type Page, type Route, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type {} from '../fixtures/ui/VoiceIdPhraseToleranceProbe';
import {
  CHALLENGE_PHRASES,
  SPOKEN_PHRASES,
} from '../../packages/voiceid/src/browser/phraseVocabulary';

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
async function run({ page }: { page: Page }, testInfo: TestInfo): Promise<void> {
  testInfo.setTimeout(180_000);
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

function commandInBrowser(input: { value: unknown; previous: number | null }) {
  return window.voiceConfirmationChallenge(input.value, input.previous);
}

test(
  'application confirmation commands select spoken action challenges without financial terms',
  runCommands,
);

async function runCommands({ page }: { page: Page }, testInfo: TestInfo): Promise<void> {
  testInfo.setTimeout(90_000);
  await page.route('**/phrase-probe/*', serveChunk);
  await page.route('**/sdk/**', serveAsset);
  await page.route('**/phrase-tolerance', servePage);
  await page.goto('/phrase-tolerance');
  await page.waitForFunction(ready);
  const commands = [
    { command: 'Sell 100 NEAR for USDC at $5.5', action: 'sale' },
    { command: '  BUY 1 ETH at $1000  ', action: 'purchase' },
    { command: 'Swap 500 USDC for NEAR', action: 'swap' },
    { command: 'Send one yoctoNEAR to receiver.testnet', action: 'transfer' },
    { command: 'Transfer one smallest USDC unit on Arc testnet', action: 'transfer' },
  ];
  const results = [];
  for (const entry of commands) {
    let previous: number | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const challenge = await page.evaluate(commandInBrowser, {
        value: { confirmationCommand: entry.command },
        previous,
      });
      expect(challenge.kind).toBe('challenge');
      if (challenge.kind !== 'challenge') throw new Error('The configured challenge was rejected');
      expect(challenge.purpose).toEqual({ kind: 'action', action: entry.action });
      expect(challenge.index).not.toBe(previous);
      expect(challenge.phrase).not.toMatch(/[0-9$]|NEAR|USDC|ETH/);
      const recording = path.join(fixtures, 'natural', `${challenge.index}.wav`);
      const result = await check(page, recording, challenge.index);
      expect(result.kind, JSON.stringify(result)).toBe('matched');
      const wrong = await check(page, path.join(fixtures, 'natural', '0.wav'), challenge.index);
      expect(wrong.kind).toBe('mismatch');
      results.push({ ...entry, attempt, challenge, result, wrong });
      previous = challenge.index;
    }
  }
  for (const value of [
    undefined,
    { confirmationCommand: 'Stake 100 NEAR' },
    { confirmationCommand: 'Do not sell 100 NEAR' },
  ]) {
    const challenge = await page.evaluate(commandInBrowser, { value, previous: null });
    expect(challenge.kind).toBe('challenge');
    if (challenge.kind !== 'challenge') throw new Error('The default challenge was unavailable');
    expect(challenge.purpose).toEqual({ kind: 'random' });
    expect(CHALLENGE_PHRASES).toContain(challenge.phrase);
  }
  const first = await page.evaluate(commandInBrowser, {
    value: { confirmationCommand: 'Sell 100 NEAR' },
    previous: null,
  });
  if (first.kind !== 'challenge') throw new Error('Missing first sale challenge');
  const second = await page.evaluate(commandInBrowser, {
    value: { confirmationCommand: 'Sell 200 NEAR' },
    previous: first.index,
  });
  if (second.kind !== 'challenge') throw new Error('Missing concurrent sale challenge');
  const retry = await page.evaluate(commandInBrowser, {
    value: { confirmationCommand: 'Sell 100 NEAR' },
    previous: first.index,
  });
  expect(retry.kind).toBe('challenge');
  if (retry.kind !== 'challenge') throw new Error('The original sale could not retry');
  expect(retry.index).not.toBe(first.index);
  for (const value of [
    null,
    {},
    { confirmationContext: 'Sell 100 NEAR' },
    { confirmationCommand: '' },
    { confirmationCommand: 100 },
    { confirmationCommand: 'Sell\n100 NEAR' },
    { confirmationCommand: 'x'.repeat(257) },
    { confirmationCommand: ' '.repeat(257) + 'Sell NEAR' },
    { confirmationCommand: 'Sell 100 NEAR', phrase: 'approve me' },
  ]) {
    const outcome = await page.evaluate(commandInBrowser, { value, previous: null });
    expect(outcome).toEqual({ kind: 'invalid', code: 'review_invalid_input' });
  }
  const report = testInfo.outputPath('confirmation-commands.json');
  fs.writeFileSync(
    report,
    JSON.stringify({ status: 'passed', realAurora: true, results }, null, 2),
  );
  await testInfo.attach('confirmation-commands.json', {
    path: report,
    contentType: 'application/json',
  });
}
