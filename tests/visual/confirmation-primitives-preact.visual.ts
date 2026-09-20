import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { injectImportMap } from '../setup/bootstrap';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import { routePreactModules } from '../setup/preact';

const root = path.resolve(import.meta.dirname, '../..');
const savedLitRoot = path.join(root, '.artifacts/refactor-127/lit-baseline-build/esm');
const output = path.join(root, '.artifacts/refactor-127/visual/confirmation-primitives');

type Renderer = 'lit' | 'preact';
type Primitive = 'halo' | 'passkey' | 'padlock';

const primitiveCss = fs.readFileSync(
  path.join(
    root,
    'packages/wallet/src/core/signingEngine/uiConfirm/ui/preact/confirmation-primitives.css',
  ),
  'utf8',
);
const visualHarnessCss = `
#visual-root {
  color: #161616;
  background: #f5f5f5;
  padding: 24px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 16px;
  line-height: 1.5;
}

#visual-root[data-theme='dark'] {
  color: #ffffff;
  background: #101826;
}
`;

function compareImages(beforePath: string, afterPath: string, diffPath: string) {
  const before = PNG.sync.read(fs.readFileSync(beforePath));
  const after = PNG.sync.read(fs.readFileSync(afterPath));
  expect({ width: after.width, height: after.height }).toEqual({
    width: before.width,
    height: before.height,
  });
  const diff = new PNG({ width: before.width, height: before.height });
  const sideBySide = new PNG({ width: before.width * 2, height: before.height });
  let changedPixels = 0;
  let maxChannelDelta = 0;
  for (let y = 0; y < before.height; y += 1) {
    for (let x = 0; x < before.width; x += 1) {
      const offset = (y * before.width + x) * 4;
      let delta = 0;
      for (let channel = 0; channel < 4; channel += 1) {
        const left = before.data[offset + channel];
        const right = after.data[offset + channel];
        delta = Math.max(delta, Math.abs(left - right));
        sideBySide.data[offset + channel] = left;
        sideBySide.data[(y * before.width * 2 + before.width + x) * 4 + channel] = right;
      }
      if (delta > 0) changedPixels += 1;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      diff.data[offset] = delta > 0 ? 255 : 0;
      diff.data[offset + 3] = 255;
    }
  }
  fs.mkdirSync(path.dirname(diffPath), { recursive: true });
  fs.writeFileSync(diffPath, PNG.sync.write(diff));
  fs.writeFileSync(diffPath.replace('.png', '-comparison.png'), PNG.sync.write(sideBySide));
  return {
    dimensions: { width: before.width, height: before.height },
    changedPixels,
    maxChannelDelta,
  };
}

async function prepare(page: import('@playwright/test').Page, renderer: Renderer): Promise<void> {
  await injectImportMap(page);
  await routePreactModules(page);
  if (renderer === 'lit') {
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
  }
  const componentsCss = path.join(
    renderer === 'lit' ? savedLitRoot : path.join(root, 'packages/wallet/dist/esm'),
    'sdk/seams-components.css',
  );
  await page.route('**/seams-components.css', (route) => route.fulfill({ path: componentsCss }));
  await page.route('**/confirmation-primitives.css', (route) =>
    route.fulfill({
      contentType: 'text/css',
      body: renderer === 'lit' ? visualHarnessCss : `${primitiveCss}\n${visualHarnessCss}`,
    }),
  );
  await page.route('**/confirmation-primitives-visual', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': "style-src 'self'; style-src-attr 'none'" },
      body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}<link rel="stylesheet" data-seams-components-css href="/seams-components.css"><link rel="stylesheet" href="/confirmation-primitives.css"></head><body><main id="visual-root" class="seams-wallet-ui"></main></body></html>`,
    }),
  );
  await page.goto('/confirmation-primitives-visual');
}

async function mount(
  page: import('@playwright/test').Page,
  renderer: Renderer,
  primitive: Primitive,
  theme: 'light' | 'dark',
): Promise<void> {
  await page.evaluate(
    async ({ renderer, primitive, theme }) => {
      document.documentElement.dataset.seamsTheme = theme;
      const root = document.querySelector<HTMLElement>('#visual-root')!;
      root.dataset.theme = theme;
      if (renderer === 'lit') {
        const modulePath =
          primitive === 'halo'
            ? '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/lit-components/HaloBorder/index.js'
            : primitive === 'passkey'
              ? '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/lit-components/PasskeyHaloLoading/index.js'
            : '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/lit-components/common/PadlockIcon.js';
        if (primitive === 'passkey') {
          await import('/_test-sdk/esm/core/signingEngine/uiConfirm/ui/lit-components/HaloBorder/index.js');
        }
        await import(modulePath);
        const tag =
          primitive === 'halo'
            ? 'seams-halo-border'
            : primitive === 'passkey'
              ? 'seams-passkey-halo-loading'
              : 'seams-padlock-icon';
        const element = document.createElement(tag) as HTMLElement & {
          theme?: string;
          animated?: boolean;
          innerPadding?: string;
          innerBackground?: string;
          width?: number;
          height?: number;
          size?: string;
          updateComplete?: Promise<unknown>;
        };
        element.theme = theme;
        if (primitive === 'halo') {
          element.animated = false;
          element.innerPadding = '24px';
          element.textContent = 'Synthetic wallet content';
        } else if (primitive === 'passkey') {
          element.animated = false;
          element.innerPadding = '0px';
          element.innerBackground = 'transparent';
          element.width = 36;
          element.height = 36;
        } else {
          element.size = '24';
        }
        root.appendChild(element);
        await element.updateComplete;
        return;
      }
      const preactUrl = '/_test-preact/preact.module.js';
      const preact = await import(preactUrl);
      const stylesModule = await import(
        '/_test-sdk/esm/core/browser/walletIframe/csp-stylesheet.js'
      );
      const styles = stylesModule.createCspStylesheetManager({ doc: document, baseCss: '' });
      if (primitive === 'halo') {
        const { HaloBorder } = await import(
          '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/preact/HaloBorder.js'
        );
        preact.render(
          preact.h(
            HaloBorder,
            { animated: false, innerPadding: '24px', styles },
            'Synthetic wallet content',
          ),
          root,
        );
      } else if (primitive === 'passkey') {
        const { PasskeyHaloLoading } = await import(
          '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/preact/PasskeyHaloLoading.js'
        );
        preact.render(
          preact.h(PasskeyHaloLoading, {
            animated: false,
            icon: 'fingerprint',
            innerPadding: '0px',
            size: 36,
            styles,
          }),
          root,
        );
      } else {
        const { PadlockIcon } = await import(
          '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/preact/PadlockIcon.js'
        );
        preact.render(preact.h(PadlockIcon, { size: '24' }), root);
      }
    },
    { renderer, primitive, theme },
  );
  await page.evaluate(() => document.fonts.ready);
}

for (const primitive of ['halo', 'passkey', 'padlock'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`confirmation/${primitive}-${theme}`, async ({ browser }) => {
      const captures: Record<Renderer, string> = { lit: '', preact: '' };
      for (const renderer of ['lit', 'preact'] as const) {
        const page = await browser.newPage({ viewport: { width: 560, height: 420 } });
        try {
          await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
          await prepare(page, renderer);
          await mount(page, renderer, primitive, theme);
          const selector =
            renderer === 'lit'
              ? primitive === 'halo'
                ? 'seams-halo-border'
                : primitive === 'passkey'
                  ? 'seams-passkey-halo-loading'
                  : 'seams-padlock-icon'
              : primitive === 'halo'
                ? '.seams-halo-border'
                : primitive === 'passkey'
                  ? '.seams-passkey-halo-loading'
                  : '.seams-padlock-icon';
          const surface = page.locator(selector);
          await expect(surface).toBeVisible();
          const capturePath = path.join(output, `${primitive}-${theme}-${renderer}.png`);
          fs.mkdirSync(path.dirname(capturePath), { recursive: true });
          await surface.screenshot({ path: capturePath, animations: 'disabled' });
          captures[renderer] = capturePath;
        } finally {
          await page.close();
        }
      }
      const comparison = compareImages(
        captures.lit,
        captures.preact,
        path.join(output, 'diff', `${primitive}-${theme}.png`),
      );
      fs.writeFileSync(
        path.join(output, `${primitive}-${theme}.json`),
        JSON.stringify({ comparison }, null, 2),
      );
      const pixels = comparison.dimensions.width * comparison.dimensions.height;
      expect(comparison.changedPixels / pixels).toBeLessThan(0.01);
    });
  }
}
