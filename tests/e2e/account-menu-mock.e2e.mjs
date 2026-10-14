import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const artifacts = '.artifacts/account-menu-mock';
const url = process.env.SEAMS_ACCOUNT_MOCK_URL || 'http://127.0.0.1:4017/account-menu-mock.html';
const walletRequests = [];
function recordRequest(request) {
  if (request.method() !== 'GET' && request.method() !== 'HEAD') walletRequests.push(request.url());
}
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 440, height: 900 } });
await context.tracing.start({ screenshots: true, snapshots: true });
try {
  const page = await context.newPage();
  page.on('request', recordRequest);
  await page.goto(url);
  await expect(page.locator('[data-account-menu-item]')).toHaveCount(7);
  await expect(page.locator('[data-account-menu-item="export-keys"]')).toBeDisabled();
  await expect(page.locator('[data-account-menu-item="linked-devices"]')).toBeDisabled();
  await page.locator('[data-account-menu-item="accounts"]').click();
  await expect(page.getByRole('link', { name: /Base/ })).toBeVisible();
  await page.locator('[data-account-menu-item="accounts"]').click();
  await page.locator('[data-account-menu-item="transaction-settings"]').click();
  await page.getByRole('button', { name: 'drawer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'drawer', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'skip click', exact: true }).click();
  await expect(page.getByRole('button', { name: 'skip click', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({ path: `${artifacts}/settings.png` });
  await page.getByRole('button', { name: 'Lock Wallet', exact: true }).click();
  await expect(page.locator('[data-account-menu-item="accounts"]')).not.toBeVisible();
  await page.locator('[aria-haspopup="menu"]').click();
  await expect(page.locator('[data-account-menu-item="accounts"]')).toBeVisible();
  assert.deepEqual(walletRequests, []);
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify(
      {
        passed: true,
        publicExport: true,
        providerFree: true,
        localPreferences: true,
        disabledWalletOperations: true,
        walletRequests,
      },
      null,
      2,
    ),
  );
  console.log(
    'Passed public AccountMenuButtonMock: expansion, preferences, lock/reopen, and no wallet requests.',
  );
} finally {
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await browser.close();
}
