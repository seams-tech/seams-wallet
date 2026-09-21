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
      <link rel="stylesheet" data-seams-wallet-ui-css href="/wallet-ui.css">
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
      calls: [],
      closed: 0,
      violations: [],
    };
    document.addEventListener('securitypolicyviolation', violation);
  });
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

test('an immediate error preserves the modal halo geometry and background', async ({ page }) => {
  const id = await page.evaluate(() => {
    const id = window.__confirmationMount.mount('modal', 'wallet-iframe');
    window.__confirmationMount.error(0);
    return id;
  });
  const root = page.locator(`#${id}`);
  await expect(root.locator('.error-banner')).toHaveText('Unable to prepare transaction.');
  const halo = root.locator('.seams-halo-border');
  await expect(halo.locator('.halo-ring')).toHaveCount(0);
  await expect(halo.locator('.halo-content')).toHaveCSS('padding', '0px');
  await expect(halo.locator('.halo-content')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const before = await halo.boundingBox();
  await page.evaluate(() => window.__confirmationMount.update(0, 'First confirmation', true));
  await expect(halo.locator('.halo-ring')).toHaveCount(1);
  const after = await halo.boundingBox();
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(after!.width).toBeCloseTo(before!.width, 2);
  expect(after!.height).toBeCloseTo(before!.height, 2);
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
    const cancel = document.querySelector<HTMLButtonElement>('.cancel')!;
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

test('missing document CSS rejects before creating a surface', async ({ page }) => {
  await page.locator('link[data-seams-wallet-ui-css]').evaluate((link) => link.remove());
  await expect(
    page.evaluate(() => window.__confirmationMount.mount('modal', 'wallet-iframe')),
  ).rejects.toThrow('Wallet confirmation stylesheet unavailable');
  await expect(page.locator('.seams-confirmation-surface')).toHaveCount(0);
  expect(await page.evaluate(() => window.__confirmationMount.closed)).toBe(0);
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
