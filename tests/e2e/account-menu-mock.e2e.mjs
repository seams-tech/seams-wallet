import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const artifacts = '.artifacts/account-menu-mock';
const url = process.env.SEAMS_ACCOUNT_MOCK_URL || 'http://127.0.0.1:4017/account-menu-mock.html';
const walletRequests = [];
function recordRequest(request) {
  if (request.method() !== 'GET' && request.method() !== 'HEAD') walletRequests.push(request.url());
}
function sampleResize(now) {
  const panel = document.querySelector('.seams-account-resize');
  const bounds = panel.getBoundingClientRect();
  window.accountResizeEvidence.push({
    time: now - window.accountResizeStarted,
    height: bounds.height,
    width: bounds.width,
  });
  if (now - window.accountResizeStarted < 400) requestAnimationFrame(sampleResize);
}
function recordResize() {
  window.accountResizeEvidence = [];
  window.accountResizeStarted = performance.now();
  requestAnimationFrame(sampleResize);
}
function recordError(errors, error) {
  errors.push(error.message);
}
async function back(page) {
  await page.getByRole('button', { name: 'Back', exact: true }).click();
}
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 460, height: 1050 },
  recordVideo: { dir: artifacts },
});
await context.tracing.start({ screenshots: true, snapshots: true });
try {
  const page = await context.newPage();
  const errors = [];
  page.on('request', recordRequest);
  page.on('pageerror', recordError.bind(null, errors));
  await page.goto(url);
  await expect(page.locator('[data-account-menu-item]')).toHaveCount(7);
  await expect(page.locator('[data-account-menu-item="export-keys"]')).toBeDisabled();
  await page.screenshot({ path: `${artifacts}/overview.png` });
  await page.addScriptTag({ content: sampleResize.toString() });
  await page.evaluate(recordResize);
  await page.locator('[data-account-menu-item="authentication-methods"]').click();
  await expect(
    page.getByRole('heading', { name: 'Authentication methods', exact: true }),
  ).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('alex.near', { exact: true })).toBeVisible();
  await expect(page.locator('.seams-account-method-tiles > li')).toHaveCount(2);
  await expect(page.getByText('Passkey', { exact: true })).toBeVisible();
  await expect(page.getByText('Email OTP', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Both', exact: true })).toHaveCount(0);
  await expect(page.getByText('MacBook Pro', { exact: true })).toHaveCount(0);
  await page.waitForTimeout(450);
  const resize = await page.evaluate(() => window.accountResizeEvidence);
  const first = resize[0].height;
  const last = resize.at(-1).height;
  assert.ok(Math.abs(first - last) > 4, 'Screens must have different intrinsic heights');
  assert.ok(
    resize.some(
      (sample) =>
        sample.height > Math.min(first, last) + 2 && sample.height < Math.max(first, last) - 2,
    ),
    'Height must interpolate between screens',
  );
  assert.ok(
    resize.every((sample) => Math.abs(sample.width - resize[0].width) < 1),
    'Width must stay fixed',
  );
  await page.screenshot({ path: `${artifacts}/authentication-methods.png` });
  await page.getByRole('button', { name: 'Link a device', exact: true }).click();
  await expect(page.locator('.qr-scanner-camera-container')).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: `${artifacts}/scanner.png` });
  await back(page);
  await page.locator('[data-account-menu-item="recovery-codes"]').click();
  await page.getByRole('button', { name: 'Reveal with passkey' }).click();
  await expect(page.locator('.seams-account-recovery-slots span')).toHaveCount(16);
  await page.screenshot({ path: `${artifacts}/recovery-16-digits.png` });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('[data-account-menu-item="accounts"]').click();
  await expect(page.getByRole('link', { name: /Base/ })).toBeVisible();
  await back(page);
  await page.locator('[data-account-menu-item="transaction-settings"]').click();
  await expect(
    page.getByRole('heading', { name: 'Transaction settings', exact: true }),
  ).toBeFocused();
  await expect(page.locator('[data-account-menu-item]')).toHaveCount(0);
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
  await page.screenshot({ path: `${artifacts}/transaction-screen.png` });
  await back(page);
  await page.locator('[data-account-menu-item="linked-devices"]').click();
  await expect(page.getByRole('heading', { name: 'Linked devices' })).toBeVisible();
  await back(page);
  // Reverse navigation during the resize. The final content must fit without stale clipping.
  await page
    .locator('[data-account-menu-item="authentication-methods"]')
    .evaluate((button) => button.click());
  await page
    .getByRole('button', { name: 'Back', exact: true })
    .evaluate((button) => button.click());
  await page.waitForTimeout(300);
  const fit = await page.evaluate(() => ({
    frame: document.querySelector('.seams-account-resize').getBoundingClientRect().height,
    content: document.querySelector('.seams-account-panel-content').getBoundingClientRect().height,
  }));
  assert.ok(
    Math.abs(fit.frame - fit.content) < 1,
    'Interrupted resize must settle to the current screen',
  );
  await page.getByRole('button', { name: 'Close wallet settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Lock Wallet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Logged out', exact: true })).toBeVisible();
  const loggedOutWidth = await page
    .locator('.seams-profile-button-morphable')
    .evaluate((element) => element.getBoundingClientRect().width);
  assert.ok(loggedOutWidth < 240, 'Logged-out trigger must shrink to its content');
  await page.screenshot({ path: `${artifacts}/logged-out.png` });
  await page.locator('[aria-haspopup="menu"]').click();
  await expect(page.getByRole('group', { name: 'Wallet account' })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.locator('[data-account-menu-item="authentication-methods"]').click();
  await expect(page.locator('.seams-account-resize')).toHaveCSS('transition-duration', '0s');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${artifacts}/mobile-reduced-motion.png` });
  assert.deepEqual(walletRequests, []);
  assert.deepEqual(errors, []);
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify({ passed: true, resize, fit, walletRequests, errors }, null, 2),
  );
  console.log(
    'Passed: shared account navigation, resize/interruption, local preferences, recovery preview, keyboard focus, mobile/reduced motion, no wallet requests.',
  );
} finally {
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await context.close();
  await browser.close();
}
