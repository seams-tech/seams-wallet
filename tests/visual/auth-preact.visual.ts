import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { setupBasicPasskeyTest } from '../setup';
import { prepareAuthMenuDocument, mountAuthMenu } from '../wallet-ui/auth-menu.harness';
import { authBranchFixtures, registration } from './lit-fixtures';
import type { AuthMenuViewModel } from '@/SeamsWeb/walletIframe/host/auth-menu/domain';
import { ensureComponentModule, mountComponent } from '../lit-components/harness';

const root = path.resolve(import.meta.dirname, '../..');
const output = path.join(root, '.artifacts/refactor-127/visual');
const baseline = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
const buildInputsHash = fs
  .readFileSync(path.join(root, 'packages/wallet/dist/.build-inputs.sha256'), 'utf8')
  .trim();
const comparisons: Record<string, unknown>[] = [];
const recoveryAccessibilityFixtures = new Set([
  'recovery-preparing',
  'recovery-passkey-ready',
  'recovery-finalizing',
  'recovery-sign-in-ready',
]);
const captureSavedLit = process.env.AUTH_VISUAL_RENDERER === 'saved-lit';
const settledReference = path.join(output, 'lit-settled');
const savedBuild = path.join(root, '.artifacts/refactor-127/lit-baseline-build/esm');

test.beforeAll(() => {
  const savedHash = fs
    .readFileSync(path.join(savedBuild, '../.build-inputs.sha256'), 'utf8')
    .trim();
  expect(savedHash, 'saved Lit build matches the original baseline').toBe(baseline.buildInputsHash);
  if (!captureSavedLit) {
    const reference = JSON.parse(
      fs.readFileSync(path.join(output, 'auth-lit-settled.json'), 'utf8'),
    );
    expect(reference.complete, 'complete settled Lit reference required').toBe(true);
    expect(reference.buildInputsHash).toBe(savedHash);
  }
});

function compareImages(beforePath: string, afterPath: string, diffPath: string) {
  const before = PNG.sync.read(fs.readFileSync(beforePath));
  const after = PNG.sync.read(fs.readFileSync(afterPath));
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const diff = new PNG({ width, height });
  const sideBySide = new PNG({ width: width * 3, height });
  let changedPixels = 0;
  let maxChannelDelta = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let delta = 0;
      for (let channel = 0; channel < 4; channel++) {
        const left =
          x < before.width && y < before.height
            ? before.data[(y * before.width + x) * 4 + channel]
            : 0;
        const right =
          x < after.width && y < after.height ? after.data[(y * after.width + x) * 4 + channel] : 0;
        delta = Math.max(delta, Math.abs(left - right));
        sideBySide.data[(y * width * 3 + x) * 4 + channel] = left;
        sideBySide.data[(y * width * 3 + width + x) * 4 + channel] = right;
      }
      if (delta > 0) changedPixels++;
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

test.afterAll(({}, testInfo) => {
  const manifestPath = path.join(
    output,
    captureSavedLit ? 'auth-lit-settled.json' : 'auth-preact-comparison.json',
  );
  const previous = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : null;
  const runId = testInfo.config.metadata.captureRunId;
  const completed = [...(previous?.runId === runId ? previous.comparisons : []), ...comparisons];
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        baselineBuildInputsHash: baseline.buildInputsHash,
        referenceDirectory: 'lit-settled',
        animationPolicy:
          'Disable motion before mounting, then remeasure after fonts load and wait for stable geometry. Motion behavior is tested separately.',
        buildInputsHash: captureSavedLit ? baseline.buildInputsHash : buildInputsHash,
        runId,
        comparisons: completed,
        complete: completed.length === 108,
        reviewFile: 'auth-preact-review.md',
      },
      null,
      2,
    ),
  );
});

for (const theme of ['light', 'dark'] as const) {
  const model = registration(theme);
  const fixtures: { name: string; model: AuthMenuViewModel }[] = [
    { name: 'default', model },
    ...authBranchFixtures(theme),
    {
      name: 'waiting',
      model: { ...model, status: { kind: 'busy', headline: 'Creating passkey wallet…' } },
    },
    {
      name: 'error',
      model: {
        ...model,
        status: { kind: 'recoverable', reason: 'error', message: 'Please try again.' },
      },
    },
  ];
  for (const narrow of [false, true]) {
    for (const fixture of fixtures) {
      const name = fixture.name + (narrow ? '-narrow' : '');
      test(`auth-preact/${name}-${theme}`, async ({ page, browser }) => {
        await setupBasicPasskeyTest(page);
        await page.setViewportSize(
          narrow ? { width: 360, height: 800 } : { width: 1024, height: 900 },
        );
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        if (captureSavedLit) {
          await page.route('**/_test-sdk/esm/**', (route) => {
            const relative = new URL(route.request().url()).pathname.split('/_test-sdk/esm/')[1];
            const file = path.resolve(savedBuild, relative);
            if (!file.startsWith(savedBuild + path.sep)) return route.abort();
            return route.fulfill({ path: file });
          });
        }
        await prepareAuthMenuDocument(page);
        await page.addStyleTag({
          content: '* { animation: none !important; transition: none !important; }',
        });
        await page.evaluate((theme) => {
          document.documentElement.dataset.seamsTheme = theme;
          const root = document.createElement('div');
          root.id = 'test-root';
          root.style.display = 'block';
          root.style.padding = '24px';
          root.style.background = theme === 'light' ? '#f5f5f5' : '#101826';
          root.style.color = theme === 'light' ? '#161616' : '#ffffff';
          root.style.minHeight = '800px';
          root.style.maxWidth = '420px';
          document.body.appendChild(root);
        }, theme);
        if (captureSavedLit) {
          await ensureComponentModule(page, {
            modulePath:
              '/_test-sdk/esm/SeamsWeb/walletIframe/host/lit-ui/auth-menu/seams-auth-menu-surface.js',
            tagName: 'seams-auth-menu-surface',
          });
          await mountComponent(page, {
            tagName: 'seams-auth-menu-surface',
            props: { viewModel: fixture.model },
          });
        } else {
          await mountAuthMenu(page, fixture.model);
        }
        await expect(page.locator('.seams-content-sizer')).toBeVisible();
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await page.evaluate(() => {
          window.dispatchEvent(new Event('resize'));
        });
        const component = page.locator(
          captureSavedLit ? 'seams-auth-menu-surface' : '.seams-auth-menu-surface',
        );
        await expect(component).toBeVisible();
        let previous = '';
        let stableSamples = 0;
        await expect
          .poll(
            async () => {
              const box = JSON.stringify(await component.boundingBox());
              stableSamples = box === previous ? stableSamples + 1 : 0;
              previous = box;
              return stableSamples;
            },
            { intervals: [100], timeout: 10_000 },
          )
          .toBeGreaterThanOrEqual(3);
        const relative = `seams-auth-menu-surface/${name}-${theme}`;
        const afterPath = path.join(
          captureSavedLit ? settledReference : path.join(output, 'preact-after'),
          `${relative}.png`,
        );
        fs.mkdirSync(path.dirname(afterPath), { recursive: true });
        await component.screenshot({ path: afterPath, animations: 'disabled' });
        await page.screenshot({
          path: afterPath.replace('.png', '-context.png'),
          animations: 'disabled',
        });
        if (captureSavedLit) {
          comparisons.push({
            fixture: name,
            theme,
            browser: browser.version(),
            viewport: page.viewportSize(),
          });
          return;
        }
        const capture = baseline.captures.find(
          (entry: { element: string; fixture: string; theme: string }) =>
            entry.element === 'seams-auth-menu-surface' &&
            entry.fixture === name &&
            entry.theme === theme,
        );
        expect(capture, 'matching baseline metadata').toBeDefined();
        expect(browser.version()).toBe(capture.browser);
        const componentDiff = compareImages(
          path.join(settledReference, `${relative}.png`),
          afterPath,
          path.join(output, `diff/${relative}.png`),
        );
        const contextDiff = compareImages(
          path.join(settledReference, `${relative}-context.png`),
          afterPath.replace('.png', '-context.png'),
          path.join(output, `diff/${relative}-context.png`),
        );
        const reviewedRecoveryDiff = recoveryAccessibilityFixtures.has(fixture.name)
          ? {
              component: compareImages(
                path.join(output, `preact-recovery-reviewed/${relative}.png`),
                afterPath,
                path.join(output, `diff/recovery-reviewed/${relative}.png`),
              ),
              context: compareImages(
                path.join(output, `preact-recovery-reviewed/${relative}-context.png`),
                afterPath.replace('.png', '-context.png'),
                path.join(output, `diff/recovery-reviewed/${relative}-context.png`),
              ),
            }
          : null;
        comparisons.push({
          fixture: name,
          theme,
          browser: browser.version(),
          viewport: page.viewportSize(),
          componentDiff,
          contextDiff,
          reviewedRecoveryDiff,
          intentionalDifference: recoveryAccessibilityFixtures.has(fixture.name)
            ? 'Recovery live region is visually hidden and no longer consumes control space. See auth-recovery-accessibility-review.md.'
            : null,
        });
        expect(componentDiff.after).toEqual(componentDiff.before);
        if (reviewedRecoveryDiff) {
          await expect(page.locator('.sr-only[role="status"]')).toHaveCSS('position', 'absolute');
          expect(reviewedRecoveryDiff.component.after).toEqual(
            reviewedRecoveryDiff.component.before,
          );
          expect(reviewedRecoveryDiff.component.maxChannelDelta).toBeLessThanOrEqual(1);
          expect(reviewedRecoveryDiff.context.maxChannelDelta).toBeLessThanOrEqual(1);
        } else {
          // Chromium's rounded-edge rasterization can differ by one 8-bit color step.
          expect(componentDiff.maxChannelDelta).toBeLessThanOrEqual(1);
          expect(contextDiff.maxChannelDelta).toBeLessThanOrEqual(1);
        }
        await page.evaluate(() => window.__authMenu.handle.dispose());
      });
    }
  }
}
