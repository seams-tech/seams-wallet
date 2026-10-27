import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const artifacts = fileURLToPath(
  new URL('../../output/playwright/account-menu-mock', import.meta.url),
);
const url = process.env.SEAMS_ACCOUNT_MOCK_URL || 'http://127.0.0.1:4017/account-menu-mock.html';
const hostStyles = `
  .customer-app button, .customer-app button[type], .customer-app a[href], .customer-app input[type], .customer-app select {
    box-sizing: content-box;
    display: block;
    width: 100%;
    height: auto;
    min-width: 120px;
    min-height: 40px;
    padding: 6px 18px;
    margin: 8px;
    border: 1px solid rgb(136, 136, 136);
    border-radius: 4px;
    background: rgb(20, 25, 30);
    color: rgb(255, 100, 100);
    font: 700 20px / 2 serif;
    text-transform: uppercase;
    letter-spacing: 2px;
    box-shadow: 0 0 4px red;
  }
  .customer-app svg[viewBox] { width: 40px; height: 40px; fill: lime; stroke: red; stroke-width: 9px; }
  .customer-app h2 { margin: 30px; font-size: 40px; }
`;
const walletRequests = [];
function addHostControl() {
  document.body.classList.add('customer-app');
  const button = document.createElement('button');
  button.id = 'host-control';
  button.type = 'button';
  button.textContent = 'App control';
  const container = document.createElement('aside');
  container.style.width = '160px';
  container.append(button);
  document.querySelector('[data-seams-root]').append(container);
}
async function waitForResize(element) {
  for (const animation of element.getAnimations()) {
    try {
      await animation.finished;
    } catch {
      // A reversed transition cancels its previous animation.
    }
  }
}
async function captureScreen(page, name) {
  const resize = page.locator('.seams-account-resize');
  if (await resize.count()) {
    await expect.poll(resize.evaluate.bind(resize, panelHeightDifference)).toBeLessThan(1);
  }
  await page.screenshot({
    path: `${artifacts}/${name}.png`,
    animations: 'disabled',
    fullPage: true,
  });
}
function panelHeightDifference(panel) {
  return Math.abs(
    panel.getBoundingClientRect().height - panel.firstElementChild.getBoundingClientRect().height,
  );
}
function measureControl(element) {
  const style = getComputedStyle(element);
  const icons = [];
  for (const icon of element.querySelectorAll('svg')) {
    const bounds = icon.getBoundingClientRect();
    const iconStyle = getComputedStyle(icon);
    icons.push([
      bounds.width,
      bounds.height,
      iconStyle.fill,
      iconStyle.stroke,
      iconStyle.stroke === 'none' ? null : iconStyle.strokeWidth,
    ]);
  }
  return {
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    padding: style.padding,
    margin: style.margin,
    border: style.border,
    radius: style.borderRadius,
    font: style.font,
    textTransform: style.textTransform,
    letterSpacing: style.letterSpacing,
    shadow: style.boxShadow,
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.stroke === 'none' ? null : style.strokeWidth,
    icons,
  };
}
async function measureOverview(page) {
  return {
    wordmark: await page.locator('.seams-account-wordmark').evaluate(measureControl),
    close: await page
      .getByRole('button', { name: 'Close wallet settings', exact: true })
      .evaluate(measureControl),
    accounts: await page.locator('[data-account-menu-item="accounts"]').evaluate(measureControl),
    lock: await page
      .getByRole('button', { name: 'Lock Wallet', exact: true })
      .evaluate(measureControl),
  };
}
async function measureMany(locator) {
  const measurements = [];
  for (const element of await locator.all()) {
    measurements.push(await element.evaluate(measureControl));
  }
  return measurements;
}
async function measureTransactions(page) {
  await page.locator('[data-account-menu-item="transaction-settings"]').click();
  const measurements = {
    back: await page.getByRole('button', { name: 'Back', exact: true }).evaluate(measureControl),
    review: await page
      .getByRole('switch', { name: 'Review before signing', exact: true })
      .evaluate(measureControl),
    modal: await page.getByRole('button', { name: 'Modal', exact: true }).evaluate(measureControl),
  };
  await back(page);
  return measurements;
}
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
function setRtl() {
  document.documentElement.dir = 'rtl';
}
function setLtr() {
  document.documentElement.dir = 'ltr';
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
await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
  origin: new URL(url).origin,
});
await context.tracing.start({ screenshots: true, snapshots: true });
try {
  const page = await context.newPage();
  const errors = [];
  page.on('request', recordRequest);
  page.on('pageerror', recordError.bind(null, errors));
  await page.goto(url);
  await expect(page.locator('[data-account-menu-item]')).toHaveCount(7);
  const cleanOverview = await measureOverview(page);
  await expect(page.getByRole('button', { name: 'Lock Wallet', exact: true })).toHaveCSS(
    'border-top-width',
    '1px',
  );
  const cleanTransactions = await measureTransactions(page);
  await page.evaluate(addHostControl);
  await page.addStyleTag({ content: hostStyles });
  const hostControl = await page.locator('#host-control').evaluate(measureControl);
  assert.equal(hostControl.textTransform, 'uppercase', 'Host CSS must apply to the app control');
  const hostOverview = await measureOverview(page);
  const hostTransactions = await measureTransactions(page);
  assert.deepEqual(hostOverview, cleanOverview, 'Host CSS must preserve the overview');
  assert.deepEqual(
    hostTransactions,
    cleanTransactions,
    'Host CSS must preserve transaction controls',
  );
  await page.locator('[data-account-menu-item="accounts"]').click();
  await expect(page.locator('.seams-accounts-row-arrow').first()).toHaveCSS('width', '14px');
  await back(page);
  await page.evaluate(setRtl);
  await page.locator('[data-account-menu-item="transaction-settings"]').click();
  await expect(page.locator('.seams-transaction-switch > span')).toHaveCSS(
    'transform',
    'matrix(1, 0, 0, 1, -18, 0)',
  );
  await captureScreen(page, 'rtl-host-css');
  await back(page);
  await page.evaluate(setLtr);
  await page.locator('[data-account-menu-item="export-keys"]').click();
  await expect(page.getByRole('heading', { name: 'Export keys', exact: true })).toBeVisible();
  await captureScreen(page, 'export-keys');
  await page.getByRole('button', { name: /Export NEAR Key/ }).click();
  await expect(page.getByRole('heading', { name: 'Export NEAR key', exact: true })).toBeVisible();
  await expect(page.getByText('Ed25519', { exact: true })).toBeVisible();
  await back(page);
  await page.getByRole('button', { name: /Export EVM Keys/ }).click();
  await expect(page.getByText('ECDSA', { exact: true })).toBeVisible();
  await back(page);
  await back(page);
  await captureScreen(page, 'overview');
  await page.addScriptTag({ content: sampleResize.toString() });
  await page.locator('.seams-account-resize').evaluate(waitForResize);
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
  await writeFile(`${artifacts}/resize.json`, JSON.stringify(resize, null, 2));
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
  await captureScreen(page, 'authentication-methods');
  await expect(page.getByRole('button', { name: 'Link a device', exact: true })).toHaveCount(0);
  await back(page);
  await page.locator('[data-account-menu-item="scan-link-device"]').click();
  await expect(page.locator('.qr-scanner-camera-container')).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await captureScreen(page, 'scanner');
  await back(page);
  await page.locator('[data-account-menu-item="recovery-codes"]').click();
  await page.getByRole('button', { name: 'Reveal with passkey' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your recovery codes', exact: true }),
  ).toBeVisible();
  const codes = await page.locator('.seams-account-recovery-codes code').allTextContents();
  assert.equal(codes.length, 4);
  assert.equal(new Set(codes).size, 4);
  for (const code of codes) assert.match(code.replaceAll('–', ''), /^\d{16}$/);
  await page.getByRole('button', { name: 'Copy all', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Copied all codes.');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${codes.join('\n')}\n`);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download all', exact: true }).click();
  const download = await downloading;
  await download.saveAs(`${artifacts}/recovery-codes.txt`);
  assert.equal(await readFile(`${artifacts}/recovery-codes.txt`, 'utf8'), `${codes.join('\n')}\n`);
  await expect(page.getByRole('status')).toHaveText('Downloaded all codes.');
  await captureScreen(page, 'recovery-16-digits');
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: /I’ve saved these codes/ }).check();
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
  await page.getByRole('checkbox', { name: /I’ve saved these codes/ }).uncheck();
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: /I’ve saved these codes/ }).check();
  await captureScreen(page, 'recovery-acknowledged');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('[data-account-menu-item="accounts"]').click();
  await expect(page.getByRole('link', { name: /Base/ })).toBeVisible();
  await back(page);
  await page.locator('[data-account-menu-item="transaction-settings"]').click();
  await expect(
    page.getByRole('heading', { name: 'Transaction settings', exact: true }),
  ).toBeFocused();
  await expect(page.locator('[data-account-menu-item]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Drawer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Drawer', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('switch', { name: 'Review before signing', exact: true }).click();
  await expect(
    page.getByRole('switch', { name: 'Review before signing', exact: true }),
  ).toHaveAttribute('aria-checked', 'false');
  await captureScreen(page, 'transaction-screen');
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
  await captureScreen(page, 'logged-out');
  await page.locator('[aria-haspopup="menu"]').click();
  await expect(page.getByRole('group', { name: 'Wallet account' })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.locator('[data-account-menu-item="authentication-methods"]').click();
  await expect(page.locator('.seams-account-resize')).toHaveCSS('transition-duration', '0s');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await captureScreen(page, 'mobile-reduced-motion');
  const portalUrl = new URL(url);
  portalUrl.searchParams.set('portal', '1');
  await page.goto(portalUrl.href);
  await page.evaluate(addHostControl);
  await page.addStyleTag({ content: hostStyles });
  await expect(
    page.locator('body > [data-seams-root] .seams-profile-button-morphable'),
  ).toBeVisible();
  await expect(page.locator('[data-account-menu-item="accounts"]')).toHaveCSS(
    'border-top-width',
    '0px',
  );
  await page.locator('[data-account-menu-item="transaction-settings"]').click();
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCSS('width', '24px');
  await expect(page.getByRole('switch')).toHaveCSS('width', '44px');
  await captureScreen(page, 'portal-host-css');
  await back(page);
  const portalHostControl = await page.locator('#host-control').evaluate(measureControl);
  await page.addStyleTag({
    content: `
    [data-seams-root].seams-theme-provider .seams-profile-dropdown-menu button.seams-dropdown-menu-item {
      padding-block: 10px;
    }
    [data-seams-root] .seams-profile-button-morphable { --seams-colors-textPrimary: rgb(24, 80, 160); }
  `,
  });
  await expect(page.locator('[data-account-menu-item="accounts"]')).toHaveCSS(
    'padding-top',
    '10px',
  );
  await expect(page.locator('.seams-dropdown-menu-item-label').first()).toHaveCSS(
    'color',
    'rgb(24, 80, 160)',
  );
  assert.deepEqual(await page.locator('#host-control').evaluate(measureControl), portalHostControl);
  await captureScreen(page, 'intentional-customization');
  const catalogEvidence = [];
  const catalogUrl = new URL('component-css.html', url);
  await page.setViewportSize({ width: 460, height: 1100 });
  for (const portal of [false, true]) {
    catalogUrl.search = portal ? '?portal=1' : '';
    await page.goto(catalogUrl.href);
    await expect(
      page.getByRole('button', { name: 'Meteor Wallet Browser extension' }),
    ).toBeEnabled();
    await expect(page.getByRole('button', { name: 'HOT Wallet Mainnet only' })).toBeDisabled();
    await expect(page.getByRole('combobox', { name: 'Wallet', exact: true })).toBeDisabled();
    const controls = page.locator(
      '.seams-wallet-picker :is(button, select), [aria-label="Standalone icons"] svg',
    );
    const clean = await measureMany(controls);
    assert.deepEqual(clean.slice(-4).map(iconSize), [
      [19, 23],
      [26, 30],
      [21, 21],
      [25, 25],
    ]);
    await page.evaluate(addHostControl);
    await page.addStyleTag({ content: hostStyles });
    const styled = await measureMany(controls);
    assert.deepEqual(styled, clean, 'Host CSS must preserve standalone pickers and icon props');
    if (portal) await expect(page.locator('#root')).toBeEmpty();
    await captureScreen(page, portal ? 'standalone-portals' : 'standalone-components');
    catalogEvidence.push({ portal, clean, styled });
  }
  catalogUrl.search = '?view=link&portal=1';
  await page.goto(catalogUrl.href);
  await page.getByRole('radio', { name: 'Email code', exact: true }).check();
  await page.getByRole('textbox').fill('customer@example.com');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  const linkControls = page.locator('.qr-code-container :is(button, input, svg, h2)');
  await expect(
    page.getByRole('heading', { name: 'Match your other device', exact: true }),
  ).toHaveCSS('font-size', '21px');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toHaveCSS(
    'min-height',
    '44px',
  );
  const cleanLink = await measureMany(linkControls);
  await page.evaluate(addHostControl);
  await page.addStyleTag({ content: hostStyles });
  const styledLink = await measureMany(linkControls);
  assert.deepEqual(
    styledLink,
    cleanLink,
    'Host CSS must preserve portal radios, email input, icons, and Continue',
  );
  await page.getByRole('radio', { name: 'Passkey (recommended)', exact: true }).check();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await captureScreen(page, 'device-link-portal');
  const surfaceEvidence = [];
  for (const view of ['scanner', 'settings']) {
    catalogUrl.search = `?view=${view}&portal=1`;
    await page.goto(catalogUrl.href);
    const controls = page.locator(
      '[data-seams-root].seams-theme-provider :is(button, select, .seams-settings-wordmark)',
    );
    await expect(controls.first()).toBeVisible();
    const clean = await measureMany(controls);
    await page.evaluate(addHostControl);
    await page.addStyleTag({ content: hostStyles });
    const styled = await measureMany(controls.filter({ hasNotText: 'App control' }));
    assert.deepEqual(styled, clean, `Host CSS must preserve the ${view} portal controls`);
    await captureScreen(page, `${view}-portal`);
    surfaceEvidence.push({ view, clean, styled });
  }
  catalogUrl.search = '?view=account-settings-modal';
  await page.goto(catalogUrl.href);
  await expect(page.locator('dialog.seams-account-modal')).toHaveCount(0);
  await expect(page.locator('[aria-haspopup="menu"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open live wallet settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Wallet settings', exact: true })).toBeVisible();
  await expect(page.locator('[data-account-menu-item="transaction-settings"]')).toBeDisabled();
  await captureScreen(page, 'live-controlled-modal');
  await page.getByRole('button', { name: 'Close wallet settings', exact: true }).click();
  await expect(page.locator('dialog.seams-account-modal')).toHaveCount(0);
  assert.deepEqual(walletRequests, []);
  assert.deepEqual(errors, []);
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify(
      {
        passed: true,
        cleanOverview,
        cleanTransactions,
        hostOverview,
        hostTransactions,
        hostControl,
        catalogEvidence,
        cleanLink,
        styledLink,
        surfaceEvidence,
        resize,
        fit,
        walletRequests,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'Passed: host CSS isolation, portal rendering, intentional customization, account navigation, resize/interruption, preferences, recovery preview, keyboard focus, mobile/reduced motion, no wallet requests.',
  );
} finally {
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await context.close();
  await browser.close();
}
function iconSize(icon) {
  return [icon.width, icon.height];
}
