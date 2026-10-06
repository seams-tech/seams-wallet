import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Frame, Route } from '@playwright/test';
import { expect } from '@playwright/test';
import { intendedTest as test } from './harness';
import { walletFrame } from './session-restore-lock';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function serve(source: string, route: Route): Promise<void> {
  await route.fulfill({ contentType: 'text/javascript', body: source });
}

async function readCount(frame: Frame, walletId: string): Promise<number> {
  return frame.evaluate(countInBrowser, walletId);
}

async function countInBrowser(walletId: string): Promise<number> {
  const url = '/__presign-generation-storage.js';
  const probe = await import(url);
  return probe.count(walletId);
}

async function runInBrowser(walletId: string): Promise<unknown> {
  const url = '/__presign-generation-storage.js';
  const probe = await import(url);
  return probe.run(walletId);
}

test('ownership advancement deletes durable presignatures and rejects delayed old admission', async ({
  harness,
  page,
}, info) => {
  info.setTimeout(180_000);
  const root = path.resolve(import.meta.dirname, '../../..');
  const bundle = await build({
    entryPoints: [path.join(import.meta.dirname, 'presign-generation-storage.probe.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    tsconfig: path.join(root, 'packages/wallet/tsconfig.json'),
  });
  await page.route(
    '**/__presign-generation-storage.js',
    serve.bind(null, bundle.outputFiles[0]!.text),
  );
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  const frame = await walletFrame(page);
  await expect
    .poll(readCount.bind(null, frame, harness.walletId), { timeout: 30_000 })
    .toBeGreaterThan(0);
  await harness.lockWallet();
  const evidence = await frame.evaluate(runInBrowser, harness.walletId);
  expect(evidence).toEqual({
    afterAdvance: 0,
    delayedOldAdmission: 'persistence_ambiguous',
    oldAvailable: 0,
    rollbackRejected: true,
    currentAdmission: 'stored',
    currentConsumption: 'opened',
  });
  await writeFile(
    info.outputPath('presign-generation-storage.json'),
    JSON.stringify(
      {
        scope:
          'Real registered material with a local storage generation transition; no regional relocation.',
        evidence,
      },
      null,
      2,
    ),
  );
});
