import { test, expect } from '@playwright/test';
import { buildWalletServiceHtml as buildWalletHostServiceHtml } from '@/plugins/plugin-utils';
import { injectImportMap } from '../setup/bootstrap';
import { buildWalletServiceHtml, initRouter, registerWalletServiceRoute } from './harness';
import { WALLET_PROTOCOL_VERSION } from '../../packages/wallet/src/SeamsWeb/walletIframe/shared/messages';

const WALLET_ORIGIN = 'https://wallet.example.localhost';
const WALLET_SERVICE_ROUTE = '**://wallet.example.localhost/wallet-service';

function buildHostPortCloseProbeHtml(): string {
  return buildWalletHostServiceHtml('/_test-sdk/esm/sdk', undefined, 'runtime').replace(
    '</body>',
    `<script>
      (() => {
        const close = MessagePort.prototype.close;
        MessagePort.prototype.close = function () {
          window.parent.postMessage({ type: 'TEST_HOST_PORT_CLOSED' }, '*');
          return close.call(this);
        };
      })();
    </script></body>`,
  );
}

test.describe('Wallet iframe handshake', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => {
      console.log(`[browser] ${msg.type().toUpperCase()}: ${msg.text()}`);
    });
    const configured = String(process.env.SEAMS_TEST_FRONTEND_URL || '').trim();
    const url =
      configured ||
      (process.env.NO_CADDY === '1' || process.env.CI === '1'
        ? 'http://localhost:4004'
        : 'https://example.localhost');
    await page.goto(url);
  });

  test.afterEach(async ({ page }) => {
    await page.unroute(WALLET_SERVICE_ROUTE).catch(() => {});
  });

  // verifies the CONNECT→READY handshake succeeds and exposes a ready router
  test('resolves when the wallet host replies with READY', async ({ page }) => {
    await registerWalletServiceRoute(page, buildWalletServiceHtml(), WALLET_SERVICE_ROUTE);
    await initRouter(page, { walletOrigin: WALLET_ORIGIN });

    const readyState = await page.evaluate(async () => {
      const router = (window as any).__walletRouter;
      await router.init();
      return router.isReady();
    });

    expect(readyState).toBe(true);
  });

  // asserts init() times out if the wallet host never acknowledges READY
  test('rejects when READY never arrives within the timeout budget', async ({ page }) => {
    await registerWalletServiceRoute(
      page,
      buildWalletServiceHtml({ respondReady: false }),
      WALLET_SERVICE_ROUTE,
    );
    await initRouter(page, { walletOrigin: WALLET_ORIGIN, connectTimeoutMs: 200 });

    const result = await page.evaluate(async () => {
      const router = (window as any).__walletRouter;
      try {
        await router.init();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, message: err?.message };
      }
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(
      /^\[IframeTransport\] Wallet iframe READY timed out after \d+ms$/,
    );

    const readyState = await page.evaluate(() => {
      const router = (window as any).__walletRouter;
      return router.isReady();
    });

    expect(readyState).toBe(false);
  });

  test('rejects a protocol version mismatch in either direction', async ({ page }) => {
    const scenarios = [
      {
        // READY advertises a version that this SDK does not speak.
        html: buildWalletServiceHtml({
          protocolVersion: '13.0.0',
          expectedConnectProtocolVersion: null,
        }),
        message: `expected ${WALLET_PROTOCOL_VERSION}, received 13.0.0`,
      },
      {
        // The wallet host refuses the CONNECT from an older SDK.
        html: buildWalletServiceHtml({ expectedConnectProtocolVersion: '99.0.0' }),
        message: `expected 99.0.0, received ${WALLET_PROTOCOL_VERSION}`,
      },
    ];
    for (const scenario of scenarios) {
      await page.unroute(WALLET_SERVICE_ROUTE).catch(() => {});
      await page.reload();
      await registerWalletServiceRoute(page, scenario.html, WALLET_SERVICE_ROUTE);
      await initRouter(page, { walletOrigin: WALLET_ORIGIN, connectTimeoutMs: 1000 });

      const result = await page.evaluate(async () => {
        const router = (window as any).__walletRouter;
        try {
          await router.init();
          return { ok: true, ready: router.isReady() };
        } catch (err: any) {
          return { ok: false, code: err?.code, message: err?.message, ready: router.isReady() };
        }
      });

      expect(result).toMatchObject({
        ok: false,
        code: 'WALLET_IFRAME_PROTOCOL_VERSION_MISMATCH',
        ready: false,
      });
      expect(result.message).toContain(scenario.message);
    }
  });

  test('closes the transferred port after rejecting a mismatched CONNECT', async ({ page }) => {
    await injectImportMap(page);
    await registerWalletServiceRoute(page, buildHostPortCloseProbeHtml(), WALLET_SERVICE_ROUTE);

    const portClosed = await page.evaluate(
      async ({ walletOrigin }) => {
        const iframe = document.createElement('iframe');
        iframe.src = `${walletOrigin}/wallet-service`;
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
        await new Promise<void>((resolve) => {
          iframe.addEventListener('load', () => resolve(), { once: true });
        });

        const result = await new Promise<boolean>((resolve) => {
          const onMessage = (event: MessageEvent): void => {
            if (
              event.source !== iframe.contentWindow ||
              event.data?.type !== 'TEST_HOST_PORT_CLOSED'
            ) {
              return;
            }
            window.clearTimeout(timeout);
            window.removeEventListener('message', onMessage);
            resolve(true);
          };
          // Armed before the listener so the handler closes over a timer that
          // already exists; messages cannot arrive before this scope returns.
          const timeout = window.setTimeout(() => {
            window.removeEventListener('message', onMessage);
            resolve(false);
          }, 3_000);
          window.addEventListener('message', onMessage);

          const channel = new MessageChannel();
          channel.port1.start();
          iframe.contentWindow?.postMessage(
            { type: 'CONNECT', payload: { protocolVersion: '13.0.0' } },
            walletOrigin,
            [channel.port2],
          );
        });
        iframe.remove();
        return result;
      },
      { walletOrigin: WALLET_ORIGIN },
    );

    expect(portClosed).toBe(true);
  });
});
