import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { ExportPrivateKeyViewModel } from '@/core/signingEngine/uiConfirm/ui/preact/ExportPrivateKeySurface';
import type { ExportSurfaceHandle } from '@/core/signingEngine/uiConfirm/ui/preact/mountExportPrivateKeySurface';
import { injectImportMap } from '../setup/bootstrap';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import { routePreactModules } from '../setup/preact';

declare global {
  interface Window {
    __exportView: {
      update(model: ExportPrivateKeyViewModel, context?: 'standalone' | 'wallet-iframe', variant?: 'modal' | 'drawer'): void;
      dispose(): void;
      resolveCopy(): void;
      rejectCopy(): void;
      copied: string[];
      violations: string[];
    };
  }
}

const secret = `0x${'1234567890abcdef'.repeat(4)}`;
const replacement = `0x${'abcdef1234567890'.repeat(4)}`;

function model(value: string, loading = false): ExportPrivateKeyViewModel {
  if (loading) {
    return {
      kind: 'loading',
      accountId: 'synthetic.testnet',
      entries: [
        {
          id: 'evm',
          scheme: 'secp256k1',
          label: 'EVM',
          publicKey: '0x02abcd',
          address: '0x1234',
          material: { kind: 'loading' },
        },
      ],
    };
  }
  return {
    kind: 'ready',
    accountId: 'synthetic.testnet',
    entries: [
      {
        id: 'evm',
        scheme: 'secp256k1',
        label: 'EVM',
        publicKey: '0x02abcd',
        address: '0x1234',
        material: { kind: 'ready', value },
      },
    ],
  };
}

test.beforeEach(async ({ page }) => {
  await injectImportMap(page);
  await routePreactModules(page);
  const css = ['confirmation-primitives', 'confirmation-drawer', 'confirmation-modal', 'export-private-key']
    .map(readCss)
    .join('\n');
  await page.route('**/export-test.css', (route) =>
    route.fulfill({ contentType: 'text/css', body: css }),
  );
  await page.route('**/export-view-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': "style-src 'self'; style-src-attr 'none'" },
      body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}<link rel="stylesheet" href="/export-test.css"></head><body><main class="seams-wallet-ui" data-theme="light"></main></body></html>`,
    }),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/export-view-test');
  await page.evaluate(async () => {
    const viewPath =
      '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/preact/mountExportPrivateKeySurface.js';
    const { mountExportPrivateKeySurface } = await import(viewPath);
    const root = document.querySelector('main')!;
    let handle: ExportSurfaceHandle | null = null;
    let resolvePending: (() => void) | null = null;
    let rejectPending: ((reason: Error) => void) | null = null;
    function completeCopy(resolve: () => void, reject: (reason: Error) => void) {
      resolvePending = resolve;
      rejectPending = reject;
    }
    function writeText(value: string) {
      window.__exportView.copied.push(value);
      return new Promise<void>(completeCopy);
    }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    function update(
      model: ExportPrivateKeyViewModel,
      context: 'standalone' | 'wallet-iframe' = 'wallet-iframe',
      variant: 'modal' | 'drawer' = 'drawer',
    ) {
      const surfaceModel = {
        variant,
        appearance: {
          palette: 'default' as const,
          theme: { id: 'default', mode: 'light' as const, colors: {} },
        },
        content: model,
      };
      if (handle) handle.update(surfaceModel);
      else
        handle = mountExportPrivateKeySurface({
          parent: root,
          context,
          model: surfaceModel,
          onClosed: closed,
        });
    }
    function closed() {
      handle = null;
    }
    function dispose() {
      handle?.dispose();
    }
    function resolveCopy() {
      resolvePending?.();
      resolvePending = null;
      rejectPending = null;
    }
    function rejectCopy() {
      rejectPending?.(new Error('Clipboard denied'));
      resolvePending = null;
      rejectPending = null;
    }
    function violation(event: SecurityPolicyViolationEvent) {
      window.__exportView.violations.push(event.violatedDirective);
    }
    window.__exportView = { update, dispose, resolveCopy, rejectCopy, copied: [], violations: [] };
    document.addEventListener('securitypolicyviolation', violation);
  });
});

function readCss(name: string): string {
  return fs.readFileSync(
    path.resolve(
      import.meta.dirname,
      `../../packages/wallet/src/core/signingEngine/uiConfirm/ui/preact/${name}.css`,
    ),
    'utf8',
  );
}

test('loading settles into masked text before private-key copying is enabled', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate((model) => window.__exportView.update(model), model('', true));
  const copy = page.getByRole('button', { name: 'Copy private key' });
  await expect(copy).toBeDisabled();
  await expect(page.locator('.reel-slot')).toHaveCount(64);
  await page.evaluate((model) => window.__exportView.update(model), model(secret));
  await expect(copy).toBeEnabled();
  expect(await page.locator('main').innerHTML()).not.toContain(secret);
  await copy.click();
  expect(await page.evaluate(() => window.__exportView.copied)).toEqual([secret]);
  await page.evaluate(() => window.__exportView.resolveCopy());
  await expect(page.getByRole('button', { name: 'Private key copied' })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.seams-export-key-viewer')).toHaveCount(0);
  expect(await page.evaluate(() => window.__exportView.violations)).toEqual([]);
});

test('key replacement discards stale copy feedback and error removes key rows', async ({
  page,
}) => {
  await page.evaluate((model) => window.__exportView.update(model), model(secret));
  await page.getByRole('button', { name: 'Copy private key' }).click();
  await page.evaluate((model) => window.__exportView.update(model), model(replacement));
  await page.evaluate(() => window.__exportView.resolveCopy());
  await expect(page.getByRole('button', { name: 'Copy private key' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Private key copied' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Copy private key' }).click();
  expect(await page.evaluate(() => window.__exportView.copied)).toEqual([secret, replacement]);
  await page.evaluate(() =>
    window.__exportView.update({
      kind: 'failed',
      accountId: 'synthetic.testnet',
      message: 'Export failed',
    }),
  );
  await expect(page.getByRole('alert')).toHaveText('Export failed');
  await expect(page.locator('.key-card')).toHaveCount(0);
  await page.evaluate(() => {
    window.__exportView.dispose();
    window.__exportView.resolveCopy();
  });
  await expect(page.locator('main')).toBeEmpty();
  expect(await page.evaluate(() => window.__exportView.violations)).toEqual([]);
});

test('clipboard rejection falls back to selected text and removes its temporary field', async ({
  page,
}) => {
  await page.evaluate(() => {
    async function rejectCopy() {
      throw new Error('Clipboard denied');
    }
    function selectedCopy() {
      const selected = document.querySelector<HTMLTextAreaElement>('textarea');
      if (!selected) return false;
      window.__exportView.copied.push(selected.value);
      return true;
    }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: rejectCopy },
    });
    document.execCommand = selectedCopy;
  });
  await page.evaluate((model) => window.__exportView.update(model), model(secret));
  await page.getByRole('button', { name: 'Copy private key' }).click();
  await expect(page.getByRole('button', { name: 'Private key copied' })).toBeVisible();
  await expect(page.locator('textarea')).toHaveCount(0);
  expect(await page.evaluate(() => window.__exportView.copied)).toEqual([secret]);
  await page.evaluate(() => window.__exportView.dispose());
  expect(await page.evaluate(() => window.__exportView.violations)).toEqual([]);
});

test('standalone backdrop and selectable key text leave the drawer open', async ({ page }) => {
  await page.evaluate((model) => window.__exportView.update(model, 'standalone'), model(secret));
  const drawer = page.locator('.seams-confirmation-drawer');
  await expect(drawer).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(drawer).toBeVisible();
  const before = await drawer.boundingBox();
  const text = await page.locator('.seams-export-key-viewer h2').boundingBox();
  expect(text).not.toBeNull();
  await page.mouse.move(text!.x + 10, text!.y + 10);
  await page.mouse.down();
  await page.mouse.move(text!.x + 30, text!.y + 200, { steps: 12 });
  await page.mouse.up();
  await expect(drawer).toBeVisible();
  expect(await drawer.boundingBox()).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(page.locator('main')).toBeEmpty();
  expect(await page.evaluate(() => window.__exportView.violations)).toEqual([]);
});

test('late clipboard rejection cannot start fallback after key replacement or disposal', async ({
  page,
}) => {
  await page.evaluate(() => {
    function unexpectedFallback() {
      window.__exportView.copied.push('unexpected fallback');
      return true;
    }
    document.execCommand = unexpectedFallback;
  });
  await page.evaluate((model) => window.__exportView.update(model), model(secret));
  await page.getByRole('button', { name: 'Copy private key' }).click();
  await page.evaluate((model) => {
    window.__exportView.update(model);
    window.__exportView.rejectCopy();
  }, model(replacement));
  await page.getByRole('button', { name: 'Copy private key' }).click();
  await page.evaluate(() => {
    window.__exportView.dispose();
    window.__exportView.rejectCopy();
  });
  await expect(page.locator('main')).toBeEmpty();
  expect(await page.evaluate(() => window.__exportView.copied)).toEqual([secret, replacement]);
  await expect(page.locator('textarea')).toHaveCount(0);
});

test('closing during loading and reveal allows a clean multi-key reopen', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate((model) => window.__exportView.update(model), model('', true));
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('main')).toBeEmpty();
  await page.evaluate((model) => window.__exportView.update(model), model(secret));
  await page.evaluate(() => {
    window.__exportView.dispose();
    window.__exportView.dispose();
  });
  await expect(page.locator('main')).toBeEmpty();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reopened = model(replacement);
  if (reopened.kind !== 'ready') throw new Error('Expected ready fixture');
  reopened.entries.push({
    id: 'near',
    scheme: 'ed25519',
    label: 'NEAR',
    publicKey: 'ed25519:synthetic-public-key',
    address: '',
    material: { kind: 'ready', value: 'ed25519:synthetic-private-key' },
  });
  reopened.guidance = {
    title: 'Keep the backup private',
    body: 'Synthetic export guidance for a scrollable multi-key drawer.',
    steps: ['Import each key into your trusted wallet.', 'Keep a secure offline backup.'],
  };
  await page.evaluate((model) => window.__exportView.update(model), reopened);
  await expect(page.locator('.key-card')).toHaveCount(2);
  const copies = page.getByRole('button', { name: 'Copy private key' });
  await copies.nth(0).click();
  await page.evaluate(() => window.__exportView.resolveCopy());
  await page.getByRole('button', { name: 'Copy private key', exact: true }).click();
  await page.evaluate(() => window.__exportView.resolveCopy());
  await page.getByRole('button', { name: 'Copy public key', exact: true }).click();
  await page.evaluate(() => window.__exportView.resolveCopy());
  expect(await page.evaluate(() => window.__exportView.copied)).toEqual([
    replacement,
    'ed25519:synthetic-private-key',
    'ed25519:synthetic-public-key',
  ]);
  expect(await page.locator('main').innerHTML()).not.toContain(secret);
  const warning = page.locator('.warning').last();
  await warning.scrollIntoViewIfNeeded();
  const warningBox = await warning.boundingBox();
  const hostBox = await page.locator('.seams-export-surface').boundingBox();
  expect(warningBox!.y + warningBox!.height).toBeLessThanOrEqual(hostBox!.y + hostBox!.height);
  expect(
    await page.locator('.seams-drawer-body').evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
  await page.evaluate(() => window.__exportView.dispose());
  await expect(page.locator('main')).toBeEmpty();
  expect(await page.evaluate(() => window.__exportView.violations)).toEqual([]);
});

for (const context of ['standalone', 'wallet-iframe'] as const) {
  test(`modal export copies and disposes keys in ${context}`, async ({ page }) => {
    await page.evaluate(({ value, context }) => window.__exportView.update(value, context, 'modal'), {
      value: model(secret),
      context,
    });
    const modal = page.locator('.seams-confirmation-modal');
    await expect(modal).toBeVisible();
    if (context === 'wallet-iframe') {
      await expect(modal).toBeFocused();
      await expect(modal).toHaveCSS('outline-style', 'none');
    }
    const close = page.getByRole('button', { name: 'Close exported keys' });
    const titleBounds = await page.getByRole('heading', { name: 'Exported Keys' }).boundingBox();
    const closeBounds = await close.boundingBox();
    expect(closeBounds!.x).toBeGreaterThanOrEqual(titleBounds!.x + titleBounds!.width);

    await expect(page.locator('.seams-confirmation-drawer')).toHaveCount(0);
    await page.getByRole('button', { name: 'Copy private key' }).click();
    expect(await page.evaluate(() => window.__exportView.copied)).toEqual([secret]);
    await page.evaluate(() => window.__exportView.resolveCopy());
    await page.getByRole('button', { name: 'Close exported keys' }).click();
    await expect(page.locator('.seams-export-key-viewer')).toHaveCount(0);
  });
}
