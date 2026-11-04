import { expect, test, type Page } from '@playwright/test';
import type { HostedAuthMenuOpenRequest } from '@/SeamsWeb/walletIframe/shared/messages';
import { setupBasicPasskeyTest } from '../setup';
import { buildWalletServiceHtml, registerWalletServiceRoute } from './harness';

const WALLET_ORIGIN = 'https://wallet.example.localhost';
const WALLET_SERVICE_ROUTE = '**://wallet.example.localhost/wallet-service*';
const OWNER_TAG = 'compact-surface-test';

type SurfaceMeasurementPayload = Record<string, unknown>;

/**
 * The wallet-host harness owns the MessagePort, so tests route synthetic
 * measurements through the child window and into that port. Tracking the
 * current open lets assertions use real request IDs.
 */
const SURFACE_MEASUREMENT_HARNESS_SCRIPT = String.raw`
      let currentSurface = null;
      const originalAdoptPort = adoptPort;
      adoptPort = function patchedAdoptPort(port) {
        originalAdoptPort(port);
        if (!adoptedPort) return;
        const originalHandler = adoptedPort.onmessage;
        adoptedPort.onmessage = (event) => {
          originalHandler?.(event);
          const message = event.data || {};
          if (!message || typeof message !== 'object') return;
          if (message.type !== 'PM_OPEN_AUTH_MENU' || typeof message.requestId !== 'string') return;
          currentSurface = {
            requestId: message.requestId,
            authMenuSessionId: message.payload?.authMenuSessionId,
          };
          window.parent?.postMessage({ type: 'TEST_SURFACE_OPEN', ...currentSurface }, '*');
        };
      };

      const markerValue = (value, field) => {
        if (value === '__current__') return currentSurface?.[field];
        return value;
      };

      window.addEventListener('message', (event) => {
        const data = event.data || {};
        if (!data || typeof data !== 'object') return;
        if (data.type === 'TEST_POST_SURFACE_MEASUREMENT') {
          if (!adoptedPort) return;
          const rawPayload = data.payload;
          const payload = rawPayload && typeof rawPayload === 'object'
            ? { ...rawPayload }
            : rawPayload;
          if (payload && typeof payload === 'object') {
            payload.requestId = markerValue(payload.requestId, 'requestId');
            payload.authMenuSessionId = markerValue(
              payload.authMenuSessionId,
              'authMenuSessionId',
            );
          }
          adoptedPort.postMessage({ type: 'SURFACE_MEASUREMENT', payload });
        }
      });
`;

type TestWindow = Window & {
  __compactSurfaceRouter?: {
    init: () => Promise<void>;
    dispose: () => void;
    getOverlayState: () => { visible: boolean };
    openHostedAuthMenu: (
      request: HostedAuthMenuOpenRequest,
      anchorElement?: HTMLElement,
    ) => Promise<unknown>;
  };
  __compactSurfaceOpen?: {
    requestId: string;
    authMenuSessionId: string;
  };
  __compactSurfaceMessageListenerInstalled?: boolean;
};

type StartHostedAuthMenuOptions = {
  anchorInFlow?: boolean;
};

async function startHostedAuthMenu(
  page: Page,
  sessionId: string,
  options: StartHostedAuthMenuOptions = {},
) {
  await page.evaluate(
    async ({ walletOrigin, ownerTag, sessionId, anchorInFlow }) => {
      const testWindow = window as TestWindow;
      if (!testWindow.__compactSurfaceMessageListenerInstalled) {
        window.addEventListener('message', (event) => {
          if (event.data?.type !== 'TEST_SURFACE_OPEN') return;
          testWindow.__compactSurfaceOpen = {
            requestId: String(event.data.requestId),
            authMenuSessionId: String(event.data.authMenuSessionId),
          };
        });
        testWindow.__compactSurfaceMessageListenerInstalled = true;
      }

      let router = testWindow.__compactSurfaceRouter;
      if (!router) {
        const routerModule = await import('/_test-sdk/esm/SeamsWeb/walletIframe/client/router.js');
        const newRouter = new routerModule.WalletIframeRouter({
          hostConfig: (window as any).__SEAMS_TEST_HOST_CONFIG__,
          walletOrigin,
          servicePath: '/wallet-service',
          sdkBasePath: '/sdk',
          requestTimeoutMs: 10_000,
          testOptions: { ownerTag },
        });
        await newRouter.init();
        router = newRouter;
        testWindow.__compactSurfaceRouter = newRouter;
      } else {
        await router.init();
      }
      if (!router) throw new Error('Wallet router was not initialized');

      const messages = await import('/_test-sdk/esm/SeamsWeb/walletIframe/shared/messages.js');
      const request = messages.buildHostedAuthMenuOpenRequest({
        authMenuSessionId: sessionId,
        initialMode: 'login',
        registrationAccountInput: 'implicit_wallet',
        showRegistrationInput: false,
        showProgress: true,
        enabledExternalProviders: [],
      });
      let anchorElement: HTMLElement | undefined;
      if (anchorInFlow) {
        const spacer = document.createElement('div');
        spacer.style.height = '1200px';
        document.body.appendChild(spacer);
        anchorElement = document.createElement('div');
        anchorElement.dataset.testAuthMenuAnchor = 'true';
        anchorElement.style.width = '420px';
        anchorElement.style.height = '430px';
        document.body.appendChild(anchorElement);
        const tail = document.createElement('div');
        tail.style.height = '1200px';
        document.body.appendChild(tail);
      }
      void router.openHostedAuthMenu(request, anchorElement).catch(() => undefined);
    },
    {
      walletOrigin: WALLET_ORIGIN,
      ownerTag: OWNER_TAG,
      sessionId,
      anchorInFlow: options.anchorInFlow,
    },
  );

  await page.waitForFunction(
    ({ sessionId }) => {
      const testWindow = window as TestWindow;
      return testWindow.__compactSurfaceOpen?.authMenuSessionId === sessionId;
    },
    { sessionId },
  );
  await page.waitForFunction(() => {
    const testWindow = window as TestWindow;
    return testWindow.__compactSurfaceRouter?.getOverlayState().visible === true;
  });
}

async function readDialogGeometry(page: Page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('dialog.seams-wallet-overlay-dialog');
    if (!(dialog instanceof HTMLDialogElement)) throw new Error('wallet overlay dialog missing');
    const rect = dialog.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
    };
  });
}

async function waitForDialogGeometry(
  page: Page,
  expected: { width: number; height: number },
): Promise<void> {
  await page.waitForFunction(
    ({ expected }) => {
      const dialog = document.querySelector('dialog.seams-wallet-overlay-dialog');
      if (!(dialog instanceof HTMLDialogElement)) return false;
      const rect = dialog.getBoundingClientRect();
      return (
        Math.abs(rect.width - expected.width) < 1 && Math.abs(rect.height - expected.height) < 1
      );
    },
    { expected },
  );
}

async function waitForMeasuredDialog(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const dialog = document.querySelector('dialog.seams-wallet-overlay-dialog');
    return dialog instanceof HTMLDialogElement && !dialog.classList.contains('is-provisional');
  });
}

async function postSurfaceMeasurement(
  page: Page,
  payload: SurfaceMeasurementPayload,
): Promise<void> {
  await page.evaluate(
    ({ walletOrigin, ownerTag, payload }) => {
      const iframe = document.querySelector(
        `iframe[data-seams-owner="${ownerTag}"]`,
      ) as HTMLIFrameElement | null;
      if (!iframe?.contentWindow) throw new Error('wallet iframe missing');
      iframe.contentWindow.postMessage(
        { type: 'TEST_POST_SURFACE_MEASUREMENT', payload },
        walletOrigin,
      );
    },
    { walletOrigin: WALLET_ORIGIN, ownerTag: OWNER_TAG, payload },
  );
}

test.describe('wallet iframe compact surface measurement routing', () => {
  test.beforeEach(async ({ page }) => {
    await setupBasicPasskeyTest(page, {
      skipSeamsWebInit: true,
      injectWalletServiceImportMap: true,
    });
    await registerWalletServiceRoute(
      page,
      buildWalletServiceHtml({ extraScript: SURFACE_MEASUREMENT_HARNESS_SCRIPT }),
      WALLET_SERVICE_ROUTE,
    );
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      const testWindow = window as TestWindow;
      testWindow.__compactSurfaceRouter?.dispose();
      delete testWindow.__compactSurfaceRouter;
    });
    await page.unroute(WALLET_SERVICE_ROUTE).catch(() => {});
  });

  test('ignores malformed, stale, and mismatched measurements before accepting a newer size', async ({
    page,
  }) => {
    await startHostedAuthMenu(page, 'compact-measurement-session');
    const pendingGeometry = await readDialogGeometry(page);

    await postSurfaceMeasurement(page, {
      kind: 'measured_auth_menu_v1',
      requestId: '__current__',
      authMenuSessionId: '__current__',
      sequence: 1,
      widthCssPx: 360,
      heightCssPx: 400,
      unexpected: true,
    });
    await page.waitForTimeout(40);
    const malformedGeometry = await readDialogGeometry(page);
    expect(malformedGeometry.width).toBeCloseTo(pendingGeometry.width, 0);
    expect(malformedGeometry.height).toBeCloseTo(pendingGeometry.height, 0);

    await postSurfaceMeasurement(page, {
      kind: 'measured_auth_menu_v1',
      requestId: '__current__',
      authMenuSessionId: '__current__',
      sequence: 10,
      widthCssPx: 360,
      heightCssPx: 400,
    });
    await waitForDialogGeometry(page, { width: 360, height: 400 });

    await postSurfaceMeasurement(page, {
      kind: 'measured_auth_menu_v1',
      requestId: '__current__',
      authMenuSessionId: '__current__',
      sequence: 9,
      widthCssPx: 500,
      heightCssPx: 500,
    });
    await page.waitForTimeout(40);
    const staleGeometry = await readDialogGeometry(page);
    expect(staleGeometry.width).toBeCloseTo(360, 0);
    expect(staleGeometry.height).toBeCloseTo(400, 0);

    await postSurfaceMeasurement(page, {
      kind: 'measured_auth_menu_v1',
      requestId: 'mismatched-request-id',
      authMenuSessionId: '__current__',
      sequence: 11,
      widthCssPx: 500,
      heightCssPx: 500,
    });
    await postSurfaceMeasurement(page, {
      kind: 'measured_auth_menu_v1',
      requestId: '__current__',
      authMenuSessionId: 'mismatched-auth-menu-session',
      sequence: 12,
      widthCssPx: 500,
      heightCssPx: 500,
    });
    await page.waitForTimeout(40);
    const mismatchedGeometry = await readDialogGeometry(page);
    expect(mismatchedGeometry.width).toBeCloseTo(360, 0);
    expect(mismatchedGeometry.height).toBeCloseTo(400, 0);

    await postSurfaceMeasurement(page, {
      kind: 'measured_auth_menu_v1',
      requestId: '__current__',
      authMenuSessionId: '__current__',
      sequence: 13,
      widthCssPx: 420,
      heightCssPx: 430,
    });
    await waitForDialogGeometry(page, { width: 420, height: 430 });
  });

  test('an anchored menu scrolls with the page content instead of floating over it', async ({
    page,
  }) => {
    await startHostedAuthMenu(page, 'compact-scroll-follow-session', { anchorInFlow: true });
    await postSurfaceMeasurement(page, {
      kind: 'measured_auth_menu_v1',
      requestId: '__current__',
      authMenuSessionId: '__current__',
      sequence: 40,
      widthCssPx: 420,
      heightCssPx: 430,
    });
    await waitForDialogGeometry(page, { width: 420, height: 430 });
    // Let the post-open anchor-settle tracking window expire so the scroll
    // assertion exercises native compositor scrolling, not the rAF tracker.
    await page.waitForTimeout(800);

    const scrolled = await page.evaluate(async () => {
      const dialog = document.querySelector('dialog.seams-wallet-overlay-dialog');
      const anchor = document.querySelector('[data-test-auth-menu-anchor]');
      if (!(dialog instanceof HTMLDialogElement) || !(anchor instanceof HTMLElement)) {
        throw new Error('wallet auth-menu overlay or anchor missing');
      }
      const before = {
        dialogTop: dialog.getBoundingClientRect().top,
        anchorTop: anchor.getBoundingClientRect().top,
      };
      window.scrollTo(0, 400);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
      );
      const after = {
        dialogTop: dialog.getBoundingClientRect().top,
        anchorTop: anchor.getBoundingClientRect().top,
        scrollY: window.scrollY,
      };
      return { before, after };
    });

    expect(scrolled.after.scrollY).toBe(400);
    expect(scrolled.before.dialogTop).toBeCloseTo(scrolled.before.anchorTop, 0);
    expect(scrolled.after.dialogTop - scrolled.before.dialogTop).toBeCloseTo(-400, 0);
    expect(scrolled.after.dialogTop).toBeCloseTo(scrolled.after.anchorTop, 0);
  });

  test('uses viewport fallback when a compact surface cannot fit a mobile viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 240 });
    await startHostedAuthMenu(page, 'compact-mobile-session');
    await postSurfaceMeasurement(page, {
      kind: 'measured_auth_menu_v1',
      requestId: '__current__',
      authMenuSessionId: '__current__',
      sequence: 1,
      widthCssPx: 360,
      heightCssPx: 400,
    });
    await waitForMeasuredDialog(page);
    const geometry = await readDialogGeometry(page);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(320);
    expect(geometry.bottom).toBeLessThanOrEqual(240);
  });
});
