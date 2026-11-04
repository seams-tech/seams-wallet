import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { injectImportMap } from '../setup/bootstrap';
import { authBranchFixtures, registration, googleOtp } from './auth-menu-fixtures';
import { mountAuthMenu, prepareAuthMenuDocument } from './auth-menu.harness';
import type { AuthMenuIntent } from '@/SeamsWeb/walletIframe/host/auth-menu/domain';
import type {
  MountedConfirmUIHandle,
  ConfirmUISurfaceDecision,
} from '@/core/signingEngine/uiConfirm/ui/confirm-ui-types';

declare global {
  interface Window {
    __authBrowser: {
      intents: AuthMenuIntent[];
      activated: boolean[];
      confirmation: MountedConfirmUIHandle | null;
      confirmationDecision: Promise<ConfirmUISurfaceDecision> | null;
    };
  }
}

test.beforeEach(async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('Browser test origin is required');
  await injectImportMap(page, { frontendUrl: baseURL });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await prepareAuthMenuDocument(page);
  await page.evaluate(() => {
    const trigger = document.createElement('button');
    trigger.id = 'auth-trigger';
    trigger.textContent = 'Open wallet';
    document.body.appendChild(trigger);
    trigger.focus();
    const parent = document.createElement('div');
    parent.id = 'test-root';
    parent.style.width = '360px';
    document.body.appendChild(parent);
    window.__authBrowser = {
      intents: [],
      activated: [],
      confirmation: null,
      confirmationDecision: null,
    };
  });
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    window.__authBrowser.confirmation?.close(false);
    window.__authMenu?.handle.dispose();
  });
});

for (const variant of ['modal', 'drawer'] as const) {
  test(`auth-to-confirm-to-auth renderer handoff preserves ${variant} decisions and cleanup`, async ({
    page,
  }) => {
    await page.evaluate(() => {
      Object.assign(window, {
        __SEAMS_WALLET_SDK_BASE__: window.location.origin + '/_test-sdk/esm/sdk/',
      });
    });
    for (const confirmed of [false, true]) {
      await mountAuthMenu(page, registration('dark'));
      await expect(page.locator('[data-auth-menu-input]')).toBeFocused();
      await page.evaluate(async (variant) => {
        window.__authMenu.handle.dispose();
        const module = await import('/_test-sdk/esm/sdk/tx-confirm-ui.js');
        const mountConfirmUI: typeof import('@/core/signingEngine/uiConfirm/ui/confirm-ui').mountConfirmUI =
          module.mountConfirmUI;
        const handle = await mountConfirmUI({
          ctx: {
            surfaceMeasurementBinding: { kind: 'disabled' },
          },
          summary: { title: 'Synthetic handoff transaction' },
          model: { chain: 'tempo', title: 'Synthetic handoff transaction', operations: [] },
          uiMode: variant,
          theme: 'light',
          loading: false,
        });
        handle.update({ confirmText: 'Approve handoff', cancelText: 'Cancel handoff' });
        window.__authBrowser.confirmation = handle;
        window.__authBrowser.confirmationDecision = handle.takeDecision();
      }, variant);
      await expect(page.locator('.seams-auth-menu-surface')).toHaveCount(0);
      // The drawer has no review toolbar: its own Close control cancels.
      const cancelName = variant === 'drawer' ? 'Close' : 'Cancel handoff';
      await page
        .getByRole('button', {
          name: confirmed ? 'Approve handoff' : cancelName,
          exact: true,
        })
        .click();
      const decision = await page.evaluate(() => window.__authBrowser.confirmationDecision);
      expect(decision?.kind).toBe(confirmed ? 'confirmed' : 'cancelled');
      await page.evaluate((confirmed) => {
        window.__authBrowser.confirmation?.close(confirmed);
        window.__authBrowser.confirmation = null;
        window.__authBrowser.confirmationDecision = null;
      }, confirmed);
      await expect(page.locator('.seams-confirmation-surface')).toHaveCount(0);
      const returnFocus = await page.evaluateHandle(() => document.activeElement);
      await mountAuthMenu(page, registration('light'));
      await expect(page.locator('[data-auth-menu-input]')).toHaveValue('Visual fixture');
      await expect(page.locator('[data-auth-menu-input]')).toBeFocused();
      await expect(page.locator('.seams-auth-menu-surface')).toHaveCount(1);
      await page.evaluate(() => window.__authMenu.handle.dispose());
      expect(
        await page.evaluate((element) => document.activeElement === element, returnFocus),
      ).toBe(true);
      await returnFocus.dispose();
    }
  });
}

test('auth renders every branch and preserves keyboard intent, activation, and focus cleanup', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const initial = registration('light');
  await mountAuthMenu(page, initial);
  await page.evaluate(() => {
    window.__authMenu.onIntent = (intent) => {
      window.__authBrowser.intents.push(intent);
      window.__authBrowser.activated.push(navigator.userActivation.isActive);
    };
  });
  await expect(page.locator('[data-auth-menu-input]')).toBeFocused();
  await page.locator('[data-auth-menu-primary]').press('Enter');
  expect(await page.evaluate(() => window.__authBrowser.intents.at(-1))).toEqual({
    kind: 'submit',
    mode: 'register',
    passkeyName: initial.passkeyName,
  });
  expect(await page.evaluate(() => window.__authBrowser.activated.at(-1))).toBe(true);
  for (const theme of ['light', 'dark'] as const) {
    for (const fixture of authBranchFixtures(theme)) {
      await page.evaluate((model) => window.__authMenu.handle.update(model), fixture.model);
      await expect(page.locator('.seams-auth-menu-surface')).toHaveCount(1);
      await expect(page.locator('.seams-content-sizer')).toBeVisible();
    }
  }
  await page.evaluate((model) => window.__authMenu.handle.update(model), initial);
  await page.locator('[data-auth-menu-input]').focus();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__authBrowser.intents.at(-1))).toEqual({
    kind: 'close',
    reason: 'escape',
  });
  await page.evaluate(() => window.__authMenu.handle.dispose());
  await expect(page.locator('#auth-trigger')).toBeFocused();
  const count = await page.evaluate(() => window.__authBrowser.intents.length);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__authBrowser.intents.length)).toBe(count);
  expect(errors).toEqual([]);
});

test('Tab and Shift+Tab keep keyboard focus inside the open auth menu', async ({ page }) => {
  await mountAuthMenu(page, registration('light'));
  const controls = page.locator(
    '.seams-auth-menu-surface button:not([disabled]), .seams-auth-menu-surface input:not([disabled]), .seams-auth-menu-surface a[href]',
  );
  await controls.last().focus();
  await page.keyboard.press('Tab');
  await expect(controls.first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(controls.last()).toBeFocused();
});

function recordAuthIntents() {
  window.__authMenu.onIntent = window.__authBrowser.intents.push.bind(window.__authBrowser.intents);
}

function updateOtpView(model: ReturnType<typeof googleOtp>) {
  window.__authMenu.handle.update(model);
}

function readAuthIntents() {
  return window.__authBrowser.intents;
}

test('hosted demo email codes follow delivery replacement without automatic submission', async ({
  page,
}, testInfo) => {
  await mountAuthMenu(
    page,
    googleOtp('dark', {
      kind: 'demo_code_response',
      status: 'sent',
      emailHint: 'f***@example.test',
      otpCode: '654321',
    }),
  );
  await page.evaluate(recordAuthIntents);
  await expect(page.getByText('Demo email code: 654321')).toBeVisible();
  expect(await page.evaluate(readAuthIntents)).toEqual([]);
  await page.evaluate(
    updateOtpView,
    googleOtp('dark', {
      kind: 'provider_and_demo_code',
      status: 'reused',
      emailHint: 'f***@example.test',
      otpCode: '456789',
    }),
  );
  await expect(page.getByText('Demo email code: 456789')).toBeVisible();
  await expect(page.getByText('Demo email code: 654321')).toHaveCount(0);
  await page.locator('#seams-auth-menu-google-otp').fill('456789');
  const intents = await page.evaluate(readAuthIntents);
  expect(intents).toContainEqual({ kind: 'google_otp_code_changed', code: '456789' });
  await page.evaluate(
    updateOtpView,
    googleOtp('dark', { kind: 'provider', status: 'sent', emailHint: 'f***@example.test' }),
  );
  await expect(page.getByText('Demo email code:', { exact: false })).toHaveCount(0);
  await expect(page.getByText('A 6-digit code was sent to f***@example.test.')).toBeVisible();
  await writeFile(
    testInfo.outputPath('demo-email-delivery.json'),
    JSON.stringify(
      {
        deliveryBranches: ['demo_code_response', 'provider_and_demo_code', 'provider'],
        replacementRemovedPreviousCode: true,
        providerDeliveryHidesCode: true,
        intents,
      },
      null,
      2,
    ),
  );
});
