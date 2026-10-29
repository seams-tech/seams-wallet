import { test, expect, type Page, type Route, type TestInfo, type Request } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {} from '../fixtures/ui/VoiceIdCitrinetProbe';
import { SPOKEN_PHRASES } from '../../packages/voiceid/src/browser/phraseVocabulary';
import { startComparisonServer } from '../scripts/voiceid-citrinet/serve.mjs';
import type {} from '../fixtures/ui/VoiceIdMicrophoneObservation';
import type { Comparison } from '../scripts/voiceid-citrinet/recognition';

type Chunk = { fileName: string; code: string };
type BenchmarkResult = Readonly<{
  file: string;
  expected: number;
  category: 'correct' | 'control';
  sha256: string;
  result: Comparison;
}>;
const root = path.resolve(import.meta.dirname, '../..');
const modelRoot = process.env.CITRINET_EVAL_ROOT;
const fixtures = path.join(root, 'tests/fixtures/audio/aurora');
let chunks: Chunk[] = [];

test.skip(!modelRoot, 'Export Citrinet and set CITRINET_EVAL_ROOT before running this evaluation');
test.beforeAll(build);
function build(): void {
  chunks = JSON.parse(
    execFileSync(
      process.execPath,
      [path.join(root, 'tests/scripts/build-preact-probe.mjs'), 'VoiceIdCitrinetProbe.ts'],
      { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
    ),
  );
}

async function serve(route: Route): Promise<void> {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname === '/citrinet-evaluation') {
    await route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Citrinet comparison</title><script type="module" src="/lab/probe.js"></script>',
    });
    return;
  }
  const chunk = chunks.find(sameName.bind(null, pathname.slice('/lab/'.length)));
  if (pathname.startsWith('/lab/') && chunk) {
    await route.fulfill({ contentType: 'text/javascript', body: chunk.code });
    return;
  }
  const name = path.basename(pathname);
  if (
    pathname.startsWith('/citrinet/') &&
    ['citrinet-int8.onnx', 'vocabulary.json'].includes(name) &&
    modelRoot
  ) {
    await route.fulfill({
      path: path.join(modelRoot, name),
      contentType: name.endsWith('.json') ? 'application/json' : 'application/octet-stream',
    });
    return;
  }
  if (
    pathname.startsWith('/sdk/voiceid/') &&
    ['aurora-int8.onnx', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'].includes(name)
  ) {
    await route.fulfill({
      path: path.join(root, 'packages/voiceid/dist/public/sdk/voiceid', name),
      contentType: name.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream',
    });
    return;
  }
  await route.abort();
}

function sameName(name: string, chunk: Chunk): boolean {
  return chunk.fileName === name;
}
function ready(): boolean {
  return typeof window.prepareCitrinetComparison === 'function';
}
function prepare(): Promise<number> {
  return window.prepareCitrinetComparison();
}
function compare(input: { audio: string; expected: number; first: 'aurora' | 'citrinet' }) {
  return window.compareCitrinetRecording(input.audio, input.expected, input.first);
}

async function run({ page }: { page: Page }, info: TestInfo): Promise<void> {
  info.setTimeout(240_000);
  await page.route('**/*', serve);
  await page.goto('/citrinet-evaluation');
  await page.waitForFunction(ready);
  const coldPrepareMs = await page.evaluate(prepare);
  const cases: Omit<BenchmarkResult, 'sha256' | 'result'>[] = [];
  for (let index = 0; index < SPOKEN_PHRASES.length; index += 1) {
    cases.push({ file: `natural/${index}.wav`, expected: index, category: 'correct' });
  }
  const voices: { file: string; spoken: string; voice: string }[] = JSON.parse(
    fs.readFileSync(path.join(fixtures, 'tolerance/generation.json'), 'utf8'),
  );
  for (const voice of voices) {
    if (voice.voice === 'Samantha') continue;
    const expected = SPOKEN_PHRASES.findIndex(samePhrase.bind(null, voice.spoken));
    if (expected < 0) throw new Error('Unknown synthetic control phrase');
    cases.push({ file: `tolerance/${voice.file}`, expected, category: 'correct' });
  }
  const controls = [
    { name: 'unrelated', expected: 9 },
    { name: 'reordered', expected: 9 },
    { name: 'negated', expected: 2 },
    { name: 'fragment', expected: 9 },
    { name: 'missing-negation', expected: 11 },
    { name: 'changed-negation', expected: 11 },
    { name: 'extra-negation', expected: 13 },
    { name: 'ambiguous-ending', expected: 24 },
    { name: 'outside-bound-quote', expected: 9 },
    { name: 'ambiguous', expected: 0 },
  ];
  for (const control of controls) {
    cases.push({
      file: `tolerance/${control.name}.wav`,
      expected: control.expected,
      category: 'control',
    });
  }
  const results: BenchmarkResult[] = [];
  for (const item of cases) {
    const bytes = fs.readFileSync(path.join(fixtures, item.file));
    const input: Parameters<typeof compare>[0] = {
      audio: bytes.toString('base64'),
      expected: item.expected,
      first: results.length % 2 === 0 ? 'aurora' : 'citrinet',
    };
    const result: Comparison = await page.evaluate(compare, input);
    results.push({ ...item, sha256: createHash('sha256').update(bytes).digest('hex'), result });
    for (const model of ['aurora', 'citrinet'] as const) {
      const measured = result[model];
      expect.soft(measured.milliseconds).toBeGreaterThan(0);
      expect.soft(measured.kind).toBe('processed');
      if (measured.kind !== 'processed') continue;
      if (item.category === 'control')
        expect.soft(measured.check.kind, `${model} ${item.file}`).toBe('mismatch');
      else {
        const otherChallenges = measured.acceptedChallenges.filter(
          otherPhrase.bind(null, SPOKEN_PHRASES[item.expected]),
        );
        expect.soft(otherChallenges, `${model} wrong targets for ${item.file}`).toEqual([]);
      }
    }
  }
  if (!modelRoot) throw new Error('Citrinet export is required');
  const nativeParity = JSON.parse(
    fs.readFileSync(path.join(modelRoot, 'native-parity.json'), 'utf8'),
  );
  const floatBytes = fs.readFileSync(path.join(modelRoot, 'citrinet-fp32.onnx'));
  expect(nativeParity.modelSha256).toBe(createHash('sha256').update(floatBytes).digest('hex'));
  const report = {
    source: 'synthetic_fixture',
    humanAccuracyMeasured: false,
    browser: await page.evaluate(browserMetadata),
    machine: { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model },
    coldPrepareMs,
    warmPrepareMs: await page.evaluate(prepare),
    export: JSON.parse(fs.readFileSync(path.join(modelRoot, 'export.json'), 'utf8')),
    nativeParity,
    summary: { aurora: summarize(results, 'aurora'), citrinet: summarize(results, 'citrinet') },
    results,
  };
  const file = info.outputPath('citrinet-comparison.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  await info.attach('citrinet-comparison.json', { path: file, contentType: 'application/json' });
}
function summarize(results: readonly BenchmarkResult[], model: 'aurora' | 'citrinet') {
  let correctTrials = 0;
  let matched = 0;
  let controls = 0;
  let controlsAccepted = 0;
  let wrongTargetsAccepted = 0;
  let failed = 0;
  const timings: number[] = [];
  for (const item of results) {
    const measured = item.result[model];
    if (item.category === 'correct') correctTrials += 1;
    else controls += 1;
    if (measured.kind === 'failed') {
      failed += 1;
      continue;
    }
    timings.push(measured.milliseconds);
    if (measured.check.kind === 'matched') {
      if (item.category === 'correct') matched += 1;
      else controlsAccepted += 1;
    }
    if (item.category === 'correct') {
      for (const challenge of measured.acceptedChallenges) {
        if (challenge !== SPOKEN_PHRASES[item.expected]) wrongTargetsAccepted += 1;
      }
    }
  }
  timings.sort(compareNumbers);
  let medianMs: number | null = null;
  let p95Ms: number | null = null;
  let maximumMs: number | null = null;
  if (timings.length > 0) {
    const middle = Math.floor(timings.length / 2);
    medianMs =
      timings.length % 2 === 0 ? (timings[middle - 1] + timings[middle]) / 2 : timings[middle];
    p95Ms = timings[Math.ceil(timings.length * 0.95) - 1];
    maximumMs = timings[timings.length - 1];
  }
  return {
    correctTrials,
    matched,
    controls,
    controlsAccepted,
    wrongTargetsAccepted,
    failed,
    medianMs,
    p95Ms,
    maximumMs,
  };
}
function compareNumbers(left: number, right: number): number {
  return left - right;
}
function browserMetadata() {
  return {
    userAgent: navigator.userAgent,
    crossOriginIsolated,
    logicalProcessors: navigator.hardwareConcurrency,
  };
}
function samePhrase(text: string, phrase: string): boolean {
  return text === phrase;
}
function otherPhrase(expected: string, phrase: string): boolean {
  return expected !== phrase;
}
test('Citrinet INT8 and Aurora process identical audio with unchanged phrase checks', run);

test(
  'local comparison captures once, labels failures, and exports scores without audio or transcripts',
  captureJourney,
);
async function captureJourney({ page }: { page: Page }, info: TestInfo): Promise<void> {
  info.setTimeout(90_000);
  if (!modelRoot) throw new Error('Citrinet export is required');
  const running = await startComparisonServer({
    port: 0,
    source: 'synthetic_fixture',
    directory: modelRoot,
  });
  const requests: { url: string; method: string }[] = [];
  page.on('request', recordRequest.bind(null, requests));
  try {
    const observation = JSON.parse(
      execFileSync(
        process.execPath,
        [
          path.join(root, 'tests/scripts/build-preact-probe.mjs'),
          'VoiceIdMicrophoneObservation.ts',
        ],
        { encoding: 'utf8' },
      ),
    );
    await page.addInitScript({ content: observation[0].code });
    await page.route(/\/voiceid-test-audio\/(\d+)\.wav$/, serveSpeech);
    await page.goto(running.url);
    await page.getByRole('button', { name: 'Prepare speech models' }).click();
    await expect(page.locator('#status')).toContainText('Confirm participation');
    expect(requests.some(modelRequest)).toBe(false);
    await page.locator('#consent').check();
    await page.getByRole('button', { name: 'Prepare speech models' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-phase', 'ready', { timeout: 30_000 });
    await recordAndLabel(page, 'I read it correctly');
    await page.evaluate(useWrongPhrase);
    await recordAndLabel(page, 'I stumbled');
    for (let index = 0; index < 3; index += 1) {
      await recordAndLabel(page, 'I read it correctly');
    }
    for (const name of ['negated', 'missing-negation', 'unrelated']) {
      const audio = fs.readFileSync(path.join(fixtures, 'tolerance', `${name}.wav`));
      await page.evaluate(useAudio, audio.toString('base64'));
      await recordAndLabel(page, 'I read it correctly');
    }
    await expect(page.locator('body')).toHaveAttribute('data-phase', 'complete');
    await expect(page.locator('#status')).toHaveText('Finished. Export your comparison scores.');
    await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeHidden();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export comparison scores' }).click();
    const file = info.outputPath('capture-comparison.json');
    await (await pending).saveAs(file);
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(report.source).toBe('synthetic_fixture');
    expect(report.attempts).toHaveLength(8);
    expect(report.attempts[0]).toMatchObject({
      reading: 'as_shown',
      result: { kind: 'compared', aurora: { matched: true }, citrinet: { matched: true } },
    });
    expect(report.attempts[1]).toMatchObject({
      reading: 'stumbled',
      result: { kind: 'compared', aurora: { matched: false }, citrinet: { matched: false } },
    });
    for (const attempt of report.attempts.slice(5)) {
      expect(attempt).toMatchObject({
        assignment: { kind: 'control' },
        result: { aurora: { matched: false }, citrinet: { matched: false } },
      });
    }
    expect(forbiddenKeys(report)).toEqual([]);
    for (const request of requests) {
      expect(request.method).toBe('GET');
      expect(new URL(request.url).origin).toBe(new URL(running.url).origin);
    }
    await page.screenshot({ path: info.outputPath('comparison-session.png'), fullPage: true });
    await info.attach('capture-comparison.json', { path: file, contentType: 'application/json' });
    await page.evaluate(closeSession);
    await expect(page.locator('body')).toHaveAttribute('data-phase', 'closed');
    await expect(page.getByRole('button', { name: 'Export comparison scores' })).toBeDisabled();
  } finally {
    running.server.closeAllConnections();
    running.server.close();
  }
}
function modelRequest(request: { url: string }): boolean {
  return /\.(onnx|wasm)(\?|$)/.test(request.url);
}
function recordRequest(requests: { url: string; method: string }[], request: Request): void {
  requests.push({ url: request.url(), method: request.method() });
}
async function serveSpeech(route: Route): Promise<void> {
  await route.fulfill({
    path: path.join(fixtures, 'natural', path.basename(new URL(route.request().url()).pathname)),
    contentType: 'audio/wav',
  });
}
async function recordAndLabel(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByRole('button', { name: label })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#capture')).toContainText('Comparison complete. Label your reading.');
  await page.getByRole('button', { name: label }).click();
}
function useWrongPhrase(): void {
  window.voiceIdUseNextWrongPhrase();
}
function useAudio(base64: string): void {
  window.voiceIdNextAudio(base64);
}
function closeSession(): void {
  window.dispatchEvent(new Event('pagehide'));
}
function forbiddenKeys(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return [];
  const found: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (['samples', 'logits', 'decodedText', 'embedding', 'template', 'deviceId'].includes(key))
      found.push(key);
    found.push(...forbiddenKeys(child));
  }
  return found;
}
