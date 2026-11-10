import { test, expect, type Route } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type {} from '../fixtures/ui/VoiceIdBackProbe';

type Chunk = { fileName: string; code: string };
let chunks: Chunk[];

test.beforeAll(() => {
  chunks = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve(import.meta.dirname, '../scripts/build-preact-probe.mjs'),
        'VoiceIdBackProbe.ts',
      ],
      { encoding: 'utf8' },
    ),
  );
});

async function serveChunk(route: Route): Promise<void> {
  const name = path.basename(new URL(route.request().url()).pathname);
  const chunk = chunks.find((candidate) => candidate.fileName === name);
  await route.fulfill({
    status: chunk ? 200 : 404,
    contentType: 'text/javascript',
    body: chunk?.code ?? '',
  });
}

// In an app's dialog with a step before it, the VoiceID card's corner control is Back.
test('the VoiceID card shows Back in place of Cancel for a step with Back', async ({ page }) => {
  await page.route('**/back-probe/*', serveChunk);
  await page.route('**/voiceid-back', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>VoiceID Back</title><script type="module" src="/back-probe/probe.js"></script>',
    }),
  );
  await page.goto('/voiceid-back');
  await page.waitForFunction(() => Boolean(window.voiceBackProbe));

  const cancel = await page.evaluate(() => window.voiceBackProbe.corner());
  expect(cancel).toMatchObject({ label: 'Cancel', path: 'M6 6l12 12M18 6L6 18' });
  expect(cancel.right).toBeLessThan(cancel.left);

  await page.evaluate(() => window.voiceBackProbe.showBack());
  const back = await page.evaluate(() => window.voiceBackProbe.corner());
  expect(back).toMatchObject({ label: 'Back', path: 'm15 18-6-6 6-6' });
  // Back moves to the leading corner, as far from the edge as Cancel was.
  expect(back.left).toBeCloseTo(cancel.right, 0);
});
