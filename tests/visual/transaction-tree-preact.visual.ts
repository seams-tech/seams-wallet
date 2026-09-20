import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { TreeNode } from '@/core/signingEngine/uiConfirm/ui/transaction-display/tree';
import { injectImportMap } from '../setup/bootstrap';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import { routePreactModules } from '../setup/preact';

const root = path.resolve(import.meta.dirname, '../..');
const savedLitRoot = path.join(root, '.artifacts/refactor-127/lit-baseline-build/esm');
const baselineRoot = path.join(root, '.artifacts/refactor-127/visual/lit-before/seams-tx-tree');
const afterRoot = path.join(root, '.artifacts/refactor-127/visual/preact-after/seams-tx-tree');
const diffRoot = path.join(root, '.artifacts/refactor-127/visual/diff/seams-tx-tree');
const treeCss = fs.readFileSync(
  path.join(
    root,
    'packages/wallet/src/core/signingEngine/uiConfirm/ui/preact/transaction-tree.css',
  ),
  'utf8',
);

const tree: TreeNode = {
  id: 'transaction',
  type: 'folder',
  label: 'Transaction to visual-fixture.testnet',
  open: true,
  children: [
    {
      id: 'amount',
      type: 'file',
      label: 'Transfer: 1 NEAR',
    },
  ],
};

const evmTree: TreeNode = {
  id: 'root',
  type: 'folder',
  label: 'Transactions',
  open: true,
  children: [
    {
      id: 'transaction',
      type: 'folder',
      label: 'Transaction to contract',
      open: true,
      chain: 'evm',
      contractAddress: '0x1111111111111111111111111111111111111111',
      children: [
        {
          id: 'data',
          type: 'file',
          label: 'Calling transfer using EVM',
          open: true,
          content: '{\n  "recipient": "visual-fixture",\n  "amount": "1000000"\n}',
          copyValue: '0xa9059cbb',
          contentVariants: {
            decoded: '{\n  "recipient": "visual-fixture",\n  "amount": "1000000"\n}',
            raw: '0xa9059cbb',
            defaultMode: 'decoded',
          },
        },
      ],
    },
  ],
};

async function prepare(page: Page, renderer: 'lit' | 'preact'): Promise<void> {
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
  await page.route('**/transaction-tree.css', (route) =>
    route.fulfill({ contentType: 'text/css', body: renderer === 'lit' ? '' : treeCss }),
  );
  await page.route('**/transaction-tree-preact-visual', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}<link rel="stylesheet" data-seams-components-css href="/seams-components.css"><link rel="stylesheet" href="/transaction-tree.css"></head><body><div id="visual-root" class="seams-wallet-ui" data-theme="light"></div></body></html>`,
    }),
  );
  await page.goto('/transaction-tree-preact-visual');
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

async function mount(
  page: Page,
  renderer: 'lit' | 'preact',
  theme: 'light' | 'dark',
  node: TreeNode,
): Promise<void> {
  await page.evaluate(
    async ({ renderer, theme, tree }) => {
      document.documentElement.dataset.seamsTheme = theme;
      const root = document.querySelector<HTMLElement>('#visual-root')!;
      root.dataset.theme = theme;
      root.style.display = 'block';
      root.style.padding = '24px';
      root.style.background = theme === 'light' ? '#f5f5f5' : '#101826';
      root.style.color = theme === 'light' ? '#161616' : '#ffffff';
      root.style.minHeight = '800px';
      root.style.maxWidth = '420px';
      if (renderer === 'lit') {
        const module =
          '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/lit-components/TxTree/index.js';
        await import(module);
        const element = document.createElement('seams-tx-tree') as HTMLElement & {
          node?: unknown;
          theme?: string;
          showShadow?: boolean;
          nearExplorerUrl?: string;
          evmExplorerUrl?: string;
        };
        element.node = tree;
        element.theme = theme;
        element.showShadow = true;
        element.nearExplorerUrl = 'https://testnet.nearblocks.io';
        element.evmExplorerUrl = 'https://explorer.example';
        root.appendChild(element);
        await (element as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
        return;
      }
      const preactRuntime = '/_test-preact/preact.module.js';
      const preact = await import(preactRuntime);
      const { TransactionTree } = await import(
        '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/preact/TransactionTree.js'
      );
      const { createCspStylesheetManager } = await import(
        '/_test-sdk/esm/core/browser/walletIframe/csp-stylesheet.js'
      );
      const styles = createCspStylesheetManager({ doc: document, baseCss: '' });
      preact.render(
        preact.h(TransactionTree, {
          node: tree,
          theme,
          showShadow: true,
          styles,
          explorers: {
            near: 'https://testnet.nearblocks.io',
            evm: 'https://explorer.example',
          },
        }),
        root,
      );
    },
    { renderer, theme, tree: node },
  );
}

function compare(beforePath: string, afterPath: string, diffPath: string) {
  const before = PNG.sync.read(fs.readFileSync(beforePath));
  const after = PNG.sync.read(fs.readFileSync(afterPath));
  expect({ width: after.width, height: after.height }).toEqual({
    width: before.width,
    height: before.height,
  });
  const diff = new PNG({ width: before.width, height: before.height });
  let changedPixels = 0;
  let maxChannelDelta = 0;
  for (let y = 0; y < before.height; y += 1) {
    for (let x = 0; x < before.width; x += 1) {
      const offset = (y * before.width + x) * 4;
      let delta = 0;
      for (let channel = 0; channel < 4; channel += 1) {
        delta = Math.max(delta, Math.abs(before.data[offset + channel] - after.data[offset + channel]));
      }
      if (delta > 0) changedPixels += 1;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      diff.data[offset] = delta > 0 ? 255 : 0;
      diff.data[offset + 3] = 255;
    }
  }
  fs.mkdirSync(path.dirname(diffPath), { recursive: true });
  fs.writeFileSync(diffPath, PNG.sync.write(diff));
  return {
    dimensions: { width: before.width, height: before.height },
    changedPixels,
    maxChannelDelta,
  };
}

for (const theme of ['light', 'dark'] as const) {
  test(`transaction-tree/default-${theme}`, async ({ browser }) => {
    for (const renderer of ['lit', 'preact'] as const) {
      const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
      try {
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await prepare(page, renderer);
        await mount(page, renderer, theme, tree);
        const surface = page.locator(renderer === 'lit' ? 'seams-tx-tree' : '.seams-tx-tree');
        await expect(surface).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await waitForStableSurface(surface);
        const capturePath = path.join(afterRoot, `default-${theme}-${renderer}.png`);
        fs.mkdirSync(path.dirname(capturePath), { recursive: true });
        await surface.screenshot({ path: capturePath, animations: 'disabled' });
      } finally {
        await page.close();
      }
    }
    const comparison = compare(
      path.join(baselineRoot, `default-${theme}.png`),
      path.join(afterRoot, `default-${theme}-preact.png`),
      path.join(diffRoot, `default-${theme}.png`),
    );
    fs.writeFileSync(
      path.join(afterRoot, `default-${theme}.json`),
      JSON.stringify({ comparison }, null, 2),
    );
    expect(comparison.changedPixels).toBeLessThan(1024);
  });

  test(`transaction-tree/evm-expanded-${theme}`, async ({ browser }) => {
    const captures: Record<'lit' | 'preact', string> = {
      lit: '',
      preact: '',
    };
    for (const renderer of ['lit', 'preact'] as const) {
      const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
      try {
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await prepare(page, renderer);
        await mount(page, renderer, theme, evmTree);
        const surface = page.locator(renderer === 'lit' ? 'seams-tx-tree' : '.seams-tx-tree');
        await expect(surface).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await waitForStableSurface(surface);
        const capturePath = path.join(afterRoot, `evm-expanded-${theme}-${renderer}.png`);
        fs.mkdirSync(path.dirname(capturePath), { recursive: true });
        await surface.screenshot({ path: capturePath, animations: 'disabled' });
        captures[renderer] = capturePath;
      } finally {
        await page.close();
      }
    }
    const comparison = compare(
      captures.lit,
      captures.preact,
      path.join(diffRoot, `evm-expanded-${theme}.png`),
    );
    fs.writeFileSync(
      path.join(afterRoot, `evm-expanded-${theme}.json`),
      JSON.stringify({ comparison }, null, 2),
    );
    const pixels = comparison.dimensions.width * comparison.dimensions.height;
    expect(comparison.changedPixels / pixels).toBeLessThan(0.01);
  });
}
