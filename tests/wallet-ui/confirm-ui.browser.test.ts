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
    const walletUiCss = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../packages/wallet/dist/esm/sdk/wallet-ui.css'),
      'utf8',
    );
    await page.route('**/wallet-ui.css', (route) =>
      route.fulfill({ contentType: 'text/css', body: walletUiCss }),
    );
    await page.route('**/confirm-ui-test', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}<link rel="stylesheet" href="/wallet-ui.css"></head><body><main></main></body></html>`,
      }),
    );
    await page.goto('/confirm-ui-test');
  });

  test('mounts a transaction model through the public confirm-ui API', async ({ page }) => {
    const result = await page.evaluate(
      async ({ confirmUiPath }) => {
        const { mountConfirmUI } = await import(confirmUiPath);
        const ctx = {
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
          surfaceMeasurementBinding: { kind: 'disabled' as const },
        };
        const decision = awaitConfirmUIDecision({
          ctx,
          surface: { kind: 'mount_new' },
          summary: { title: 'Cancel this confirmation' },
          txSigningRequests: [],
          theme: 'dark',
          uiMode: 'modal',
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

  test('mounts every supported chain in standalone and hosted modal/drawer contexts', async ({
    page,
  }) => {
    const results = await page.evaluate(async ({ confirmUiPath }) => {
      const { mountConfirmUI } = await import(confirmUiPath);
      const chains = [
        { kind: 'near', label: 'NEAR', chainId: 4000 },
        { kind: 'evm', label: 'EVM', chainId: 11155111 },
        { kind: 'tempo', label: 'Tempo', chainId: 4242 },
      ] as const;
      const contexts = ['standalone', 'wallet-iframe'] as const;
      const variants = ['modal', 'drawer'] as const;
      const mounted: Array<{
        chain: string;
        context: string;
        variant: string;
        surface: string | undefined;
        tree: boolean;
        chainLabel: boolean;
      }> = [];
      for (const chain of chains) {
        for (const context of contexts) {
          for (const variant of variants) {
            const handle = await mountConfirmUI({
              ctx: {
                surfaceMeasurementBinding:
                  context === 'wallet-iframe'
                    ? {
                        kind: 'wallet_iframe' as const,
                        requestId: `${chain.kind}-${context}-${variant}`,
                        hostSurfaceVariant: variant,
                        postMeasurement: () => {},
                      }
                    : { kind: 'disabled' as const },
              },
              summary: { title: `${chain.label} review`, body: 'Synthetic chain fixture' },
              model: {
                chain: chain.kind,
                chainId: chain.chainId,
                operations: [
                  {
                    id: `${chain.kind}-operation`,
                    kind: 'generic.contractCall',
                    label: 'Synthetic contract call',
                    fields: [{ label: 'Target', value: 'fixture.testnet' }],
                  },
                ],
              },
              securityContext: { rpId: 'wallet.example.test', blockHeight: '1' },
              loading: false,
              theme: context === 'standalone' ? 'light' : 'dark',
              uiMode: variant,
            });
            const root = handle.element;
            const text = root.textContent ?? '';
            mounted.push({
              chain: chain.kind,
              context,
              variant,
              surface: root.dataset.seamsConfirmSurface,
              tree: Boolean(root.querySelector('.seams-tx-tree')),
              chainLabel: text.includes(`${chain.label} | ChainID: ${chain.chainId}`),
            });
            handle.close(true);
            if (variant === 'drawer') {
              await new Promise((resolve) => setTimeout(resolve, 300));
            }
          }
        }
      }
      return mounted;
    }, { confirmUiPath: IMPORT_PATHS.confirmUi });

    expect(results).toHaveLength(12);
    expect(results.every((result) => result.tree && result.chainLabel)).toBe(true);
    for (const result of results) {
      const expectedSurface =
        result.context === 'wallet-iframe' && result.variant === 'modal'
          ? 'wallet-iframe'
          : 'standalone';
      expect(result.surface).toBe(expectedSurface);
    }
    await expect(page.locator('.seams-confirmation-surface')).toHaveCount(0);
  });

  test('cleans up a cancelled confirmation before the next auth handoff', async ({ page }) => {
    const result = await page.evaluate(async ({ confirmUiPath }) => {
      const { awaitConfirmUIDecision } = await import(confirmUiPath);
      const ctx = {
        surfaceMeasurementBinding: { kind: 'disabled' as const },
      };
      const input = (title: string) => ({
        ctx,
        summary: { title },
        txSigningRequests: [],
        theme: 'light' as const,
        uiMode: 'modal' as const,
        surface: { kind: 'mount_new' as const },
      });
      const cancelled = awaitConfirmUIDecision(input('Cancel before auth handoff'));
      while (!document.querySelector<HTMLButtonElement>('button.cancel')) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      document.querySelector<HTMLButtonElement>('button.cancel')!.click();
      const cancelledResult = await cancelled;
      cancelledResult.handle.close(false);
      const confirmed = awaitConfirmUIDecision(input('Confirm after auth handoff'));
      let confirmButton: HTMLButtonElement | null = null;
      while (!confirmButton || confirmButton.disabled) {
        confirmButton = document.querySelector<HTMLButtonElement>('button.confirm');
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      confirmButton.click();
      const confirmedResult = await confirmed;
      confirmedResult.handle.close(true);
      return {
        cancelled: cancelledResult.confirmed,
        confirmed: confirmedResult.confirmed,
        remaining: document.querySelectorAll('.seams-confirmation-surface').length,
      };
    }, { confirmUiPath: IMPORT_PATHS.confirmUi });

    expect(result).toEqual({ cancelled: false, confirmed: true, remaining: 0 });
  });

  test('lazily enriches ABI hints without replacing the mounted surface', async ({ page }) => {
    const result = await page.evaluate(
      async ({ confirmUiPath }) => {
        const { mountConfirmUI } = await import(confirmUiPath);
        const ctx = {
          surfaceMeasurementBinding: { kind: 'disabled' as const },
        };
        const model = {
          chain: 'evm' as const,
          intentDigest: '0x22',
          operations: [
            {
              id: 'evm.call',
              kind: 'generic.contractCall' as const,
              label: 'Transaction to contract',
              children: [
                {
                  id: 'evm.call.set-greeting',
                  kind: 'generic.contractCall' as const,
                  label: 'Calling contract function using 200k gas',
                  fields: [
                    {
                      label: 'Data',
                      value:
                        'data: 0xa41368620000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d68656c6c6f2c20776f726c642100000000000000000000000000000000000000',
                    },
                  ],
                  abiDecodeHint: {
                    dataHex:
                      '0xa41368620000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d68656c6c6f2c20776f726c642100000000000000000000000000000000000000',
                    abi: [
                      {
                        type: 'function',
                        name: 'setGreeting',
                        inputs: [{ name: 'greeting', type: 'string' }],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        };
        const handle = await mountConfirmUI({
          ctx,
          summary: { title: 'Lazy ABI Decode' },
          model,
          securityContext: { blockHeight: '1' },
          loading: false,
          theme: 'dark',
          uiMode: 'modal',
        });
        const surface = handle.element;
        const initialSurface = surface;
        const startedAt = performance.now();
        while (!surface.textContent?.includes('setGreeting()')) {
          if (performance.now() - startedAt > 5_000) {
            throw new Error('Timed out waiting for lazy ABI enrichment');
          }
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        const text = surface.textContent ?? '';
        handle.close(true);
        return {
          sameSurface: initialSurface === surface,
          callLabel: text.includes('Calling setGreeting() using 200k gas'),
          decodedArgument: text.includes('"greeting": "hello, world!"'),
        };
      },
      { confirmUiPath: IMPORT_PATHS.confirmUi },
    );

    expect(result).toEqual({
      sameSurface: true,
      callLabel: true,
      decodedArgument: true,
    });
  });
});
