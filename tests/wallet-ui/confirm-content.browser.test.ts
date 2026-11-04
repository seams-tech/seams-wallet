import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { injectImportMap } from '../setup/bootstrap';
import { routePreactModules } from '../setup/preact';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import type { EmailOtpVerificationState } from '@/core/signingEngine/uiConfirm/ui/preact/email-otp-session';
import type { ConfirmationBodyModel } from '@/core/signingEngine/uiConfirm/ui/confirmation-body-model';

const walletUiCss = fs.readFileSync(
  path.resolve(import.meta.dirname, '../../packages/wallet/dist/esm/sdk/wallet-ui.css'),
  'utf8',
);

declare global {
  interface Window {
    __contentTest: {
      update(ready: boolean): void;
      setRegistration(creating: boolean): void;
      setOtp(challengeId: string, resend?: boolean, verification?: EmailOtpVerificationState): void;
      otpSubmissions: string[];
      otpChallenges: string[];
      setBody(body: ConfirmationBodyModel): void;
      setModal(context: 'standalone' | 'wallet-iframe'): void;
      setDrawer(context: 'standalone' | 'wallet-iframe', closing: boolean, busy: boolean): void;
      drawerClosed: number;
      dispose(): void;
      confirmed: number;
      cancelled: number;
      violations: string[];
      initiallyDisabled: boolean;
    };
  }
}

test.beforeEach(async ({ page }) => {
  await injectImportMap(page);
  await routePreactModules(page);
  await page.route('**/wallet-ui.css', (route) =>
    route.fulfill({ contentType: 'text/css', body: walletUiCss }),
  );
  await page.route('**/confirm-content-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': "style-src 'self'; style-src-attr 'none'" },
      body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}<link rel="stylesheet" href="/wallet-ui.css"></head><body><main class="seams-wallet-ui" data-theme="light"></main></body></html>`,
    }),
  );
  await page.goto('/confirm-content-test');
  await page.evaluate(async () => {
    const runtime = '/_test-preact/preact.module.js';
    const componentUrl = '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/preact/ConfirmContent.js';
    const stylesUrl = '/_test-sdk/esm/core/browser/walletIframe/csp-stylesheet.js';
    const { h, render } = await import(runtime);
    const { ConfirmContent } = await import(componentUrl);
    const compositionUrl =
      '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/preact/ConfirmationContent.js';
    const { ConfirmationContent } = await import(compositionUrl);
    const modalUrl = '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/preact/ConfirmationModal.js';
    const { ConfirmationModal } = await import(modalUrl);
    const drawerUrl = '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/preact/ConfirmationDrawer.js';
    const { ConfirmationDrawer } = await import(drawerUrl);
    const otpUrl = '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/preact/EmailOtpContent.js';
    const { EmailOtpContent } = await import(otpUrl);
    const registrationUrl =
      '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/preact/PasskeyRegistrationContent.js';
    const { PasskeyRegistrationContent } = await import(registrationUrl);
    const { createCspStylesheetManager } = await import(stylesUrl);
    const styles = createCspStylesheetManager({ doc: document, baseCss: '' });
    const parent = document.querySelector('main')!;
    function setModal(context: 'standalone' | 'wallet-iframe') {
      setBody({ kind: 'empty' }, context);
    }
    function bodyContent(body: ConfirmationBodyModel) {
      return h(ConfirmationContent, {
        styles,
        model: {
          kind: 'transaction',
          review: { model: null, tree: null },
          header: {
            heading: 'Confirm transaction',
            website: { kind: 'ready', text: 'wallet.example' },
            chainDetails: { kind: 'ready', text: 'NEAR' },
          },
          body,
          prompt: { kind: 'passkey' },
          transaction: {
            tree: null,
            theme: 'light',
            explorers: { near: 'https://testnet.nearblocks.io' },
            decision: { kind: 'ready', onConfirm },
            confirmText: 'Confirm',
            cancelText: 'Cancel',
            onCancel,
          },
        },
      });
    }
    function drawerClosed() {
      window.__contentTest.drawerClosed++;
    }
    function setDrawer(context: 'standalone' | 'wallet-iframe', closing: boolean, busy: boolean) {
      render(
        h(
          ConfirmationDrawer,
          {
            context,
            label: 'Confirm transaction',
            styles,
            onCancel,
            state: closing
              ? { kind: 'closing', onClosed: drawerClosed }
              : { kind: 'open', interaction: busy ? 'busy' : 'ready' },
          },
          bodyContent({ kind: 'empty' }),
        ),
        parent,
      );
    }
    function setBody(body: ConfirmationBodyModel, context?: 'standalone' | 'wallet-iframe') {
      const content = bodyContent(body);
      if (context) {
        render(
          h(ConfirmationModal, { context, label: 'Confirm transaction', onCancel }, content),
          parent,
        );
      } else {
        render(content, parent);
      }
    }
    function submitOtp(code: string, challengeId: string) {
      window.__contentTest.otpSubmissions.push(code);
      window.__contentTest.otpChallenges.push(challengeId);
    }
    function resendOtp() {
      return { challengeId: 'resent-challenge', emailHint: 'r***@example.com' };
    }
    function setOtp(
      challengeId: string,
      resend = false,
      verification: EmailOtpVerificationState = { kind: 'ready' },
    ) {
      render(
        h(EmailOtpContent, {
          prompt: { challengeId, onResend: resend ? resendOtp : undefined },
          verification,
          onSubmit: submitOtp,
        }),
        parent,
      );
    }
    function setRegistration(creating: boolean) {
      render(
        h(PasskeyRegistrationContent, {
          display: {
            kind: 'passkey_registration_confirm_display_v1',
            intendedUserName: 'Displayed account',
            accountId: 'internal-account.testnet',
            rpId: 'wallet.example',
            signerSlot: 0,
          },
          heading: 'Create your passkey',
          body: 'Create credentials for this account.',
          cancelText: 'Cancel',
          styles,
          onCancel,
          decision: creating ? { kind: 'creating' } : { kind: 'ready', onConfirm },
        }),
        parent,
      );
    }
    function onConfirm() {
      window.__contentTest.confirmed++;
    }
    function onCancel() {
      window.__contentTest.cancelled++;
    }
    function update(ready: boolean) {
      render(
        h(ConfirmContent, {
          tree: null,
          theme: 'light',
          explorers: { near: 'https://testnet.nearblocks.io' },
          styles,
          decision: ready ? { kind: 'ready', onConfirm } : { kind: 'preparing' },
          confirmText: 'Confirm',
          cancelText: 'Cancel',
          onCancel,
        }),
        parent,
      );
    }
    function dispose() {
      render(null, parent);
    }
    window.__contentTest = {
      update,
      setRegistration,
      setOtp,
      otpSubmissions: [],
      otpChallenges: [],
      setBody,
      setModal,
      setDrawer,
      drawerClosed: 0,
      dispose,
      confirmed: 0,
      cancelled: 0,
      violations: [],
      initiallyDisabled: false,
    };
    document.addEventListener('securitypolicyviolation', (event) =>
      window.__contentTest.violations.push(event.violatedDirective),
    );
    update(true);
    window.__contentTest.initiallyDisabled =
      document.querySelector<HTMLButtonElement>('.confirm')!.disabled;
  });
});

test('drawer supports keyboard cancellation and completes close once with reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.__contentTest.setDrawer('standalone', false, true));
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__contentTest.cancelled)).toBe(1);
  await page.evaluate(() => window.__contentTest.setDrawer('standalone', true, false));
  await expect.poll(() => page.evaluate(() => window.__contentTest.drawerClosed)).toBe(1);
  await page.evaluate(() => window.__contentTest.setDrawer('standalone', true, false));
  expect(await page.evaluate(() => window.__contentTest.drawerClosed)).toBe(1);
  await page.evaluate(() => window.__contentTest.dispose());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.__contentTest.violations)).toEqual([]);
});

test('drawer pointer capture cancels cleanly and release can dismiss', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.__contentTest.setDrawer('standalone', false, false));
  const handle = page.getByRole('button', { name: 'Dismiss confirmation' });
  await expect(handle).toBeVisible();
  const bounds = (await handle.boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.locator('.seams-confirmation-drawer').evaluate((sheet) => {
    sheet.addEventListener(
      'pointerdown',
      (event) => {
        sheet.setAttribute('data-test-pointer', String((event as PointerEvent).pointerId));
      },
      { once: true },
    );
  });
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 30);
  await expect(page.locator('.seams-confirmation-drawer')).toHaveClass(/is-dragging/);
  await page.evaluate(() => {
    const sheet = document.querySelector('.seams-confirmation-drawer')!;
    sheet.dispatchEvent(
      new PointerEvent('pointercancel', {
        bubbles: true,
        pointerId: Number(sheet.getAttribute('data-test-pointer')),
      }),
    );
  });
  await page.mouse.up();
  await expect(page.locator('.seams-confirmation-drawer')).not.toHaveClass(/is-dragging/);
  expect(await page.evaluate(() => window.__contentTest.cancelled)).toBe(0);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 100);
  await page.mouse.up();
  expect(await page.evaluate(() => window.__contentTest.cancelled)).toBe(1);
  await page.evaluate(() => window.__contentTest.dispose());
  expect(await page.evaluate(() => window.__contentTest.violations)).toEqual([]);
});

test('drawer reopen interrupts close and disposal releases pending completion', async ({
  page,
}) => {
  await page.evaluate(() => window.__contentTest.setDrawer('wallet-iframe', false, false));
  await expect(page.locator('.seams-confirmation-drawer')).toHaveClass(/is-open/);
  await page.evaluate(() => window.__contentTest.setDrawer('wallet-iframe', true, false));
  await page.evaluate(() => window.__contentTest.setDrawer('wallet-iframe', false, false));
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__contentTest.drawerClosed)).toBe(0);
  await page.evaluate(() => window.__contentTest.setDrawer('wallet-iframe', true, false));
  await page.evaluate(() => window.__contentTest.dispose());
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__contentTest.drawerClosed)).toBe(0);
  expect(await page.evaluate(() => window.__contentTest.violations)).toEqual([]);
});

test('drawer keeps confirmation actions in view across contexts', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: 800 });
    for (const context of ['standalone', 'wallet-iframe'] as const) {
      await page.evaluate(
        (context) => window.__contentTest.setDrawer(context, false, false),
        context,
      );
      await expect(page.locator('.seams-confirmation-drawer')).toHaveClass(/is-open/);
      const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
      await expect(confirm).toBeEnabled();
      await expect(confirm).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => window.__contentTest.violations)).toEqual([]);
    }
  }
  await page.evaluate(() => window.__contentTest.dispose());
});

test('standalone modal owns focus and preserves two-phase cancellation', async ({ page }) => {
  await page.evaluate(() => {
    const opener = document.createElement('button');
    opener.id = 'modal-opener';
    opener.textContent = 'Open confirmation';
    document.body.prepend(opener);
    opener.focus();
    window.__contentTest.setModal('standalone');
  });
  const dialog = page.getByRole('dialog', { name: 'Confirm transaction' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.modal-container-root')).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__contentTest.cancelled)).toBe(1);
  await expect(dialog).toBeVisible();
  await page.evaluate(() => document.getElementById('modal-opener')!.focus());
  await expect(page.locator('#modal-opener')).not.toBeFocused();
  await dialog.getByRole('heading').click();
  expect(await page.evaluate(() => window.__contentTest.cancelled)).toBe(1);
  await page.mouse.click(1, 1);
  expect(await page.evaluate(() => window.__contentTest.cancelled)).toBe(2);
  await page.evaluate(() => window.__contentTest.dispose());
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#modal-opener')).toBeFocused();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__contentTest.cancelled)).toBe(2);
  expect(await page.evaluate(() => window.__contentTest.violations)).toEqual([]);
});

test('host pending and rejection update the email input without replacing its challenge', async ({
  page,
}) => {
  await page.evaluate(() =>
    window.__contentTest.setOtp('verification', false, { kind: 'pending' }),
  );
  const input = page.getByRole('textbox', { name: 'Email code' });
  await expect(input).toBeDisabled();
  await page.evaluate(() =>
    window.__contentTest.setOtp('verification', false, {
      kind: 'rejected',
      message: 'Incorrect code',
    }),
  );
  await expect(input).toBeEnabled();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.email-otp-confirm__error')).toHaveText('Incorrect code');
  await input.fill('123456');
  await expect
    .poll(() => page.evaluate(() => window.__contentTest.otpSubmissions))
    .toEqual(['123456']);
  await page.evaluate(() =>
    window.__contentTest.setOtp('verification', false, {
      kind: 'rejected',
      message: 'Incorrect code',
    }),
  );
  await expect(input).toBeDisabled();
});

test('resending updates the submitted challenge and recipient hint', async ({ page }) => {
  await page.evaluate(() => window.__contentTest.setOtp('original', true));
  await page.getByRole('button', { name: 'Resend code' }).click();
  await expect(page.locator('.email-otp-confirm__helper')).toContainText('r***@example.com');
  await page.getByRole('textbox', { name: 'Email code' }).fill('123456');
  await expect
    .poll(() => page.evaluate(() => window.__contentTest.otpChallenges))
    .toEqual(['resent-challenge']);
  await page.evaluate(() => window.__contentTest.dispose());
  expect(await page.evaluate(() => window.__contentTest.violations)).toEqual([]);
});

test('email code normalizes input, refuses a short code and replacement cancels a pending submit', async ({
  page,
}) => {
  await page.evaluate(() => window.__contentTest.setOtp('first'));
  const input = page.getByRole('textbox', { name: 'Email code' });
  await expect(input).toHaveAttribute('autocomplete', 'one-time-code');
  await input.fill('12a');
  await expect(input).toHaveValue('12');
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Enter the 6-digit Email OTP code.')).toBeVisible();
  expect(await page.evaluate(() => window.__contentTest.otpSubmissions)).toEqual([]);
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('.email-otp-confirm__input')!;
    input.value = '123456';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    window.__contentTest.setOtp('replacement');
  });
  await expect(input).toHaveValue('');
  await input.fill('654321');
  await expect
    .poll(() => page.evaluate(() => window.__contentTest.otpSubmissions))
    .toEqual(['654321']);
  await expect(input).toBeDisabled();
  await page.evaluate(() => window.__contentTest.dispose());
  await expect(page.locator('main > *')).toHaveCount(0);
  expect(await page.evaluate(() => window.__contentTest.violations)).toEqual([]);
});

test('initial guard, preparing cancellation and synchronous ready action', async ({ page }) => {
  expect(await page.evaluate(() => window.__contentTest.initiallyDisabled)).toBe(true);
  const confirm = page.locator('.confirm');
  await expect(confirm).toBeEnabled();
  const synchronousCount = await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('.confirm')!.click();
    return window.__contentTest.confirmed;
  });
  expect(synchronousCount).toBe(1);
  await page.evaluate(() => window.__contentTest.update(false));
  await expect(confirm).toBeDisabled();
  await expect(page.getByRole('progressbar', { name: 'Loading' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(() => window.__contentTest.cancelled)).toBe(1);
  await page.evaluate(() => window.__contentTest.update(true));
  await expect(confirm).toBeEnabled();
  await confirm.click();
  expect(await page.evaluate(() => window.__contentTest.confirmed)).toBe(2);
  await expect(page.locator('main [style]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__contentTest.violations)).toEqual([]);
});

test('registration preserves displayed identity and cancellation during creation', async ({
  page,
}) => {
  await page.evaluate(() => window.__contentTest.setRegistration(false));
  await expect(page.locator('.passkey-registration-confirm__value')).toHaveText([
    'Displayed account',
    'wallet.example',
  ]);
  await expect(page.locator('main')).not.toContainText('internal-account.testnet');
  await expect(page.locator('.seams-passkey-loading-touch-icon')).toHaveAttribute('width', '44');
  expect(
    await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>('.btn-confirm')!.click();
      return window.__contentTest.confirmed;
    }),
  ).toBe(1);
  await page.evaluate(() => window.__contentTest.setRegistration(true));
  await expect(page.getByRole('button', { name: 'Creating passkey...' })).toBeDisabled();
  await expect(page.getByRole('progressbar', { name: 'Creating passkey' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(() => window.__contentTest.cancelled)).toBe(1);
  await page.evaluate(() => window.__contentTest.dispose());
  await expect(page.locator('main > *')).toHaveCount(0);
  expect(await page.evaluate(() => window.__contentTest.violations)).toEqual([]);
});
