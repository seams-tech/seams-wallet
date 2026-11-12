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
  /** When the event ran, on the page's clock. */
  atMs: number;
};

type StepTransition = { enterDelayMs?: number; fadeInMs?: number; fadeOutMs?: number };

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
      const { WalletIframeRouter } = await import(
        '/_test-sdk/esm/SeamsWeb/walletIframe/client/router.js'
      );
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
  options: {
    chrome: 'back' | 'close' | 'back_and_close' | 'none';
    hideAppStepOnEnter?: boolean;
    transition?: StepTransition;
  },
): Promise<{ requestId: string; sessionId: string; payload: any }> {
  await page.evaluate(async ({ chrome, hideAppStepOnEnter, transition }) => {
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
        atMs: performance.now(),
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
        transition,
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
    ({ walletOrigin, message }) => {
      const iframe = document.querySelector<HTMLIFrameElement>(
        'iframe.seams-wallet-overlay-iframe',
      );
      iframe!.contentWindow!.postMessage({ type: 'TEST_STEP_POST', message }, walletOrigin);
    },
    { walletOrigin: WALLET_ORIGIN, message },
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
    expect(enter).toMatchObject({
      name: 'enter',
      value: { width: 400, height: 320 },
      hidden: true,
    });
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

  test('the app sets how long the card waits and fades', async ({ page }) => {
    const ids = await openSignInStep(page, {
      chrome: 'close',
      transition: { enterDelayMs: 200, fadeInMs: 0, fadeOutMs: 300 },
    });
    await measureAuthMenu(page, ids, 1, { width: 400, height: 320 });
    await waitForStepEvent(page, 'enter');
    // The card waits for the app's dialog: it is still hidden well after one frame.
    await page.waitForTimeout(100);
    expect(
      await page.evaluate(() =>
        document
          .querySelector('dialog.seams-wallet-overlay-dialog')!
          .classList.contains('is-provisional'),
      ),
    ).toBe(true);
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
    const at = (name: string): number => events.find((event) => event.name === name)!.atMs;
    expect(events.map((event) => event.name)).toEqual(['enter', 'ready', 'close', 'exit']);
    expect(at('ready') - at('enter')).toBeGreaterThanOrEqual(200);
    // With no fade-in, the card is whole when it shows.
    expect(events[1]).toMatchObject({ name: 'ready', hidden: false, dialogHeight: 320 });
    expect(at('exit') - at('close')).toBeGreaterThanOrEqual(290);
  });

  test('a transition time outside 0 to 1000 ms opens no card', async ({ page }) => {
    const error = await page.evaluate(async () => {
      const state = window as unknown as StepWindow;
      const messages = await import('/_test-sdk/esm/SeamsWeb/walletIframe/shared/messages.js');
      return state.__stepRouter
        .openHostedAuthMenu(
          messages.buildHostedAuthMenuOpenRequest({ authMenuSessionId: 'step-session-bad-time' }),
          document.getElementById('anchor')!,
          { layer: 'top', transition: { fadeInMs: -1 } },
        )
        .then(
          () => null,
          (cause: Error) => cause.message,
        );
    });
    expect(error).toBe("A Wallet card's fadeInMs must be from 0 to 1000 milliseconds");
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

  test('with Back and Close, the card reports the control that the person pressed', async ({
    page,
  }) => {
    const cancelled = (ids: { requestId: string; sessionId: string }) =>
      postFromHost(page, {
        type: 'PM_RESULT',
        requestId: ids.requestId,
        payload: {
          ok: true,
          result: { kind: 'cancelled', authMenuSessionId: ids.sessionId, reason: 'close_button' },
        },
      });
    const ids = await openSignInStep(page, { chrome: 'back_and_close' });
    expect(ids.payload.chrome).toBe('back_and_close');
    await measureAuthMenu(page, ids, 1, { width: 400, height: 320 });
    await waitForStepEvent(page, 'ready');
    // The Wallet host reports Close before the menu's cancelled outcome.
    await postFromHost(page, {
      type: 'SURFACE_CONTROL',
      requestId: ids.requestId,
      payload: { requestId: ids.requestId, control: 'close' },
    });
    await cancelled(ids);
    await waitForStepEvent(page, 'exit');
    let events = await stepEvents(page);
    expect(events.map((event) => event.name)).toEqual(['enter', 'ready', 'close', 'exit']);
    expect(events.at(-1)?.value).toEqual({ kind: 'closed' });

    // Escape reports no control: with Back in the chrome, it counts as Back.
    await page.evaluate(() => {
      const state = window as unknown as StepWindow;
      state.__stepEvents = [];
      state.__stepRequests = [];
    });
    const again = await openSignInStep(page, { chrome: 'back_and_close' });
    await measureAuthMenu(page, again, 1, { width: 400, height: 320 });
    await waitForStepEvent(page, 'ready');
    await cancelled(again);
    await waitForStepEvent(page, 'exit');
    events = await stepEvents(page);
    expect(events.map((event) => event.name)).toEqual(['enter', 'ready', 'back', 'exit']);
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

type ConfirmWindow = StepWindow & { __confirmResult?: Promise<unknown> };

/**
 * Sends a NEAR transaction; with `chrome`, its Wallet card shows over #anchor. With `minimize`,
 * the card has Minimize, and `__restore` is the function that shows it again.
 */
async function sendTransaction(
  page: Page,
  chrome?: 'back' | 'close' | 'back_and_close' | 'none',
  minimize = false,
): Promise<string> {
  await page.evaluate(({ chrome, minimize }) => {
    const state = window as unknown as ConfirmWindow & { __stepRecord: (name: string) => any };
    const anchor = document.getElementById('anchor')!;
    const record = (name: string) => (value?: unknown) => {
      const dialog = document.querySelector('dialog.seams-wallet-overlay-dialog');
      state.__stepEvents.push({
        name,
        value,
        hidden: !(dialog instanceof HTMLDialogElement) || !dialog.open,
        modal: dialog instanceof HTMLDialogElement && dialog.matches(':modal'),
        dialogHeight: dialog?.getBoundingClientRect().height ?? 0,
        anchorHeight: anchor.style.getPropertyValue('--seams-auth-menu-height'),
        atMs: performance.now(),
      });
    };
    const dispatch = chrome
      ? {
          kind: 'anchored',
          presentation: {
            kind: 'anchored',
            anchor,
            chrome,
            minimize,
            onEnter: (size: unknown) => {
              record('enter')(size);
              document.getElementById('app-step')!.hidden = true;
            },
            onReady: record('ready'),
            onExit: record('exit'),
            onBack: record('back'),
            onClose: record('close'),
            onMinimize: (restore: () => void) => {
              (state as unknown as { __restore: () => void }).__restore = restore;
              record('minimize')();
            },
            onRestore: record('restore'),
            onProgress: record('progress'),
          },
        }
      : { kind: 'ordinary' };
    state.__confirmResult = state.__stepRouter.signAndSendTransaction(
      {
        walletId: 'step.testnet',
        nearAccountId: 'step.testnet',
        transaction: { receiverId: 'market.testnet', actions: [{ type: 'Transfer', amount: '1' }] },
        options: {},
      },
      dispatch,
    );
  }, { chrome, minimize });
  return (await waitForRequest(page, 'PM_SIGN_AND_SEND_TX')).requestId;
}

async function surfaceViews(page: Page): Promise<boolean[]> {
  return page.evaluate(() =>
    (window as unknown as StepWindow).__stepRequests
      .filter((request) => request.type === 'PM_SURFACE_VIEW')
      .map((request) => request.payload.unobstructed as boolean),
  );
}

async function waitForSurfaceView(page: Page, unobstructed: boolean, after: number): Promise<void> {
  await page.waitForFunction(
    ({ unobstructed, after }) => {
      const views = (window as unknown as StepWindow).__stepRequests.filter(
        (request) => request.type === 'PM_SURFACE_VIEW',
      );
      return views.length > after && views.at(-1)!.payload.unobstructed === unobstructed;
    },
    { unobstructed, after },
  );
}

test.describe('A transaction confirm as a step of an app dialog', () => {
  test.beforeEach(async ({ page }) => {
    await startStepRouter(page);
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate(() => (window as unknown as StepWindow).__stepRouter?.dispose());
    await page.unroute(WALLET_SERVICE_ROUTE).catch(() => {});
  });

  test('the card shows in the app dialog with explicit approval, and Back ends it', async ({
    page,
  }) => {
    const requestId = await sendTransaction(page, 'back');
    const request = await waitForRequest(page, 'PM_SIGN_AND_SEND_TX');
    // The Wallet host draws Back and guards the card; the settings need an explicit approval.
    expect(request.presentation).toEqual({ kind: 'anchored_v1', chrome: 'back' });
    expect(request.payload.options.confirmationConfig).toEqual({
      uiMode: 'modal',
      behavior: 'requireClick',
    });
    await waitForStepEvent(page, 'ready');
    const [enter, ready] = await stepEvents(page);
    expect(enter).toMatchObject({ name: 'enter', value: { width: 420, height: 380 } });
    expect(ready).toMatchObject({ name: 'ready', modal: true, dialogHeight: 380 });
    const geometry = await page.evaluate(() => {
      const dialog = document.querySelector('dialog.seams-wallet-overlay-dialog')!;
      const anchor = document.getElementById('anchor')!;
      return {
        dialog: dialog.getBoundingClientRect().toJSON(),
        anchor: anchor.getBoundingClientRect().toJSON(),
      };
    });
    expect(geometry.dialog.top).toBeCloseTo(geometry.anchor.top, 0);
    expect(geometry.dialog.left).toBeCloseTo(geometry.anchor.left, 0);

    // The person pressed Back in the card: the card's own cancel ends the confirmation.
    await postFromHost(page, {
      type: 'PROGRESS',
      requestId,
      payload: {
        version: 2,
        flow: 'signing',
        step: 5,
        phase: 'signing.confirmation.cancelled',
        status: 'cancelled',
        message: 'Transaction rejected',
        flowId: `signing:test:${requestId}`,
        requestId,
        interaction: { kind: 'transaction_confirmation', overlay: 'hide' },
      },
    });
    await postFromHost(page, {
      type: 'PM_RESULT',
      requestId,
      payload: {
        ok: true,
        result: { success: false, kind: 'not_submitted', error: 'Transaction rejected' },
      },
    });
    await waitForStepEvent(page, 'exit');
    const events = await stepEvents(page);
    expect(events.map((event) => event.name)).toEqual(['enter', 'ready', 'back', 'exit']);
    expect(events.at(-1)?.value).toEqual({ kind: 'back' });
    const result = await page.evaluate(() => (window as unknown as ConfirmWindow).__confirmResult);
    expect(result).toMatchObject({ success: false, kind: 'not_submitted' });
  });

  test('the card accepts input only while it is whole in view and nothing covers it', async ({
    page,
  }) => {
    await sendTransaction(page, 'none');
    await waitForStepEvent(page, 'ready');
    await waitForSurfaceView(page, true, 0);
    let seen = (await surfaceViews(page)).length;

    // A popover that opens later paints above the card in the top layer.
    await page.evaluate(() => {
      const cover = document.createElement('div');
      cover.id = 'cover';
      cover.popover = 'manual';
      cover.style.cssText = 'margin:0;inset:0;width:100vw;height:100vh;opacity:0.2;border:0';
      document.body.appendChild(cover);
      cover.showPopover();
    });
    await waitForSurfaceView(page, false, seen);
    seen = (await surfaceViews(page)).length;
    await page.evaluate(() => document.getElementById('cover')!.hidePopover());
    await waitForSurfaceView(page, true, seen);
    seen = (await surfaceViews(page)).length;

    // Part of the card out of view.
    await page.evaluate(() => {
      document.getElementById('panel')!.style.transform = 'translateY(-300px)';
    });
    await waitForSurfaceView(page, false, seen);
    seen = (await surfaceViews(page)).length;
    await page.evaluate(() => {
      document.getElementById('panel')!.style.transform = '';
    });
    await waitForSurfaceView(page, true, seen);
  });

  test('Minimize hides the card and keeps its request, and the app or the card shows it again', async ({
    page,
  }) => {
    const requestId = await sendTransaction(page, 'back_and_close', true);
    const request = await waitForRequest(page, 'PM_SIGN_AND_SEND_TX');
    expect(request.presentation).toEqual({
      kind: 'anchored_v1',
      chrome: 'back_and_close',
      minimize: true,
    });
    await waitForStepEvent(page, 'ready');
    await waitForSurfaceView(page, true, 0);
    let seen = (await surfaceViews(page)).length;
    const control = (control: string) =>
      postFromHost(page, { type: 'SURFACE_CONTROL', requestId, payload: { requestId, control } });
    const overlay = () =>
      page.evaluate(() => {
        const dialog = document.querySelector<HTMLDialogElement>('dialog.seams-wallet-overlay-dialog')!;
        return {
          open: dialog.open,
          modal: dialog.matches(':modal'),
          inert: dialog.inert,
          minimized: dialog.classList.contains('is-minimized'),
          pointerEvents: getComputedStyle(dialog).pointerEvents,
        };
      });

    // The person pressed Minimize: the card stays open but shows nothing and takes no input,
    // and the page is not inert. The request goes on.
    await control('minimize');
    await waitForStepEvent(page, 'minimize');
    expect(await overlay()).toEqual({
      open: true,
      modal: false,
      inert: true,
      minimized: true,
      pointerEvents: 'none',
    });
    await waitForSurfaceView(page, false, seen);
    seen = (await surfaceViews(page)).length;

    // The card's stage reaches the app, for its progress.
    const progress = { stage: 'checking', done: 2, total: 5 };
    await postFromHost(page, {
      type: 'SURFACE_PROGRESS',
      requestId,
      payload: { requestId, progress },
    });
    await waitForStepEvent(page, 'progress');

    // The app shows the card again.
    await page.evaluate(() => (window as unknown as { __restore: () => void }).__restore());
    await page.waitForFunction(() =>
      document.querySelector('dialog.seams-wallet-overlay-dialog')!.matches(':modal'),
    );
    expect(await overlay()).toMatchObject({ modal: true, inert: false, minimized: false });
    await waitForSurfaceView(page, true, seen);

    // Hidden again; now the card asks to show again (a result). A second ask does nothing.
    await control('minimize');
    await page.waitForFunction(
      () =>
        (window as unknown as StepWindow).__stepEvents.filter((event) => event.name === 'minimize')
          .length === 2,
    );
    await control('restore');
    await control('restore');
    await page.waitForFunction(() =>
      document.querySelector('dialog.seams-wallet-overlay-dialog')!.matches(':modal'),
    );
    const events = await stepEvents(page);
    expect(events.map((event) => event.name)).toEqual([
      'enter',
      'ready',
      'minimize',
      'progress',
      'restore',
      'minimize',
      'restore',
    ]);
    expect(events.find((event) => event.name === 'progress')?.value).toEqual(progress);
  });

  test('a card without Minimize ignores a minimize and a stage', async ({ page }) => {
    const requestId = await sendTransaction(page, 'back_and_close');
    expect((await waitForRequest(page, 'PM_SIGN_AND_SEND_TX')).presentation).toEqual({
      kind: 'anchored_v1',
      chrome: 'back_and_close',
    });
    await waitForStepEvent(page, 'ready');
    await postFromHost(page, {
      type: 'SURFACE_CONTROL',
      requestId,
      payload: { requestId, control: 'minimize' },
    });
    await postFromHost(page, {
      type: 'SURFACE_PROGRESS',
      requestId,
      payload: { requestId, progress: { stage: 'recording', done: 0, total: 0 } },
    });
    await page.waitForTimeout(200);
    expect((await stepEvents(page)).map((event) => event.name)).toEqual(['enter', 'ready']);
    const modal = await page.evaluate(() =>
      document.querySelector('dialog.seams-wallet-overlay-dialog')!.matches(':modal'),
    );
    expect(modal).toBe(true);
  });

  test('the card eases a new size as the Wallet modal does, except with reduced motion', async ({
    page,
  }) => {
    const requestId = await sendTransaction(page, 'none');
    await waitForStepEvent(page, 'ready');
    const resize = async (sequence: number, height: number) => {
      await page.evaluate(() => {
        const state = window as unknown as { __cardHeights: number[]; __sampling: boolean };
        const dialog = document.querySelector('dialog.seams-wallet-overlay-dialog')!;
        state.__cardHeights = [Math.round(dialog.getBoundingClientRect().height)];
        state.__sampling = true;
        const sample = () => {
          const value = Math.round(dialog.getBoundingClientRect().height);
          if (state.__cardHeights.at(-1) !== value) state.__cardHeights.push(value);
          if (state.__sampling) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await postFromHost(page, {
        type: 'SURFACE_MEASUREMENT',
        payload: { kind: 'measured_v1', requestId, sequence, widthCssPx: 420, heightCssPx: height },
      });
      await page.waitForTimeout(400);
      return page.evaluate(() => {
        const state = window as unknown as { __cardHeights: number[]; __sampling: boolean };
        state.__sampling = false;
        return {
          heights: state.__cardHeights,
          anchor: document
            .getElementById('anchor')!
            .style.getPropertyValue('--seams-auth-menu-height'),
        };
      });
    };

    const eased = await resize(2, 480);
    expect(eased.heights[0]).toBe(380);
    expect(eased.heights.at(-1)).toBe(480);
    expect(eased.heights.some((height) => height > 380 && height < 480)).toBe(true);
    // The anchor takes the new size at once, so the app knows the size it eases to.
    expect(eased.anchor).toBe('480px');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const instant = await resize(3, 400);
    expect(instant.heights).toEqual([480, 400]);
  });

  test('a transaction without a presentation keeps the Wallet modal', async ({ page }) => {
    await sendTransaction(page);
    const request = await waitForRequest(page, 'PM_SIGN_AND_SEND_TX');
    expect(request.presentation).toBeUndefined();
    await page.waitForFunction(() => {
      const dialog = document.querySelector('dialog.seams-wallet-overlay-dialog');
      return dialog instanceof HTMLDialogElement && dialog.matches(':modal');
    });
    // The modal backdrop fades in over 180 ms.
    await page.waitForTimeout(300);
    const dialog = await page.evaluate(() => {
      const element = document.querySelector('dialog.seams-wallet-overlay-dialog')!;
      return {
        inline: element.classList.contains('seams-wallet-inline-dialog'),
        anchoredTop: element.classList.contains('is-anchored-top'),
        backdrop: getComputedStyle(element, '::backdrop').backgroundColor,
      };
    });
    expect(dialog).toEqual({
      inline: false,
      anchoredTop: false,
      backdrop: 'rgba(0, 0, 0, 0.26)',
    });
    await page.waitForTimeout(100);
    expect(await surfaceViews(page)).toEqual([]);
  });
});

test.describe('WalletStep in a React dialog', () => {
  test.afterEach(async ({ page }) => {
    await page.unroute(WALLET_SERVICE_ROUTE).catch(() => {});
  });

  test('a sign-in step holds the app size, takes the card size, and Back keeps the app state', async ({
    page,
  }) => {
    await injectImportMap(page);
    await page.route('**/steps-react', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}</head><body></body></html>`,
      }),
    );
    await page.goto('/steps-react');
    await registerWalletServiceRoute(
      page,
      buildWalletServiceHtml({ extraScript: STEP_HOST_SCRIPT }),
      WALLET_SERVICE_ROUTE,
    );
    await page.evaluate(
      async ({ walletOrigin }) => {
        const state = window as unknown as StepWindow & {
          __stepOutcomes: unknown[];
          __panelHeights: number[];
        };
        state.__stepEvents = [];
        state.__stepRequests = [];
        state.__stepOutcomes = [];
        window.addEventListener('message', (event) => {
          if (event.data?.type === 'TEST_STEP_REQUEST')
            state.__stepRequests.push(event.data.message);
        });
        const React = await import('react');
        const { createRoot } = await import('react-dom/client');
        const { SeamsWebProvider } = await import(
          '/_test-sdk/esm/react/context/SeamsWebProvider.js'
        );
        const { WalletStep } = await import('/_test-sdk/esm/react/components/WalletStep.js');
        const h = React.createElement;
        const record = (name: string) => (value?: unknown) =>
          state.__stepEvents.push({
            name,
            value,
            hidden: false,
            modal: false,
            dialogHeight: 0,
            anchorHeight: '',
            atMs: performance.now(),
          });
        function Dialog() {
          const [step, setStep] = React.useState('app');
          const [held, setHeld] = React.useState(0);
          const panel = React.useRef<HTMLDivElement>(null);
          const toWallet = () => {
            setHeld(panel.current!.offsetHeight);
            setStep('wallet');
          };
          return h(
            'div',
            { id: 'panel', ref: panel, style: { width: '420px', margin: '40px auto' } },
            h(
              'div',
              { id: 'app-step', hidden: step !== 'app', style: { height: '500px' } },
              h('input', { id: 'app-input' }),
              h('button', { id: 'to-wallet', onClick: toWallet }, 'Sign in'),
            ),
            step === 'wallet'
              ? h(WalletStep, {
                  surface: { kind: 'auth_menu' },
                  chrome: 'back',
                  initialHeight: held,
                  onEnter: record('enter'),
                  onReady: record('ready'),
                  onExit: record('exit'),
                  onBack: () => {
                    record('back')();
                    setStep('app');
                  },
                  onOutcome: (outcome: unknown) => state.__stepOutcomes.push(outcome),
                })
              : null,
          );
        }
        const config = {
          iframeWallet: { walletOrigin },
          relayer: { url: location.origin },
          routerAb: { normalSigning: { mode: 'enabled', signingWorkerId: 'test-worker' } },
          registration: { projectEnvironmentId: 'proj_local:test', publishableKey: 'pk_local' },
          appearance: { theme: { id: 'default', mode: 'light' } },
        };
        const container = document.createElement('div');
        document.body.appendChild(container);
        createRoot(container).render(
          h(React.StrictMode, null, h(SeamsWebProvider, { config }, h(Dialog))),
        );
      },
      { walletOrigin: WALLET_ORIGIN },
    );

    await page.fill('#app-input', 'my draft');
    await page.click('#to-wallet');
    const request = await waitForRequest(page, 'PM_OPEN_AUTH_MENU');
    expect(request.payload.chrome).toBe('back');
    // Until the card has its size, the step keeps the app step's height.
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => document.getElementById('panel')!.offsetHeight)).toBe(500);

    await measureAuthMenu(
      page,
      { requestId: request.requestId, sessionId: request.payload.authMenuSessionId },
      1,
      { width: 420, height: 300 },
    );
    await waitForStepEvent(page, 'ready');
    expect(await page.evaluate(() => document.getElementById('panel')!.offsetHeight)).toBe(300);

    await postFromHost(page, {
      type: 'PM_RESULT',
      requestId: request.requestId,
      payload: {
        ok: true,
        result: {
          kind: 'cancelled',
          authMenuSessionId: request.payload.authMenuSessionId,
          reason: 'close_button',
        },
      },
    });
    await expect(page.locator('#app-step')).toBeVisible();
    await expect(page.locator('#app-input')).toHaveValue('my draft');
    const outcomes = await page.evaluate(
      () => (window as unknown as { __stepOutcomes: unknown[] }).__stepOutcomes,
    );
    expect(outcomes).toEqual([
      {
        kind: 'auth_menu',
        outcome: {
          kind: 'cancelled',
          authMenuSessionId: request.payload.authMenuSessionId,
          reason: 'close_button',
        },
      },
    ]);
  });
});

type ModalStepsWindow = StepWindow & {
  __seams: any;
  __h: (...args: any[]) => unknown;
  __useState: <T>(value: T) => [T, (value: T) => void];
  __settled: Array<{ kind: 'value' | 'error'; value: unknown }>;
};

/** A React app with SeamsWebProvider and, when `host`, TransactionReviewHost. */
async function startModalStepsApp(page: Page, host: boolean): Promise<void> {
  await injectImportMap(page);
  await page.route('**/modal-steps', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}</head><body></body></html>`,
    }),
  );
  await page.goto('/modal-steps');
  await registerWalletServiceRoute(
    page,
    buildWalletServiceHtml({ extraScript: STEP_HOST_SCRIPT }),
    WALLET_SERVICE_ROUTE,
  );
  await page.evaluate(
    async ({ walletOrigin, host }) => {
      const state = window as unknown as ModalStepsWindow;
      state.__stepEvents = [];
      state.__stepRequests = [];
      state.__settled = [];
      window.addEventListener('message', (event) => {
        if (event.data?.type === 'TEST_STEP_REQUEST') state.__stepRequests.push(event.data.message);
      });
      const React = await import('react');
      const { createRoot } = await import('react-dom/client');
      const { SeamsWebProvider } = await import('/_test-sdk/esm/react/context/SeamsWebProvider.js');
      const { useSeams } = await import('/_test-sdk/esm/react/context/index.js');
      const { TransactionReviewHost } = await import(
        '/_test-sdk/esm/react/transactionReview/TransactionReviewHost.js'
      );
      const h = React.createElement;
      state.__h = h;
      state.__useState = React.useState as ModalStepsWindow['__useState'];
      function Expose() {
        state.__seams = useSeams().seams;
        return null;
      }
      const config = {
        iframeWallet: { walletOrigin },
        relayer: { url: location.origin },
        routerAb: { normalSigning: { mode: 'enabled', signingWorkerId: 'test-worker' } },
        registration: { projectEnvironmentId: 'proj_local:test', publishableKey: 'pk_local' },
        appearance: { theme: { id: 'default', mode: 'light' } },
        approvals: [{ kind: 'spoken', network: 'testnet' }],
      };
      const container = document.createElement('div');
      document.body.appendChild(container);
      const app = host ? h(TransactionReviewHost, null, h(Expose)) : h(Expose);
      createRoot(container).render(h(React.StrictMode, null, h(SeamsWebProvider, { config }, app)));
    },
    { walletOrigin: WALLET_ORIGIN, host },
  );
  await page.waitForFunction(() => Boolean((window as unknown as ModalStepsWindow).__seams));
}

/** Records how the call's promise settled. */
async function settledCalls(page: Page): Promise<ModalStepsWindow['__settled']> {
  return page.evaluate(() => (window as unknown as ModalStepsWindow).__settled);
}

/** The `count`-th forwarded request of `type`, once the host has it. */
async function waitForNthRequest(page: Page, type: string, count: number) {
  await page.waitForFunction(
    ({ type, count }) =>
      (window as unknown as StepWindow).__stepRequests.filter((r) => r.type === type).length >=
      count,
    { type, count },
  );
  return page.evaluate(
    ({ type, count }) =>
      (window as unknown as StepWindow).__stepRequests.filter((r) => r.type === type)[count - 1]!,
    { type, count },
  );
}

/** Opens the sign-in menu between a bet step and a result step in the SDK's modal. */
async function openSignInWithModalSteps(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const state = window as unknown as ModalStepsWindow;
    const messages = await import('/_test-sdk/esm/SeamsWeb/walletIframe/shared/messages.js');
    const h = state.__h;
    function BetStep({ controls }: { controls: any }) {
      // React state, so Back shows that the step stayed mounted.
      const [note, setNote] = state.__useState('');
      return h(
        'div',
        { id: 'bet-step', style: { height: '240px' } },
        h('input', {
          id: 'bet-note',
          value: note,
          onChange: (event: any) => setNote(event.target.value),
        }),
        h('button', { id: 'bet-cancel', onClick: controls.cancel }, 'Cancel'),
        h('button', { id: 'bet-continue', onClick: controls.continueToWallet }, 'Continue'),
      );
    }
    state.__seams.authMenu
      .open(
        messages.buildHostedAuthMenuOpenRequest({ authMenuSessionId: 'modal-steps' }),
        undefined,
        {
          steps: {
            title: 'Place a bet',
            before: (controls: unknown) => h(BetStep, { controls }),
            after: (outcome: any, controls: any) =>
              h(
                'div',
                { id: 'bet-after' },
                h('p', null, `Signed in as ${outcome.walletId}`),
                h('button', { id: 'bet-done', onClick: controls.close }, 'Done'),
              ),
          },
        },
      )
      .then(
        (value: unknown) => state.__settled.push({ kind: 'value', value }),
        (error: any) =>
          state.__settled.push({
            kind: 'error',
            value: { code: error?.code, message: error?.message },
          }),
      );
  });
}

const STEPS_MODAL = 'dialog.seams-wallet-steps-modal';

async function modalBox(page: Page) {
  return page.evaluate((selector) => {
    const modal = document.querySelector<HTMLDialogElement>(selector);
    const card = document.querySelector('dialog.seams-wallet-overlay-dialog');
    return {
      open: Boolean(modal?.open),
      modal: Boolean(modal?.matches(':modal')),
      ready: modal?.hasAttribute('data-wallet-card-ready') ?? false,
      height: modal?.offsetHeight ?? 0,
      rect: modal?.getBoundingClientRect().toJSON(),
      card: card?.getBoundingClientRect().toJSON(),
      cardModal: Boolean(card?.matches(':modal')),
    };
  }, STEPS_MODAL);
}

test.describe('App steps around a sign-in or VoiceID card in the Wallet modal', () => {
  test.afterEach(async ({ page }) => {
    await page.unroute(WALLET_SERVICE_ROUTE).catch(() => {});
  });

  test('before, the card, Back with the state kept, the card again, then after', async ({
    page,
  }) => {
    await startModalStepsApp(page, true);
    await openSignInWithModalSteps(page);
    await expect(page.locator(STEPS_MODAL)).toBeVisible();
    await expect(page.locator(`${STEPS_MODAL} h2`)).toHaveText('Place a bet');
    const before = await modalBox(page);
    expect(before).toMatchObject({ open: true, modal: true, ready: false });
    // The app step shows first: nothing goes to the Wallet until Continue.
    expect(await page.evaluate(() => (window as unknown as StepWindow).__stepRequests.length)).toBe(
      0,
    );

    await page.fill('#bet-note', 'my draft');
    await page.click('#bet-continue');
    const first = await waitForNthRequest(page, 'PM_OPEN_AUTH_MENU', 1);
    // The card draws Back and Close, and the Wallet host guards it as a card in an app's dialog.
    expect(first.payload.chrome).toBe('back_and_close');
    expect(first.presentation).toEqual({ kind: 'anchored_v1', chrome: 'back_and_close' });
    // Until the card has its size, the modal keeps the app step's height.
    await page.waitForTimeout(100);
    expect((await modalBox(page)).height).toBe(before.height);

    await measureAuthMenu(
      page,
      { requestId: first.requestId, sessionId: first.payload.authMenuSessionId },
      1,
      { width: 400, height: 300 },
    );
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.hasAttribute('data-wallet-card-ready'),
      STEPS_MODAL,
    );
    const shown = await modalBox(page);
    expect(shown.height).toBe(300);
    // The card covers the modal, above it in the top layer.
    expect(shown.cardModal).toBe(true);
    expect(shown.card!.top).toBeCloseTo(shown.rect!.top, 0);
    expect(shown.card!.left).toBeCloseTo(shown.rect!.left, 0);
    expect(shown.card!.height).toBeCloseTo(300, 0);

    // Back in the card: the app step shows again with its state.
    await postFromHost(page, {
      type: 'PM_RESULT',
      requestId: first.requestId,
      payload: {
        ok: true,
        result: { kind: 'cancelled', authMenuSessionId: 'modal-steps', reason: 'close_button' },
      },
    });
    await expect(page.locator('#bet-note')).toBeVisible();
    await expect(page.locator('#bet-note')).toHaveValue('my draft');
    expect(await settledCalls(page)).toEqual([]);

    // The overlay closes after its fade; then the modal takes input again.
    await expect(page.locator('#bet-continue')).toBeEnabled();
    await expect
      .poll(async () => {
        await page.click('#bet-continue', { timeout: 1_000 }).catch(() => {});
        return page.evaluate(
          () =>
            (window as unknown as StepWindow).__stepRequests.filter(
              (r) => r.type === 'PM_OPEN_AUTH_MENU',
            ).length,
        );
      })
      .toBe(2);
    const second = await waitForNthRequest(page, 'PM_OPEN_AUTH_MENU', 2);
    expect(second.requestId).not.toBe(first.requestId);
    await measureAuthMenu(
      page,
      { requestId: second.requestId, sessionId: second.payload.authMenuSessionId },
      1,
      { width: 400, height: 300 },
    );
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.hasAttribute('data-wallet-card-ready'),
      STEPS_MODAL,
    );
    const authenticated = {
      kind: 'authenticated',
      authMenuSessionId: 'modal-steps',
      walletId: 'step.testnet',
      method: 'passkey',
    };
    await postFromHost(page, {
      type: 'PM_RESULT',
      requestId: second.requestId,
      payload: { ok: true, result: authenticated },
    });
    // The call settles first; then the same modal shows the app's after step.
    await expect.poll(() => settledCalls(page)).toEqual([{ kind: 'value', value: authenticated }]);
    await expect(page.locator('#bet-after')).toContainText('Signed in as step.testnet');
    expect(await modalBox(page)).toMatchObject({ open: true, modal: true, ready: false });
    await page.click('#bet-done');
    await expect(page.locator(STEPS_MODAL)).toHaveCount(0);
  });

  test('Cancel in the before step sends nothing and resolves as cancelled', async ({ page }) => {
    await startModalStepsApp(page, true);
    await openSignInWithModalSteps(page);
    await page.click('#bet-cancel');
    await expect(page.locator(STEPS_MODAL)).toHaveCount(0);
    expect(await settledCalls(page)).toEqual([
      {
        kind: 'value',
        value: { kind: 'cancelled', authMenuSessionId: 'modal-steps', reason: 'close_button' },
      },
    ]);
    expect(await page.evaluate(() => (window as unknown as StepWindow).__stepRequests.length)).toBe(
      0,
    );
  });

  test('Close in a card after a before step closes the modal', async ({ page }) => {
    await startModalStepsApp(page, true);
    await openSignInWithModalSteps(page);
    await page.click('#bet-continue');
    const request = await waitForNthRequest(page, 'PM_OPEN_AUTH_MENU', 1);
    await measureAuthMenu(
      page,
      { requestId: request.requestId, sessionId: request.payload.authMenuSessionId },
      1,
      { width: 400, height: 300 },
    );
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.hasAttribute('data-wallet-card-ready'),
      STEPS_MODAL,
    );
    // The Wallet host reports Close, then the menu's cancelled outcome.
    await postFromHost(page, {
      type: 'SURFACE_CONTROL',
      requestId: request.requestId,
      payload: { requestId: request.requestId, control: 'close' },
    });
    const cancelled = {
      kind: 'cancelled',
      authMenuSessionId: 'modal-steps',
      reason: 'close_button',
    };
    await postFromHost(page, {
      type: 'PM_RESULT',
      requestId: request.requestId,
      payload: { ok: true, result: cancelled },
    });
    await expect.poll(() => settledCalls(page)).toEqual([{ kind: 'value', value: cancelled }]);
    await expect(page.locator(STEPS_MODAL)).toHaveCount(0);
  });

  test('a Speak-to-Sign request with only an after step shows its card with Close', async ({
    page,
  }) => {
    await startModalStepsApp(page, true);
    await page.evaluate(() => {
      const state = window as unknown as ModalStepsWindow;
      state.__seams.near.spoken
        .note({
          walletSession: 'step.testnet',
          contract: 'notes.testnet',
          postId: 1,
          text: 'A note',
          summary: 'plain words',
          steps: {
            title: 'Add a note',
            after: () => state.__h('p', { id: 'note-after' }, 'Posted'),
          },
        })
        .then((value: unknown) => state.__settled.push({ kind: 'value', value }));
    });
    const request = await waitForNthRequest(page, 'PM_SPEAK_TO_SIGN_NOTE', 1);
    // The card opens at once, with Close, and the request carries no app steps. Each
    // Speak-to-Sign payload carries `autoStart`, with the app's default.
    expect(request.presentation).toEqual({ kind: 'anchored_v1', chrome: 'close' });
    expect(Object.keys(request.payload).sort()).toEqual(['action', 'autoStart', 'walletId']);
    await postFromHost(page, {
      type: 'SURFACE_MEASUREMENT',
      payload: {
        kind: 'measured_v1',
        requestId: request.requestId,
        sequence: 1,
        widthCssPx: 400,
        heightCssPx: 360,
      },
    });
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.hasAttribute('data-wallet-card-ready'),
      STEPS_MODAL,
    );
    expect((await modalBox(page)).height).toBe(360);

    // A refused verdict did not complete: the modal closes and shows no after step.
    await postFromHost(page, {
      type: 'PM_RESULT',
      requestId: request.requestId,
      payload: { ok: true, result: { kind: 'refused', reason: 'note_not_valid' } },
    });
    await expect
      .poll(() => settledCalls(page))
      .toEqual([{ kind: 'value', value: { kind: 'refused', reason: 'note_not_valid' } }]);
    await expect(page.locator(STEPS_MODAL)).toHaveCount(0);
    await expect(page.locator('#note-after')).toHaveCount(0);
  });

  test('modal steps need TransactionReviewHost and take no anchor', async ({ page }) => {
    await startModalStepsApp(page, false);
    const errors = await page.evaluate(async () => {
      const state = window as unknown as ModalStepsWindow;
      const messages = await import('/_test-sdk/esm/SeamsWeb/walletIframe/shared/messages.js');
      const steps = { title: 'Sign in', before: () => null };
      const codeOf = (promise: Promise<unknown>) =>
        promise.then(
          () => 'resolved',
          (error: any) => error?.code ?? error?.message,
        );
      return [
        await codeOf(
          state.__seams.authMenu.open(
            messages.buildHostedAuthMenuOpenRequest({ authMenuSessionId: 'no-host' }),
            undefined,
            { steps },
          ),
        ),
        await codeOf(
          state.__seams.authMenu.open(
            messages.buildHostedAuthMenuOpenRequest({ authMenuSessionId: 'anchored' }),
            document.body,
            { steps },
          ),
        ),
        await codeOf(
          state.__seams.near.spoken.note({
            walletSession: 'step.testnet',
            contract: 'notes.testnet',
            postId: 1,
            text: 'A note',
            summary: 'plain words',
            steps: { title: '', after: () => null },
          }),
        ),
      ];
    });
    expect(errors).toEqual([
      'review_host_unavailable',
      'An auth menu with modal steps takes no anchor element',
      'review_invalid_input',
    ]);
    expect(await page.evaluate(() => (window as unknown as StepWindow).__stepRequests.length)).toBe(
      0,
    );
  });
});
