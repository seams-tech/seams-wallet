import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { injectImportMap } from '../setup/bootstrap';
import { routePreactModules } from '../setup/preact';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import type { TreeNode } from '@/core/signingEngine/uiConfirm/ui/transaction-display/tree';
import { ActionType } from '@/core/types/actions';

const root = path.resolve(import.meta.dirname, '../..');
const walletUiCss = fs.readFileSync(
  path.join(root, 'packages/wallet/dist/esm/sdk/wallet-ui.css'),
  'utf8',
);

declare global {
  interface Window {
    __treeTest: {
      dispose(): void;
      update(node: TreeNode): void;
      copies: string[];
      toggles: { id: string; open: boolean }[];
      violations: string[];
      writes: string[];
      pendingCopy: (() => void) | null;
      resize: { viewportPx: number; deltas: number[]; dispose(): void } | null;
    };
  }
}

const tree: TreeNode = {
  id: 'root',
  type: 'folder',
  label: 'Transactions',
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
test('copy controls remain inside their row at narrow and wide widths', async ({ page }) => {
  for (const width of [320, 360, 768]) {
    await page.setViewportSize({ width, height: 640 });
    const copy = page.locator('.copy-badge');
    await expect(copy).toBeVisible();
    expect((await copy.evaluate(copyBounds)).overflow).toBeLessThanOrEqual(-4);
    await copy.click();
    await expect(copy).toHaveText('copied');
    expect((await copy.evaluate(copyBounds)).overflow).toBeLessThanOrEqual(-4);
    await expect(copy).toHaveText('copy');
  }
});

function copyBounds(copy: Element) {
  const row = copy.closest('.row')!;
  return {
    overflow: copy.getBoundingClientRect().right - row.getBoundingClientRect().right,
  };
}

test('message copy controls share an edge with signer and recipient controls', async ({ page }) => {
  const model: TreeNode = {
    id: 'root',
    type: 'folder',
    label: 'Messages',
    children: [
      {
        id: 'message-signature',
        type: 'folder',
        label: 'Message signature',
        open: true,
        children: [
          {
            id: 'signer',
            type: 'file',
            label: `Signer: ${'a'.repeat(64)}`,
            copyValue: 'a'.repeat(64),
          },
          {
            id: 'recipient',
            type: 'file',
            label: 'Recipient: example.test',
            copyValue: 'example.test',
          },
          {
            id: 'message',
            type: 'file',
            label: 'Message:',
            content: 'Hello, Seams!',
            copyValue: 'Hello, Seams!',
            open: true,
          },
        ],
      },
    ],
  };
  await page.evaluate((node) => window.__treeTest.update(node), model);
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 640 });
    const buttons = page.locator('.copy-badge');
    await expect(buttons).toHaveCount(3);
    const edges = await buttons.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().right),
    );
    expect(Math.max(...edges) - Math.min(...edges)).toBeLessThan(1);
    await buttons.last().click();
    await expect(buttons.last()).toHaveText('copied');
    expect(await page.evaluate(() => window.__treeTest.writes.at(-1))).toBe('Hello, Seams!');
  }
});

test('NEAR action formatting and unknown-chain labels retain their display contracts', async ({
  page,
}) => {
  const model: TreeNode = {
    id: 'replacement',
    type: 'folder',
    label: 'Transactions',
    children: [
      {
        id: 'near',
        type: 'folder',
        label: 'Transaction',
        open: true,
        transaction: { receiverId: 'visual-fixture.testnet', actions: [] },
        children: [
          {
            id: 'transfer',
            type: 'file',
            label: 'Transfer',
            action: { type: ActionType.Transfer, amount: '1000000000000000000000000' },
          },
          {
            id: 'call',
            type: 'file',
            label: 'Call',
            action: {
              type: ActionType.FunctionCall,
              methodName: 'set_greeting',
              args: {},
              gas: '30000000000000',
              deposit: '0',
            },
          },
          {
            id: 'global',
            type: 'file',
            label: 'Deploy',
            action: { type: ActionType.DeployGlobalContract, code: 'wasm', deployMode: 'CodeHash' },
          },
        ],
      },
      {
        id: 'unknown',
        type: 'file',
        label: 'Transaction to contract',
        chain: 'unknown',
        contractAddress: '0x2222222222222222222222222222222222222222',
      },
    ],
  };
  await page.evaluate((node) => window.__treeTest.update(node), model);
  await expect(page.getByRole('link')).toHaveAttribute(
    'href',
    'https://testnet.nearblocks.io/address/visual-fixture.testnet',
  );
  await expect(page.locator('.highlight-amount')).toHaveText('1 NEAR');
  await expect(page.locator('.highlight-method-name')).toHaveText(['set_greeting', '30 Tgas']);
  await expect(page.locator('.seams-tx-tree')).toContainText(
    'Deploy global WASM contract (mode: CodeHash, size 4 bytes)',
  );
  await expect(page.locator('.seams-tx-tree')).toContainText('0x222222...2222');
  await expect(page.getByRole('link')).toHaveCount(1);
});

test('review renders receiver and action labels from the NEAR transaction payload', async ({ page }) => {
  await page.evaluate(async () => {
    const runtime = '/_test-preact/preact.module.js';
    const { h, render } = await import(runtime);
    const reviewUrl = '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/preact/TransactionReview.js';
    const treeUrl = '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/transaction-display/tree.js';
    const { TransactionReview } = await import(reviewUrl);
    const { buildDisplayTreeFromTxPayloads } = await import(treeUrl);
    const tree = buildDisplayTreeFromTxPayloads([{
      receiverId: 'demo.testnet',
      actions: [{ type: 'Transfer', amount: '0' }],
    }]);
    window.__treeTest.dispose();
    render(h(TransactionReview, {
      data: { model: null, tree, detailsInitiallyOpen: true },
    }), document.querySelector('main')!);
  });
  const review = page.locator('.seams-transaction-review');
  await expect(review).toContainText('Transaction to demo.testnet');
  await expect(review).toContainText('Transfer 0 NEAR');
});

test('review aligns a block content copy action with its label', async ({ page }) => {
  await page.evaluate(renderBlockContentReview);
  const row = page.locator('.seams-review-detail-row--block');
  const positions = await row.evaluate(blockContentPositions);
  expect(positions.copyTop).toBeCloseTo(positions.labelTop, 0);
  expect(positions.copyRight).toBeCloseTo(positions.rowRight, 0);
  expect(positions.contentTop).toBeGreaterThan(positions.labelBottom);
});

async function renderBlockContentReview() {
  const runtime = '/_test-preact/preact.module.js';
  const { h, render } = await import(runtime);
  const reviewUrl = '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/preact/TransactionReview.js';
  const { TransactionReview } = await import(reviewUrl);
  window.__treeTest.dispose();
  render(
    h(TransactionReview, {
      data: {
        model: null,
        detailsInitiallyOpen: true,
        tree: {
          id: 'root',
          type: 'folder',
          label: 'Transaction details',
          open: true,
          children: [
            {
              id: 'data',
              type: 'file',
              label: 'Data: decoded payload',
              fieldLabel: 'Data:',
              open: false,
              content: '{\n  "token": "0x20c0"\n}',
              copyValue: '0x20c0',
            },
          ],
        },
      },
    }),
    document.querySelector('main')!,
  );
}

function blockContentPositions(element: Element) {
  const label = element.querySelector(':scope > span')!.getBoundingClientRect();
  const copy = element.querySelector(':scope > .seams-review-copy')!.getBoundingClientRect();
  const content = element.querySelector(':scope > pre')!.getBoundingClientRect();
  const bounds = element.getBoundingClientRect();
  return {
    labelTop: label.top,
    copyTop: copy.top,
    copyRight: copy.right,
    contentTop: content.top,
    labelBottom: label.bottom,
    rowRight: bounds.right,
  };
}

test.beforeEach(async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('Browser origin required');
  await injectImportMap(page, { frontendUrl: baseURL });
  await routePreactModules(page);
  await page.route('**/wallet-ui.css', (route) =>
    route.fulfill({ contentType: 'text/css', body: walletUiCss }),
  );
  await page.route('**/transaction-tree-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': "style-src 'self'; style-src-attr 'none'" },
      body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}<link rel="stylesheet" href="/wallet-ui.css"></head><body><main class="seams-wallet-ui" data-theme="light"></main></body></html>`,
    }),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/transaction-tree-test');
  await page.evaluate(async (node) => {
    const runtime = '/_test-preact/preact.module.js';
    const { h, render } = await import(runtime);
    const moduleUrl = '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/preact/TransactionTree.js';
    const { TransactionTree } = await import(moduleUrl);
    const stylesUrl = '/_test-sdk/esm/core/browser/walletIframe/csp-stylesheet.js';
    const { createCspStylesheetManager } = await import(stylesUrl);
    const styles = createCspStylesheetManager({ doc: document, baseCss: '' });
    const parent = document.querySelector('main')!;
    const copies: string[] = [];
    const writes: string[] = [];
    const toggles: { id: string; open: boolean }[] = [];
    const violations: string[] = [];
    document.addEventListener('securitypolicyviolation', (event) =>
      violations.push(event.violatedDirective),
    );
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(value: string) {
          writes.push(value);
          return Promise.resolve();
        },
      },
    });
    function onCopy(value: string) {
      copies.push(value);
    }
    function onToggle(id: string, open: boolean) {
      toggles.push({ id, open });
    }
    function update(node: TreeNode) {
      render(
        h(TransactionTree, {
          node,
          theme: 'light',
          showShadow: false,
          styles,
          explorers: { near: 'https://testnet.nearblocks.io', evm: 'https://explorer.example' },
          onCopy,
          onToggle,
        }),
        parent,
      );
    }
    function dispose() {
      render(null, parent);
    }
    window.__treeTest = {
      update,
      dispose,
      copies,
      writes,
      toggles,
      violations,
      pendingCopy: null,
      resize: null,
    };
    update(node);
  }, tree);
});

test('keyboard expansion, decoded/raw content, copy feedback and explorer links', async ({ page }) => {
  const folder = page.locator('details[data-node-id="transaction"]');
  const summary = folder.locator(':scope > summary');
  await expect(page.getByRole('link')).toHaveAttribute(
    'href',
    'https://explorer.example/address/0x1111111111111111111111111111111111111111',
  );
  await expect(page.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('.highlight-method-name')).toHaveText('transfer');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(folder).not.toHaveAttribute('open', '');
  await page.keyboard.press('Space');
  await expect(folder).toHaveAttribute('open', '');
  await page.getByRole('button', { name: 'Show bytes' }).click();
  await expect(page.locator('.file-content')).toHaveText('0xa9059cbb');
  await expect(folder).toHaveAttribute('open', '');
  await page.getByRole('button', { name: 'Show decoded' }).click();
  await expect(page.locator('.file-content')).toContainText('visual-fixture');
  const copy = page.getByRole('button', { name: 'copy', exact: true });
  await copy.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'copied', exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.__treeTest.copies)).toEqual(['0xa9059cbb']);
  expect(await page.evaluate(() => window.__treeTest.writes)).toEqual(['0xa9059cbb']);
  expect(await page.evaluate(() => window.__treeTest.toggles)).toEqual([
    { id: 'transaction', open: false },
    { id: 'transaction', open: true },
  ]);
  await expect(copy).toBeVisible();
  await expect(page.locator('main [style]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__treeTest.violations)).toEqual([]);
});

test('clipboard fallback is scoped, removes its textarea and preserves CSP', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    document.execCommand = (command: string): boolean => {
      if (command !== 'copy') return false;
      const textarea = document.querySelector<HTMLTextAreaElement>('.seams-tx-tree textarea')!;
      window.__treeTest.writes.push(textarea.value);
      return true;
    };
  });
  await page.getByRole('button', { name: 'copy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'copied', exact: true })).toBeVisible();
  await expect(page.locator('textarea')).toHaveCount(0);
  expect(await page.evaluate(() => window.__treeTest.writes)).toEqual(['0xa9059cbb']);
  expect(await page.evaluate(() => window.__treeTest.violations)).toEqual([]);
});

test('normal-motion toggles release geometry rules and pending copy cannot revive a disposed tree', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const folder = page.locator('details[data-node-id="transaction"]');
  const summary = folder.locator(':scope > summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(folder).not.toHaveAttribute('open', '');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__treeTest.toggles.length)).toBe(2);
  await expect(page.locator('.anim-h')).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText() {
          return new Promise<void>((resolve) => {
            window.__treeTest.pendingCopy = resolve;
          });
        },
      },
    });
  });
  await page.getByRole('button', { name: 'copy', exact: true }).click();
  await page.evaluate(() => {
    window.__treeTest.dispose();
    window.__treeTest.pendingCopy?.();
  });
  await expect(page.locator('main > *')).toHaveCount(0);
  expect(await page.evaluate(() => window.__treeTest.copies)).toEqual([]);
  expect(await page.evaluate(() => window.__treeTest.violations)).toEqual([]);
});

test('hosted expansion waits for the iframe box before revealing the transaction body', async ({
  page,
}) => {
  const folder = page.locator('details[data-node-id="transaction"]');
  await folder.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  await expect(folder).not.toHaveAttribute('open', '');
  const origin = await page.evaluate(async () => {
    const url = '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/confirm-surface-resize.js';
    const module = await import(url);
    const host = document.querySelector<HTMLElement>('main')!;
    host.setAttribute(module.CONFIRM_SURFACE_MODE_ATTR, 'wallet-iframe');
    const viewportPx = Math.round(host.getBoundingClientRect().height);
    const state = { viewportPx, deltas: [] as number[], dispose: () => {} };
    host.addEventListener('seams-surface-resize-begin', (event) => {
      state.deltas.push((event as CustomEvent<{ deltaCssPx: number }>).detail.deltaCssPx);
    });
    const choreographer = module.attachConfirmSurfaceResizeChoreographer(host, {
      viewportHeightCssPx: () => state.viewportPx,
    });
    state.dispose = () => choreographer.dispose();
    window.__treeTest.resize = state;
    window.__treeTest.toggles.length = 0;
    return viewportPx;
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toHaveClass(/seams-confirm-surface-pinned/);
  const delta = await page.evaluate(() => window.__treeTest.resize!.deltas[0]);
  expect(delta).toBeGreaterThan(0);
  const body = folder.locator(':scope > .folder-children');
  expect(await body.evaluate((element) => element.getBoundingClientRect().height)).toBe(0);
  expect(await page.evaluate(() => window.__treeTest.toggles)).toEqual([]);
  for (const fraction of [0.25, 0.5, 0.75, 1]) {
    const viewportPx = origin + Math.round(delta * fraction);
    await page.evaluate(async (height) => {
      window.__treeTest.resize!.viewportPx = height;
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    }, viewportPx);
    const bodyHeight = await body.evaluate((element) => element.getBoundingClientRect().height);
    expect(bodyHeight).toBeLessThanOrEqual(viewportPx - origin + 1);
  }
  await expect
    .poll(() => page.evaluate(() => window.__treeTest.toggles))
    .toEqual([{ id: 'transaction', open: true }]);
  await expect(page.locator('main')).not.toHaveClass(/seams-confirm-surface-pinned/);
  await expect(page.locator('.anim-h')).toHaveCount(0);
  expect(await page.evaluate(() => window.__treeTest.resize!.deltas)).toHaveLength(1);
  expect(await page.evaluate(() => window.__treeTest.violations)).toEqual([]);
  await page.evaluate(() => {
    window.__treeTest.resize!.dispose();
    window.__treeTest.dispose();
  });
});
