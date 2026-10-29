import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { injectImportMap } from '../setup/bootstrap';

function closeFromApp() {
  Reflect.get(window, 'setSettingsOpen')(false);
}
function currentScroll() {
  return window.scrollY;
}
function setPreviewSearch(search: string) {
  const url = new URL(location.href);
  url.search = search;
  history.replaceState(null, '', url);
}
function activeInDialog() {
  return Boolean(document.activeElement?.closest('dialog.seams-account-dialog'));
}
function previousFocusRestored() {
  return document.activeElement === Reflect.get(window, 'settingsPreviousFocus');
}
function previousFocusTag() {
  const element = Reflect.get(window, 'settingsPreviousFocus');
  return element instanceof Element ? element.tagName : null;
}
function focusState() {
  return {
    inDialog: Boolean(document.activeElement?.closest('dialog.seams-account-dialog')),
    documentFocused: document.hasFocus(),
  };
}
function showWalletApproval() {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('data-seams-root', '');
  dialog.className = 'seams-wallet-overlay-dialog';
  dialog.setAttribute('aria-label', 'Wallet approval');
  const button = document.createElement('button');
  button.textContent = 'Wallet approval action';
  dialog.append(button);
  document.body.append(dialog);
  dialog.showModal();
}
function closeWalletApproval() {
  const dialog = document.querySelector<HTMLDialogElement>('dialog.seams-wallet-overlay-dialog');
  dialog?.close();
  dialog?.remove();
}
function closeDialogs() {
  for (const dialog of document.querySelectorAll('dialog')) dialog.close();
}
async function cleanupDialogs({ page }: { page: Page }) {
  await page.evaluate(closeDialogs);
}

test.afterEach(cleanupDialogs);

test(
  'app-controlled settings modal shares navigation, traps focus, restores the opener, and survives wallet overlays',
  runModalSettings,
);
test(
  'settings drawer retains screens through interrupted dismissal and scrolls within mobile bounds',
  runDrawerSettings,
);

async function runModalSettings(
  { page, baseURL }: { page: Page; baseURL?: string },
  testInfo: TestInfo,
): Promise<void> {
  await runSettingsPresentation('modal', { page, baseURL }, testInfo);
}

async function runDrawerSettings(
  { page, baseURL }: { page: Page; baseURL?: string },
  testInfo: TestInfo,
): Promise<void> {
  await runSettingsPresentation('drawer', { page, baseURL }, testInfo);
}

async function runSettingsPresentation(
  presentation: 'modal' | 'drawer',
  { page, baseURL }: { page: Page; baseURL?: string },
  testInfo: TestInfo,
): Promise<void> {
  if (!baseURL) throw new Error('Settings browser test requires a frontend URL');
  const artifacts = fileURLToPath(
    new URL(
      `../../output/playwright/account-settings-${presentation}/${testInfo.project.name}/`,
      import.meta.url,
    ),
  );
  await mkdir(artifacts, { recursive: true });
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../fixtures/ui/account-settings.tsx', import.meta.url))],
    bundle: true,
    write: false,
    format: 'esm',
    jsx: 'automatic',
    external: ['react', 'react-dom/client', 'react/jsx-runtime'],
  });
  await injectImportMap(page, { frontendUrl: baseURL });
  await page.goto(baseURL);
  await page.evaluate(setPreviewSearch, `?theme=dark&presentation=${presentation}`);
  await page.addScriptTag({ type: 'module', content: bundle.outputFiles[0].text });
  const opener = page.getByRole('button', { name: 'App wallet settings', exact: true });
  const modal = page.getByRole('dialog', { name: 'Wallet settings', exact: true });
  const close = page.getByRole('button', { name: 'Close wallet settings', exact: true });
  await expect(opener).toBeVisible();
  await expect(modal).toHaveCount(0);
  await expect(page.locator('[aria-haspopup="menu"]')).toHaveCount(0);
  await opener.click();
  await expect(modal).toBeVisible();
  const pointerOpeningFocus = await page.evaluate(previousFocusTag);
  await expect(close).toBeFocused();
  await expect(modal).toHaveAttribute('open', '');
  await expect(modal).toHaveAttribute('data-presentation', presentation);
  await expect(page.locator('body > [data-seams-root] > dialog')).toBeVisible();
  await page.locator('body').evaluate(addCustomerClass);
  await page.addStyleTag({
    content: `
    .customer-app dialog[open] {
      padding: 30px;
      margin: 30px;
      min-width: 700px;
      width: 100vw;
      height: 100vh;
      border: 12px solid red;
      background: red;
    }
  `,
  });
  await expect(modal).toHaveCSS('padding', '0px');
  await expect(modal).toHaveCSS('border-top-width', '0px');
  await page.keyboard.press('Shift+Tab');
  const shiftedFocus = await page.evaluate(focusState);
  expect(shiftedFocus.inDialog || !shiftedFocus.documentFocused).toBe(true);
  await page.keyboard.press('Tab');
  const tabbedFocus = await page.evaluate(focusState);
  expect(tabbedFocus.inDialog || !tabbedFocus.documentFocused).toBe(true);
  await close.focus();
  await page.getByRole('button', { name: 'Background action', exact: true }).evaluate(focusElement);
  expect(await page.evaluate(activeInDialog)).toBe(true);
  const beforeScroll = await page.evaluate(currentScroll);
  await page.mouse.move(5, 5);
  await page.mouse.wheel(0, 500);
  await expect.poll(page.evaluate.bind(page, currentScroll)).toBe(beforeScroll);
  await page.locator('[data-account-menu-item="transaction-settings"]').click();
  await expect(
    page.getByRole('heading', { name: 'Transaction settings', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Drawer', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.locator('[data-account-menu-item="authentication-methods"]').click();
  await expect(
    page.getByRole('heading', { name: 'Authentication methods', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.evaluate(showWalletApproval);
  await page.getByRole('button', { name: 'Wallet approval action', exact: true }).click();
  await expect(modal).toBeVisible();
  await expect(page.getByTestId('open-changes')).toHaveText('[]');
  await page.evaluate(closeWalletApproval);
  await expect.poll(modal.evaluate.bind(modal, settingsAlignment)).toBeLessThan(1);
  const desktopBounds = await modal.boundingBox();
  if (!desktopBounds) throw new Error('Desktop settings modal has no bounds');
  await page.mouse.move(desktopBounds.x + 30, desktopBounds.y + 30);
  await page.mouse.down();
  await page.mouse.move(5, 5);
  await page.mouse.up();
  await expect(modal).toBeVisible();
  await expect(page.getByTestId('open-changes')).toHaveText('[]');
  await page.getByRole('group', { name: 'Wallet account', exact: true }).click();
  await page.screenshot({ path: `${artifacts}/desktop.png`, animations: 'disabled' });
  let interruption: Awaited<ReturnType<typeof reopenDuringExit>> | null = null;
  if (presentation === 'drawer') {
    await page.locator('[data-account-menu-item="export-keys"]').click();
    interruption = await page.evaluate(reopenDuringExit);
    expect(interruption.closing).toBe(true);
    expect(interruption.headingBeforeClose).toBeTruthy();
    expect(interruption.headingDuringClose).toBe(interruption.headingBeforeClose);
    expect(interruption.sameDialog).toBe(true);
    await expect(modal).toHaveAttribute('data-state', 'open');
    await expect(page.getByRole('group', { name: 'Wallet account', exact: true })).toBeVisible();
    await expect.poll(modal.evaluate.bind(modal, settingsAlignment)).toBeLessThan(1);
  }
  await close.click();
  await expect(modal).toHaveCount(0);
  await expect.poll(page.evaluate.bind(page, previousFocusRestored)).toBe(true);
  await expect(page.getByTestId('open-changes')).toHaveText('[false]');
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-account-menu-item]')).toHaveCount(7);
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page.getByTestId('open-changes')).toHaveText('[false,false]');
  await opener.click();
  await page.mouse.click(5, 5);
  await expect(modal).toHaveCount(0);
  await expect(page.getByTestId('open-changes')).toHaveText('[false,false,false]');
  await opener.click();
  await page.evaluate(closeFromApp);
  await expect(modal).toHaveCount(0);
  await expect.poll(page.evaluate.bind(page, previousFocusRestored)).toBe(true);
  await expect(page.getByTestId('open-changes')).toHaveText('[false,false,false]');
  if (presentation === 'drawer') {
    await page.evaluate(setDocumentDirection, 'rtl');
    await opener.click();
    await expect.poll(modal.evaluate.bind(modal, drawerLeft)).toBe(0);
    const exitMotion = await page.evaluate(closeRtlDrawer);
    await writeFile(`${artifacts}/rtl-exit-motion.json`, JSON.stringify(exitMotion, null, 2));
    let leftmost = 0;
    for (const frame of exitMotion.frames) leftmost = Math.min(leftmost, frame.left);
    expect(leftmost).toBeLessThan(0);
    expect(exitMotion.closed).toBe(true);
    await expect(modal).toHaveCount(0);
    await page.evaluate(setDocumentDirection, 'ltr');
  }
  await page.setViewportSize({ width: 320, height: 540 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await opener.click();
  const bounds = await modal.boundingBox();
  if (!bounds) throw new Error('Settings modal has no bounds');
  if (presentation === 'modal') {
    expect(bounds.width).toBeLessThanOrEqual(288);
    expect(bounds.height).toBeLessThanOrEqual(508);
  } else {
    expect(bounds.width).toBe(320);
    expect(bounds.y + bounds.height).toBe(540);
    expect(bounds.y).toBeGreaterThanOrEqual(36);
    expect(await modal.evaluate(runningMotionCount)).toBe(0);
  }
  const footerBeforeScroll = await modal.locator('.seams-account-footer').boundingBox();
  const scrolling = await modal.evaluate(scrollToBottom);
  expect(scrolling.scrollTop).toBeGreaterThan(0);
  await expect(modal.locator('.seams-account-footer')).toBeInViewport();
  if (presentation === 'drawer') {
    const footerAfterScroll = await modal.locator('.seams-account-footer').boundingBox();
    expect(footerAfterScroll?.y).toBe(footerBeforeScroll?.y);
    await expect(modal.locator('.seams-account-origin')).toBeInViewport();
  }
  await page.locator('[data-account-menu-item="recovery-codes"]').click();
  await expect.poll(modal.evaluate.bind(modal, readScrollTop)).toBe(0);
  await page.getByRole('button', { name: 'Reveal with passkey', exact: true }).click();
  await expect(page.locator('.seams-account-recovery-codes code')).toHaveCount(4);
  await page.screenshot({ path: `${artifacts}/mobile.png`, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect.poll(page.evaluate.bind(page, previousFocusRestored)).toBe(true);
  await page.goto(baseURL);
  await page.evaluate(setPreviewSearch, '?presentation=dropdown');
  await page.addScriptTag({ type: 'module', content: bundle.outputFiles[0].text });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Wallet account', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Background action', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify(
      {
        passed: true,
        presentation,
        interruption,
        desktopBounds,
        bounds,
        beforeScroll,
        shiftedFocus,
        tabbedFocus,
        scrolling,
        pointerOpeningFocus,
      },
      null,
      2,
    ),
  );
}
function focusElement(element: HTMLElement) {
  element.focus();
}
function addCustomerClass(body: HTMLElement) {
  body.classList.add('customer-app');
}
function scrollToBottom(dialog: HTMLDialogElement) {
  const content =
    dialog.dataset.presentation === 'drawer'
      ? dialog.querySelector<HTMLElement>('.seams-account-main')
      : dialog;
  if (!content) throw new Error('Settings content is missing');
  content.scrollTop = content.scrollHeight;
  return {
    scrollTop: content.scrollTop,
    clientHeight: content.clientHeight,
    scrollHeight: content.scrollHeight,
  };
}
function readScrollTop(dialog: HTMLDialogElement) {
  if (dialog.dataset.presentation === 'drawer') {
    return dialog.querySelector<HTMLElement>('.seams-account-main')?.scrollTop;
  }
  return dialog.scrollTop;
}
function settingsAlignment(dialog: HTMLDialogElement) {
  const bounds = dialog.getBoundingClientRect();
  const panel = dialog.querySelector('.seams-profile-button-morphable')?.getBoundingClientRect();
  if (!panel) throw new Error('Missing settings panel');
  if (dialog.dataset.presentation === 'drawer') {
    return Math.max(
      Math.abs(bounds.height - innerHeight),
      Math.abs(bounds.x + bounds.width - innerWidth),
      Math.abs(bounds.height - panel.height),
    );
  }
  return Math.max(
    Math.abs(bounds.height - panel.height),
    Math.abs(bounds.y + bounds.height / 2 - innerHeight / 2),
  );
}

function runningMotionCount(dialog: HTMLDialogElement): number {
  let count = 0;
  for (const motion of dialog.getAnimations()) if (motion.playState === 'running') count += 1;
  return count;
}

async function reopenDuringExit() {
  const original = document.querySelector('dialog.seams-account-dialog');
  const headingBeforeClose = original?.querySelector('.seams-account-main h2')?.textContent;
  Reflect.get(window, 'setSettingsOpen')(false);
  await new Promise<number>(requestAnimationFrame);
  await new Promise<number>(requestAnimationFrame);
  const closing = original?.getAttribute('data-state') === 'closing';
  const headingDuringClose = original?.querySelector('.seams-account-main h2')?.textContent;
  Reflect.get(window, 'setSettingsOpen')(true);
  await new Promise<number>(requestAnimationFrame);
  await new Promise<number>(requestAnimationFrame);
  return {
    closing,
    headingBeforeClose,
    headingDuringClose,
    sameDialog: document.querySelector('dialog.seams-account-dialog') === original,
  };
}

function setDocumentDirection(direction: 'ltr' | 'rtl'): void {
  document.documentElement.dir = direction;
}

function drawerLeft(dialog: HTMLDialogElement): number {
  return Math.round(dialog.getBoundingClientRect().left);
}

async function closeRtlDrawer() {
  const frames: { elapsed: number; left: number; state: string | null; offset: string }[] = [];
  const started = performance.now();
  const dialog = document.querySelector<HTMLDialogElement>('dialog.seams-account-dialog');
  if (!dialog) throw new Error('Missing RTL drawer');
  Reflect.get(window, 'setSettingsOpen')(false);
  while (dialog.isConnected && performance.now() - started < 1000) {
    await new Promise<number>(requestAnimationFrame);
    if (!dialog.isConnected) break;
    frames.push({
      elapsed: performance.now() - started,
      left: dialog.getBoundingClientRect().left,
      state: dialog.getAttribute('data-state'),
      offset: getComputedStyle(dialog).getPropertyValue('--seams-account-drawer-offset').trim(),
    });
  }
  return { closed: !dialog.isConnected, frames };
}
