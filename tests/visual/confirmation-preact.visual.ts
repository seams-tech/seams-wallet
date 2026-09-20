import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { injectImportMap } from '../setup/bootstrap';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import { routePreactModules } from '../setup/preact';
import { SDK_ESM_PATHS } from '../setup';

const root = path.resolve(import.meta.dirname, '../..');
const output = path.join(root, '.artifacts/refactor-127/visual');
const afterRoot = path.join(output, 'preact-after');
const diffRoot = path.join(output, 'diff');
const savedLitRoot = path.join(root, '.artifacts/refactor-127/lit-baseline-build/esm');
const renderer = process.env.CONFIRMATION_VISUAL_RENDERER ?? 'preact';
const captureSavedLit = renderer === 'saved-lit';
const comparisons: Record<string, unknown>[] = [];

const confirmationCssFiles = [
  'confirmation-primitives',
  'confirm-header',
  'confirmation-body',
  'passkey-registration',
  'email-otp',
  'confirm-content',
  'transaction-tree',
  'confirmation-modal',
  'confirmation-drawer',
];

function readConfirmationCss(): string {
  return confirmationCssFiles
    .map((name) =>
      fs.readFileSync(
        path.join(
          root,
          `packages/wallet/src/core/signingEngine/uiConfirm/ui/preact/${name}.css`,
        ),
        'utf8',
      ),
    )
    .join('\n');
}

function compareImages(beforePath: string, afterPath: string, diffPath: string) {
  const before = PNG.sync.read(fs.readFileSync(beforePath));
  const after = PNG.sync.read(fs.readFileSync(afterPath));
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const diff = new PNG({ width, height });
  const sideBySide = new PNG({ width: width * 3, height });
  let changedPixels = 0;
  let maxChannelDelta = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let delta = 0;
      for (let channel = 0; channel < 4; channel += 1) {
        const left =
          x < before.width && y < before.height
            ? before.data[(y * before.width + x) * 4 + channel]
            : 0;
        const right =
          x < after.width && y < after.height
            ? after.data[(y * after.width + x) * 4 + channel]
            : 0;
        delta = Math.max(delta, Math.abs(left - right));
        sideBySide.data[(y * width * 3 + x) * 4 + channel] = left;
        sideBySide.data[(y * width * 3 + width + x) * 4 + channel] = right;
      }
      if (delta > 0) changedPixels += 1;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      const offset = (y * width + x) * 4;
      diff.data[offset] = delta > 0 ? 255 : 0;
      diff.data[offset + 3] = 255;
      diff.data.copy(sideBySide.data, (y * width * 3 + 2 * width + x) * 4, offset, offset + 4);
    }
  }
  fs.mkdirSync(path.dirname(diffPath), { recursive: true });
  fs.writeFileSync(diffPath, PNG.sync.write(diff));
  fs.writeFileSync(diffPath.replace('.png', '-comparison.png'), PNG.sync.write(sideBySide));
  return {
    before: { width: before.width, height: before.height },
    after: { width: after.width, height: after.height },
    changedPixels,
    maxChannelDelta,
  };
}

async function waitForStableSurface(surface: Locator): Promise<void> {
  let previous = '';
  let stableSamples = 0;
  await expect
    .poll(
      async () => {
        const box = JSON.stringify(await surface.boundingBox());
        stableSamples = box === previous ? stableSamples + 1 : 0;
        previous = box;
        return stableSamples;
      },
      { intervals: [100], timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(3);
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await injectImportMap(page);
  await routePreactModules(page);
  if (captureSavedLit) {
    await page.route('**/_test-sdk/esm/**', (route) => {
      const marker = '/_test-sdk/esm/';
      const pathname = new URL(route.request().url()).pathname;
      const relative = pathname.slice(pathname.indexOf(marker) + marker.length);
      const file = path.join(savedLitRoot, relative);
      if (!file.startsWith(`${savedLitRoot}${path.sep}`) || !fs.existsSync(file)) {
        return route.abort();
      }
      return route.fulfill({ path: file });
    });
    await page.route('**/sdk/**', (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const marker = '/sdk/';
      const relative = pathname.slice(pathname.lastIndexOf(marker) + marker.length);
      const file = path.join(savedLitRoot, 'sdk', relative);
      if (!file.startsWith(`${savedLitRoot}/sdk${path.sep}`) || !fs.existsSync(file)) {
        return route.fallback();
      }
      return route.fulfill({ path: file });
    });
  }
  const confirmationCss = readConfirmationCss();
  const componentsCss = fs.readFileSync(
    path.join(root, 'packages/wallet/dist/esm/sdk/seams-components.css'),
    'utf8',
  );
  await page.route('**/confirmation-ui.css', (route) =>
    route.fulfill({ contentType: 'text/css', body: captureSavedLit ? '' : confirmationCss }),
  );
  await page.route('**/seams-components.css', (route) =>
    captureSavedLit
      ? route.fulfill({ path: path.join(savedLitRoot, 'sdk/seams-components.css') })
      : route.fulfill({ contentType: 'text/css', body: componentsCss }),
  );
  await page.route('**/confirmation-preact-visual', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}<link rel="stylesheet" data-seams-components-css href="/seams-components.css"><link rel="stylesheet" data-seams-confirmation-css href="/confirmation-ui.css"></head><body><main id="visual-root"></main></body></html>`,
    }),
  );
  await page.goto('/confirmation-preact-visual');
  await page.addStyleTag({ content: '* { animation: none !important; transition: none !important; }' });
});

for (const theme of ['light', 'dark'] as const) {
  for (const variant of ['modal', 'drawer'] as const) {
    for (const state of ['default', 'loading', 'error'] as const) {
      test(`confirmation/${variant}/${state}-${theme}`, async ({ page, browser }) => {
        await page.setViewportSize({ width: 1024, height: 900 });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await page.evaluate(
          async ({ confirmUiPath, variant, state, theme }) => {
            document.documentElement.dataset.seamsTheme = theme;
            const { mountConfirmUI } = await import(confirmUiPath);
            const handle = await mountConfirmUI({
              ctx: {
                userPreferencesManager: { getCurrentWalletId: () => 'visual-fixture.testnet' },
                surfaceMeasurementBinding: {
                  kind: 'wallet_iframe' as const,
                  requestId: `visual-${variant}-${state}`,
                  hostSurfaceVariant: 'modal' as const,
                  postMeasurement: () => {},
                },
              },
              summary: { title: 'Review transaction', body: 'Synthetic visual fixture' },
              model: {
                chain: 'evm' as const,
                chainId: 11155111,
                title: 'Review transaction',
                operations: [
                  {
                    id: 'contract-call',
                    kind: 'generic.contractCall' as const,
                    label: 'Transfer to contract',
                    to: '0x1111111111111111111111111111111111111111',
                    fields: [
                      { label: 'recipient', value: 'visual-fixture' },
                      {
                        label: 'calldata',
                        value: '{\n  "amount": "1000000"\n}',
                        renderAs: 'file-content' as const,
                        contentVariants: {
                          decoded: '{\n  "amount": "1000000"\n}',
                          raw: '0xa9059cbb',
                          defaultMode: 'decoded' as const,
                        },
                        copyValue: '0xa9059cbb',
                      },
                    ],
                  },
                ],
              },
              securityContext: { rpId: 'wallet.example.test', blockHeight: '1' },
              loading: state === 'loading',
              theme,
              uiMode: variant,
              nearAccountIdOverride: 'visual-fixture.testnet',
            });
            (globalThis as { __preactVisualHandle?: typeof handle }).__preactVisualHandle = handle;
          },
          {
            confirmUiPath: SDK_ESM_PATHS.confirmUi,
            variant,
            state,
            theme,
          },
        );
        const surface = captureSavedLit
          ? page.locator('seams-tx-confirmer')
          : page.locator(
              variant === 'modal'
                ? '.seams-confirmation-modal .modal-container-root'
                : '.seams-confirmation-drawer',
            );
        await expect(surface).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await waitForStableSurface(surface);
        if (state === 'error') {
          await page.evaluate(() => {
            const handle = (globalThis as {
              __preactVisualHandle?: { update: (update: { errorMessage: string }) => void };
            }).__preactVisualHandle;
            if (!handle) throw new Error('Confirmation handle is missing');
            handle.update({ errorMessage: 'Unable to prepare transaction.' });
          });
          await waitForStableSurface(surface);
        }

        const rendererRoot = captureSavedLit ? path.join(output, 'lit-production') : afterRoot;
        const surfacePath = path.join(
          rendererRoot,
          `seams-${variant}-tx-confirmer/${state}-${theme}.png`,
        );
        const contentPath = path.join(
          rendererRoot,
          `seams-tx-confirm-content/${variant}-${state}-${theme}.png`,
        );
        fs.mkdirSync(path.dirname(surfacePath), { recursive: true });
        fs.mkdirSync(path.dirname(contentPath), { recursive: true });
        await surface.screenshot({ path: surfacePath, animations: 'disabled' });
        const content = captureSavedLit
          ? page.locator('seams-tx-confirm-content')
          : page.locator('.seams-tx-confirm-content');
        await content.screenshot({ path: contentPath, animations: 'disabled' });
        const contextPath = surfacePath.replace('.png', '-context.png');
        await page.screenshot({ path: contextPath, animations: 'disabled' });

        const referenceRoot = path.join(output, 'lit-production');
        const beforeSurface = path.join(
          referenceRoot,
          `seams-${variant}-tx-confirmer/${state}-${theme}.png`,
        );
        const beforeContent = path.join(
          referenceRoot,
          `seams-tx-confirm-content/${variant}-${state}-${theme}.png`,
        );
        const comparison = {
          surface: compareImages(
            beforeSurface,
            surfacePath,
            path.join(diffRoot, `seams-${variant}-tx-confirmer/${state}-${theme}.png`),
          ),
          content: compareImages(
            beforeContent,
            contentPath,
            path.join(diffRoot, `seams-tx-confirm-content/${variant}-${state}-${theme}.png`),
          ),
        };
        comparisons.push({ renderer, variant, state, theme, browser: browser.version(), comparison });
        expect(comparison.surface.after.width).toBeGreaterThan(0);
        expect(comparison.content.after.width).toBeGreaterThan(0);
        expect(comparison.surface.after).toEqual(comparison.surface.before);
        const pixels = comparison.surface.after.width * comparison.surface.after.height;
        // Lit's JS-driven halo keeps rotating under reduced motion; allow its captured angle.
        const pixelThreshold = variant === 'modal' && state !== 'error' ? 0.025 : 0.01;
        expect(comparison.surface.changedPixels / pixels).toBeLessThan(pixelThreshold);

        await page.evaluate(() => {
          const handle = (globalThis as { __preactVisualHandle?: { close: (confirmed: boolean) => void } })
            .__preactVisualHandle;
          handle?.close(true);
        });
      });
    }
  }
}

test.afterAll(({}, testInfo) => {
  fs.writeFileSync(
    path.join(output, `confirmation-${renderer}-comparison.json`),
    JSON.stringify(
      {
        runId: testInfo.config.metadata.captureRunId,
        referenceDirectory: 'lit-production',
        rendererDirectory: captureSavedLit ? 'lit-production' : 'preact-after',
        comparisons,
      },
      null,
      2,
    ),
  );
});
