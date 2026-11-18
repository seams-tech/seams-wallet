import { expect, type FrameLocator, type Page } from '@playwright/test';
import { buildWalletServiceHtml } from '@/plugins/plugin-utils';
import type { HostedAuthMenuCopyInput } from '@/SeamsWeb/walletIframe/shared/messages';
import { setupBasicPasskeyTest } from '../../setup';
import { injectImportMap } from '../../setup/bootstrap';
import { registerWalletServiceRoute } from '../../wallet-iframe/harness';

/**
 * Opens today's hosted auth menu the way an app does: a WalletIframeRouter on the app page, the
 * real wallet-origin host in an iframe, and an anchor element in the app page. The page records
 * every host error event that reaches the document.
 */

const WALLET_ORIGIN = 'https://wallet.example.localhost';
const WALLET_SERVICE_ROUTE = '**://wallet.example.localhost/wallet-service*';
const OWNER_TAG = 'conformance-auth-menu';
const HOST_HTML = buildWalletServiceHtml('/_test-sdk/esm/sdk', undefined, 'runtime');

export const CONFORMANCE_AUTH_MENU_SESSION_ID = 'conformance-auth-menu-session';

export type HostedAuthMenuOpenOptions = {
  readonly initialMode?: 'login' | 'register';
  readonly showRegistrationInput?: boolean;
  readonly copy?: HostedAuthMenuCopyInput;
  /** The app's `appearance.theme.shape` tokens. */
  readonly shape?: Readonly<Record<string, string>>;
  readonly chrome?: 'close';
};

/** One `seams:hosted-auth-menu-error` event as the app page received it. */
export type RecordedHostEvent = {
  readonly detail: unknown;
  readonly bubbles: boolean;
  readonly composed: boolean;
  readonly targetIsAnchor: boolean;
};

type ConformanceWindow = Window & {
  __SEAMS_TEST_HOST_CONFIG__: { ui: Record<string, unknown> };
  __conformanceAuthMenu?: {
    router: { dispose(): void };
    events: RecordedHostEvent[];
  };
};

export async function prepareHostedAuthMenuPage(page: Page): Promise<void> {
  await setupBasicPasskeyTest(page, {
    skipSeamsWebInit: true,
    injectWalletServiceImportMap: true,
  });
  await page.goto('/');
  await injectImportMap(page);
  await registerWalletServiceRoute(page, HOST_HTML, WALLET_SERVICE_ROUTE);
}

export async function openHostedAuthMenu(
  page: Page,
  options: HostedAuthMenuOpenOptions = {},
): Promise<void> {
  await page.evaluate(openInPage, {
    walletOrigin: WALLET_ORIGIN,
    ownerTag: OWNER_TAG,
    authMenuSessionId: CONFORMANCE_AUTH_MENU_SESSION_ID,
    options,
  });
  // The menu first loads the wallet iframe and its workers, which is slow on a busy machine.
  await expect(hostedAuthMenuFrame(page).locator('.seams-auth-menu-surface')).toBeVisible({
    timeout: 30_000,
  });
}

async function openInPage(args: {
  walletOrigin: string;
  ownerTag: string;
  authMenuSessionId: string;
  options: HostedAuthMenuOpenOptions;
}): Promise<void> {
  const { WalletIframeRouter } = await import(
    '/_test-sdk/esm/SeamsWeb/walletIframe/client/router.js'
  );
  const { buildHostedAuthMenuOpenRequest } = await import(
    '/_test-sdk/esm/SeamsWeb/walletIframe/shared/messages.js'
  );
  const testWindow = window as unknown as ConformanceWindow;
  const hostConfig = testWindow.__SEAMS_TEST_HOST_CONFIG__;
  const { shape } = args.options;
  const router = new WalletIframeRouter({
    hostConfig: shape
      ? {
          ...hostConfig,
          ui: {
            ...hostConfig.ui,
            appearance: {
              theme: { id: 'conformance-app', mode: 'light', colors: {}, shape },
              palette: 'default',
            },
          },
        }
      : hostConfig,
    walletOrigin: args.walletOrigin,
    servicePath: '/wallet-service',
    sdkBasePath: '/sdk',
    testOptions: { ownerTag: args.ownerTag },
  });
  const anchor = document.createElement('div');
  anchor.style.width = '420px';
  document.body.appendChild(anchor);
  const events: RecordedHostEvent[] = [];
  document.addEventListener('seams:hosted-auth-menu-error', (event) => {
    events.push({
      detail: (event as CustomEvent).detail,
      bubbles: event.bubbles,
      composed: event.composed,
      targetIsAnchor: event.target === anchor,
    });
  });
  testWindow.__conformanceAuthMenu = { router, events };
  const request = buildHostedAuthMenuOpenRequest({
    authMenuSessionId: args.authMenuSessionId,
    initialMode: args.options.initialMode ?? 'login',
    showRegistrationInput: args.options.showRegistrationInput ?? false,
    ...(args.options.copy ? { copy: args.options.copy } : {}),
    ...(args.options.chrome ? { chrome: args.options.chrome } : {}),
  });
  void router.openHostedAuthMenu(request, anchor, { layer: 'page' }).catch(() => {});
}

export function hostedAuthMenuFrame(page: Page): FrameLocator {
  return page.frameLocator(`iframe[data-seams-owner="${OWNER_TAG}"]`);
}

export async function recordedHostEvents(page: Page): Promise<RecordedHostEvent[]> {
  return await page.evaluate(
    () => (window as unknown as ConformanceWindow).__conformanceAuthMenu?.events ?? [],
  );
}

export async function disposeHostedAuthMenu(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as ConformanceWindow).__conformanceAuthMenu?.router.dispose(),
  );
}
