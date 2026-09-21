import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { injectImportMap } from '../setup/bootstrap';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import { routePreactModules } from '../setup/preact';

type RecoveryTestState = {
  startDirect(): void;
  startAccount(mode: 'ready' | 'failed'): void;
  startAccountPending(): void;
  startAccountOpeningPending(): void;
  cancelPending(): void;
  resolveOpening(): void;
  releaseOpening: () => void;
  releaseCopy: () => void;
  result: Promise<unknown> | null;
  copied: string[];
  copiedTimerScheduled: number;
  copiedTimerCleared: number;
  pendingCancelled: boolean;
};

declare global {
  interface Window {
    __recoveryTest: RecoveryTestState;
  }
}

const recoveryCodes = [
  'amber-01',
  'birch-02',
  'cedar-03',
  'dahlia-04',
  'elm-05',
  'fir-06',
  'hazel-07',
  'iris-08',
  'juniper-09',
  'kestrel-10',
];
const recoveryMountModuleFile = path.resolve(
  import.meta.dirname,
  '../../packages/wallet/dist/esm/core/signingEngine/uiConfirm/ui/preact/mountRecoveryCodeBackupSurface.js',
);

async function prepare(page: Page): Promise<void> {
  await injectImportMap(page);
  await routePreactModules(page);
  await page.route('**/recovery-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': "style-src 'self'; style-src-attr 'none'" },
      body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}<link rel="stylesheet" href="/_test-sdk/esm/sdk/wallet-ui.css"></head><body><button id="opener">Open</button></body></html>`,
    }),
  );
  await page.goto('/recovery-test');
  await page.evaluate((codes) => {
    const modulePath = '/_test-sdk/esm/SeamsWeb/operations/recovery/walletRecoveryCodeBackup.js';
    const state: RecoveryTestState = {
      result: null,
      copied: [],
      pendingCancelled: false,
      releaseOpening: () => {},
      releaseCopy: () => {},
      copiedTimerScheduled: 0,
      copiedTimerCleared: 0,
      startDirect() {
        state.result = import(modulePath).then(({ showWalletRecoveryCodeBackupUi }) =>
          showWalletRecoveryCodeBackupUi({
            kind: 'wallet_recovery_code_backup_request_v1',
            walletId: 'recovery.testnet',
            recoveryCodes: codes,
            continuation: 'registration_may_defer',
          }),
        );
      },
      startAccount(mode) {
        state.result = import(modulePath).then(({ showWalletRecoveryCodesUi }) =>
          showWalletRecoveryCodesUi({
            walletId: 'recovery.testnet',
            loadStatus: async () =>
              mode === 'failed'
                ? { kind: 'transport_failed', message: 'Synthetic status failure' }
                : {
                    kind: 'ready',
                    walletId: 'recovery.testnet',
                    activeCodeCount: codes.length,
                    totalCodeCount: codes.length,
                    issuedAtMs: 0,
                    storeVersion: 'synthetic-v1',
                    backupOutstanding: true,
                    pendingLocalBackup: true,
                  },
            loadPendingBackup: async () => {
              if (mode === 'failed') throw new Error('Synthetic opening failure');
              return {
                kind: 'wallet_recovery_code_backup_request_v1',
                walletId: 'recovery.testnet',
                recoveryCodes: codes,
                continuation: 'pending_backup_must_finish',
              };
            },
          }),
        );
      },
      startAccountPending() {
        state.pendingCancelled = false;
        state.result = import(modulePath).then(({ showWalletRecoveryCodesUi }) =>
          showWalletRecoveryCodesUi(
            {
              walletId: 'recovery.testnet',
              loadStatus: async () => ({
                kind: 'ready',
                walletId: 'recovery.testnet',
                activeCodeCount: codes.length,
                totalCodeCount: codes.length,
                issuedAtMs: 0,
                storeVersion: 'synthetic-v1',
                backupOutstanding: true,
                pendingLocalBackup: true,
              }),
              loadPendingBackup: async () => null,
            },
            { kind: 'disabled' },
            { shouldCancel: () => state.pendingCancelled },
          ),
        );
      },
      startAccountOpeningPending() {
        state.releaseOpening = () => {};
        state.result = import(modulePath).then(({ showWalletRecoveryCodesUi }) =>
          showWalletRecoveryCodesUi({
            walletId: 'recovery.testnet',
            loadStatus: async () => ({
              kind: 'ready',
              walletId: 'recovery.testnet',
              activeCodeCount: codes.length,
              totalCodeCount: codes.length,
              issuedAtMs: 0,
              storeVersion: 'synthetic-v1',
              backupOutstanding: true,
              pendingLocalBackup: true,
            }),
            loadPendingBackup: () =>
              new Promise((resolve) => {
                state.releaseOpening = () => {
                  resolve({
                    kind: 'wallet_recovery_code_backup_request_v1',
                    walletId: 'recovery.testnet',
                    recoveryCodes: codes,
                    continuation: 'pending_backup_must_finish',
                  });
                };
              }),
          }),
        );
      },
      cancelPending() {
        state.pendingCancelled = true;
      },
      resolveOpening() {
        state.releaseOpening();
      },
    };
    const originalSetTimeout = window.setTimeout.bind(window);
    const originalClearTimeout = window.clearTimeout.bind(window);
    const copiedTimers = new Set<number>();
    Object.defineProperty(window, 'setTimeout', {
      configurable: true,
      value: (handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        const handle = originalSetTimeout(handler, timeout, ...args);
        if (timeout === 1800) {
          state.copiedTimerScheduled += 1;
          copiedTimers.add(handle);
        }
        return handle;
      },
    });
    Object.defineProperty(window, 'clearTimeout', {
      configurable: true,
      value: (handle: number) => {
        if (copiedTimers.delete(handle)) state.copiedTimerCleared += 1;
        originalClearTimeout(handle);
      },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => state.copied.push(value) },
    });
    window.__recoveryTest = state;
  }, recoveryCodes);
}

async function result(page: Page): Promise<unknown> {
  return await page.evaluate(async () =>
    window.__recoveryTest.result?.catch((error: unknown) =>
      error instanceof Error ? error.message : String(error),
    ),
  );
}

test.beforeEach(async ({ page }) => {
  await prepare(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    document.querySelector<HTMLDialogElement>('[data-seams-wallet-recovery-backup-dialog]')?.close();
  });
});

test('registration backup preserves copy, download, acknowledgement, and focus', async ({
  page,
}) => {
  await page.locator('#opener').focus();
  await page.evaluate(() => window.__recoveryTest.startDirect());
  const dialog = page.locator('[data-seams-wallet-recovery-backup-dialog]');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Save your wallet recovery codes' })).toBeVisible();
  await expect(page.locator('.recovery-code-item')).toHaveCount(10);

  await page.getByRole('button', { name: 'Copy codes' }).click();
  expect(await page.evaluate(() => window.__recoveryTest.copied[0])).toContain('amber-01');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download codes' }).click();
  expect((await download).suggestedFilename()).toBe('seams-wallet-recovery-codes-recovery.testnet.txt');

  await page.getByRole('checkbox').check();
  await expect(page.getByRole('button', { name: 'Finish backup' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish backup' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#opener')).toBeFocused();
  await expect.poll(() => result(page)).toEqual({ kind: 'wallet_recovery_codes_backed_up_v1' });
});

test('registration backup can defer without leaking codes into the next session', async ({ page }) => {
  await page.evaluate(() => window.__recoveryTest.startDirect());
  await expect(page.locator('.recovery-code-item')).toHaveCount(10);
  await page.getByRole('button', { name: 'Back up later' }).click();
  await expect.poll(() => result(page)).toEqual({ kind: 'wallet_recovery_code_backup_deferred_v1' });

  await page.evaluate(() => window.__recoveryTest.startDirect());
  await expect(page.locator('.recovery-code-item')).toHaveCount(10);
  expect(await page.locator('.seams-recovery-code-backup-viewer').count()).toBe(1);
});

test('disposal clears copied feedback timers before a new backup opens', async ({ page }) => {
  await page.evaluate(() => window.__recoveryTest.startDirect());
  await expect(page.locator('.recovery-code-item')).toHaveCount(10);
  await page.getByRole('button', { name: 'Copy codes' }).click();
  await expect(page.locator('.recovery-backup-copy.copied')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__recoveryTest.copiedTimerScheduled))
    .toBe(1);

  await page.getByRole('button', { name: 'Back up later' }).click();
  await expect.poll(() => result(page)).toEqual({ kind: 'wallet_recovery_code_backup_deferred_v1' });
  await expect(page.locator('[data-seams-recovery-surface]')).toHaveCount(0);
  await expect(page.locator('link[href$="wallet-ui.css"]')).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => window.__recoveryTest.copiedTimerCleared))
    .toBe(1);

  await page.evaluate(() => window.__recoveryTest.startDirect());
  await expect(page.locator('.recovery-code-item')).toHaveCount(10);
  await expect(page.getByRole('button', { name: 'Copy codes' })).not.toHaveClass(/copied/);
  await expect(page.locator('.recovery-backup-status')).toHaveText('');
});

test('disposal ignores a delayed clipboard completion', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(value: string) {
          window.__recoveryTest.copied.push(value);
          return new Promise<void>((resolve) => {
            window.__recoveryTest.releaseCopy = resolve;
          });
        },
      },
    });
    window.__recoveryTest.startDirect();
  });
  await expect(page.locator('.recovery-code-item')).toHaveCount(10);
  await page.getByRole('button', { name: 'Copy codes' }).click();
  await expect.poll(() => page.evaluate(() => window.__recoveryTest.copied)).toHaveLength(1);

  await page.getByRole('button', { name: 'Back up later' }).click();
  await expect.poll(() => result(page)).toEqual({ kind: 'wallet_recovery_code_backup_deferred_v1' });
  await page.evaluate(() => window.__recoveryTest.releaseCopy());

  await page.evaluate(() => window.__recoveryTest.startDirect());
  await expect(page.locator('.recovery-code-item')).toHaveCount(10);
  await expect(page.locator('.recovery-backup-status')).toHaveText('');
  await expect(page.getByRole('button', { name: 'Copy codes' })).not.toHaveClass(/copied/);
});

test('account-menu backup rejects an unacknowledged close and handles opening failure', async ({
  page,
}) => {
  await page.evaluate(() => window.__recoveryTest.startAccount('ready'));
  await expect(page.getByRole('button', { name: 'View recovery codes' })).toBeVisible();
  await page.getByRole('button', { name: 'View recovery codes' }).click();
  await expect(page.locator('.recovery-code-item')).toHaveCount(10);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(() => result(page)).toEqual('Recovery-code backup was cancelled before acknowledgement');

  await page.evaluate(() => window.__recoveryTest.startAccount('failed'));
  await expect(page.getByRole('button', { name: 'View recovery codes' })).toBeVisible();
  await page.getByRole('button', { name: 'View recovery codes' }).click();
  await expect(page.getByText('Synthetic opening failure', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close recovery codes' }).click();
  await expect.poll(() => result(page)).toEqual('Recovery-code backup was cancelled before acknowledgement');
});

test('cancellation while the lazy Preact module is pending does not mount a stale dialog', async ({
  page,
}) => {
  let moduleRequested!: () => void;
  let releaseModule!: () => void;
  const moduleRequest = new Promise<void>((resolve) => {
    moduleRequested = resolve;
  });
  const moduleGate = new Promise<void>((resolve) => {
    releaseModule = resolve;
  });
  await page.route('**/mountRecoveryCodeBackupSurface.js', async (route) => {
    moduleRequested();
    await moduleGate;
    await route.fulfill({ path: recoveryMountModuleFile, contentType: 'text/javascript' });
  });

  await page.evaluate(() => window.__recoveryTest.startAccountPending());
  await moduleRequest;
  await page.evaluate(() => window.__recoveryTest.cancelPending());
  releaseModule();

  await expect.poll(() => result(page)).toEqual('Recovery-code backup was cancelled before acknowledgement');
  await expect(page.locator('[data-seams-wallet-recovery-backup-dialog]')).toHaveCount(0);
  await expect(page.locator('.seams-recovery-code-backup-viewer')).toHaveCount(0);
});

test('closing while recovery codes are opening ignores the late result', async ({ page }) => {
  await page.evaluate(() => window.__recoveryTest.startAccountOpeningPending());
  await expect(page.getByRole('button', { name: 'View recovery codes' })).toBeVisible();
  await page.getByRole('button', { name: 'View recovery codes' }).click();
  await expect(page.getByRole('button', { name: 'Opening recovery codes' })).toBeDisabled();
  await page.getByRole('button', { name: 'Close recovery codes' }).click();
  await expect.poll(() => result(page)).toEqual('Recovery-code backup was cancelled before acknowledgement');

  await page.evaluate(() => window.__recoveryTest.resolveOpening());
  await expect(page.locator('[data-seams-wallet-recovery-backup-dialog]')).toHaveCount(0);
  await expect(page.locator('.recovery-code-item')).toHaveCount(0);
  await expect(page.locator('.seams-recovery-code-backup-viewer')).toHaveCount(0);
});
