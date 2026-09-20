import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { injectImportMap } from '../setup/bootstrap';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import { routePreactModules } from '../setup/preact';
import { SDK_ESM_PATHS } from '../setup';

const IMPORT_PATHS = {
  confirmUi: SDK_ESM_PATHS.confirmUi,
} as const;

test.describe('Preact production confirmation mount', () => {
  test.beforeEach(async ({ page }) => {
    await injectImportMap(page);
    await routePreactModules(page);
    const confirmationCss = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../packages/wallet/dist/esm/sdk/confirmation-ui.css'),
      'utf8',
    );
    const componentsCss = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../packages/wallet/dist/esm/sdk/seams-components.css'),
      'utf8',
    );
    await page.route('**/confirmation-ui.css', (route) =>
      route.fulfill({ contentType: 'text/css', body: confirmationCss }),
    );
    await page.route('**/seams-components.css', (route) =>
      route.fulfill({ contentType: 'text/css', body: componentsCss }),
    );
    await page.route('**/confirm-ui-test', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}<link rel="stylesheet" data-seams-components-css href="/seams-components.css"><link rel="stylesheet" data-seams-confirmation-css href="/confirmation-ui.css"></head><body><main></main></body></html>`,
      }),
    );
    await page.goto('/confirm-ui-test');
  });

  test('mounts a transaction model through the public confirm-ui API', async ({ page }) => {
    const result = await page.evaluate(
      async ({ confirmUiPath }) => {
        const { mountConfirmUI } = await import(confirmUiPath);
        const ctx = {
          userPreferencesManager: { getCurrentWalletId: () => 'alice.testnet' },
          surfaceMeasurementBinding: { kind: 'disabled' as const },
        };
        const handle = await mountConfirmUI({
          ctx,
          summary: { title: 'Model-only confirmation', body: 'Review this transaction' },
          model: {
            chain: 'evm',
            chainId: 1,
            operations: [
              {
                id: 'op-1',
                kind: 'generic.contractCall',
                label: 'Contract Call',
                fields: [{ label: 'To', value: '0x1111111111111111111111111111111111111111' }],
              },
            ],
          },
          securityContext: { rpId: 'example.com', blockHeight: '1' },
          loading: false,
          theme: 'light',
          uiMode: 'modal',
          nearAccountIdOverride: 'alice.testnet',
        });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const root = handle.element;
        const result = {
          rootClass: root.className,
          surface: root.dataset.seamsConfirmSurface,
          variant: root.dataset.seamsConfirmVariant,
          heading: root.querySelector('.seams-confirm-header .hero-heading')?.textContent ?? '',
          tree: !!root.querySelector('.seams-tx-tree'),
          operation: root.querySelector('.label-text')?.textContent ?? '',
          cancel: !!root.querySelector('button.cancel'),
          confirm: !!root.querySelector('button.confirm'),
        };
        handle.close(true);
        return result;
      },
      { confirmUiPath: IMPORT_PATHS.confirmUi },
    );

    expect(result.rootClass).toContain('seams-confirmation-surface');
    expect(result.surface).toBe('standalone');
    expect(result.variant).toBe('modal');
    expect(result.heading).toBe('Model-only confirmation');
    expect(result.tree).toBe(true);
    expect(result.operation).toContain('Contract Call');
    expect(result.cancel).toBe(true);
    expect(result.confirm).toBe(true);
  });

  test('resolves cancel through the public decision API', async ({ page }) => {
    const result = await page.evaluate(
      async ({ confirmUiPath }) => {
        const { awaitConfirmUIDecision } = await import(confirmUiPath);
        const ctx = {
          userPreferencesManager: { getCurrentWalletId: () => 'alice.testnet' },
          surfaceMeasurementBinding: { kind: 'disabled' as const },
        };
        const decision = awaitConfirmUIDecision({
          ctx,
          surface: { kind: 'mount_new' },
          summary: { title: 'Cancel this confirmation' },
          txSigningRequests: [],
          theme: 'dark',
          uiMode: 'modal',
          nearAccountIdOverride: 'alice.testnet',
        });
        await pageClickCancel();
        const resolved = await decision;
        return { confirmed: resolved.confirmed, error: resolved.error ?? null };

        async function pageClickCancel(): Promise<void> {
          const startedAt = performance.now();
          while (!document.querySelector<HTMLButtonElement>('button.cancel')) {
            if (performance.now() - startedAt > 5_000)
              throw new Error('Cancel button did not mount');
            await new Promise((resolve) => requestAnimationFrame(resolve));
          }
          document.querySelector<HTMLButtonElement>('button.cancel')!.click();
        }
      },
      { confirmUiPath: IMPORT_PATHS.confirmUi },
    );

    expect(result).toEqual({ confirmed: false, error: null });
  });
});
