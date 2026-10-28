import { expect, test, type Page, type Route } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { injectImportMap } from '../setup/bootstrap';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import { routePreactModules } from '../setup/preact';

const parentScript = `
import OverlayController from '/_test-sdk/esm/SeamsWeb/walletIframe/client/overlay/overlay-controller.js';
import { modalWalletIframeSurfacePresentation, requestSurfaceIdentity } from '/_test-sdk/esm/SeamsWeb/walletIframe/client/surface/domain.js';
import { provisionalWalletIframeSurfaceGeometry, measuredWalletIframeSurfaceGeometry } from '/_test-sdk/esm/SeamsWeb/walletIframe/client/surface/geometry.js';
import { walletIframeRequestIdFromBoundary, walletIframeSurfaceIdFromBoundary } from '/_test-sdk/esm/core/types/walletIframeIdentity.js';

const iframe = document.createElement('iframe');
iframe.src = '/confirmation-overlay-child' + location.search;
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
import { attachConfirmSurfaceResizeChoreographer } from '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/confirm-surface-resize.js';
import { buildDisplayTreeFromModel } from '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/transaction-display/tree.js';

const model = {
  chain: 'tempo',
  chainId: 42431,
  signerAccount: 'lunar-feather-bxpjp2',
  operations: [{
    id: 'contract-call', kind: 'generic.contractCall', label: 'Transaction to contract',
    to: '0xBB442B54c85efBa2D7B81eA52990ad638CbA483',
  }],
};

const surface = mountConfirmationSurface({
  parent: document.body,
  presentation: { variant: 'modal', context: 'wallet-iframe' },
  model: {
    appearance: { palette: 'default', theme: { id: 'default', mode: new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light', colors: {} } },
    content: {
      kind: 'transaction',
      capture: null,
      review: { model, tree: buildDisplayTreeFromModel(model) },
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
  kind: 'request_scroll_surface',
  element: surface.element,
  requestId: walletIframeRequestIdFromBoundary('confirmation-overlay'),
  postMeasurement,
});
attachConfirmSurfaceResizeChoreographer(surface.element);
window.__receiptTransition = { frames: [], done: false };
let receiptState = { kind: 'confirmed', hash: null };
function prepareSigningReceipt() {
  receiptState = { kind: 'signing' };
}
function submitReceipt() {
  receiptState = { kind: 'submitted', hash: null };
  showReceipt('expanded');
}
window.prepareSigningReceipt = prepareSigningReceipt;
window.submitReceipt = submitReceipt;
function readReceiptFrame(time = performance.now()) {
  const card = surface.element.querySelector('.modal-container-root');
  const shell = surface.element.querySelector('.seams-receipt-morph-shell');
  const footer = surface.element.querySelector('.seams-receipt-footer');
  return {
    time,
    viewport: document.documentElement.clientHeight,
    surfaceBottom: surface.element.getBoundingClientRect().bottom,
    surfaceOverflow: getComputedStyle(surface.element).overflowY,
    shellBottom: (shell ?? card).getBoundingClientRect().bottom,
    footerBottom: footer?.getBoundingClientRect().bottom ?? null,
    footerOpacity: footer ? Number(getComputedStyle(footer).opacity) : 0,
    footerHosted: footer?.classList.contains('seams-receipt-footer--hosted') ?? false,
    cardHeight: card.getBoundingClientRect().height,
    drivenHeight: getComputedStyle(card).getPropertyValue('--seams-surface-height-driven-target'),
    targetHeight: getComputedStyle(card).getPropertyValue('--seams-receipt-target-height'),
    morphing: surface.element.hasAttribute('data-receipt-morphing'),
  };
}
window.readReceiptFrame = readReceiptFrame;
function sampleTransition(trace, time) {
  if (window.__receiptTransition !== trace) return;
  trace.frames.push(readReceiptFrame(time));
  if (surface.element.hasAttribute('data-receipt-morphing')) {
    requestAnimationFrame(sampleTransition.bind(null, trace));
  } else {
    window.__receiptTransition.done = true;
  }
}
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
  window.__receiptTransition = { frames: [], done: false };
  parent.postMessage({ kind: 'view', value: view }, location.origin);
  surface.showReceipt({
    subject: 'transaction',
    state: receiptState,
    view,
    onView: showReceipt,
    onDismiss: dismiss,
  });
  requestAnimationFrame(sampleTransition.bind(null, window.__receiptTransition));
}
`;

function serveOverlayPage(route: Route) {
  const child = new URL(route.request().url()).pathname.endsWith('-child');
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
  await page.locator('body').evaluate(addAppClass);
  await page.addStyleTag({
    content: `
    .customer-app dialog[open], .customer-app iframe[src] {
      box-sizing: content-box;
      padding: 30px;
      margin: 20px;
      border: 12px solid red;
      width: 200px;
      height: 200px;
      background: red;
    }
  `,
  });
  await expect(page.locator('dialog[data-seams-root]')).toHaveCSS('padding', '0px');
  await expect(page.locator('iframe')).toHaveCSS('border-top-width', '0px');
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
function addAppClass(body: HTMLElement) {
  body.classList.add('customer-app');
}
function scrollHorizontally() {
  window.scrollTo(100, 0);
  return window.scrollX;
}
function readScroll(page: Page) {
  return page.evaluate(browserScroll);
}

type ReceiptFrame = {
  time: number;
  viewport: number;
  surfaceBottom: number;
  surfaceOverflow: string;
  shellBottom: number;
  footerBottom: number | null;
  footerOpacity: number;
};

function assertReceiptFrames(frames: ReceiptFrame[]): void {
  expect(frames.length).toBeGreaterThan(0);
  for (const sample of frames) {
    expect(sample.shellBottom - sample.viewport).toBeLessThanOrEqual(1);
    if (sample.footerBottom === null || sample.footerOpacity === 0) continue;
    expect(sample.footerBottom - sample.viewport).toBeLessThanOrEqual(1);
    if (sample.surfaceOverflow !== 'visible') {
      expect(sample.footerBottom - sample.surfaceBottom).toBeLessThanOrEqual(1);
    }
  }
}

function receiptTextBounds() {
  const label = document.querySelector('[role="status"]');
  if (!label) throw new Error('Receipt status is missing');
  const range = document.createRange();
  range.selectNodeContents(label);
  const bounds = range.getBoundingClientRect();
  return { top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height };
}

function pauseReceiptAtStart(selector: string) {
  const target = document.querySelector<HTMLButtonElement>(selector);
  if (!target) throw new Error('Receipt control is missing');
  target.click();
  for (const animation of document.getAnimations()) {
    if (animation.effect?.getTiming().iterations === Infinity) continue;
    animation.pause();
    animation.currentTime = 0;
  }
  const label = document.querySelector('[role="status"]');
  if (!label) throw new Error('Receipt status is missing');
  const range = document.createRange();
  range.selectNodeContents(label);
  const bounds = range.getBoundingClientRect();
  return { top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height };
}

function finishReceiptAnimations() {
  for (const animation of document.getAnimations()) {
    if (animation.effect?.getTiming().iterations !== Infinity) animation.finish();
  }
}

test('receipt title keeps its position and text dimensions when minimizing and expanding', async ({ page }, testInfo) => {
  await injectImportMap(page);
  await routePreactModules(page);
  await page.route('**/confirmation-overlay-*', serveOverlayPage);
  await page.goto('/confirmation-overlay-parent?theme=dark');
  const child = page.frameLocator('iframe');
  await child.getByRole('button', { name: 'Confirm', exact: true }).click();
  const frame = page.frames()[1];
  await expect.poll(frame.evaluate.bind(frame, 'window.__receiptTransition.done')).toBe(true);
  await expectCardBounds(page, 448);
  const expanded = await frame.evaluate(receiptTextBounds);
  const minimizeStart = await frame.evaluate(pauseReceiptAtStart, '.seams-review-toolbar button');
  await frame.evaluate(finishReceiptAnimations);
  await expect.poll(frame.evaluate.bind(frame, 'window.__receiptTransition.done')).toBe(true);
  await expectCardBounds(page, 352);
  const minimized = await frame.evaluate(receiptTextBounds);
  const expandStart = await frame.evaluate(pauseReceiptAtStart, '.seams-receipt-open');
  await page.waitForTimeout(90);
  await page.screenshot({ path: testInfo.outputPath('receipt-expand-midpoint.png') });
  await frame.evaluate(finishReceiptAnimations);
  await writeFile(testInfo.outputPath('receipt-text-motion.json'), JSON.stringify({ expanded, minimizeStart, minimized, expandStart }, null, 2));
  expect(Math.abs(expanded.top - minimizeStart.top)).toBeLessThanOrEqual(2);
  expect(Math.abs(expanded.left - minimizeStart.left)).toBeLessThanOrEqual(2);
  expect(Math.abs(expanded.width - minimizeStart.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(minimized.top - expandStart.top)).toBeLessThanOrEqual(2);
  expect(Math.abs(minimized.left - expandStart.left)).toBeLessThanOrEqual(2);
  expect(Math.abs(minimized.width - expandStart.width)).toBeLessThanOrEqual(2);
});

test('review-to-receipt shell and footer stay inside the resizing iframe', async ({
  page,
}, testInfo) => {
  await injectImportMap(page);
  await routePreactModules(page);
  await page.route('**/confirmation-overlay-*', serveOverlayPage);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/confirmation-overlay-parent');
  await expectCardBounds(page, 448);
  const child = page.frameLocator('iframe');
  await child.getByRole('button', { name: 'Confirm', exact: true }).click();
  const frame = page.frames()[1];
  await expect.poll(frame.evaluate.bind(frame, 'window.__receiptTransition.done')).toBe(true);
  const transitions: Record<string, ReceiptFrame[]> = {};
  transitions.review = await frame.evaluate('window.__receiptTransition.frames');
  expect(transitions.review.length).toBeGreaterThan(8);
  for (const action of ['Minimize transaction', 'Open']) {
    await child.getByRole('button', { name: action, exact: true }).click();
    await expect.poll(frame.evaluate.bind(frame, 'window.__receiptTransition.done')).toBe(true);
    transitions[action] = await frame.evaluate('window.__receiptTransition.frames');
  }
  await child.getByRole('button', { name: 'Minimize transaction', exact: true }).click();
  await page.waitForTimeout(60);
  transitions.interrupted = await frame.evaluate('window.__receiptTransition.frames');
  await child.getByRole('button', { name: 'Open', exact: true }).click({ force: true });
  await expect.poll(frame.evaluate.bind(frame, 'window.__receiptTransition.done')).toBe(true);
  transitions.reversed = await frame.evaluate('window.__receiptTransition.frames');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const action of ['Minimize transaction', 'Open']) {
    await child.getByRole('button', { name: action, exact: true }).click();
    await expect.poll(frame.evaluate.bind(frame, 'window.__receiptTransition.done')).toBe(true);
    await expectCardBounds(page, action === 'Open' ? 448 : 352);
    transitions[`reduced-${action}`] = [await frame.evaluate('window.readReceiptFrame()')];
  }
  await writeFile(
    testInfo.outputPath('receipt-transition-frames.json'),
    JSON.stringify(transitions, null, 2),
  );
  for (const frames of Object.values(transitions)) assertReceiptFrames(frames);
  await page.screenshot({ path: testInfo.outputPath('receipt-transition.png') });
});

for (const statusDelay of [45, 220]) {
  test(`receipt status can change ${statusDelay} ms into the mobile transition`, async ({
    page,
  }, testInfo) => {
    await injectImportMap(page);
    await routePreactModules(page);
    await page.route('**/confirmation-overlay-*', serveOverlayPage);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/confirmation-overlay-parent');
    await expectCardBounds(page, 358);
    const frame = page.frames()[1];
    await frame.evaluate('window.prepareSigningReceipt()');
    await page.frameLocator('iframe').getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.waitForTimeout(statusDelay);
    const signing: ReceiptFrame[] = await frame.evaluate('window.__receiptTransition.frames');
    await frame.evaluate('window.submitReceipt()');
    await expect.poll(frame.evaluate.bind(frame, 'window.__receiptTransition.done')).toBe(true);
    const submitted: ReceiptFrame[] = await frame.evaluate('window.__receiptTransition.frames');
    await writeFile(
      testInfo.outputPath('receipt-status-frames.json'),
      JSON.stringify({ signing, submitted }, null, 2),
    );
    assertReceiptFrames(signing);
    assertReceiptFrames(submitted);
    await expectCardBounds(page, 358);
    await page.screenshot({ path: testInfo.outputPath('receipt-status-transition.png') });
  });
}
