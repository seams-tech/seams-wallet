import { expect, test, type Page } from '@playwright/test';
import { expectKnownFault } from '../knownFault';
import {
  CONFORMANCE_AUTH_MENU_SESSION_ID,
  disposeHostedAuthMenu,
  hostedAuthMenuFrame,
  openHostedAuthMenu,
  prepareHostedAuthMenuPage,
  recordedHostEvents,
} from './hostedAuthMenu';

/**
 * The integrator contracts of the hosted auth menu, checked through the real wallet iframe: the
 * card radius from the app's theme token, the app's copy, and the host error event that carries
 * the raw error text. An app relies on each one, so the new auth menu must keep them.
 */

const SYNC_OPTIONS = '**/sync-account/options';

test.beforeEach(async ({ page }) => {
  await prepareHostedAuthMenuPage(page);
  // The discoverable login prepares an account sync first; without a stub it would reach the
  // test web server and fail with whatever that server answers.
  await failRoute(page, SYNC_OPTIONS, 502);
});

test.afterEach(async ({ page }) => {
  await disposeHostedAuthMenu(page);
});

async function failRoute(page: Page, pattern: string, status: number): Promise<void> {
  await page.unroute(pattern);
  await page.route(pattern, (route) => route.fulfill({ status, body: 'conformance failure' }));
}

function cardRadius(page: Page): Promise<string> {
  return hostedAuthMenuFrame(page)
    .locator('.auth-menu-root')
    .evaluate((card) => getComputedStyle(card).borderRadius);
}

test.describe('card radius (audit row 7.7)', () => {
  test('without an app token the card keeps the 16px default', async ({ page }) => {
    await openHostedAuthMenu(page);
    await expect.poll(() => cardRadius(page)).toBe('16px');
  });

  test("the app's shape.card token sets the card radius exactly, with no cap", async ({ page }) => {
    // 48px is above the 2rem cap that the confirmation overlay applies; the menu has no cap.
    await openHostedAuthMenu(page, { shape: { card: '48px' } });
    await expect.poll(() => cardRadius(page)).toBe('48px');
  });
});

test.describe('app copy (audit row 7.8)', () => {
  test("the login view shows the app's title and subtitle", async ({ page }) => {
    await openHostedAuthMenu(page, {
      copy: { login: { title: 'Sign in to Example', subtitle: 'Your example wallet' } },
    });
    const surface = hostedAuthMenuFrame(page).locator('.seams-auth-menu-surface');
    await expect(surface.getByText('Sign in to Example', { exact: true })).toBeVisible();
    await expect(surface.getByText('Your example wallet', { exact: true })).toBeVisible();
  });

  test("the register view shows the app's title, subtitle and wallet name label", async ({
    page,
  }) => {
    await openHostedAuthMenu(page, {
      initialMode: 'register',
      showRegistrationInput: true,
      copy: {
        register: {
          title: 'Make an Example wallet',
          subtitle: 'It takes one passkey',
          passkeyNameLabel: 'Example wallet name',
        },
      },
    });
    const surface = hostedAuthMenuFrame(page).locator('.seams-auth-menu-surface');
    await expect(surface.getByText('Make an Example wallet', { exact: true })).toBeVisible();
    await expect(surface.getByText('It takes one passkey', { exact: true })).toBeVisible();
    await expect(surface.locator('#seams-auth-menu-passkey-name')).toHaveAttribute(
      'placeholder',
      'Example wallet name',
    );
  });

  test("the card's Close control carries the app's close label", async ({ page }) => {
    await openHostedAuthMenu(page, {
      chrome: 'close',
      copy: { common: { closeLabel: 'Dismiss example' } },
    });
    await expect(
      hostedAuthMenuFrame(page).locator('[data-auth-menu-chrome="close"]'),
    ).toHaveAttribute('aria-label', 'Dismiss example');
  });

  test("the passkey button shows the app's passkeyCta", async ({ page }) => {
    expectKnownFault(
      '7.8',
      'the passkey button shows a fixed label for each mode (passkeyButtonLabel); the app ' +
        'passkeyCta reaches the view model as ctaLabel but is never rendered',
    );
    await openHostedAuthMenu(page, { copy: { login: { passkeyCta: 'Use my Example passkey' } } });
    await expect(hostedAuthMenuFrame(page).locator('[data-auth-menu-primary]')).toHaveText(
      'Use my Example passkey',
      { timeout: 5_000 },
    );
  });
});

test.describe('host error event (audit rows 7.9 and 8.2)', () => {
  test('a passkey view failure sends its raw text once for each change, on the anchor', async ({
    page,
  }) => {
    await openHostedAuthMenu(page);
    const surface = hostedAuthMenuFrame(page).locator('.seams-auth-menu-surface');
    // The card shows a plain sentence; the host event carries the raw text behind it.
    await expect(surface.getByText('Can’t reach Seams right now.').first()).toBeVisible();
    await expect.poll(() => recordedHostEvents(page)).toHaveLength(1);

    await failRoute(page, SYNC_OPTIONS, 429);
    await surface.getByRole('button', { name: 'Try again' }).click();
    await expect(surface.getByText('Too many attempts. Wait a moment.').first()).toBeVisible();
    await expect.poll(() => recordedHostEvents(page)).toHaveLength(2);

    expect(await recordedHostEvents(page)).toEqual(
      [502, 429].map((status) => ({
        detail: {
          kind: 'hosted_auth_menu_error_v1',
          authMenuSessionId: CONFORMANCE_AUTH_MENU_SESSION_ID,
          mode: 'login',
          message: `sync-account/options failed (HTTP ${status})`,
        },
        bubbles: true,
        composed: true,
        targetIsAnchor: true,
      })),
    );
  });

  test('a link view failure sends its raw text to the host', async ({ page }) => {
    expectKnownFault(
      '8.2',
      'the link view reports no host event: presentedAuthMenuError returns null for ' +
        "'link_device' (auth-menu/session.ts:544)",
    );
    await failRoute(page, '**/wallet/device-linking/**', 502);
    await openHostedAuthMenu(page);
    const surface = hostedAuthMenuFrame(page).locator('.seams-auth-menu-surface');
    await expect.poll(() => recordedHostEvents(page)).toHaveLength(1);
    await surface.getByText('Recover or link wallet').click();
    await surface.getByRole('button', { name: /Link this device/ }).click();
    await surface.getByRole('button', { name: 'Continue' }).click();
    // The link view shows the raw text on purpose.
    await expect(surface.getByText('linked-device request failed with HTTP 502')).toBeVisible();
    await expect
      .poll(async () => (await recordedHostEvents(page)).map((event) => event.detail), {
        timeout: 3_000,
      })
      .toContainEqual(
        expect.objectContaining({ message: 'linked-device request failed with HTTP 502' }),
      );
  });
});
