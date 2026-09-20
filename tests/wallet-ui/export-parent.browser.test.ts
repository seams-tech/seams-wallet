import { expect, test } from '@playwright/test';
import { injectImportMap } from '../setup/bootstrap';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import { routePreactModules } from '../setup/preact';
import type { WalletIframeSurfaceMeasurement } from '@/SeamsWeb/walletIframe/shared/messages';

declare global {
  interface Window {
    __exportParentViolations: string[];
    __exportParent: {
      measurement(value: WalletIframeSurfaceMeasurement): void;
      close(): void;
      measurements: WalletIframeSurfaceMeasurement[];
    };
  }
}

for (const viewport of [
  { width: 1024, height: 900 },
  { width: 390, height: 844 },
  { width: 390, height: 300 },
]) {
  test(`export parent drawer fits and scrolls at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await injectImportMap(page);
    await routePreactModules(page);
    await page.addInitScript(() => {
      window.__exportParentViolations = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__exportParentViolations.push(event.violatedDirective);
      });
    });
    await page.route('**/export-parent-*', (route) =>
      route.fulfill({
        contentType: 'text/html',
        headers: { 'content-security-policy': "style-src 'self'; style-src-attr 'none'" },
        body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}<link rel="stylesheet" data-seams-components-css href="/_test-sdk/esm/sdk/seams-components.css"><link rel="stylesheet" data-seams-confirmation-css href="/_test-sdk/esm/sdk/confirmation-ui.css"></head><body><button id="opener">Export</button></body></html>`,
      }),
    );
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/export-parent-test');
    await page.locator('#opener').focus();
    await page.evaluate(async () => {
      const prefix = '/_test-sdk/esm/SeamsWeb/walletIframe/client/';
      const { default: OverlayController } = await import(`${prefix}overlay/overlay-controller.js`);
      const { drawerWalletIframeSurfacePresentation, requestSurfaceIdentity } = await import(
        `${prefix}surface/domain.js`
      );
      const { provisionalWalletIframeSurfaceGeometry, measuredWalletIframeSurfaceGeometry } =
        await import(`${prefix}surface/geometry.js`);
      const { walletIframeRequestIdFromBoundary, walletIframeSurfaceIdFromBoundary } = await import(
        '/_test-sdk/esm/core/types/walletIframeIdentity.js'
      );
      const iframe = document.createElement('iframe');
      iframe.src = '/export-parent-child';
      iframe.title = 'Export wallet';
      function ensureIframe() {
        return iframe;
      }
      const overlay = new OverlayController({ ensureIframe });
      const presentation = drawerWalletIframeSurfacePresentation('Exported Keys');
      const identity = requestSurfaceIdentity({
        requestId: walletIframeRequestIdFromBoundary('export-parent'),
        surfaceId: walletIframeSurfaceIdFromBoundary('export-parent'),
      });
      function viewport() {
        return {
          widthCssPx: innerWidth,
          heightCssPx: innerHeight,
          offsetLeftCssPx: 0,
          offsetTopCssPx: 0,
        };
      }
      function measurement(value: WalletIframeSurfaceMeasurement) {
        window.__exportParent.measurements.push(value);
        overlay.apply({
          kind: 'compact_request_drawer',
          presentation,
          identity,
          focusTrap: true,
          geometry: measuredWalletIframeSurfaceGeometry(presentation, viewport(), value),
        });
      }
      function close() {
        overlay.apply({ kind: 'hidden' });
      }
      window.__exportParent = { measurement, close, measurements: [] };
      overlay.apply({
        kind: 'compact_request_drawer',
        presentation,
        identity,
        focusTrap: true,
        geometry: provisionalWalletIframeSurfaceGeometry(presentation, viewport()),
      });
    });
    const child = page.frameLocator('iframe');
    await expect(child.locator('#opener')).toBeAttached();
    const frame = page.frames().find((frame) => frame.url().endsWith('/export-parent-child'))!;
    await frame.evaluate(async () => {
      const { upsertExportViewerHost } = await import(
        '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/export-viewer-host.js'
      );
      const { walletIframeRequestIdFromBoundary } = await import(
        '/_test-sdk/esm/core/types/walletIframeIdentity.js'
      );
      document.querySelector('#opener')?.remove();
      function postMeasurement(value: WalletIframeSurfaceMeasurement) {
        parent.__exportParent.measurement(value);
      }
      function onLifecycle(event: 'opened' | 'closed') {
        if (event === 'closed') parent.__exportParent.close();
      }
      await upsertExportViewerHost({
        theme: 'light',
        variant: 'drawer',
        accountId: 'synthetic.testnet',
        sessionId: 'export-parent',
        keys: [
          {
            scheme: 'secp256k1',
            label: 'EVM',
            publicKey: '0x02abcd',
            address: '0x123456',
            privateKey: `0x${'1234567890abcdef'.repeat(4)}`,
          },
          {
            scheme: 'ed25519',
            label: 'NEAR',
            publicKey: 'ed25519:synthetic',
            privateKey: `ed25519:${'123456789ABCDEFGH'.repeat(4)}`,
          },
        ],
        onLifecycle,
        surfaceMeasurementBinding: {
          kind: 'wallet_iframe',
          requestId: walletIframeRequestIdFromBoundary('export-parent'),
          hostSurfaceVariant: 'drawer',
          postMeasurement,
        },
      });
    });
    const drawer = child.locator('.seams-confirmation-drawer');
    await expect(drawer).toBeVisible();
    const box = await drawer.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box!.y).toBeLessThan(viewport.height);
    await expect(child.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
    await expect(child.getByRole('heading', { name: 'Exported Keys' })).toBeInViewport();
    const warning = child.locator('.warning');
    await warning.scrollIntoViewIfNeeded();
    await expect(warning).toBeInViewport({ ratio: 1 });
    await child.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('dialog')).not.toBeVisible();
    await expect(page.locator('#opener')).toBeFocused();
    await expect(child.locator('.seams-export-surface')).toHaveCount(0);
    expect(await page.evaluate(() => window.__exportParentViolations)).toEqual([]);
    expect(await frame.evaluate(() => window.__exportParentViolations)).toEqual([]);
  });
}
