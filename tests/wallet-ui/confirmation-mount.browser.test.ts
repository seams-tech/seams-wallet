import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { injectImportMap } from '../setup/bootstrap';
import { routePreactModules } from '../setup/preact';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import type {
  ConfirmSurfaceModel,
  ConfirmationSurfaceHandle,
} from '@/core/signingEngine/uiConfirm/ui/preact/mountConfirmationSurface';
import type { EmailOtpVerificationState } from '@/core/signingEngine/uiConfirm/ui/preact/email-otp-session';
import type { TransactionReceiptState } from '@/core/signingEngine/uiConfirm/ui/transaction-receipt';

const walletUiCss = fs.readFileSync(
  path.resolve(import.meta.dirname, '../../packages/wallet/dist/esm/sdk/wallet-ui.css'),
  'utf8',
);

declare global {
  interface Window {
    __confirmationMount: {
      mount(variant: 'modal' | 'drawer', context: 'standalone' | 'wallet-iframe'): string;
      update(index: number, heading: string, ready: boolean): void;
      error(index: number): void;
      email(index: number, challengeId: string, verification: EmailOtpVerificationState): void;
      close(index: number): void;
      dispose(index: number): void;
      receipt(index: number, state: TransactionReceiptState, view?: 'expanded' | 'toast'): void;
      recipient(index: number, value: string): void;
      calls: string[];
      closed: number;
      violations: string[];
    };
  }
}

test.beforeEach(async ({ page }) => {
  await injectImportMap(page);
  await routePreactModules(page);
  await page.route('**/wallet-ui.css', (route) =>
    route.fulfill({ contentType: 'text/css', body: walletUiCss }),
  );
  await page.route('**/confirmation-mount-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': "style-src 'self'; style-src-attr 'none'" },
      body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}
      <link rel="stylesheet" href="/wallet-ui.css">
      </head><body><button id="opener">Open confirmation</button><main></main></body></html>`,
    }),
  );
  await page.goto('/confirmation-mount-test');
  await page.evaluate(async () => {
    const moduleUrl =
      '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/preact/mountConfirmationSurface.js';
    const { mountConfirmationSurface } = await import(moduleUrl);
    const handles: ConfirmationSurfaceHandle[] = [];
    function firstConfirm() {
      window.__confirmationMount.calls.push('first');
    }
    function updatedConfirm() {
      window.__confirmationMount.calls.push('updated');
    }
    function cancel() {
      window.__confirmationMount.calls.push('cancel');
    }
    function closed() {
      window.__confirmationMount.closed++;
    }
    function otpSubmit(code: string, challengeId: string) {
      window.__confirmationMount.calls.push(`${challengeId}:${code}`);
    }
    function email(index: number, challengeId: string, verification: EmailOtpVerificationState) {
      const viewModel = model('Email confirmation', true);
      if (viewModel.content.kind !== 'transaction') throw new Error('Expected transaction fixture');
      viewModel.content.prompt = {
        kind: 'email',
        email: {
          prompt: { challengeId, emailHint: 'a***@example.com' },
          verification,
          onSubmit: otpSubmit,
        },
      };
      viewModel.content.transaction.confirmText = 'Confirm Code';
      handles[index].update(viewModel);
    }
    function model(heading: string, ready: boolean): ConfirmSurfaceModel {
      return {
        appearance: {
          palette: 'default',
          theme: { id: 'default', mode: 'light', colors: { accent: 'rgb(12, 34, 56)' } },
        },
        content: {
          kind: 'transaction',
          review: { model: null, tree: null },
          header: {
            heading,
            website: { kind: 'ready', text: 'wallet.example' },
            chainDetails: { kind: 'ready', text: 'NEAR' },
          },
          body: { kind: 'empty' },
          prompt: { kind: 'passkey' },
          transaction: {
            tree: null,
            theme: 'light',
            explorers: { near: 'https://testnet.nearblocks.io' },
            decision: ready
              ? {
                  kind: 'ready',
                  onConfirm: heading === 'First confirmation' ? firstConfirm : updatedConfirm,
                }
              : { kind: 'preparing' },
            confirmText: 'Confirm',
            cancelText: 'Cancel',
            onCancel: cancel,
          },
        },
      };
    }
    function mount(variant: 'modal' | 'drawer', context: 'standalone' | 'wallet-iframe') {
      const handle = mountConfirmationSurface({
        parent: document.querySelector('main')!,
        presentation: { variant, context },
        model: model('First confirmation', true),
        onClosed: closed,
      });
      handles.push(handle);
      return handle.element.id;
    }
    function update(index: number, heading: string, ready: boolean) {
      handles[index].update(model(heading, ready));
    }
    function error(index: number) {
      const viewModel = model('First confirmation', true);
      if (viewModel.content.kind !== 'transaction') throw new Error('Expected transaction fixture');
      viewModel.content.header.errorMessage = 'Unable to prepare transaction.';
      viewModel.content.transaction.errorMessage = 'Unable to prepare transaction.';
      handles[index].update(viewModel);
    }
    function close(index: number) {
      handles[index].close();
    }
    function dispose(index: number) {
      handles[index].dispose();
    }
    function receiptView() {
      window.__confirmationMount.calls.push('receipt-view');
    }
    function recipient(index: number, value: string) {
      const viewModel = model('Review transfer', true);
      if (viewModel.content.kind !== 'transaction') throw new Error('Expected transaction fixture');
      viewModel.content.review = { tree: null, model: {
        chain: 'evm', chainId: 8453,
        operations: [{ id: 'transfer', kind: 'generic.contractCall', label: 'Transfer', to: value }],
      } };
      viewModel.content.transaction.explorers.evm = 'https://basescan.org';
      handles[index].update(viewModel);
    }
    function receiptDismiss() {
      window.__confirmationMount.calls.push('receipt-dismiss');
    }
    function receipt(
      index: number,
      state: TransactionReceiptState,
      view: 'expanded' | 'toast' = 'toast',
    ) {
      handles[index].showReceipt({
        state,
        view,
        onView: receiptView,
        onDismiss: receiptDismiss,
      });
    }
    function violation(event: SecurityPolicyViolationEvent) {
      window.__confirmationMount.violations.push(event.violatedDirective);
    }
    window.__confirmationMount = {
      mount,
      update,
      error,
      email,
      close,
      dispose,
      receipt,
      recipient,
      calls: [],
      closed: 0,
      violations: [],
    };
    document.addEventListener('securitypolicyviolation', violation);
  });
});

test('toast progress advances in thirds only after completed transaction stages', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__confirmationMount.mount('modal', 'wallet-iframe');
    window.__confirmationMount.receipt(0, { kind: 'signing' });
  });
  const progress = page.locator('.seams-toast-progress');
  const fill = progress.locator('span');
  const spinner = page.locator('.seams-transaction-toast .seams-receipt-symbol svg');
  const stages: { state: TransactionReceiptState; fraction: number; pending: boolean }[] = [
    { state: { kind: 'signing' }, fraction: 0, pending: true },
    { state: { kind: 'signed' }, fraction: 1 / 3, pending: false },
    { state: { kind: 'broadcasting' }, fraction: 1 / 3, pending: true },
    { state: { kind: 'submitted', hash: '0x123' }, fraction: 2 / 3, pending: true },
    { state: { kind: 'confirmed', hash: '0x123' }, fraction: 1, pending: false },
  ];
  for (const { state, fraction, pending } of stages) {
    await page.evaluate((state) => window.__confirmationMount.receipt(0, state), state);
    await expect
      .poll(async () => {
        const trackBounds = await progress.boundingBox();
        const fillBounds = await fill.boundingBox();
        return fillBounds!.width / trackBounds!.width;
      })
      .toBeCloseTo(fraction, 2);
    await expect(spinner).toHaveCSS('animation-name', pending ? 'seams-receipt-spin' : 'none');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() =>
    window.__confirmationMount.receipt(0, { kind: 'submitted', hash: '0x123' }),
  );
  await expect(fill).toHaveCSS('transition-duration', '0s');
  await expect(spinner).toHaveCSS('animation-name', 'none');
  await expect.poll(() => page.evaluate(() => window.__confirmationMount.violations)).toEqual([]);
});

test('receipt hashes stay on one line and reveal their end on hover and keyboard focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const hash = `0x${'1234567890abcdef'.repeat(4)}`;
  await page.evaluate((hash) => {
    window.__confirmationMount.mount('modal', 'wallet-iframe');
    window.__confirmationMount.receipt(0, { kind: 'confirmed', hash }, 'expanded');
  }, hash);
  await page.locator('summary').filter({ hasText: 'Receipt details' }).click();
  const address = page.locator('.seams-review-address');
  await expect(address).toHaveCSS('white-space', 'nowrap');
  await expect(address).toHaveCSS('text-overflow', 'ellipsis');
  await expect(address).toHaveAttribute('aria-label', hash);
  await expect
    .poll(() => address.evaluate((el) => el.firstElementChild!.scrollWidth > el.clientWidth))
    .toBe(true);
  await expect
    .poll(() =>
      page.locator('.modal-container-root').evaluate((el) => el.scrollWidth <= el.clientWidth),
    )
    .toBe(true);
  await address.hover();
  expect(await address.locator('span').evaluate(el => {
    const timing = el.getAnimations()[0]?.effect?.getTiming();
    return { duration: timing?.duration, delay: timing?.delay };
  })).toEqual({ duration: 200, delay: 0 });
  await expect(address).toHaveAttribute('data-revealing', 'true');
  await expect
    .poll(() => address.locator('span').evaluate((el) => getComputedStyle(el).transform))
    .not.toBe('matrix(1, 0, 0, 1, 0, 0)');
  await page.mouse.move(0, 0);
  await expect(address).not.toHaveAttribute('data-revealing');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await address.focus();
  await expect(address).toHaveAttribute('data-revealing', 'true');
  await expect
    .poll(() =>
      address.evaluate((el) => {
        const text = el.firstElementChild!;
        return Math.abs(text.getBoundingClientRect().right - el.getBoundingClientRect().right);
      }),
    )
    .toBeLessThan(1);
  await page.getByRole('button', { name: 'Done', exact: true }).focus();
  await expect(address).not.toHaveAttribute('data-revealing');
  await expect.poll(() => page.evaluate(() => window.__confirmationMount.violations)).toEqual([]);
});

test('clicking the receipt address copies the full value and animates the export-style check', async ({ page }) => {
  const recipient = '0x2F0100000000000000000000000000000000004EC9';
  await page.evaluate((value) => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      async writeText(text: string) { window.__confirmationMount.calls.push(text); },
    } });
    window.__confirmationMount.mount('modal', 'wallet-iframe');
    window.__confirmationMount.recipient(0, value);
    window.__confirmationMount.receipt(0, { kind: 'signed' }, 'expanded');
  }, recipient);
  const destination = page.locator('.seams-receipt-destination');
  const button = destination.getByRole('button', { name: `Copy recipient address ${recipient}`, exact: true });
  await expect(button.locator('.copy-icon')).toHaveCSS('opacity', '0');
  await expect(button.locator('.seams-review-full-address')).toHaveText(recipient);
  await button.hover();
  await expect(button.locator('.copy-icon')).toHaveCSS('opacity', '1');
  await expect(button.locator('.seams-review-address')).toHaveCount(0);
  await button.locator('.seams-review-full-address').click();
  await expect.poll(() => page.evaluate(() => window.__confirmationMount.calls)).toEqual([recipient]);
  await expect(button).toHaveCount(0);
  const copied = destination.locator('.seams-review-copy-address');
  await expect(copied).toHaveAccessibleName('Copied');
  await expect(copied.locator('.copy-icon-check')).toHaveCSS('opacity', '1');
  await expect(copied.locator('.copy-icon-copy')).toHaveCSS('opacity', '0');
  await expect(copied).toHaveAccessibleName(`Copy recipient address ${recipient}`, { timeout: 5000 });
  await copied.focus();
  await copied.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__confirmationMount.calls)).toEqual([recipient, recipient]);
  await expect.poll(() => page.evaluate(() => window.__confirmationMount.violations)).toEqual([]);
});

test('confirmed receipts link to the configured block explorer', async ({ page }) => {
  const recipient = '0x2F0100000000000000000000000000000000004EC9';
  const hash = `0x${'1234567890abcdef'.repeat(4)}`;
  await page.evaluate(({ recipient, hash }) => {
    window.__confirmationMount.mount('modal', 'wallet-iframe');
    window.__confirmationMount.recipient(0, recipient);
    window.__confirmationMount.receipt(0, { kind: 'confirmed', hash }, 'expanded');
  }, { recipient, hash });
  const link = page.getByRole('link', { name: 'View transaction' });
  await expect(link).toHaveAttribute('href', `https://basescan.org/tx/${hash}`);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

test('email Confirm Code validates and retries through its native form', async ({ page }) => {
  await page.evaluate(() => {
    window.__confirmationMount.mount('modal', 'wallet-iframe');
    window.__confirmationMount.email(0, 'email-challenge', { kind: 'ready' });
  });
  const input = page.getByRole('textbox', { name: 'Email code' });
  const confirm = page.getByRole('button', { name: 'Confirm Code' });
  await input.fill('12');
  await confirm.click();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(input).toBeFocused();
  await expect(page.getByText('Enter the 6-digit Email OTP code.')).toBeVisible();
  expect(await page.evaluate(() => window.__confirmationMount.calls)).toEqual([]);
  await input.fill('123456');
  await expect
    .poll(() => page.evaluate(() => window.__confirmationMount.calls))
    .toEqual(['email-challenge:123456']);
  await page.evaluate(() =>
    window.__confirmationMount.email(0, 'email-challenge', {
      kind: 'rejected',
      message: 'Please retry.',
    }),
  );
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue('123456');
  await confirm.click();
  await expect
    .poll(() => page.evaluate(() => window.__confirmationMount.calls))
    .toEqual(['email-challenge:123456', 'email-challenge:123456']);
  await confirm.click();
  expect(await page.evaluate(() => window.__confirmationMount.calls)).toHaveLength(2);
  await page.evaluate(() => window.__confirmationMount.dispose(0));
  expect(await page.evaluate(() => window.__confirmationMount.violations)).toEqual([]);
});

test('email forms isolate simultaneous surfaces and Enter validates the focused input', async ({
  page,
}) => {
  const ids = await page.evaluate(() => {
    const first = window.__confirmationMount.mount('modal', 'wallet-iframe');
    const second = window.__confirmationMount.mount('modal', 'wallet-iframe');
    window.__confirmationMount.email(0, 'first-challenge', { kind: 'ready' });
    window.__confirmationMount.email(1, 'second-challenge', { kind: 'ready' });
    return { first, second };
  });
  const first = page.locator(`#${ids.first}`);
  const second = page.locator(`#${ids.second}`);
  await expect(first.getByRole('button', { name: 'Confirm Code' })).toBeEnabled();
  await first.getByRole('textbox', { name: 'Email code' }).fill('123');
  await first.getByRole('textbox', { name: 'Email code' }).press('Enter');
  await expect(first.getByRole('textbox', { name: 'Email code' })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(second.locator('[aria-invalid="true"]')).toHaveCount(0);
  await second.getByRole('textbox', { name: 'Email code' }).fill('654321');
  await expect
    .poll(() => page.evaluate(() => window.__confirmationMount.calls))
    .toEqual(['second-challenge:654321']);
  await page.evaluate(() => {
    window.__confirmationMount.dispose(0);
    window.__confirmationMount.dispose(1);
  });
  expect(await page.evaluate(() => window.__confirmationMount.violations)).toEqual([]);
});

test('mount updates complete models and invokes the current callback synchronously', async ({
  page,
}) => {
  const id = await page.evaluate(() => window.__confirmationMount.mount('modal', 'wallet-iframe'));
  const root = page.locator(`#${id}`);
  await expect(root.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  await expect(root).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  expect(
    await root.evaluate((element) =>
      getComputedStyle(element).getPropertyValue('--seams-colors-accent').trim(),
    ),
  ).toBe('rgb(12, 34, 56)');
  expect(
    await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>('.confirm')!.click();
      return window.__confirmationMount.calls;
    }),
  ).toEqual(['first']);
  await page.evaluate(() => window.__confirmationMount.update(0, 'Updated confirmation', false));
  await expect(root.getByRole('heading')).toHaveText('Updated confirmation');
  await expect(root.getByRole('button', { name: 'Loading...', exact: true })).toBeDisabled();
  await page.evaluate(() => window.__confirmationMount.update(0, 'Updated confirmation', true));
  await root.getByRole('button', { name: 'Confirm', exact: true }).click();
  expect(await page.evaluate(() => window.__confirmationMount.calls)).toEqual(['first', 'updated']);
  await page.evaluate(() => {
    window.__confirmationMount.close(0);
    window.__confirmationMount.dispose(0);
    window.__confirmationMount.update(0, 'Retired', true);
  });
  await expect(root).toHaveCount(0);
  expect(await page.evaluate(() => window.__confirmationMount.closed)).toBe(1);
  expect(await page.evaluate(() => window.__confirmationMount.violations)).toEqual([]);
});

test('an immediate error remains visible and clears when the review updates', async ({ page }) => {
  const id = await page.evaluate(() => {
    const id = window.__confirmationMount.mount('modal', 'wallet-iframe');
    window.__confirmationMount.error(0);
    return id;
  });
  const root = page.locator(`#${id}`);
  await expect(root.getByRole('alert')).toHaveText('Unable to prepare transaction.');
  await expect(root.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.evaluate(() => window.__confirmationMount.update(0, 'First confirmation', true));
  await expect(root.getByRole('alert')).toHaveCount(0);
  await expect(root.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  await page.evaluate(() => window.__confirmationMount.dispose(0));
  expect(await page.evaluate(() => window.__confirmationMount.violations)).toEqual([]);
});

test('hosted drawer keeps its compact content inside the sheet', async ({ page }) => {
  const id = await page.evaluate(() => window.__confirmationMount.mount('drawer', 'wallet-iframe'));
  const root = page.locator(`#${id}`);
  await expect(root.getByRole('heading')).toHaveText('First confirmation');
  await expect(root.locator('.seams-passkey-halo-loading')).toHaveCount(0);
  await expect(root.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  const sheet = await root.locator('.seams-confirmation-drawer').boundingBox();
  const actions = await root.locator('.actions').boundingBox();
  expect(sheet).not.toBeNull();
  expect(actions).not.toBeNull();
  expect(actions!.x).toBeGreaterThan(sheet!.x);
  expect(actions!.x + actions!.width).toBeLessThan(sheet!.x + sheet!.width);
  await root.getByRole('button', { name: 'Confirm', exact: true }).click();
  expect(await page.evaluate(() => window.__confirmationMount.calls)).toEqual(['first']);
  await page.evaluate(() => window.__confirmationMount.dispose(0));
  expect(await page.evaluate(() => window.__confirmationMount.violations)).toEqual([]);
});

test('drawer close filters callbacks and disposes after its transition', async ({ page }) => {
  await page.locator('#opener').focus();
  const id = await page.evaluate(() => window.__confirmationMount.mount('drawer', 'standalone'));
  await expect(page.locator(`#${id} .is-open`)).toBeVisible();
  await page.evaluate(() => {
    const cancel = document.querySelector<HTMLButtonElement>('button[aria-label="Cancel"]')!;
    window.__confirmationMount.close(0);
    cancel.click();
    window.__confirmationMount.close(0);
    window.__confirmationMount.update(0, 'Too late', true);
  });
  await expect(page.locator(`#${id}`)).toHaveCount(0);
  expect(await page.evaluate(() => window.__confirmationMount.closed)).toBe(1);
  expect(await page.evaluate(() => window.__confirmationMount.calls)).toEqual([]);
  await expect(page.locator('#opener')).toBeFocused();
  expect(await page.evaluate(() => window.__confirmationMount.violations)).toEqual([]);
});

test('disposing one surface leaves the other mounted and styled', async ({ page }) => {
  const first = await page.evaluate(() =>
    window.__confirmationMount.mount('modal', 'wallet-iframe'),
  );
  const second = await page.evaluate(() =>
    window.__confirmationMount.mount('drawer', 'wallet-iframe'),
  );
  await page.evaluate(() => window.__confirmationMount.dispose(0));
  await expect(page.locator(`#${first}`)).toHaveCount(0);
  expect(
    await page.evaluate((id) => {
      for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets]) {
        for (const rule of sheet.cssRules) {
          if (rule.cssText.includes(`#${id}`)) return true;
        }
      }
      return false;
    }, first),
  ).toBe(false);
  const surviving = page.locator(`#${second}`);
  await expect(surviving.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  await surviving.getByRole('button', { name: 'Confirm', exact: true }).click();
  expect(await page.evaluate(() => window.__confirmationMount.calls)).toEqual(['first']);
  expect(
    await surviving.evaluate((element) =>
      getComputedStyle(element).getPropertyValue('--seams-colors-accent').trim(),
    ),
  ).toBe('rgb(12, 34, 56)');
  await page.evaluate(() => window.__confirmationMount.dispose(1));
  expect(await page.evaluate(() => window.__confirmationMount.closed)).toBe(2);
  expect(await page.evaluate(() => window.__confirmationMount.violations)).toEqual([]);
});
