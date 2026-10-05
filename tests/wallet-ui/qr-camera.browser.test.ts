import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { injectImportMap } from '../setup/bootstrap';

declare global {
  interface Window {
    cameraEvidence(): { requests: MediaStreamConstraints[]; tracks: MediaStreamTrackState[] };
    unmountCamera(): void;
  }
}

function readEvidence() {
  return window.cameraEvidence();
}

function unmountCamera() {
  window.unmountCamera();
}

test('camera retries denied access, switches devices, and releases streams on stop, mode change, and unmount', async ({
  page,
  baseURL,
}, testInfo) => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../fixtures/ui/qr-camera.tsx', import.meta.url))],
    bundle: true,
    write: false,
    format: 'esm',
    jsx: 'automatic',
    external: ['react', 'react-dom/client', 'react/jsx-runtime'],
  });
  await injectImportMap(page, { frontendUrl: baseURL! });
  await page.goto(baseURL!);
  await page.addScriptTag({ type: 'module', content: bundle.outputFiles[0].text });
  const state = page.getByTestId('state');
  await expect(state).toContainText('Camera access was blocked');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(state).toContainText('"error":null');
  await expect.poll(page.evaluate.bind(page, readEvidence)).toMatchObject({ tracks: ['live'] });
  await page.getByRole('button', { name: 'Back camera', exact: true }).click();
  await expect(state).toContainText('"selected":"back"');
  await expect
    .poll(page.evaluate.bind(page, readEvidence))
    .toMatchObject({ tracks: ['ended', 'live'] });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(state).toContainText('"scanning":false');
  await expect
    .poll(page.evaluate.bind(page, readEvidence))
    .toMatchObject({ tracks: ['ended', 'ended'] });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect
    .poll(page.evaluate.bind(page, readEvidence))
    .toMatchObject({ tracks: ['ended', 'ended', 'live'] });
  await page.getByRole('button', { name: 'File mode', exact: true }).click();
  await expect
    .poll(page.evaluate.bind(page, readEvidence))
    .toMatchObject({ tracks: ['ended', 'ended', 'ended'] });
  await page.getByRole('button', { name: 'Camera mode', exact: true }).click();
  await expect
    .poll(page.evaluate.bind(page, readEvidence))
    .toMatchObject({ tracks: ['ended', 'ended', 'ended', 'live'] });
  await page.evaluate(unmountCamera);
  const evidence = await page.evaluate(readEvidence);
  expect(evidence.tracks).toEqual(['ended', 'ended', 'ended', 'ended']);
  expect(evidence.requests).toHaveLength(5);
  expect(evidence.requests[2].video).toMatchObject({ deviceId: 'back' });
  await writeFile(testInfo.outputPath('camera-lifecycle.json'), JSON.stringify(evidence, null, 2));
});
