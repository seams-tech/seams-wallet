import { expect, test, type Page } from '@playwright/test';
import { WalletIframeDomEvents } from '@/core/browser/walletIframe/events';
import type { WalletIframeSurfaceMeasurement } from '@/SeamsWeb/walletIframe/shared/messages';
import { injectImportMap } from '../setup/bootstrap';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import { routePreactModules } from '../setup/preact';

type ExportFixture = {
  sessionId: string;
  requestId: string;
  state: 'loading' | 'ready' | 'failed';
  context: 'standalone' | 'wallet-iframe';
};

declare global {
  interface Window {
    __exportHost: {
      open(fixture: ExportFixture): Promise<void>;
      remove(): void;
      isOpen(sessionId: string): boolean;
      events: string[];
      measurements: WalletIframeSurfaceMeasurement[];
      copied: string[];
      violations: string[];
    };
  }
}

function fixture(state: ExportFixture['state'] = 'ready'): ExportFixture {
  return { sessionId: 'export-one', requestId: 'request-one', state, context: 'wallet-iframe' };
}

async function open(page: Page, input = fixture()): Promise<void> {
  await page.evaluate((input) => window.__exportHost.open(input), input);
}

test.beforeEach(async ({ page }) => {
  await injectImportMap(page);
  await routePreactModules(page);
  await page.route('**/export-host-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': "style-src 'self'; style-src-attr 'none'" },
      body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}<link rel="stylesheet" href="/_test-sdk/esm/sdk/wallet-ui.css"></head><body><button id="opener">Export</button></body></html>`,
    }),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/export-host-test');
  await page.evaluate(async () => {
    const hostPath = '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/export-viewer-host.js';
    const identityPath = '/_test-sdk/esm/core/types/walletIframeIdentity.js';
    const { upsertExportViewerHost, removeExportViewerHostIfPresent, isExportViewerSessionOpen } =
      await import(hostPath);
    const { walletIframeRequestIdFromBoundary } = await import(identityPath);
    function lifecycle(event: 'opened' | 'closed') {
      window.__exportHost.events.push(event);
    }
    function postMeasurement(measurement: WalletIframeSurfaceMeasurement) {
      window.__exportHost.measurements.push(measurement);
    }
    function open(input: ExportFixture) {
      return upsertExportViewerHost({
        theme: 'light',
        variant: 'drawer',
        accountId: 'synthetic.testnet',
        sessionId: input.sessionId,
        loading: input.state === 'loading',
        errorMessage: input.state === 'failed' ? 'Synthetic export failure' : '',
        keys: [
          {
            scheme: 'secp256k1',
            label: 'EVM',
            publicKey: '0x02abcd',
            address: '0x1234567890abcdef',
            privateKey: `0x${'1234567890abcdef'.repeat(4)}`,
          },
        ],
        onLifecycle: lifecycle,
        surfaceMeasurementBinding:
          input.context === 'standalone'
            ? { kind: 'disabled' }
            : {
                kind: 'wallet_iframe',
                requestId: walletIframeRequestIdFromBoundary(input.requestId),
                hostSurfaceVariant: 'modal',
                postMeasurement,
              },
      });
    }
    function violation(event: SecurityPolicyViolationEvent) {
      window.__exportHost.violations.push(event.violatedDirective);
    }
    async function writeText(value: string) {
      window.__exportHost.copied.push(value);
    }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    window.__exportHost = {
      open,
      remove: removeExportViewerHostIfPresent,
      isOpen: isExportViewerSessionOpen,
      events: [],
      measurements: [],
      copied: [],
      violations: [],
    };
    document.addEventListener('securitypolicyviolation', violation);
  });
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.__exportHost.remove());
  expect(await page.evaluate(() => window.__exportHost.violations)).toEqual([]);
});

test('complete updates discard error and key state and rebind measurement requests', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Copy private key' }).click();
  expect(await page.evaluate(() => window.__exportHost.copied)).toEqual([
    `0x${'1234567890abcdef'.repeat(4)}`,
  ]);
  await open(page, fixture('failed'));
  await expect(page.getByRole('alert')).toHaveText('Synthetic export failure');
  await expect(page.locator('.key-card')).toHaveCount(0);
  await open(page, fixture('loading'));
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy private key' })).toBeDisabled();
  const rebound = fixture();
  rebound.requestId = 'request-two';
  await open(page, rebound);
  expect(await page.evaluate(() => window.__exportHost.measurements.at(-1)?.requestId)).toBe(
    'request-two',
  );
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const count = await page.evaluate(() => window.__exportHost.measurements.length);
  await page.setViewportSize({ width: 640, height: 400 });
  await page.evaluate(() => window.__exportHost.remove());
  await expect(page.locator('.seams-export-surface')).toHaveCount(0);
  expect(await page.evaluate(() => window.__exportHost.isOpen('export-one'))).toBe(false);
  expect(await page.evaluate(() => window.__exportHost.events)).toEqual(['opened', 'closed']);
  expect(await page.evaluate(() => window.__exportHost.measurements.length)).toBe(count);
});

test('wallet iframe cancellation event disposes the export surface', async ({ page }) => {
  await open(page);
  await page.evaluate((eventName) => {
    document
      .querySelector('.seams-export-surface')
      ?.dispatchEvent(new CustomEvent(eventName, { bubbles: true, composed: true }));
  }, WalletIframeDomEvents.TX_CONFIRMER_CANCEL);
  await expect(page.locator('.seams-export-surface')).toHaveCount(0);
  expect(await page.evaluate(() => window.__exportHost.events)).toEqual(['opened', 'closed']);
});

test('session replacement closes its previous lifetime', async ({ page }) => {
  await open(page);
  const second = fixture();
  second.sessionId = 'export-two';
  await open(page, second);
  expect(await page.evaluate(() => window.__exportHost.isOpen('export-one'))).toBe(false);
  expect(await page.evaluate(() => window.__exportHost.isOpen('export-two'))).toBe(true);
  expect(await page.evaluate(() => window.__exportHost.events)).toEqual([
    'opened',
    'closed',
    'opened',
  ]);
});

test('cancel and replacement during lazy loading cannot mount stale exports', async ({ page }) => {
  await page.evaluate(async (input) => {
    const pending = window.__exportHost.open(input);
    window.__exportHost.remove();
    await pending;
  }, fixture());
  await expect(page.locator('.seams-export-surface')).toHaveCount(0);
  expect(await page.evaluate(() => window.__exportHost.events)).toEqual([]);
  const second = fixture();
  second.sessionId = 'latest';
  await page.evaluate(
    async ({ first, second }) => {
      await Promise.all([window.__exportHost.open(first), window.__exportHost.open(second)]);
    },
    { first: fixture(), second },
  );
  await expect(page.locator('.seams-export-surface')).toHaveCount(1);
  expect(await page.evaluate(() => window.__exportHost.isOpen('latest'))).toBe(true);
  expect(await page.evaluate(() => window.__exportHost.events)).toEqual(['opened']);
});

test('failed renderer import leaves no session, events, or DOM', async ({ page }) => {
  await page.route('**/preact/mountExportPrivateKeySurface.js', (route) => route.abort());
  await expect(open(page)).rejects.toThrow();
  await expect(page.locator('.seams-export-surface')).toHaveCount(0);
  expect(await page.evaluate(() => window.__exportHost.events)).toEqual([]);
  expect(await page.evaluate(() => window.__exportHost.isOpen('export-one'))).toBe(false);
});
