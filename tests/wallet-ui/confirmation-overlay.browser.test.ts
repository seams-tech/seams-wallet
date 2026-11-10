import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { injectImportMap } from '../setup/bootstrap';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import { routePreactModules } from '../setup/preact';

const parentScript = `
import OverlayController from '/_test-sdk/esm/SeamsWeb/walletIframe/client/overlay/overlay-controller.js';
import { modalWalletIframeSurfacePresentation, drawerWalletIframeSurfacePresentation, requestSurfaceIdentity } from '/_test-sdk/esm/SeamsWeb/walletIframe/client/surface/domain.js';
import { provisionalWalletIframeSurfaceGeometry, measuredWalletIframeSurfaceGeometry } from '/_test-sdk/esm/SeamsWeb/walletIframe/client/surface/geometry.js';
import { walletIframeRequestIdFromBoundary, walletIframeSurfaceIdFromBoundary } from '/_test-sdk/esm/core/types/walletIframeIdentity.js';

const iframe = document.createElement('iframe');
iframe.src = '/confirmation-overlay-child' + location.search;
iframe.title = 'Wallet confirmation';
const parameters = new URLSearchParams(location.search);
const presentation = parameters.get('presentation') === 'drawer'
  ? drawerWalletIframeSurfacePresentation('Transaction receipt')
  : modalWalletIframeSurfacePresentation('Transaction receipt');
const identity = requestSurfaceIdentity({
  requestId: walletIframeRequestIdFromBoundary('confirmation-overlay'),
  surfaceId: walletIframeSurfaceIdFromBoundary('confirmation-overlay'),
});
const overlay = new OverlayController({ ensureIframe });
let measurement = null;
let view = 'expanded';
let holdMeasurement = parameters.has('hold');
let open = true;
let releaseStartedAt = 0;
window.overlayRevealLatencyMs = null;
window.measuredHeights = [];

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
  if (!open) {
    overlay.apply({ kind: 'hidden' });
    return;
  }
  overlay.apply({
    kind: presentation.kind === 'drawer' ? 'compact_request_drawer' : 'compact_request_modal',
    identity,
    presentation,
    focusTrap: view === 'expanded',
    anchoredLayer: null,
    geometry: measurement
      ? measuredWalletIframeSurfaceGeometry(presentation, viewport(), measurement)
      : provisionalWalletIframeSurfaceGeometry(presentation, viewport()),
  });
}
function receive(event) {
  if (event.source !== iframe.contentWindow || event.origin !== location.origin) return;
  if (event.data.kind === 'measurement') {
    measurement = event.data.value;
    window.measuredHeights.push(measurement.heightCssPx);
    if (holdMeasurement) return;
  } else if (event.data.kind === 'view') {
    view = event.data.value;
  } else if (event.data.kind === 'closed') {
    open = false;
    render();
    return;
  } else {
    return;
  }
  render();
}
function clicked() {
  document.querySelector('#background').textContent = 'Clicked';
}
function releaseMeasurement() {
  open = true;
  holdMeasurement = false;
  releaseStartedAt = performance.now();
  render();
  requestAnimationFrame(recordRevealLatency);
}
function recordRevealLatency() {
  const dialog = iframe.closest('dialog');
  if (dialog && !dialog.inert && getComputedStyle(dialog).opacity === '1') {
    window.overlayRevealLatencyMs = performance.now() - releaseStartedAt;
  } else {
    requestAnimationFrame(recordRevealLatency);
  }
}
function hasMeasurement() {
  return measurement !== null;
}
function cancelMeasuredReveal() {
  holdMeasurement = false;
  render();
  open = false;
  render();
}
window.releaseMeasurement = releaseMeasurement;
window.hasMeasurement = hasMeasurement;
window.cancelMeasuredReveal = cancelMeasuredReveal;
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
import { buildDisplayTreeFromModel, buildDisplayTreeFromTxPayloads } from '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/transaction-display/tree.js';

const model = {
  chain: 'tempo',
  chainId: 42431,
  signerAccount: 'lunar-feather-bxpjp2',
  operations: [{
    id: 'contract-call', kind: 'generic.contractCall', label: 'Transaction to contract',
    to: '0xBB442B54c85efBa2D7B81eA52990ad638CbA483',
  }],
};
// Arguments long enough to fill the scrolling Transaction details area.
const longArgsTransaction = {
  receiverId: 'usdc.fakes.testnet',
  actions: [{
    type: 'FunctionCall', methodName: 'ft_transfer_call', gas: '100000000000000', deposit: '1',
    args: JSON.stringify({
      receiver_id: 'pm-notes.seams-v1.testnet',
      amount: '500000',
      msg: JSON.stringify({ action: 'bet', market_id: 9, outcome: 'yes', note: 'x'.repeat(80) }),
    }),
  }],
};
const tree = new URLSearchParams(location.search).has('long-args')
  ? buildDisplayTreeFromTxPayloads([longArgsTransaction])
  : buildDisplayTreeFromModel(model);

const surface = mountConfirmationSurface({
  parent: document.body,
  presentation: {
    variant: new URLSearchParams(location.search).get('presentation') === 'drawer' ? 'drawer' : 'modal',
    context: 'wallet-iframe',
  },
  model: {
    appearance: { palette: 'default', theme: { id: 'default', mode: new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light', colors: {} } },
    content: {
      kind: 'transaction',
      capture: null,
      review: { model, tree },
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
// One entry per frame: the box the parent gave this frame, and the card's height and bottom edge.
let recordingFrames = false;
let boxFrames = [];
function recordFrame() {
  if (!recordingFrames) return;
  const card = document.querySelector('.modal-container-root').getBoundingClientRect();
  boxFrames.push({
    box: document.documentElement.clientHeight,
    card: Math.round(card.height),
    bottom: Math.round(card.bottom),
  });
  requestAnimationFrame(recordFrame);
}
window.scrollCardToEnd = () => {
  surface.element.scrollTop = surface.element.scrollHeight;
  return surface.element.scrollTop;
};
window.startFrames = () => {
  boxFrames = [];
  recordingFrames = true;
  requestAnimationFrame(recordFrame);
};
window.stopFrames = () => {
  recordingFrames = false;
  return boxFrames;
};
const receiptState = { kind: 'confirmed', hash: null };
function postMeasurement(value) {
  parent.postMessage({ kind: 'measurement', value }, location.origin);
}
function confirm() {
  showReceipt('expanded');
}
function dismiss() {
  surface.dispose();
  parent.postMessage({ kind: 'closed' }, location.origin);
}
function showReceipt(view) {
  parent.postMessage({ kind: 'view', value: view }, location.origin);
  surface.showReceipt({
    subject: 'transaction',
    state: receiptState,
    view,
    onView: showReceipt,
    onDismiss: dismiss,
  });
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
        #background-input { position: fixed; top: 8px; left: 8px; z-index: 1; }
      </style></head><body>
      ${child ? '' : '<button id="background">Background control</button><input id="background-input" aria-label="Background input"><div id="spacer"></div>'}
      <script type="module">${child ? childScript : parentScript}</script>
      </body></html>`,
  });
}

test('a minimized receipt leaves the page beside it clickable and scrollable', async ({ page }) => {
  await injectImportMap(page);
  await routePreactModules(page);
  await page.route('**/confirmation-overlay-*', serveOverlayPage);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/confirmation-overlay-parent');
  const child = page.frameLocator('iframe');
  await child.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(child.getByRole('status')).toHaveText('Transaction complete');
  await child.getByRole('button', { name: 'Minimize' }).click();
  await expect(child.getByRole('button', { name: 'Open' })).toBeVisible();
  const bounds = await settledIframeBounds(page);
  const beside = { x: bounds.x + bounds.width + 8, y: bounds.y + bounds.height / 2 };
  await page.mouse.click(beside.x, beside.y);
  await expect(page.locator('#background')).toHaveText('Clicked');
  await page.mouse.move(beside.x, beside.y);
  await page.mouse.wheel(0, 400);
  await expect.poll(readScroll.bind(null, page)).toBeGreaterThan(0);
  await child.getByRole('button', { name: 'Open' }).click();
  await expect(child.getByRole('status')).toHaveText('Transaction complete');
});

/** The iframe box once the minimize transition stops changing it. */
async function settledIframeBounds(page: Page) {
  const iframe = page.locator('iframe');
  let previous = '';
  await expect
    .poll(async () => {
      const current = JSON.stringify(await iframe.boundingBox());
      const settled = current === previous;
      previous = current;
      return settled;
    })
    .toBe(true);
  const bounds = await iframe.boundingBox();
  if (!bounds) throw new Error('Receipt iframe has no bounds');
  return bounds;
}

function browserScroll() {
  return window.scrollY;
}
function readScroll(page: Page) {
  return page.evaluate(browserScroll);
}

test('details in a card taller than its frame open and close in one motion', async ({ page }) => {
  await injectImportMap(page);
  await routePreactModules(page);
  await page.route('**/confirmation-overlay-*', serveOverlayPage);
  // The open details make the card taller than the largest box this viewport allows.
  await page.setViewportSize({ width: 520, height: 640 });
  await page.goto('/confirmation-overlay-parent?long-args');
  await expect(page.locator('dialog[data-seams-root]')).toHaveCSS('opacity', '1');
  await settledIframeBounds(page);

  const opening = await toggleDetails(page);
  const opened = opening.at(-1)!;
  expect(opened.card).toBeGreaterThan(opened.box);
  // The card grows on the box's ease and ends with it: no snap, and no second motion
  // after the box stops at its limit.
  expect(largestStepWhileBoxStill(opening)).toBeLessThan(40);
  expect(cardGrowthAfterBoxStops(opening)).toBeLessThan(10);

  // Scrolled down to its end, the card keeps its place when the motion starts and ends.
  expect(await confirmationFrame(page).evaluate('window.scrollCardToEnd()')).toBeGreaterThan(0);
  const heightsBeforeClosing: number = await page.evaluate('window.measuredHeights.length');
  const closing = await toggleDetails(page);
  expect(largestStepWhileBoxStill(closing)).toBeLessThan(40);
  const closedBox = closing.at(-1)!.box;
  expect(closing.at(-1)!.card).toBe(closedBox);
  // The box eases once, straight to the closed card: it never dips below it and grows back.
  expect(Math.min(...closing.map((frame) => frame.box))).toBe(closedBox);
  const heights: number[] = await page.evaluate('window.measuredHeights');
  expect(heights.slice(heightsBeforeClosing)).toEqual([closedBox]);
});

type BoxFrame = { box: number; card: number; bottom: number };

function confirmationFrame(page: Page) {
  const frame = page.frames().find((candidate) => candidate.url().includes('-child'));
  if (!frame) throw new Error('Confirmation frame is missing');
  return frame;
}

/** Toggles Transaction details and returns one record per frame until the box settles. */
async function toggleDetails(page: Page): Promise<BoxFrame[]> {
  const frame = confirmationFrame(page);
  await frame.evaluate('window.startFrames()');
  await frame.locator('.seams-review-technical > summary').click();
  await expect(frame.locator('.seams-confirm-surface-pinned')).toHaveCount(0);
  await settledIframeBounds(page);
  return frame.evaluate('window.stopFrames()');
}

/** How far the card's height still changes after the box's last change. */
function cardGrowthAfterBoxStops(frames: BoxFrame[]): number {
  let lastBoxChange = 0;
  for (let index = 1; index < frames.length; index += 1) {
    if (frames[index].box !== frames[index - 1].box) lastBoxChange = index;
  }
  return Math.abs(frames.at(-1)!.card - frames[lastBoxChange].card);
}

/** The largest one-frame move of the card's bottom edge while the box stands still. */
function largestStepWhileBoxStill(frames: BoxFrame[]): number {
  let largest = 0;
  for (let index = 1; index < frames.length; index += 1) {
    if (frames[index].box !== frames[index - 1].box) continue;
    largest = Math.max(largest, Math.abs(frames[index].bottom - frames[index - 1].bottom));
  }
  return largest;
}

test(
  'loading wallet surfaces preserve page clicks and typing until their content is ready',
  verifyLoadingInteractions,
);

async function verifyLoadingInteractions(
  { page }: { page: Page },
  testInfo: TestInfo,
): Promise<void> {
  await injectImportMap(page);
  await routePreactModules(page);
  await page.route('**/confirmation-overlay-*', serveOverlayPage);
  const evidence = [];
  for (const scenario of [
    { presentation: 'modal', width: 1024, height: 900 },
    { presentation: 'drawer', width: 390, height: 844 },
    { presentation: 'modal', width: 320, height: 220 },
  ]) {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.goto(`/confirmation-overlay-parent?hold=1&presentation=${scenario.presentation}`);
    const dialog = page.locator('dialog[data-seams-root]');
    await expect(dialog).toHaveCSS('opacity', '0');
    await expect(page.locator('dialog:modal')).toHaveCount(0);
    await page.mouse.click(scenario.width / 2, scenario.height / 2);
    await expect(page.locator('#background')).toHaveText('Clicked');
    const input = page.getByRole('textbox', { name: 'Background input' });
    await input.fill('Page remains usable');
    await expect(input).toBeFocused();

    const child = page.frameLocator('iframe');
    const dismissName = scenario.presentation === 'drawer' ? 'Close' : 'Cancel';
    // The hidden iframe still renders the real confirmation and reports its size.
    await expect(
      child.getByRole('button', { name: dismissName, exact: true, includeHidden: true }),
    ).toHaveCount(1);
    await expect.poll(page.evaluate.bind(page, 'window.hasMeasurement()')).toBe(true);
    await page.evaluate('window.releaseMeasurement()');
    await expect(dialog).toHaveCSS('opacity', '1');
    await expect(page.locator('dialog:modal')).toHaveCount(1);
    await expect(input).not.toBeFocused();
    await child.getByRole('button', { name: dismissName, exact: true }).click();
    await expect(page.locator('dialog:modal')).toHaveCount(0);
    await expect(input).toBeFocused();
    await input.fill('Page remains usable after cancellation');
    const revealLatencyMs: number = await page.evaluate('window.overlayRevealLatencyMs');
    evidence.push({
      ...scenario,
      loadingInteractive: true,
      visibleModal: true,
      cancelledInteractive: true,
      revealLatencyMs,
    });
  }
  await page.goto('/confirmation-overlay-parent?hold=1');
  await expect.poll(page.evaluate.bind(page, 'window.hasMeasurement()')).toBe(true);
  await page.evaluate('window.cancelMeasuredReveal()');
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Background input' }).fill('Reveal cancelled');
  await page.evaluate('window.releaseMeasurement()');
  await expect(page.locator('dialog:modal')).toHaveCount(1);
  await expect(page.locator('dialog[data-seams-root]')).toHaveCSS('opacity', '1');
  await page.frameLocator('iframe').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  const artifact = testInfo.outputPath('loading-surface-interactions.json');
  await writeFile(
    artifact,
    JSON.stringify({ browser: testInfo.project.name, evidence }, null, 2) + '\n',
  );
  await testInfo.attach('loading-surface-interactions', {
    path: artifact,
    contentType: 'application/json',
  });
}
