import { test, expect, type Page, type Route, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';

type ProbeChunk = { fileName: string; code: string };
let chunks: ProbeChunk[];

test.beforeAll(buildProbe);
function buildProbe(): void {
  chunks = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve(import.meta.dirname, '../scripts/build-preact-probe.mjs'),
        'VoiceCaptureProbe.ts',
      ],
      { encoding: 'utf8' },
    ),
  );
}
async function serveScript(route: Route): Promise<void> {
  const file = path.basename(new URL(route.request().url()).pathname);
  const chunk = chunks.find(matchesChunk.bind(null, file));
  await route.fulfill({
    status: chunk ? 200 : 404,
    contentType: 'application/javascript',
    body: chunk?.code ?? '',
  });
}
function matchesChunk(file: string, chunk: ProbeChunk): boolean {
  return chunk.fileName === file;
}
async function servePage(route: Route): Promise<void> {
  await route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><body><script type="module" src="/capture-probe/probe.js"></script></body></html>',
  });
}

test(
  'capture preserves initial and internal pauses, ends on silence, and releases cancelled input',
  verifyCapture,
);
async function verifyCapture({ page }: { page: Page }, testInfo: TestInfo): Promise<void> {
  await page.route('**/capture-probe/*', serveScript);
  await page.route('**/capture-check', servePage);
  await page.goto('/capture-check');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-result', /"captured"/, {
    timeout: 10_000,
  });
  const completed = JSON.parse((await page.locator('body').getAttribute('data-result'))!);
  expect(completed.quality.endedBy).toBe('pause');
  expect(completed.quality.recordingMs).toBeGreaterThan(5_300);
  expect(completed.quality.recordingMs).toBeLessThan(6_000);
  expect(completed.quality.voicedMs).toBeGreaterThanOrEqual(900);
  expect(completed.quality.voicedMs).toBeLessThan(1_300);
  expect(completed.tracks).toEqual(['ended']);

  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-capture', 'listening');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-result', /"rejected"/);
  const cancelled = JSON.parse((await page.locator('body').getAttribute('data-result'))!);
  expect(cancelled.message).toContain('cancelled');
  expect(cancelled.tracks).toEqual(['ended']);
  const report = testInfo.outputPath('voiceid-pause-capture.json');
  await writeFile(
    report,
    JSON.stringify(
      {
        completed,
        cancelled,
        input: 'synthetic tone through real browser MediaRecorder; no identity inference',
        timelineMs: {
          click: [100, 120],
          speech: [
            [2200, 2500],
            [3250, 3950],
          ],
          expectedStop: 5450,
        },
      },
      null,
      2,
    ),
  );
  await testInfo.attach('voiceid-pause-capture.json', {
    path: report,
    contentType: 'application/json',
  });
}
