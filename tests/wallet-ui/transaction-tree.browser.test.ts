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

  // The transaction review builds the same labels from a NEAR transaction payload.
  await page.evaluate(async () => {
    const runtime = '/_test-preact/preact.module.js';
    const { h, render } = await import(runtime);
    const reviewUrl = '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/preact/TransactionReview.js';
    const treeUrl = '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/transaction-display/tree.js';
    const { TransactionReview } = await import(reviewUrl);
    const { buildDisplayTreeFromTxPayloads } = await import(treeUrl);
    const tree = buildDisplayTreeFromTxPayloads([
      {
        receiverId: 'demo.testnet',
        actions: [{ type: 'Transfer', amount: '0' }],
      },
    ]);
    window.__treeTest.dispose();
    render(
      h(TransactionReview, {
        data: { model: null, tree, detailsInitiallyOpen: true },
      }),
      document.querySelector('main')!,
    );
  });
  const review = page.locator('.seams-transaction-review');
  await expect(review).toContainText('Transaction to demo.testnet');
  await expect(review).toContainText('Transfer 0 NEAR');
});

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
    };
    update(node);
  }, tree);
});

test('keyboard expansion, decoded/raw content, copy feedback and explorer links', async ({
  page,
}) => {
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

test('a pending copy cannot revive a disposed tree', async ({ page }) => {
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
