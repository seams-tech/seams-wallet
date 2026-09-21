import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { setupBasicPasskeyTest, sdkEsmPath } from '../setup';
import { ensureComponentModule, mountComponent } from './component-harness';
import { LIT_COMPONENT_INVENTORY, SYNTHETIC_BACKUP, litVisualFixtures } from './lit-fixtures';

const root = path.resolve(import.meta.dirname, '../..');
const output = path.join(root, '.artifacts/refactor-127/visual');
const savedLitRoot = path.join(root, '.artifacts/refactor-127/lit-baseline-build/esm');
const manifestPath = path.join(output, 'manifest.json');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const buildInputsHash = fs
  .readFileSync(path.join(root, 'packages/wallet/dist/.build-inputs.sha256'), 'utf8')
  .trim();
const captures: Record<string, unknown>[] = [];
let canWriteManifest = false;

function freezeStaticHaloFrame(): void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync('.halo-root { --halo-angle: 0deg !important; }');
  const roots: (Document | ShadowRoot)[] = [document];
  while (roots.length > 0) {
    const root = roots.pop();
    if (!root) continue;
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) roots.push(element.shadowRoot);
    }
  }
}

test.beforeAll(() => {
  fs.mkdirSync(output, { recursive: true });
  const previous = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : null;
  if (previous?.buildInputsHash && previous.buildInputsHash !== buildInputsHash) {
    throw new Error(
      'The Lit baseline belongs to a different build. Preserve it and capture the migrated renderer under preact-after.',
    );
  }
  canWriteManifest = true;
});

test.afterAll(({}, testInfo) => {
  if (!canWriteManifest) return;
  const runId = testInfo.config.metadata.captureRunId;
  const previous = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : null;
  const previousCaptures = previous?.runId === runId ? previous.captures : [];
  const completedCaptures = [...previousCaptures, ...captures];
  const expectedCaptureCount = litVisualFixtures('light').length + litVisualFixtures('dark').length;
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        runId,
        commit,
        buildInputsHash,
        buildCommand: 'pnpm -C packages/wallet build:prod',
        captureCommand:
          'SEAMS_TEST_FRONTEND_URL=http://localhost:4206 pnpm -C tests exec playwright test -c playwright.visual.config.ts',
        os: `${os.platform()} ${os.release()} ${os.arch()}`,
        viewport: { width: 1024, height: 900 },
        deviceScaleFactor: 1,
        locale: 'en-US',
        reducedMotion: 'reduce',
        animationPolicy:
          'Static reduced-motion fixtures; CSS animations disabled and JS-driven halo angle pinned to 0deg without removing its ring. Behavioral animation tests remain separate.',
        expectedElements: LIT_COMPONENT_INVENTORY.map(([tag]) => tag),
        expectedCaptureCount,
        captureComplete: completedCaptures.length === expectedCaptureCount,
        captures: completedCaptures,
      },
      null,
      2,
    ),
  );
});

for (const theme of ['light', 'dark'] as const) {
  const fixtures = litVisualFixtures(theme);
  for (const [tag] of LIT_COMPONENT_INVENTORY) {
    if (!fixtures.some((fixture) => fixture.tag === tag))
      throw new Error(`Missing visual fixture: ${tag}`);
  }
  for (const fixture of fixtures) {
    test(`${fixture.tag}/${fixture.name}-${theme}`, async ({ page, browser }) => {
      await setupBasicPasskeyTest(page);
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
        const marker = '/sdk/';
        const pathname = new URL(route.request().url()).pathname;
        const relative = pathname.slice(pathname.lastIndexOf(marker) + marker.length);
        const file = path.join(savedLitRoot, 'sdk', relative);
        if (!file.startsWith(`${savedLitRoot}/sdk${path.sep}`) || !fs.existsSync(file)) {
          return route.fallback();
        }
        return route.fulfill({ path: file });
      });
      await page.setViewportSize(fixture.viewport ?? { width: 1024, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.addStyleTag({ url: new URL('/sdk/seams-components.css', page.url()).href });
      const entry = LIT_COMPONENT_INVENTORY.find(([tag]) => tag === fixture.tag);
      if (!entry) throw new Error(`Missing component module: ${fixture.tag}`);
      await ensureComponentModule(page, { modulePath: sdkEsmPath(entry[1]), tagName: fixture.tag });
      await mountComponent(page, {
        tagName: fixture.tag,
        props: fixture.props,
        attributes: fixture.attributes,
      });
      await page.evaluate(
        async ({ tag, content, request, theme }) => {
          document.documentElement.dataset.seamsTheme = theme;
          const root = document.getElementById('test-root');
          if (root) {
            root.style.background = theme === 'light' ? '#f5f5f5' : '#101826';
            root.style.color = theme === 'light' ? '#161616' : '#ffffff';
            root.style.minHeight = '800px';
            root.style.maxWidth = '420px';
          }
          const element = document.querySelector(tag) as HTMLElement & {
            updateComplete: Promise<boolean>;
            whenStylesReady?: () => Promise<void>;
            configure?: (experience: unknown) => void;
          };
          if (content) {
            const paragraph = document.createElement('p');
            paragraph.textContent = content;
            element.appendChild(paragraph);
          }
          if (tag === 'seams-recovery-code-backup-viewer') {
            element.configure?.({ kind: 'direct_backup', request });
          }
          await element.whenStylesReady?.();
          await element.updateComplete;
          await document.fonts.ready;
        },
        { tag: fixture.tag, content: fixture.content, request: SYNTHETIC_BACKUP, theme },
      );
      const selector =
        fixture.tag === 'seams-recovery-code-backup-host' ? `${fixture.tag} dialog` : fixture.tag;
      const component = page.locator(selector).first();
      await expect(component).toBeVisible();
      await expect
        .poll(async () => {
          return component.evaluate((element) => (element.shadowRoot ?? element).childElementCount);
        })
        .toBeGreaterThan(0);
      // Require settled geometry rather than a fixed stylesheet/animation sleep.
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
      const relative = `lit-before/${fixture.tag}/${fixture.name}-${theme}`;
      await page.evaluate(freezeStaticHaloFrame);
      fs.mkdirSync(path.dirname(path.join(output, relative)), { recursive: true });
      await component.screenshot({
        path: path.join(output, `${relative}.png`),
        animations: 'disabled',
      });
      await page.screenshot({
        path: path.join(output, `${relative}-context.png`),
        animations: 'disabled',
      });
      captures.push({
        element: fixture.tag,
        fixture: fixture.name,
        fixtureData: fixture,
        theme,
        selector,
        browser: browser.version(),
        viewport: page.viewportSize(),
        image: `${relative}.png`,
        contextImage: `${relative}-context.png`,
      });
    });
  }
}
