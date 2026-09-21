import { expect, test } from '@playwright/test';
import { injectImportMap } from '../setup/bootstrap';
import { authBranchFixtures, registration } from './auth-menu-fixtures';
import { mountAuthMenu, prepareAuthMenuDocument } from './auth-menu.harness';
import type { AuthMenuIntent } from '@/SeamsWeb/walletIframe/host/auth-menu/domain';
import type { WalletIframeSurfaceMeasurement } from '@/SeamsWeb/walletIframe/shared/messages';
import type { WalletIframeSurfaceMeasurementReporter } from '@/SeamsWeb/walletIframe/host/surface-measurement-reporter';
import type {
  MountedConfirmUIHandle,
  ConfirmUISurfaceDecision,
} from '@/core/signingEngine/uiConfirm/ui/confirm-ui-types';

declare global {
  interface Window {
    __authBrowser: {
      intents: AuthMenuIntent[];
      activated: boolean[];
      measurements: WalletIframeSurfaceMeasurement[];
      reporter: WalletIframeSurfaceMeasurementReporter | null;
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
      measurements: [],
      reporter: null,
      confirmation: null,
      confirmationDecision: null,
    };
  });
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    window.__authBrowser.reporter?.disconnect();
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
        const module = await import('/_test-sdk/esm/core/signingEngine/uiConfirm/ui/confirm-ui.js');
        const mountConfirmUI: typeof import('@/core/signingEngine/uiConfirm/ui/confirm-ui').mountConfirmUI =
          module.mountConfirmUI;
        const handle = await mountConfirmUI({
          ctx: {
            userPreferencesManager: { getCurrentWalletId: () => null },
            surfaceMeasurementBinding: { kind: 'disabled' },
          },
          summary: { title: 'Synthetic handoff transaction' },
          model: { chain: 'tempo', title: 'Synthetic handoff transaction', operations: [] },
          uiMode: variant,
          theme: 'light',
          loading: false,
          nearAccountIdOverride: 'visual-fixture.testnet',
        });
        handle.update({ confirmText: 'Approve handoff', cancelText: 'Cancel handoff' });
        window.__authBrowser.confirmation = handle;
        window.__authBrowser.confirmationDecision = handle.takeDecision();
      }, variant);
      await expect(page.locator('.seams-auth-menu-surface')).toHaveCount(0);
      await page
        .getByRole('button', {
          name: confirmed ? 'Approve handoff' : 'Cancel handoff',
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

test('auth measurements follow normal-motion updates and stop after disposal', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await mountAuthMenu(page, registration('light'));
  await page.evaluate(async () => {
    const { createWalletIframeSurfaceMeasurementReporter } =
      await import('/_test-sdk/esm/SeamsWeb/walletIframe/host/surface-measurement-reporter.js');
    const { walletIframeRequestIdFromBoundary } =
      await import('/_test-sdk/esm/core/types/walletIframeIdentity.js');
    const { buildHostedAuthMenuOpenRequest } =
      await import('/_test-sdk/esm/SeamsWeb/walletIframe/shared/messages.js');
    const request = buildHostedAuthMenuOpenRequest({
      authMenuSessionId: 'browser-measurement',
      initialMode: 'login',
      registrationAccountInput: 'implicit_wallet',
      showRegistrationInput: false,
      showProgress: true,
      enabledExternalProviders: [],
    });
    window.__authBrowser.reporter = createWalletIframeSurfaceMeasurementReporter({
      kind: 'auth_menu_surface',
      element: window.__authMenu.handle.element,
      requestId: walletIframeRequestIdFromBoundary('browser-measurement'),
      authMenuSessionId: request.authMenuSessionId,
      postMeasurement: (measurement: WalletIframeSurfaceMeasurement) =>
        window.__authBrowser.measurements.push(measurement),
    });
  });
  for (const name of ['device-loading', 'device-factor-passkey', 'recovery-email-code']) {
    const fixture = authBranchFixtures('light').find((entry) => entry.name === name);
    if (!fixture) throw new Error('Missing auth fixture: ' + name);
    await page.evaluate((model) => window.__authMenu.handle.update(model), fixture.model);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.effect?.getComputedTiming().iterations !== Infinity &&
                  animation.playState === 'running',
              ).length,
        ),
      )
      .toBe(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const measured = window.__authBrowser.measurements.at(-1);
          const rect = window.__authMenu.handle.element.getBoundingClientRect();
          return (
            measured?.widthCssPx === Math.round(rect.width) &&
            measured.heightCssPx === Math.round(rect.height)
          );
        }),
      )
      .toBe(true);
  }
  const measurements = await page.evaluate(() => window.__authBrowser.measurements);
  expect(measurements.length).toBeGreaterThan(3);
  expect(new Set(measurements.map((measurement) => measurement.heightCssPx)).size).toBeGreaterThan(
    2,
  );
  for (let index = 1; index < measurements.length; index++) {
    expect(measurements[index].sequence).toBeGreaterThan(measurements[index - 1].sequence);
  }
  await page.evaluate(() => {
    window.__authBrowser.reporter?.disconnect();
    window.__authMenu.handle.dispose();
    window.dispatchEvent(new Event('resize'));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => window.__authBrowser.measurements.length)).toBe(
    measurements.length,
  );
});

test('recovery announcements remain accessible without consuming control space', async ({
  page,
}) => {
  const recoveryFixture = authBranchFixtures('light').find(
    (fixture) => fixture.name === 'recovery-entry',
  );
  if (!recoveryFixture) throw new Error('Missing recovery-entry fixture');
  await mountAuthMenu(page, recoveryFixture.model);
  const initialAnnouncement = await page.locator('.sr-only[role="status"]').elementHandle();
  if (!initialAnnouncement) throw new Error('Missing initial recovery announcement region');
  await expect(page.locator('.sr-only[role="status"]')).toHaveText('');
  for (const fixture of authBranchFixtures('light')) {
    if (fixture.model.kind !== 'recovery') continue;
    await page.evaluate((model) => window.__authMenu.handle.update(model), fixture.model);
    const announcement = page.locator('.sr-only[role="status"]');
    await expect(announcement).toHaveCSS('position', 'absolute');
    await expect(announcement).toHaveCSS('width', '1px');
    await expect(announcement).toHaveCSS('height', '1px');
    await expect(announcement).not.toHaveCSS('display', 'none');
    await expect(announcement).not.toHaveCSS('visibility', 'hidden');
    await expect(announcement).toHaveAttribute('aria-live', 'polite');
    expect(await page.evaluate(element => document.querySelector('.sr-only[role="status"]') === element, initialAnnouncement)).toBe(true);
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const switcher = document.querySelector('.seams-content-switcher');
            if (!switcher) throw new Error('Missing auth content switcher');
            const bounds = switcher.getBoundingClientRect();
            return Array.from(switcher.querySelectorAll('[data-auth-menu-primary]')).every(
              (control) => {
                const box = control.getBoundingClientRect();
                return box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1;
              },
            );
          }),
        { message: fixture.name + ' primary controls fit inside the measured content' },
      )
      .toBe(true);
  }
  await initialAnnouncement.dispose();
});
