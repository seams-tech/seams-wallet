import { expect, test, type Page, type Locator } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { injectImportMap } from '../setup/bootstrap';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import { routePreactModules } from '../setup/preact';

const root = path.resolve(import.meta.dirname, '../..');
const savedLit = path.join(root, '.artifacts/refactor-127/lit-baseline-build/esm');
const output = path.join(root, '.artifacts/refactor-127/visual/export');
type Renderer = 'lit' | 'preact';
type FixtureState = 'ready' | 'multi-key' | 'loading' | 'failed' | 'copied' | 'appearance';

async function preparePage(page: Page, renderer: Renderer): Promise<void> {
  await injectImportMap(page);
  await routePreactModules(page);
  if (renderer === 'lit') {
    await page.route('**/_test-sdk/esm/**', (route) => {
      const relative = new URL(route.request().url()).pathname.split('/_test-sdk/esm/')[1];
      const file = path.resolve(savedLit, relative);
      if (!file.startsWith(`${savedLit}${path.sep}`) || !fs.existsSync(file)) return route.abort();
      return route.fulfill({ path: file });
    });
    await page.route('**/sdk/**', (route) => {
      const relative = new URL(route.request().url()).pathname.split('/sdk/').at(-1)!;
      const file = path.resolve(savedLit, 'sdk', relative);
      if (!file.startsWith(`${savedLit}/sdk${path.sep}`) || !fs.existsSync(file))
        return route.fallback();
      return route.fulfill({ path: file });
    });
  }
  const components = path.join(
    renderer === 'lit' ? savedLit : path.join(root, 'packages/wallet/dist/esm'),
    'sdk/seams-components.css',
  );
  await page.route('**/seams-components.css', (route) => route.fulfill({ path: components }));
  await page.route('**/export-visual.css', (route) =>
    route.fulfill({ path: path.join(root, 'packages/wallet/dist/esm/sdk/confirmation-ui.css') }),
  );
  await page.route('**/export-preact-visual', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}<link rel="stylesheet" data-seams-components-css href="/seams-components.css"><link rel="stylesheet" data-seams-confirmation-css href="/export-visual.css"></head><body></body></html>`,
    }),
  );
  await page.goto('/export-preact-visual');
}

async function waitForStableSurface(surface: Locator): Promise<void> {
  let previous = '';
  let count = 0;
  await expect
    .poll(
      async () => {
        const box = JSON.stringify(await surface.boundingBox());
        count = box === previous ? count + 1 : 0;
        previous = box;
        return count;
      },
      { intervals: [100], timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(3);
}

function compare(before: Buffer, after: Buffer, name: string, scrollEdge: number | null) {
  const left = PNG.sync.read(before);
  const right = PNG.sync.read(after);
  expect({ width: right.width, height: right.height }).toEqual({
    width: left.width,
    height: left.height,
  });
  const joined = new PNG({ width: left.width * 2, height: left.height });
  let changedPixels = 0;
  let changedOutsideScrollEdge = 0;
  for (let y = 0; y < left.height; y += 1) {
    for (let x = 0; x < left.width; x += 1) {
      const offset = (y * left.width + x) * 4;
      const a = left.data.subarray(offset, offset + 4);
      const b = right.data.subarray(offset, offset + 4);
      if (!a.equals(b)) {
        changedPixels += 1;
        if (scrollEdge === null || y < scrollEdge - 16 || y >= scrollEdge) {
          changedOutsideScrollEdge += 1;
        }
      }
      a.copy(joined.data, (y * joined.width + x) * 4);
      b.copy(joined.data, (y * joined.width + left.width + x) * 4);
    }
  }
  fs.writeFileSync(path.join(output, `${name}-comparison.png`), PNG.sync.write(joined));
  return {
    changedPixels,
    changedOutsideScrollEdge,
    fraction: changedPixels / (left.width * left.height),
  };
}

for (const viewport of [
  { width: 1024, height: 900 },
  { width: 390, height: 844 },
]) {
  for (const theme of ['light', 'dark'] as const) {
    for (const surfaceContext of ['wallet-iframe', 'standalone'] as const) {
      for (const state of [
        'ready',
        'multi-key',
        'loading',
        'failed',
        'copied',
        'appearance',
      ] as const) {
        test(`export/${viewport.width}/${surfaceContext}/${state}-${theme}`, async ({
          context,
        }) => {
          fs.mkdirSync(output, { recursive: true });
          const name = `${surfaceContext}-${state}-${theme}${viewport.width === 1024 ? '' : '-narrow'}`;
          const captures: Buffer[] = [];
          const geometry = [];
          for (const renderer of ['lit', 'preact'] as const) {
            const page = await context.newPage();
            try {
              await page.setViewportSize(viewport);
              await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
              await preparePage(page, renderer);
              await page.evaluate(
                async ({
                  theme,
                  surfaceContext,
                  state,
                }: {
                  theme: 'light' | 'dark';
                  surfaceContext: 'wallet-iframe' | 'standalone';
                  state: FixtureState;
                }) => {
                  document.documentElement.dataset.seamsTheme = theme;
                  Object.defineProperty(navigator, 'clipboard', {
                    configurable: true,
                    value: { writeText: async () => {} },
                  });
                  const entries = [
                    {
                      id: 'evm',
                      scheme: 'secp256k1' as 'secp256k1' | 'ed25519',
                      label: 'EVM',
                      publicKey: '0x02abcd',
                      address: '0x1234567890abcdef',
                      privateKey: `0x${'1234567890abcdef'.repeat(4)}`,
                    },
                  ];
                  if (state === 'multi-key')
                    entries.push({
                      id: 'near',
                      scheme: 'ed25519',
                      label: 'NEAR',
                      publicKey: 'ed25519:synthetic-public-key',
                      address: '',
                      privateKey: `ed25519:${'123456789ABCDEFGH'.repeat(4)}`,
                    });
                  const prefix = '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/';
                  const { upsertExportViewerHost } = await import(`${prefix}export-viewer-host.js`);
                  await upsertExportViewerHost({
                    theme,
                    variant: 'drawer',
                    accountId: 'synthetic.testnet',
                    keys: (state === 'failed' ? [] : entries).map((entry) => ({
                      ...entry,
                      privateKey: state === 'loading' ? '' : entry.privateKey,
                    })),
                    loading: state === 'loading',
                    errorMessage: state === 'failed' ? 'Export failed. Please try again.' : '',
                    appearance:
                      state === 'appearance'
                        ? {
                            palette: 'default',
                            theme: {
                              id: 'default',
                              mode: theme,
                              colors: { success: '#8367ce', textPrimary: '#987bcf' },
                            },
                          }
                        : undefined,
                    surfaceMeasurementBinding:
                      surfaceContext === 'standalone'
                        ? { kind: 'disabled' }
                        : {
                            kind: 'wallet_iframe',
                            requestId: 'export-visual',
                            hostSurfaceVariant: 'modal',
                            postMeasurement: () => {},
                          },
                  });
                  await document.fonts.ready;
                },
                { theme, surfaceContext, state },
              );
              const surface = page.locator(
                renderer === 'lit' ? 'seams-drawer .drawer' : '.seams-confirmation-drawer',
              );
              await expect(surface).toBeVisible();
              await waitForStableSurface(surface);
              if (state === 'copied' || state === 'appearance') {
                await page.getByRole('button', { name: 'Copy private key', exact: true }).click();
                await expect(
                  page.getByRole('button', { name: 'Private key copied', exact: true }),
                ).toBeVisible();
              }
              geometry.push({ renderer, box: await surface.boundingBox() });
              captures.push(
                await page.screenshot({ path: path.join(output, `${name}-${renderer}.png`) }),
              );
              if (
                renderer === 'preact' &&
                surfaceContext === 'wallet-iframe' &&
                state === 'multi-key'
              ) {
                await page.locator('.warning').last().scrollIntoViewIfNeeded();
                await page.screenshot({ path: path.join(output, `${name}-preact-scrolled.png`) });
              }
            } finally {
              await page.close();
            }
          }
          const before = geometry[0].box!;
          const after = geometry[1].box!;
          const hostedMultiKey = surfaceContext === 'wallet-iframe' && state === 'multi-key';
          const comparison = compare(
            captures[0],
            captures[1],
            name,
            hostedMultiKey ? after.y + after.height : null,
          );
          fs.writeFileSync(
            path.join(output, `${name}.json`),
            JSON.stringify({ geometry, comparison }, null, 2),
          );
          expect(after.x).toBeCloseTo(before.x, 2);
          expect(after.y).toBeCloseTo(before.y, 2);
          expect(after.width).toBeCloseTo(before.width, 2);
          if (hostedMultiKey) {
            // The replacement scrolls long exports inside the fixed hosted box.
            expect(after.height).toBe(576);
            // The content above the scroll boundary remains tightly matched; the
            // lower strip contains the intentional legacy-height difference.
            expect(comparison.changedOutsideScrollEdge).toBeLessThan(
              viewport.width * viewport.height * (viewport.width < 500 ? 0.008 : 0.005),
            );
            expect(comparison.changedPixels).toBeLessThan(
              viewport.width * viewport.height * (viewport.width < 500 ? 0.015 : 0.004),
            );
          } else {
            // Content-box padding is included in the replacement's viewport height.
            expect(after.height).toBeCloseTo(
              before.height - (surfaceContext === 'standalone' ? 16 : 0),
              2,
            );
            expect(comparison.fraction).toBeLessThan(0.001);
          }
        });
      }
    }
  }
}
