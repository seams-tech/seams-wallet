import { expect, test, type Page } from '@playwright/test';
import type { WalletIframeRouter } from '@/SeamsWeb/walletIframe/client/router';
import type { HostedAuthMenuOutcome } from '@/SeamsWeb/walletIframe/shared/messages';
import { buildWalletServiceHtml } from '@/plugins/plugin-utils';
import { setupBasicPasskeyTest } from '../setup';
import { injectImportMap } from '../setup/bootstrap';
import { registerWalletServiceRoute } from './harness';

const WALLET_ORIGIN = 'https://wallet.example.localhost';
const WALLET_SERVICE_ROUTE = '**://wallet.example.localhost/wallet-service*';

type AuthMenuTestWindow = Window & {
  __authMenuHostTestRouter?: WalletIframeRouter;
  __authMenuHostTestOutcome?: Promise<
    HostedAuthMenuOutcome | { kind: 'test_error'; message: string }
  >;
};

async function openTestAuthMenu(page: Page): Promise<void> {
  await page.evaluate(
    async ({ walletOrigin }) => {
      const { WalletIframeRouter } =
        await import('/_test-sdk/esm/SeamsWeb/walletIframe/client/router.js');
      const { buildHostedAuthMenuOpenRequest } =
        await import('/_test-sdk/esm/SeamsWeb/walletIframe/shared/messages.js');
      const router = new WalletIframeRouter({
        walletOrigin,
        servicePath: '/wallet-service',
        sdkBasePath: '/sdk',
        relayer: { url: window.location.origin },
        registration: { projectEnvironmentId: 'proj_local:test', publishableKey: 'pk_local' },
        testOptions: { ownerTag: 'auth-menu-host-test' },
      });
      const request = buildHostedAuthMenuOpenRequest({
        authMenuSessionId: 'auth-menu-host-test-session',
        initialMode: 'login',
        registrationAccountInput: 'implicit_wallet',
        showRegistrationInput: false,
        showProgress: true,
        enabledExternalProviders: [],
      });
      const testWindow = window as AuthMenuTestWindow;
      testWindow.__authMenuHostTestRouter = router;
      testWindow.__authMenuHostTestOutcome = router
        .openHostedAuthMenu(request)
        .catch((error: unknown) => ({
          kind: 'test_error' as const,
          message: String(error),
        }));
    },
    { walletOrigin: WALLET_ORIGIN },
  );
}

const HOST_HTML = buildWalletServiceHtml('/_test-sdk/esm/sdk');

test.describe('wallet-host auth-menu integration', () => {
  test.beforeEach(async ({ page }) => {
    await setupBasicPasskeyTest(page, {
      skipSeamsWebInit: true,
      injectWalletServiceImportMap: true,
    });
    await page.goto('about:blank');
    await injectImportMap(page);
    await registerWalletServiceRoute(page, HOST_HTML, WALLET_SERVICE_ROUTE);
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      (window as AuthMenuTestWindow).__authMenuHostTestRouter?.dispose();
    });
    await page.unroute(WALLET_SERVICE_ROUTE).catch(() => {});
  });

  test('mounts one compact wallet-origin surface', async ({ page }) => {
    await openTestAuthMenu(page);

    const surface = page
      .frameLocator('iframe[data-seams-owner="auth-menu-host-test"]')
      .locator('.seams-auth-menu-surface');
    await expect(surface).toHaveCount(1);
    await expect(page.locator('.seams-auth-menu-surface')).toHaveCount(0);
    const dialog = page.locator('dialog.seams-wallet-overlay-dialog');
    await expect(dialog).not.toHaveClass(/is-viewport-fallback/);
    const dialogBox = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(dialogBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(dialogBox!.width).toBeLessThan(viewport!.width);
    expect(dialogBox!.height).toBeLessThan(viewport!.height);

    await page.evaluate(() => {
      const testWindow = window as typeof window & {
        __authMenuHostTestRouter?: { dispose: () => void };
      };
      testWindow.__authMenuHostTestRouter?.dispose();
      delete testWindow.__authMenuHostTestRouter;
    });
  });

  test('disposing during a delayed auth import settles the request and removes the surface', async ({
    page,
  }) => {
    let releaseImport!: () => void;
    const importGate = new Promise<void>((resolve) => {
      releaseImport = resolve;
    });
    const authModule = /\/runtime-auth-[^/]+\.js(?:\?.*)?$/;
    await page.route(authModule, async (route) => {
      await importGate;
      // The iframe request can already be aborted by disposal.
      await route.continue().catch(() => {});
    });
    const requestedImport = page.waitForRequest(authModule);
    try {
      await openTestAuthMenu(page);
      await requestedImport;
      const outcome = await page.evaluate(async () => {
        const testWindow = window as AuthMenuTestWindow;
        if (!testWindow.__authMenuHostTestRouter || !testWindow.__authMenuHostTestOutcome) {
          throw new Error('Auth menu test was not initialized');
        }
        testWindow.__authMenuHostTestRouter.dispose();
        testWindow.__authMenuHostTestRouter.dispose();
        return await testWindow.__authMenuHostTestOutcome;
      });
      expect(outcome).toEqual({
        kind: 'cancelled',
        authMenuSessionId: 'auth-menu-host-test-session',
        reason: 'connection_closed',
      });
      releaseImport();
      await page.unroute(authModule);
      await expect(page.locator('iframe[data-seams-owner="auth-menu-host-test"]')).toHaveCount(0);
      await expect(page.locator('dialog.seams-wallet-overlay-dialog')).toHaveCount(0);
    } finally {
      releaseImport();
    }
  });

  test('cancellation during a delayed auth import does not reopen the surface', async ({
    page,
  }) => {
    let releaseImport!: () => void;
    const importGate = new Promise<void>((resolve) => {
      releaseImport = resolve;
    });
    const authModule = /\/runtime-auth-[^/]+\.js(?:\?.*)?$/;
    await page.route(authModule, async (route) => {
      await importGate;
      await route.fallback();
    });
    const requestedImport = page.waitForRequest(authModule);
    try {
      await openTestAuthMenu(page);
      const request = await requestedImport;
      const outcome = await page.evaluate(async () => {
        const { hostedAuthMenuSessionIdFromBoundary } =
          await import('/_test-sdk/esm/SeamsWeb/walletIframe/shared/messages.js');
        const testWindow = window as AuthMenuTestWindow;
        const router = testWindow.__authMenuHostTestRouter;
        if (!router || !testWindow.__authMenuHostTestOutcome)
          throw new Error('Auth menu test was not initialized');
        const authMenuSessionId = hostedAuthMenuSessionIdFromBoundary(
          'auth-menu-host-test-session',
        );
        if (!authMenuSessionId) throw new Error('Invalid test session identity');
        await router.cancelHostedAuthMenu({ authMenuSessionId });
        await router.cancelHostedAuthMenu({ authMenuSessionId });
        return await testWindow.__authMenuHostTestOutcome;
      });
      expect(outcome).toEqual({
        kind: 'test_error',
        message: 'Error: Hosted auth-menu cancelled: component_unmounted',
      });
      releaseImport();
      const frame = page.frames().find((candidate) => candidate.url().startsWith(WALLET_ORIGIN));
      if (!frame) throw new Error('Wallet frame disappeared during cancellation');
      await frame.evaluate(async (url) => {
        await import(url);
      }, request.url());
      await expect(frame.locator('.seams-auth-menu-surface')).toHaveCount(0);
      await expect(page.locator('dialog.seams-wallet-overlay-dialog')).not.toBeVisible();
    } finally {
      releaseImport();
      await page.evaluate(() => {
        (window as AuthMenuTestWindow).__authMenuHostTestRouter?.dispose();
      });
    }
  });

  test('a failed auth module settles the pending request without mounting a surface', async ({
    page,
  }) => {
    await page.route(/\/runtime-auth-[^/]+\.js(?:\?.*)?$/, (route) => route.abort('failed'));
    await openTestAuthMenu(page);
    const outcome = await page.evaluate(
      () => (window as AuthMenuTestWindow).__authMenuHostTestOutcome,
    );
    expect(outcome?.kind).toBe('test_error');
    const surface = page
      .frameLocator('iframe[data-seams-owner="auth-menu-host-test"]')
      .locator('.seams-auth-menu-surface');
    await expect(surface).toHaveCount(0);
    await expect(page.locator('dialog.seams-wallet-overlay-dialog')).not.toBeVisible();
    await page.evaluate(() => {
      (window as AuthMenuTestWindow).__authMenuHostTestRouter?.dispose();
    });
  });

  test('waits for document-owned auth CSS before mounting the prompt', async ({ page }) => {
    let releaseStyles!: () => void;
    const stylesGate = new Promise<void>((resolve) => {
      releaseStyles = resolve;
    });
    const stylesheet = /\/auth-menu\.css(?:\?.*)?$/;
    await page.route(stylesheet, async (route) => {
      await stylesGate;
      await route.fallback();
    });
    const requestedStyles = page.waitForRequest(stylesheet);
    try {
      await openTestAuthMenu(page);
      await requestedStyles;
      const surface = page
        .frameLocator('iframe[data-seams-owner="auth-menu-host-test"]')
        .locator('.seams-auth-menu-surface');
      await expect(surface).toHaveCount(0);
      await expect(page.locator('dialog.seams-wallet-overlay-dialog')).not.toBeVisible();
      releaseStyles();
      await expect(surface).toBeVisible();
    } finally {
      releaseStyles();
      await page.evaluate(() => {
        (window as AuthMenuTestWindow).__authMenuHostTestRouter?.dispose();
      });
    }
  });

  for (const stylesheet of ['auth-menu.css', 'seams-components.css']) {
    test(`failed ${stylesheet} settles auth without an unstyled prompt`, async ({ page }) => {
      await page.route(`**/${stylesheet}*`, (route) => route.abort('failed'));
      await openTestAuthMenu(page);
      await expect
        .poll(
          async () =>
            page.evaluate(() =>
              Promise.race([
                (window as AuthMenuTestWindow).__authMenuHostTestOutcome?.then(() => 'settled'),
                new Promise((resolve) => setTimeout(resolve, 10, 'pending')),
              ]),
            ),
          { timeout: 10_000 },
        )
        .toBe('settled');
      const outcome = await page.evaluate(
        () => (window as AuthMenuTestWindow).__authMenuHostTestOutcome,
      );
      expect(outcome).toEqual({
        kind: 'test_error',
        message: expect.stringContaining('Wallet auth-menu stylesheet unavailable'),
      });
      await expect(
        page
          .frameLocator('iframe[data-seams-owner="auth-menu-host-test"]')
          .locator('.seams-auth-menu-surface'),
      ).toHaveCount(0);
      await expect(page.locator('dialog.seams-wallet-overlay-dialog')).not.toBeVisible();
      await page.evaluate(() => {
        (window as AuthMenuTestWindow).__authMenuHostTestRouter?.dispose();
      });
    });
  }

  test('renders auth under strict style CSP without violations or duplicate stylesheet links', async ({
    page,
  }) => {
    const violations: string[] = [];
    await page.exposeFunction('recordAuthCspViolation', (directive: string) => {
      violations.push(directive);
    });
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        const report = (
          window as typeof window & { recordAuthCspViolation: (directive: string) => void }
        ).recordAuthCspViolation;
        report(event.violatedDirective);
      });
    });
    await page.route(WALLET_SERVICE_ROUTE, (route) =>
      route.fulfill({
        status: 200,
        headers: {
          'content-type': 'text/html',
          'cross-origin-resource-policy': 'cross-origin',
          'content-security-policy': "style-src 'self'; style-src-attr 'none'",
        },
        body: HOST_HTML,
      }),
    );
    await openTestAuthMenu(page);
    const frame = page.frameLocator('iframe[data-seams-owner="auth-menu-host-test"]');
    await expect(frame.locator('.seams-auth-menu-surface')).toBeVisible();
    await expect(frame.locator('link[data-seams-auth-menu-css]')).toHaveCount(1);
    expect(violations).toEqual([]);
    await page.evaluate(() => {
      (window as AuthMenuTestWindow).__authMenuHostTestRouter?.dispose();
    });
  });
});
