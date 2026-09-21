import { expect, test, type Page } from '@playwright/test';
import type { AppearanceConfig } from '@/core/types/seams';
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
  appearance?: AppearanceConfig;
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
      closeOnMeasurement: boolean;
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
      body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}<link rel="stylesheet" data-seams-wallet-ui-css href="/_test-sdk/esm/sdk/wallet-ui.css"></head><body><button id="opener">Export</button></body></html>`,
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
      if (window.__exportHost.closeOnMeasurement) removeExportViewerHostIfPresent();
    }
    function open(input: ExportFixture) {
      return upsertExportViewerHost({
        theme: 'light',
        variant: 'drawer',
        accountId: 'synthetic.testnet',
        sessionId: input.sessionId,
        appearance: input.appearance,
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
      closeOnMeasurement: false,
    };
    document.addEventListener('securitypolicyviolation', violation);
  });
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.__exportHost.remove());
  expect(await page.evaluate(() => window.__exportHost.violations)).toEqual([]);
});

test('production export mounts without obsolete requests and reports a styled viewport-independent box', async ({
  page,
}) => {
  const obsoleteRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (
      ['/lit-components/', '/seams-tx-confirmer.js', '/halo-border.js', '/passkey-halo-loading.js'].some(
        (fragment) => url.includes(fragment),
      )
    ) {
      obsoleteRequests.push(url);
    }
  });
  await page.setViewportSize({ width: 1024, height: 900 });
  await open(page, fixture('loading'));
  await expect(page.getByRole('heading', { name: 'Exported Keys' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy private key' })).toBeDisabled();
  const initial = await page.evaluate(() => window.__exportHost.measurements);
  expect(initial[0]).toMatchObject({
    kind: 'measured_v1',
    requestId: 'request-one',
    widthCssPx: 384,
    heightCssPx: 576,
  });
  expect(obsoleteRequests).toEqual([]);
  const root = page.locator('.seams-export-surface');
  const id = await root.getAttribute('id');
  await page.setViewportSize({ width: 500, height: 300 });
  expect(await root.evaluate((element) => element.getBoundingClientRect().height)).toBe(576);
  await open(page);
  await expect(root).toHaveAttribute('id', id!);
  await expect(page.getByRole('button', { name: 'Copy private key' })).toBeEnabled();
  expect(await page.evaluate(() => window.__exportHost.events)).toEqual(['opened']);
  expect(await page.evaluate(() => window.__exportHost.isOpen('export-one'))).toBe(true);
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

test('session replacement closes its previous lifetime and removes owned appearance rules', async ({
  page,
}) => {
  const first = fixture();
  first.appearance = {
    palette: 'default',
    theme: { id: 'default', mode: 'dark', colors: { accent: 'rgb(12, 34, 56)' } },
  };
  await open(page, first);
  const oldId = await page.locator('.seams-export-surface').getAttribute('id');
  expect(
    await page
      .locator('.seams-export-surface')
      .evaluate((element) =>
        getComputedStyle(element).getPropertyValue('--seams-colors-accent').trim(),
      ),
  ).toBe('rgb(12, 34, 56)');
  const second = fixture();
  second.sessionId = 'export-two';
  await open(page, second);
  expect(await page.evaluate(() => window.__exportHost.isOpen('export-one'))).toBe(false);
  expect(await page.evaluate(() => window.__exportHost.isOpen('export-two'))).toBe(true);
  await expect(page.locator('.seams-export-surface')).not.toHaveAttribute('id', oldId!);
  await expect(page.locator('.seams-export-surface')).toHaveAttribute('data-theme', 'light');
  expect(
    await page.evaluate(
      (id) =>
        Array.from(document.adoptedStyleSheets)
          .flatMap((sheet) => Array.from(sheet.cssRules))
          .some((rule) => rule.cssText.includes(`#${id}`)),
      oldId,
    ),
  ).toBe(false);
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

test('missing document CSS rejects without opening a session or reporting geometry', async ({
  page,
}) => {
  await page.locator('[data-seams-wallet-ui-css]').evaluate((element) => element.remove());
  await expect(open(page)).rejects.toThrow('Wallet confirmation stylesheet unavailable');
  await expect(page.locator('.seams-export-surface')).toHaveCount(0);
  expect(
    await page.evaluate(() => ({
      events: window.__exportHost.events,
      measurements: window.__exportHost.measurements,
      open: window.__exportHost.isOpen('export-one'),
    })),
  ).toEqual({ events: [], measurements: [], open: false });
});

test('failed renderer import leaves no session, events, or DOM', async ({ page }) => {
  await page.route('**/preact/mountExportPrivateKeySurface.js', (route) => route.abort());
  await expect(open(page)).rejects.toThrow();
  await expect(page.locator('.seams-export-surface')).toHaveCount(0);
  expect(await page.evaluate(() => window.__exportHost.events)).toEqual([]);
  expect(await page.evaluate(() => window.__exportHost.isOpen('export-one'))).toBe(false);
});

test('closing synchronously from first measurement leaves no reporter or open session', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__exportHost.closeOnMeasurement = true;
  });
  await open(page);
  await expect(page.locator('.seams-export-surface')).toHaveCount(0);
  await page.setViewportSize({ width: 400, height: 300 });
  expect(await page.evaluate(() => window.__exportHost.events)).toEqual(['opened', 'closed']);
  expect(await page.evaluate(() => window.__exportHost.measurements.length)).toBe(1);
  expect(await page.evaluate(() => window.__exportHost.isOpen('export-one'))).toBe(false);
});

test('standalone export preserves its backdrop and Escape closes the session', async ({ page }) => {
  const input = fixture();
  input.context = 'standalone';
  await page.locator('#opener').focus();
  await open(page, input);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.mouse.click(5, 5);
  expect(await page.evaluate(() => window.__exportHost.isOpen('export-one'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#opener')).toBeFocused();
  expect(await page.evaluate(() => window.__exportHost.events)).toEqual(['opened', 'closed']);
});

test('wallet iframe cancellation event disposes the export surface', async ({ page }) => {
  await open(page);
  await page.evaluate((eventName) => {
    document.querySelector('.seams-export-surface')?.dispatchEvent(
      new CustomEvent(eventName, { bubbles: true, composed: true }),
    );
  }, WalletIframeDomEvents.TX_CONFIRMER_CANCEL);
  await expect(page.locator('.seams-export-surface')).toHaveCount(0);
  expect(await page.evaluate(() => window.__exportHost.events)).toEqual(['opened', 'closed']);
});
