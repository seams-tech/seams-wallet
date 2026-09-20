import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { injectImportMap } from '../setup/bootstrap';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import { routePreactModules } from '../setup/preact';

const root = path.resolve(import.meta.dirname, '../..');
const output = path.join(root, '.artifacts/refactor-127/visual/preact-recovery');
const baseline = path.join(
  root,
  '.artifacts/refactor-127/visual/lit-before/seams-recovery-code-backup-host',
);
const codes = ['TEST-ONLY-0001-AAAA', 'TEST-ONLY-0002-BBBB', 'TEST-ONLY-0003-CCCC'];
const comparisons: Array<Record<string, unknown>> = [];

function compareImages(beforePath: string, afterPath: string, diffPath: string) {
  const before = PNG.sync.read(fs.readFileSync(beforePath));
  const after = PNG.sync.read(fs.readFileSync(afterPath));
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(
      `Recovery visual dimensions differ: ${before.width}x${before.height} vs ${after.width}x${after.height}`,
    );
  }
  const diff = new PNG({ width: before.width, height: before.height });
  let changedPixels = 0;
  let maxChannelDelta = 0;
  for (let y = 0; y < before.height; y += 1) {
    for (let x = 0; x < before.width; x += 1) {
      const offset = (y * before.width + x) * 4;
      let delta = 0;
      for (let channel = 0; channel < 4; channel += 1) {
        delta = Math.max(delta, Math.abs(before.data[offset + channel] - after.data[offset + channel]));
      }
      if (delta > 0) changedPixels += 1;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      diff.data[offset] = delta > 0 ? 255 : 0;
      diff.data[offset + 3] = 255;
    }
  }
  fs.mkdirSync(path.dirname(diffPath), { recursive: true });
  fs.writeFileSync(diffPath, PNG.sync.write(diff));
  return {
    dimensions: { width: before.width, height: before.height },
    changedPixels,
    maxChannelDelta,
  };
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await injectImportMap(page);
  await routePreactModules(page);
  await page.route('**/recovery-preact-visual', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': "style-src 'self'; style-src-attr 'none'" },
      body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}<link rel="stylesheet" data-seams-components-css href="/_test-sdk/esm/sdk/seams-components.css"><link rel="stylesheet" data-seams-recovery-code-backup-css href="/_test-sdk/esm/sdk/recovery-code-backup.css"><link rel="stylesheet" data-seams-copy-icon-css href="/_test-sdk/esm/sdk/copy-icon.css"></head><body></body></html>`,
    }),
  );
  await page.goto('/recovery-preact-visual');
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

for (const theme of ['light', 'dark'] as const) {
  test(`recovery host matches Lit baseline in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 560, height: 420 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.evaluate(
      async ({ theme }) => {
        document.documentElement.dataset.seamsTheme = theme;
        const { mountRecoveryCodeBackupSurface } = await import(
          '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/preact/mountRecoveryCodeBackupSurface.js'
        );
        mountRecoveryCodeBackupSurface({
          parent: document.body,
          surface: 'wallet-iframe',
          experience: {
            kind: 'direct_backup',
            request: {
              kind: 'wallet_recovery_code_backup_request_v1',
              walletId: 'visual-fixture.testnet',
              recoveryCodes: ['TEST-ONLY-0001-AAAA', 'TEST-ONLY-0002-BBBB', 'TEST-ONLY-0003-CCCC'],
              continuation: 'registration_may_defer',
            },
          },
          onClose: () => {},
          onCancel: () => {},
          onShown: () => {},
        });
      },
      { theme },
    );
    const dialog = page.locator('[data-seams-wallet-recovery-backup-dialog]');
    await expect(dialog).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const afterPath = path.join(output, `seams-recovery-code-backup-host/default-${theme}.png`);
    const diffPath = path.join(output, `diff/default-${theme}.png`);
    fs.mkdirSync(path.dirname(afterPath), { recursive: true });
    await dialog.screenshot({ path: afterPath, animations: 'disabled' });
    const comparison = compareImages(
      path.join(baseline, `default-${theme}.png`),
      afterPath,
      diffPath,
    );
    comparisons.push({ theme, comparison });
    expect(comparison.changedPixels / (comparison.dimensions.width * comparison.dimensions.height)).toBeLessThan(
      0.01,
    );
  });
}

test.afterAll(() => {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(
    path.join(output, 'comparison.json'),
    JSON.stringify({ baseline: 'lit-before/seams-recovery-code-backup-host', comparisons }, null, 2),
  );
});
