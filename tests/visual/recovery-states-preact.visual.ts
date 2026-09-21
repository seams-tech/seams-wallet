import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { injectImportMap } from '../setup/bootstrap';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import { routePreactModules } from '../setup/preact';

const root = path.resolve(import.meta.dirname, '../..');
const savedLitRoot = path.join(root, '.artifacts/refactor-127/lit-baseline-build/esm');
const output = path.join(root, '.artifacts/refactor-127/visual/recovery-states');

type Renderer = 'lit' | 'preact';
type Theme = 'light' | 'dark';
type RecoveryState =
  | 'summary'
  | 'opening'
  | 'status-error'
  | 'opening-error'
  | 'acknowledged'
  | 'viewer';

const recoveryCodes = ['TEST-ONLY-0001-AAAA', 'TEST-ONLY-0002-BBBB', 'TEST-ONLY-0003-CCCC'];

function compareImages(beforePath: string, afterPath: string, diffPath: string) {
  const before = PNG.sync.read(fs.readFileSync(beforePath));
  const after = PNG.sync.read(fs.readFileSync(afterPath));
  expect({ width: after.width, height: after.height }).toEqual({
    width: before.width,
    height: before.height,
  });
  const diff = new PNG({ width: before.width, height: before.height });
  const sideBySide = new PNG({ width: before.width * 2, height: before.height });
  let changedPixels = 0;
  let maxChannelDelta = 0;
  for (let y = 0; y < before.height; y += 1) {
    for (let x = 0; x < before.width; x += 1) {
      const offset = (y * before.width + x) * 4;
      const sideOffset = (y * before.width * 2 + x) * 4;
      const afterOffset = (y * after.width + x) * 4;
      let delta = 0;
      for (let channel = 0; channel < 4; channel += 1) {
        const left = before.data[offset + channel];
        const right = after.data[afterOffset + channel];
        delta = Math.max(delta, Math.abs(left - right));
        sideBySide.data[sideOffset + channel] = left;
        sideBySide.data[sideOffset + before.width * 4 + channel] = right;
      }
      if (delta > 0) changedPixels += 1;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      diff.data[offset] = delta > 0 ? 255 : 0;
      diff.data[offset + 3] = 255;
    }
  }
  fs.mkdirSync(path.dirname(diffPath), { recursive: true });
  fs.writeFileSync(diffPath, PNG.sync.write(diff));
  fs.writeFileSync(diffPath.replace('.png', '-comparison.png'), PNG.sync.write(sideBySide));
  return {
    dimensions: { width: before.width, height: before.height },
    changedPixels,
    maxChannelDelta,
  };
}

async function prepare(page: import('@playwright/test').Page, renderer: Renderer): Promise<void> {
  await injectImportMap(page);
  await routePreactModules(page);
  if (renderer === 'lit') {
    await page.route('**/_test-sdk/esm/**', (route) => {
      const marker = '/_test-sdk/esm/';
      const pathname = new URL(route.request().url()).pathname;
      const relative = pathname.slice(pathname.indexOf(marker) + marker.length);
      const file = path.join(savedLitRoot, relative);
      if (!file.startsWith(`${savedLitRoot}${path.sep}`) || !fs.existsSync(file)) {
        return route.abort();
      }
      return route.fulfill({ path: file });
    });
  } else {
    await page.route('**/wallet-ui.css', (route) =>
      route.fulfill({ path: path.join(root, 'packages/wallet/dist/esm/sdk/wallet-ui.css') }),
    );
  }
  await page.route('**/recovery-states-visual', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': "style-src 'self'; style-src-attr 'none'" },
      body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}${renderer === 'lit' ? '<link rel="stylesheet" data-seams-components-css href="/_test-sdk/esm/sdk/seams-components.css"><link rel="stylesheet" data-seams-recovery-code-backup-css href="/_test-sdk/esm/sdk/recovery-code-backup.css"><link rel="stylesheet" data-seams-copy-icon-css href="/_test-sdk/esm/sdk/copy-icon.css">' : '<link rel="stylesheet" data-seams-wallet-ui-css href="/wallet-ui.css">'}</head><body></body></html>`,
    }),
  );
  await page.goto('/recovery-states-visual');
}

async function mount(
  page: import('@playwright/test').Page,
  renderer: Renderer,
  theme: Theme,
  state: RecoveryState,
): Promise<void> {
  await page.evaluate(
    async ({ renderer, theme, state, recoveryCodes }) => {
      document.documentElement.dataset.seamsTheme = theme;
      const request = {
        kind: 'wallet_recovery_code_backup_request_v1' as const,
        walletId: 'visual-fixture.testnet',
        recoveryCodes,
        continuation: 'registration_may_defer' as const,
      };
      const status = async () => {
        if (state === 'status-error') throw new Error('Synthetic status failure');
        return {
          kind: 'ready' as const,
          walletId: request.walletId,
          activeCodeCount: recoveryCodes.length,
          totalCodeCount: recoveryCodes.length,
          issuedAtMs: 0,
          storeVersion: 'synthetic-v1',
          backupOutstanding: true,
          pendingLocalBackup: true,
        };
      };
      const experience =
        state === 'acknowledged' || state === 'viewer'
          ? { kind: 'direct_backup' as const, request }
          : {
              kind: 'account_menu' as const,
              walletId: request.walletId,
              loadStatus: status,
              loadPendingBackup: async () => {
                if (state === 'opening-error') throw new Error('Synthetic opening failure');
                if (state === 'opening') return await new Promise<never>(() => {});
                return request;
              },
            };
      if (renderer === 'lit') {
        const moduleUrl =
          '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/lit-components/RecoveryCodeBackup/host.js';
        await import(moduleUrl);
        const host = document.createElement('seams-recovery-code-backup-host') as HTMLElement & {
          experience: unknown;
          surface: string;
          whenDialogShown: () => Promise<HTMLDialogElement>;
        };
        host.experience = experience;
        host.surface = 'wallet-iframe';
        document.body.appendChild(host);
        await host.whenDialogShown();
        return;
      }
      const moduleUrl =
        '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/preact/mountRecoveryCodeBackupSurface.js';
      const { mountRecoveryCodeBackupSurface } = await import(moduleUrl);
      mountRecoveryCodeBackupSurface({
        parent: document.body,
        experience,
        surface: 'wallet-iframe',
        onClose: () => {},
        onCancel: () => {},
        onShown: () => {},
      });
    },
    { renderer, theme, state, recoveryCodes },
  );
  if (state === 'opening' || state === 'opening-error') {
    await page.getByRole('button', { name: 'View recovery codes' }).click();
    if (state === 'opening') {
      await expect(page.getByRole('button', { name: 'Opening recovery codes' })).toBeDisabled();
    } else {
      await expect(page.getByText('Synthetic opening failure', { exact: true })).toBeVisible();
    }
  }
  if (state === 'status-error') {
    await expect(page.getByText('Synthetic status failure', { exact: true })).toBeVisible();
  }
  if (state === 'acknowledged') {
    await page.getByRole('checkbox').check();
    await expect(page.getByRole('button', { name: 'Finish backup' })).toBeVisible();
  }
}

for (const theme of ['light', 'dark'] as const) {
  test(`recovery/viewer-${theme}`, async ({ browser }) => {
    const captures: Record<Renderer, string> = { lit: '', preact: '' };
    for (const renderer of ['lit', 'preact'] as const) {
      const page = await browser.newPage({ viewport: { width: 560, height: 420 } });
      try {
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await prepare(page, renderer);
        await mount(page, renderer, theme, 'viewer');
        const viewer = page.locator(
          renderer === 'lit'
            ? 'seams-recovery-code-backup-viewer'
            : '.seams-recovery-code-backup-viewer',
        );
        await expect(viewer).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const capturePath = path.join(output, `viewer-${theme}-${renderer}.png`);
        fs.mkdirSync(path.dirname(capturePath), { recursive: true });
        await viewer.screenshot({ path: capturePath, animations: 'disabled' });
        captures[renderer] = capturePath;
      } finally {
        await page.close();
      }
    }
    const comparison = compareImages(
      captures.lit,
      captures.preact,
      path.join(output, 'diff', `viewer-${theme}.png`),
    );
    fs.writeFileSync(
      path.join(output, `viewer-${theme}.json`),
      JSON.stringify({ comparison }, null, 2),
    );
    const pixels = comparison.dimensions.width * comparison.dimensions.height;
    expect(comparison.changedPixels / pixels).toBeLessThan(0.01);
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const state of [
    'summary',
    'opening',
    'status-error',
    'opening-error',
    'acknowledged',
  ] as const) {
    test(`recovery/${state}-${theme}`, async ({ browser }) => {
      const captures: Record<Renderer, string> = { lit: '', preact: '' };
      for (const renderer of ['lit', 'preact'] as const) {
        const page = await browser.newPage({ viewport: { width: 560, height: 420 } });
        try {
          await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
          await prepare(page, renderer);
          await mount(page, renderer, theme, state);
          const dialog = page.locator('[data-seams-wallet-recovery-backup-dialog]');
          await expect(dialog).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          const capturePath = path.join(output, `${state}-${theme}-${renderer}.png`);
          fs.mkdirSync(path.dirname(capturePath), { recursive: true });
          await dialog.screenshot({ path: capturePath, animations: 'disabled' });
          captures[renderer] = capturePath;
        } finally {
          await page.close();
        }
      }
      const comparison = compareImages(
        captures.lit,
        captures.preact,
        path.join(output, 'diff', `${state}-${theme}.png`),
      );
      fs.writeFileSync(
        path.join(output, `${state}-${theme}.json`),
        JSON.stringify({ comparison }, null, 2),
      );
      const pixels = comparison.dimensions.width * comparison.dimensions.height;
      expect(comparison.changedPixels / pixels).toBeLessThan(0.01);
    });
  }
}
