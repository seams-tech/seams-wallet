import { expect, test, type Page, type Route } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';

// The wallet iframe clips any shadow its card paints, so the host overlay paints
// the elevation. These checks read the computed styles from the source stylesheet.

type Elevation = {
  readonly modal: boolean;
  readonly iframeFilter: string;
  readonly dialogShadow: string;
};

type OverlayCase = {
  readonly display: 'modal' | 'nonmodal';
  readonly reviewed: boolean;
};

const REQUEST_MODAL: OverlayCase = { display: 'modal', reviewed: false };
const RECEIPT_TOAST: OverlayCase = { display: 'nonmodal', reviewed: false };
const REVIEWED_RECEIPT_TOAST: OverlayCase = { display: 'nonmodal', reviewed: true };

async function overlayElevation(input: OverlayCase): Promise<Elevation> {
  const overlayPath = '/__overlay-styles.js';
  const overlay = await import(overlayPath);
  const dialog = document.createElement('dialog');
  const iframe = document.createElement('iframe');
  overlay.ensureOverlayDialog(dialog);
  overlay.ensureOverlayBase(iframe);
  dialog.appendChild(iframe);
  document.body.appendChild(dialog);
  if (input.reviewed) dialog.setAttribute('data-transaction-review', '');
  overlay.setDialogPresentation(dialog, 'modal', 'measured');
  overlay.setDialogGeometry(dialog, {
    topCssPx: 400,
    leftCssPx: 400,
    widthCssPx: 360,
    heightCssPx: 72,
  });
  if (input.display === 'modal') dialog.showModal();
  else dialog.show();
  return {
    modal: dialog.matches(':modal'),
    iframeFilter: getComputedStyle(iframe).filter,
    dialogShadow: getComputedStyle(dialog).boxShadow,
  };
}

async function serveOverlayStyles(source: string, route: Route): Promise<void> {
  await route.fulfill({ contentType: 'application/javascript', body: source });
}

async function serveBlankPage(route: Route): Promise<void> {
  await route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><body style="--seams-colors-borderPrimary: #e7e5e4"></body></html>',
  });
}

async function openOverlayPage(page: Page): Promise<void> {
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({
    stdin: {
      contents: `export * from './packages/wallet/src/SeamsWeb/walletIframe/client/overlay/overlay-styles';`,
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    tsconfig: path.join(root, 'packages/wallet/tsconfig.json'),
  });
  await page.route(
    '**/__overlay-styles.js',
    serveOverlayStyles.bind(null, bundle.outputFiles[0]!.text),
  );
  await page.route('**/overlay-elevation-test', serveBlankPage);
  await page.goto('/overlay-elevation-test');
}

const MODAL_SHADOW = 'drop-shadow(rgba(0, 0, 0, 0.22) 0px 12px 24px)';
const CARD_SHADOW = 'drop-shadow(rgba(15, 23, 42, 0.1) 0px 10px 20px)';

test('a request modal casts the modal elevation outside its iframe', async ({ page }) => {
  await openOverlayPage(page);
  const result = await page.evaluate(overlayElevation, REQUEST_MODAL);
  expect(result.modal).toBe(true);
  expect(result.iframeFilter).toContain(MODAL_SHADOW);
});

test('a receipt toast casts the quieter card elevation', async ({ page }) => {
  await openOverlayPage(page);
  const result = await page.evaluate(overlayElevation, RECEIPT_TOAST);
  expect(result.modal).toBe(false);
  expect(result.iframeFilter).toContain(CARD_SHADOW);
  expect(result.iframeFilter).not.toContain(MODAL_SHADOW);
});

test('a reviewed transaction toast keeps its shell with the quieter elevation', async ({
  page,
}) => {
  await openOverlayPage(page);
  const toast = await page.evaluate(overlayElevation, REVIEWED_RECEIPT_TOAST);
  expect(toast.iframeFilter).toBe('none');
  expect(toast.dialogShadow).toContain('rgba(15, 23, 42, 0.1) 0px 10px 20px 0px');
  expect(toast.dialogShadow).not.toContain('rgba(0, 0, 0, 0.22)');
});
