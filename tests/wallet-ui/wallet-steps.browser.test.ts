import { expect, test, type Page } from '@playwright/test';
import { injectImportMap } from '../setup/bootstrap';
import { DEFAULT_TEST_CONFIG } from '../setup/config';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import { createTestWalletHostConfig } from '../setup/walletHostConfig';
import { buildWalletServiceHtml, registerWalletServiceRoute } from '../wallet-iframe/harness';

// A Wallet card as one step of an app's own dialog. The fake Wallet host forwards each request
// to the page and posts the measurements and results that a test sends it, so each test sets the
// card's size and its end exactly.

const WALLET_ORIGIN = 'https://wallet.example.localhost';
const WALLET_SERVICE_ROUTE = '**://wallet.example.localhost/wallet-service*';
const OWNER_TAG = 'wallet-steps-test';

const STEP_HOST_SCRIPT = String.raw`
  const forwardedTypes = new Set(['PM_OPEN_AUTH_MENU', 'PM_SIGN_AND_SEND_TX', 'PM_SPEAK_TO_SIGN_NOTE']);
  const originalAdoptPort = adoptPort;
  adoptPort = function stepAdoptPort(port) {
    originalAdoptPort(port);
    if (!adoptedPort) return;
    const ordinary = adoptedPort.onmessage;
    adoptedPort.onmessage = (event) => {
      ordinary?.(event);
      const message = event.data || {};
      if (forwardedTypes.has(message.type) || message.type === 'PM_SURFACE_VIEW') {
        window.parent.postMessage({ type: 'TEST_STEP_REQUEST', message }, '*');
      }
    };
  };
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'TEST_STEP_POST' && adoptedPort) adoptedPort.postMessage(event.data.message);
  });
`;

// The app's dialog: its own step (500 px high), then the anchor that the Wallet card covers.
const APP_DIALOG_HTML = `
  <div id="overlay" style="position:fixed;inset:0;display:flex;justify-content:center;align-items:flex-start;padding-top:40px;background:rgb(0 0 0 / 0.3)">
    <div id="panel" style="width:420px;background:#fff;border-radius:16px">
      <div id="app-step" style="height:500px">
        <label>Note <input id="app-input" /></label>
      </div>
      <div id="anchor" style="display:block;width:100%;min-height:var(--seams-auth-menu-height, 0px)"></div>
    </div>
  </div>`;

type StepEvent = {
  name: string;
  value?: unknown;
  hidden: boolean;
  modal: boolean;
  dialogHeight: number;
  anchorHeight: string;
};

type StepWindow = Window & {
  __stepRouter?: any;
  __stepEvents: StepEvent[];
  __stepRequests: Array<{ type: string; requestId: string; payload: any; presentation?: any }>;
  __stepOutcome?: Promise<unknown>;
};

async function startStepRouter(page: Page): Promise<void> {
  await injectImportMap(page);
  await page.route('**/steps-app', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}</head><body></body></html>`,
    }),
  );
  await page.goto('/steps-app');
  await registerWalletServiceRoute(
    page,
    buildWalletServiceHtml({ extraScript: STEP_HOST_SCRIPT }),
    WALLET_SERVICE_ROUTE,
  );
  await page.evaluate(
    async ({ walletOrigin, ownerTag, html, hostConfig }) => {
      const state = window as unknown as StepWindow;
      document.body.insertAdjacentHTML('beforeend', html);
      state.__stepEvents = [];
      state.__stepRequests = [];
      window.addEventListener('message', (event) => {
        if (event.data?.type === 'TEST_STEP_REQUEST') state.__stepRequests.push(event.data.message);
      });
      const { WalletIframeRouter } =
        await import('/_test-sdk/esm/SeamsWeb/walletIframe/client/router.js');
      const router = new WalletIframeRouter({
        hostConfig,
        walletOrigin,
        servicePath: '/wallet-service',
        sdkBasePath: '/sdk',
        requestTimeoutMs: 10_000,
        testOptions: { ownerTag },
      });
      await router.init();
      state.__stepRouter = router;
    },
    {
      walletOrigin: WALLET_ORIGIN,
      ownerTag: OWNER_TAG,
      html: APP_DIALOG_HTML,
      hostConfig: createTestWalletHostConfig(DEFAULT_TEST_CONFIG),
    },
  );
}

/** Opens a sign-in card over #anchor. The events record the card's state when they run. */
async function openSignInStep(
  page: Page,
  options: { chrome: 'back' | 'close' | 'none'; hideAppStepOnEnter?: boolean },
): Promise<{ requestId: string; sessionId: string; payload: any }> {
  await page.evaluate(async ({ chrome, hideAppStepOnEnter }) => {
    const state = window as unknown as StepWindow;
    const messages = await import('/_test-sdk/esm/SeamsWeb/walletIframe/shared/messages.js');
    const anchor = document.getElementById('anchor')!;
    const record = (name: string) => (value?: unknown) => {
      const dialog = document.querySelector('dialog.seams-wallet-overlay-dialog');
      const style = dialog ? getComputedStyle(dialog) : null;
      state.__stepEvents.push({
        name,
        value,
        hidden:
          !(dialog instanceof HTMLDialogElement) ||
          !dialog.open ||
          dialog.classList.contains('is-hidden') ||
          dialog.classList.contains('is-provisional') ||
          style?.opacity === '0',
        modal: dialog instanceof HTMLDialogElement && dialog.matches(':modal'),
        dialogHeight: dialog?.getBoundingClientRect().height ?? 0,
        anchorHeight: anchor.style.getPropertyValue('--seams-auth-menu-height'),
      });
    };
    const onEnter = record('enter');
    state.__stepOutcome = state.__stepRouter.openHostedAuthMenu(
      messages.buildHostedAuthMenuOpenRequest({
        authMenuSessionId: `step-session-${chrome}`,
        chrome,
      }),
      anchor,
      {
        layer: 'top',
        onEnter: (size: unknown) => {
          onEnter(size);
          // The recipe for one resize: the app's own step goes when the card has its size.
          if (hideAppStepOnEnter) document.getElementById('app-step')!.hidden = true;
        },
        onReady: record('ready'),
        onResize: record('resize'),
        onExit: record('exit'),
        onBack: record('back'),
        onClose: record('close'),
      },
    );
  }, options);
  const request = await waitForRequest(page, 'PM_OPEN_AUTH_MENU');
  return {
    requestId: request.requestId,
    sessionId: request.payload.authMenuSessionId,
    payload: request.payload,
  };
}

async function waitForRequest(page: Page, type: string) {
  await page.waitForFunction(
    (type) => (window as unknown as StepWindow).__stepRequests.some((r) => r.type === type),
    type,
  );
  return page.evaluate(
    (type) => (window as unknown as StepWindow).__stepRequests.find((r) => r.type === type)!,
    type,
  );
}

async function postFromHost(page: Page, message: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    ({ walletOrigin, ownerTag, message }) => {
      const iframe = document.querySelector<HTMLIFrameElement>(
        `iframe[data-seams-owner="${ownerTag}"]`,
      );
      iframe!.contentWindow!.postMessage({ type: 'TEST_STEP_POST', message }, walletOrigin);
    },
    { walletOrigin: WALLET_ORIGIN, ownerTag: OWNER_TAG, message },
  );
}

async function measureAuthMenu(
  page: Page,
  ids: { requestId: string; sessionId: string },
  sequence: number,
  size: { width: number; height: number },
): Promise<void> {
  await postFromHost(page, {
    type: 'SURFACE_MEASUREMENT',
    payload: {
      kind: 'measured_auth_menu_v1',
      requestId: ids.requestId,
      authMenuSessionId: ids.sessionId,
      sequence,
      widthCssPx: size.width,
      heightCssPx: size.height,
    },
  });
}

async function stepEvents(page: Page): Promise<StepEvent[]> {
  return page.evaluate(() => (window as unknown as StepWindow).__stepEvents);
}

async function waitForStepEvent(page: Page, name: string): Promise<void> {
  await page.waitForFunction(
    (name) => (window as unknown as StepWindow).__stepEvents.some((event) => event.name === name),
    name,
  );
}

test.describe('Wallet cards as steps of an app dialog', () => {
  test.beforeEach(async ({ page }) => {
    await startStepRouter(page);
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate(() => (window as unknown as StepWindow).__stepRouter?.dispose());
    await page.unroute(WALLET_SERVICE_ROUTE).catch(() => {});
  });

  test('a sign-in step reports enter while hidden, ready once painted and exit once gone', async ({
    page,
  }) => {
    const ids = await openSignInStep(page, { chrome: 'close' });
    // The card draws Close itself: the request asks the Wallet host for it.
    expect(ids.payload.chrome).toBe('close');

    await measureAuthMenu(page, ids, 1, { width: 400, height: 320 });
    await waitForStepEvent(page, 'ready');
    const [enter, ready, ...rest] = await stepEvents(page);
    expect(enter).toMatchObject({ name: 'enter', value: { width: 400, height: 320 }, hidden: true });
    // The anchor reserves the card's height when enter runs, before the card paints.
    expect(enter.anchorHeight).toBe('320px');
    expect(ready).toMatchObject({ name: 'ready', hidden: false, modal: true, dialogHeight: 320 });
    expect(rest).toEqual([]);

    // The person pressed Close in the card: the host ends the menu as a close-button cancel.
    await postFromHost(page, {
      type: 'PM_RESULT',
      requestId: ids.requestId,
      payload: {
        ok: true,
        result: { kind: 'cancelled', authMenuSessionId: ids.sessionId, reason: 'close_button' },
      },
    });
    await waitForStepEvent(page, 'exit');
    const events = await stepEvents(page);
    const close = events.find((event) => event.name === 'close')!;
    const exit = events.find((event) => event.name === 'exit')!;
    expect(events.map((event) => event.name)).toEqual(['enter', 'ready', 'close', 'exit']);
    expect(close.hidden).toBe(false);
    expect(exit).toMatchObject({ value: { kind: 'closed' }, hidden: true });
    // The card's place keeps its size until the app changes it.
    expect(exit.anchorHeight).toBe('320px');
    const outcome = await page.evaluate(() => (window as unknown as StepWindow).__stepOutcome);
    expect(outcome).toMatchObject({ kind: 'cancelled', reason: 'close_button' });
  });

  test('Back in the card reports back, and the app step keeps its state', async ({ page }) => {
    await page.fill('#app-input', 'my draft');
    const ids = await openSignInStep(page, { chrome: 'back', hideAppStepOnEnter: true });
    expect(ids.payload.chrome).toBe('back');
    await measureAuthMenu(page, ids, 1, { width: 400, height: 320 });
    await waitForStepEvent(page, 'ready');
    await postFromHost(page, {
      type: 'PM_RESULT',
      requestId: ids.requestId,
      payload: {
        ok: true,
        result: { kind: 'cancelled', authMenuSessionId: ids.sessionId, reason: 'close_button' },
      },
    });
    await waitForStepEvent(page, 'exit');
    const events = await stepEvents(page);
    expect(events.map((event) => event.name)).toEqual(['enter', 'ready', 'back', 'exit']);
    expect(events.at(-1)?.value).toEqual({ kind: 'back' });
    await page.evaluate(() => {
      document.getElementById('app-step')!.hidden = false;
    });
    await expect(page.locator('#app-input')).toHaveValue('my draft');
  });

  test("the card changes the app's layout once for each step change", async ({ page }) => {
    await page.evaluate(() => {
      const state = window as unknown as StepWindow & { __panelHeights: number[] };
      const panel = document.getElementById('panel')!;
      state.__panelHeights = [panel.offsetHeight];
      const sample = () => {
        const height = panel.offsetHeight;
        if (state.__panelHeights.at(-1) !== height) state.__panelHeights.push(height);
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const ids = await openSignInStep(page, { chrome: 'none', hideAppStepOnEnter: true });
    await page.waitForTimeout(100);
    await measureAuthMenu(page, ids, 1, { width: 400, height: 320 });
    await waitForStepEvent(page, 'ready');
    await measureAuthMenu(page, ids, 2, { width: 400, height: 360 });
    await waitForStepEvent(page, 'resize');
    await page.waitForTimeout(100);

    const heights = await page.evaluate(
      () => (window as unknown as { __panelHeights: number[] }).__panelHeights,
    );
    // App step 500 px, then the card at 320 px, then the card at 360 px: no height between.
    expect(heights).toEqual([500, 320, 360]);
    const resize = (await stepEvents(page)).find((event) => event.name === 'resize')!;
    // Resize runs before the new size paints.
    expect(resize).toMatchObject({ value: { width: 400, height: 360 }, dialogHeight: 320 });
  });

  test("the card follows the app's dialog while the dialog moves", async ({ page }) => {
    const ids = await openSignInStep(page, { chrome: 'none', hideAppStepOnEnter: true });
    await measureAuthMenu(page, ids, 1, { width: 400, height: 320 });
    await waitForStepEvent(page, 'ready');
    // Past the first second: a dialog can move long after the card opened.
    await page.waitForTimeout(1_000);
    const offsets = await page.evaluate(async () => {
      const panel = document.getElementById('panel')!;
      const anchor = document.getElementById('anchor')!;
      const dialog = document.querySelector('dialog.seams-wallet-overlay-dialog')!;
      const move = panel.animate(
        [{ transform: 'translateY(0)' }, { transform: 'translateY(160px)' }],
        { duration: 600, easing: 'linear' },
      );
      const offsets: number[] = [];
      while (move.playState === 'running') {
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
        offsets.push(
          Math.abs(dialog.getBoundingClientRect().top - anchor.getBoundingClientRect().top),
        );
      }
      return offsets;
    });
    expect(offsets.length).toBeGreaterThan(10);
    expect(Math.max(...offsets)).toBeLessThan(1.5);
  });
});
