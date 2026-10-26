import { expect, test, type Page, type Route } from '@playwright/test';
import { injectImportMap } from '../setup/bootstrap';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import { routePreactModules } from '../setup/preact';

const parentScript = `
import OverlayController from '/_test-sdk/esm/SeamsWeb/walletIframe/client/overlay/overlay-controller.js';
import { modalWalletIframeSurfacePresentation, requestSurfaceIdentity } from '/_test-sdk/esm/SeamsWeb/walletIframe/client/surface/domain.js';
import { provisionalWalletIframeSurfaceGeometry, measuredWalletIframeSurfaceGeometry } from '/_test-sdk/esm/SeamsWeb/walletIframe/client/surface/geometry.js';
import { walletIframeRequestIdFromBoundary, walletIframeSurfaceIdFromBoundary } from '/_test-sdk/esm/core/types/walletIframeIdentity.js';

const iframe = document.createElement('iframe');
iframe.src = '/confirmation-overlay-child';
iframe.title = 'Wallet confirmation';
const presentation = modalWalletIframeSurfacePresentation('Transaction receipt');
const identity = requestSurfaceIdentity({
  requestId: walletIframeRequestIdFromBoundary('confirmation-overlay'),
  surfaceId: walletIframeSurfaceIdFromBoundary('confirmation-overlay'),
});
const overlay = new OverlayController({ ensureIframe });
let measurement = null;
let view = 'expanded';

function ensureIframe() {
  return iframe;
}
function viewport() {
  return {
    widthCssPx: innerWidth,
    heightCssPx: innerHeight,
    offsetLeftCssPx: 0,
    offsetTopCssPx: 0,
  };
}
function render() {
  overlay.apply({
    kind: 'compact_request_modal',
    identity,
    presentation,
    focusTrap: view === 'expanded',
    geometry: measurement
      ? measuredWalletIframeSurfaceGeometry(presentation, viewport(), measurement)
      : provisionalWalletIframeSurfaceGeometry(presentation, viewport()),
  });
}
function receive(event) {
  if (event.source !== iframe.contentWindow || event.origin !== location.origin) return;
  if (event.data.kind === 'measurement') {
    measurement = event.data.value;
  } else if (event.data.kind === 'view') {
    view = event.data.value;
  } else {
    return;
  }
  render();
}
function clicked() {
  document.querySelector('#background').textContent = 'Clicked';
}
window.addEventListener('message', receive);
window.addEventListener('resize', render);
document.querySelector('#background').addEventListener('click', clicked);
render();
`;

const childScript = `
import { mountConfirmationSurface } from '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/preact/mountConfirmationSurface.js';
import { createWalletIframeSurfaceMeasurementReporter } from '/_test-sdk/esm/SeamsWeb/walletIframe/host/surface-measurement-reporter.js';
import { walletIframeRequestIdFromBoundary } from '/_test-sdk/esm/core/types/walletIframeIdentity.js';

const surface = mountConfirmationSurface({
  parent: document.body,
  presentation: { variant: 'modal', context: 'wallet-iframe' },
  model: {
    appearance: { palette: 'default', theme: { id: 'default', mode: 'light', colors: {} } },
    content: {
      kind: 'transaction',
      review: { model: null, tree: null },
      header: {
        heading: 'Review transfer',
        website: { kind: 'ready', text: 'example.test' },
        chainDetails: { kind: 'ready', text: 'NEAR' },
      },
      body: { kind: 'empty' },
      prompt: { kind: 'passkey' },
      transaction: {
        tree: null,
        theme: 'light',
        explorers: {},
        decision: { kind: 'ready', onConfirm: confirm },
        confirmText: 'Confirm',
        cancelText: 'Cancel',
        onCancel: dismiss,
      },
    },
  },
  onClosed: dismiss,
});
createWalletIframeSurfaceMeasurementReporter({
  kind: 'request_surface',
  element: surface.element,
  requestId: walletIframeRequestIdFromBoundary('confirmation-overlay'),
  postMeasurement,
});
function postMeasurement(value) {
  parent.postMessage({ kind: 'measurement', value }, location.origin);
}
function confirm() {
  showReceipt('expanded');
}
function dismiss() {
  surface.dispose();
}
function showReceipt(view) {
  parent.postMessage({ kind: 'view', value: view }, location.origin);
  surface.showReceipt({
    subject: 'transaction',
    state: { kind: 'confirmed', hash: null },
    view,
    onView: showReceipt,
    onDismiss: dismiss,
  });
}
`;

function serveOverlayPage(route: Route) {
  const child = route.request().url().endsWith('-child');
  return route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}
      <link rel="stylesheet" href="/_test-sdk/esm/sdk/wallet-ui.css">
      <style>
        body { margin: 0; }
        #background { position: fixed; inset: 0; width: 100%; height: 100%; }
        #spacer { height: 2400px; }
      </style></head><body>
      ${child ? '' : '<button id="background">Background control</button><div id="spacer"></div>'}
      <script type="module">${child ? childScript : parentScript}</script>
      </body></html>`,
  });
}

async function expectCardBounds(page: Page, width: number) {
  const iframe = page.locator('iframe');
  const card = page.frameLocator('iframe').locator('.modal-container-root');
  await expect(iframe).toHaveCSS('width', `${width}px`);
  await expect(card).toHaveCSS('width', `${width}px`);
  await expect.poll(boundsDifference.bind(null, page)).toBeLessThanOrEqual(1);
}

async function boundsDifference(page: Page) {
  const outer = await page.locator('iframe').boundingBox();
  const inner = await page.frameLocator('iframe').locator('.modal-container-root').boundingBox();
  if (!outer || !inner) return Infinity;
  return Math.max(
    Math.abs(outer.x - inner.x),
    Math.abs(outer.y - inner.y),
    Math.abs(outer.height - inner.height),
  );
}

test('iframe hugs review and receipt through minimization and viewport changes', async ({
  page,
}, testInfo) => {
  await injectImportMap(page);
  await routePreactModules(page);
  await page.route('**/confirmation-overlay-*', serveOverlayPage);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/confirmation-overlay-parent');
  const child = page.frameLocator('iframe');
  await expectCardBounds(page, 448);
  await child.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(child.getByRole('status')).toHaveText('Transaction complete');
  await expectCardBounds(page, 448);

  await child.getByRole('button', { name: 'Minimize' }).click();
  await expectCardBounds(page, 352);
  const bounds = await page.locator('iframe').boundingBox();
  if (!bounds) throw new Error('Receipt iframe has no bounds');
  const beside = { x: bounds.x + bounds.width + 8, y: bounds.y + bounds.height / 2 };
  await page.mouse.click(beside.x, beside.y);
  await expect(page.locator('#background')).toHaveText('Clicked');
  await page.mouse.move(beside.x, beside.y);
  await page.mouse.wheel(0, 400);
  await expect.poll(readScroll.bind(null, page)).toBeGreaterThan(0);

  await child.getByRole('button', { name: 'Open' }).click();
  await expectCardBounds(page, 448);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectCardBounds(page, 358);
  expect(await child.locator('html').evaluate(scrollHorizontally)).toBe(0);
  await child.getByRole('button', { name: 'Minimize' }).click();
  await expectCardBounds(page, 352);
  await child.getByRole('button', { name: 'Open' }).click();
  await expectCardBounds(page, 358);
  await page.setViewportSize({ width: 1024, height: 900 });
  await expectCardBounds(page, 448);
  await page.screenshot({ path: testInfo.outputPath('receipt-iframe-bounds.png') });
  await testInfo.attach('receipt-iframe-bounds', {
    path: testInfo.outputPath('receipt-iframe-bounds.png'),
    contentType: 'image/png',
  });
});

function browserScroll() {
  return window.scrollY;
}
function scrollHorizontally() {
  window.scrollTo(100, 0);
  return window.scrollX;
}
function readScroll(page: Page) {
  return page.evaluate(browserScroll);
}
