import { test, expect } from '@playwright/test';
import { setupBasicPasskeyTest, SDK_ESM_PATHS } from '../setup';
import {
  buildWalletServiceHtml,
  captureOverlay,
  registerWalletServiceRoute,
  waitFor,
} from './harness';
import { parseWebAuthnRpId } from '@shared/utils/domainIds';

const WALLET_ORIGIN = 'https://wallet.example.localhost';
const WALLET_SERVICE_ROUTE = '**://wallet.example.localhost/wallet-service*';
const CAPTURE_OVERLAY_SOURCE = `(${captureOverlay.toString()})`;
const WAIT_FOR_SOURCE = `(${waitFor.toString()})`;
const CANCEL_SIGNING_PROGRESS_SCRIPT = String.raw`
  const originalAdoptPort = adoptPort;
  adoptPort = function patchedAdoptPort(port) {
    originalAdoptPort(port);
    if (!adoptedPort) return;
    const originalHandler = adoptedPort.onmessage;
    adoptedPort.onmessage = (event) => {
      originalHandler?.(event);
      const data = event.data || {};
      if (data.type !== 'PM_EXECUTE_ACTION' || typeof data.requestId !== 'string') return;
      setTimeout(() => {
        adoptedPort.postMessage({
          type: 'PROGRESS',
          requestId: data.requestId,
          payload: {
            version: 2,
            flow: 'signing',
            step: 5,
            phase: 'signing.confirmation.cancelled',
            status: 'cancelled',
            message: 'Request cancelled.',
            flowId: 'signing:test:' + data.requestId,
            requestId: data.requestId,
            interaction: { kind: 'transaction_confirmation', overlay: 'hide' },
          },
        });
      }, 20);
    };
  };
`;

function unwrapFixture<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) throw new Error('invalid fixture value');
  return result.value;
}

const REGISTRATION_RP_ID = unwrapFixture(parseWebAuthnRpId('example.localhost'));

test.describe('WalletIframeRouter cancellation progress', () => {
  test.beforeEach(async ({ page }) => {
    await setupBasicPasskeyTest(page);
    await registerWalletServiceRoute(page, buildWalletServiceHtml(), WALLET_SERVICE_ROUTE);
  });

  test.afterEach(async ({ page }) => {
    await page.unroute(WALLET_SERVICE_ROUTE).catch(() => {});
  });

  test('forwards v2 cancelled terminal events for core request flows', async ({ page }) => {
    const result = await page.evaluate(
      async ({
        routerPath,
        walletOrigin,
        registrationRpId,
        captureOverlaySource,
        waitForSource,
      }) => {
        const mod = await import(routerPath);
        const { WalletIframeRouter } =
          mod as typeof import('@/SeamsWeb/walletIframe/client/router');
        const capture = eval(captureOverlaySource) as typeof import('./harness').captureOverlay;
        const waitFor = eval(waitForSource) as typeof import('./harness').waitFor;

        const router = new WalletIframeRouter({
          walletOrigin,
          servicePath: '/wallet-service',
          connectTimeoutMs: 3000,
          requestTimeoutMs: 5000,
          debug: true,
          sdkBasePath: '/sdk',
        });
        await router.init();

        const events: Record<string, any[]> = {
          registration: [],
          unlock: [],
          signing: [],
        };
        const registrationSignerSet = {
          kind: 'signer_set' as const,
          signers: [
            {
              kind: 'near_ed25519' as const,
              accountProvisioning: {
                kind: 'implicit_account' as const,
                accountIdSource: 'ed25519_public_key' as const,
              },
              signerSlot: 1,
              participantIds: [1, 2],
              derivationVersion: 1,
            },
          ],
        };

        const runAndCancel = async (
          name: keyof typeof events,
          run: () => Promise<unknown>,
        ): Promise<{
          message: string;
          code?: string;
          overlayHidden: boolean;
        }> => {
          const pending = run().catch((error: any) => ({
            message: String(error?.message || error || ''),
            code: typeof error?.code === 'string' ? error.code : undefined,
          }));
          await waitFor(() => router.getOverlayState().visible, 3000);
          await router.cancelAll();
          const overlayHidden = await waitFor(() => {
            const state = capture();
            return !state.exists || !state.visible;
          }, 3000);
          const settled = (await pending) as { message: string; code?: string };
          return { ...settled, overlayHidden };
        };

        const registration = await runAndCancel('registration', () =>
          router.registerWallet({
            wallet: { kind: 'server_allocated' },
            authMethod: { kind: 'passkey', rpId: registrationRpId },
            signerSelection: registrationSignerSet,
            options: { onEvent: (event: any) => events.registration.push(event) },
          }),
        );
        const unlock = await runAndCancel('unlock', () =>
          router.unlock({
            kind: 'custom_options',
            walletId: 'alice.testnet',
            options: { onEvent: (event: any) => events.unlock.push(event) },
          }),
        );
        const signing = await runAndCancel('signing', () =>
          router.executeAction({
            walletId: 'alice.testnet',
            nearAccountId: 'alice.testnet',
            receiverId: 'seams-v1.testnet',
            actionArgs: { type: 'Transfer', amount: '1' } as any,
            options: { onEvent: (event: any) => events.signing.push(event) },
          }),
        );

        return {
          registration,
          unlock,
          signing,
          events,
        };
      },
      {
        routerPath: SDK_ESM_PATHS.walletIframeRouter,
        walletOrigin: WALLET_ORIGIN,
        registrationRpId: REGISTRATION_RP_ID,
        captureOverlaySource: CAPTURE_OVERLAY_SOURCE,
        waitForSource: WAIT_FOR_SOURCE,
      },
    );

    expect(result.registration).toMatchObject({
      message: 'Request cancelled.',
      code: 'cancelled',
      overlayHidden: true,
    });
    expect(result.unlock).toMatchObject({
      message: 'Request cancelled.',
      code: 'cancelled',
      overlayHidden: true,
    });
    expect(result.signing).toMatchObject({
      message: 'Request cancelled.',
      code: 'cancelled',
      overlayHidden: true,
    });

    expect(result.events.registration.at(-1)).toMatchObject({
      version: 2,
      flow: 'registration',
      step: 0,
      phase: 'registration.cancelled',
      status: 'cancelled',
      message: 'Request cancelled.',
      error: { code: 'cancelled', message: 'Request cancelled.' },
      interaction: { kind: 'none', overlay: 'hide' },
    });
    expect(result.events.unlock.at(-1)).toMatchObject({
      version: 2,
      flow: 'unlock',
      step: 0,
      phase: 'unlock.cancelled',
      status: 'cancelled',
      message: 'Request cancelled.',
      error: { code: 'cancelled', message: 'Request cancelled.' },
      interaction: { kind: 'none', overlay: 'hide' },
    });
    expect(result.events.signing.at(-1)).toMatchObject({
      version: 2,
      flow: 'signing',
      step: 0,
      phase: 'signing.cancelled',
      status: 'cancelled',
      message: 'Request cancelled.',
      error: { code: 'cancelled', message: 'Request cancelled.' },
      interaction: { kind: 'none', overlay: 'hide' },
    });
  });

  test('hides the overlay before the wallet service acknowledges cancellation', async ({
    page,
  }) => {
    await page.unroute(WALLET_SERVICE_ROUTE);
    await registerWalletServiceRoute(
      page,
      buildWalletServiceHtml({ cancelResponseDelayMs: 1_000 }),
      WALLET_SERVICE_ROUTE,
    );

    const result = await page.evaluate(
      async ({ routerPath, walletOrigin, captureOverlaySource, waitForSource }) => {
        const mod = await import(routerPath);
        const { WalletIframeRouter } =
          mod as typeof import('@/SeamsWeb/walletIframe/client/router');
        const capture = eval(captureOverlaySource) as typeof import('./harness').captureOverlay;
        const waitFor = eval(waitForSource) as typeof import('./harness').waitFor;
        const router = new WalletIframeRouter({
          walletOrigin,
          servicePath: '/wallet-service',
          connectTimeoutMs: 3_000,
          requestTimeoutMs: 5_000,
          debug: true,
          sdkBasePath: '/sdk',
        });
        await router.init();

        const request = router
          .executeAction({
            walletId: 'alice.testnet',
            nearAccountId: 'alice.testnet',
            receiverId: 'seams-v1.testnet',
            actionArgs: { type: 'Transfer', amount: '1' } as any,
            options: {},
          })
          .catch(() => undefined);
        await waitFor(() => router.getOverlayState().visible, 3_000);

        const cancelStartedAt = performance.now();
        const cancellation = router.cancelAll();
        const hiddenBeforeAcknowledgement = !router.getOverlayState().visible && !capture().visible;
        const visualDismissalMs = performance.now() - cancelStartedAt;

        await cancellation;
        await request;
        const requestSettlementMs = performance.now() - cancelStartedAt;
        return { hiddenBeforeAcknowledgement, visualDismissalMs, requestSettlementMs };
      },
      {
        routerPath: SDK_ESM_PATHS.walletIframeRouter,
        walletOrigin: WALLET_ORIGIN,
        captureOverlaySource: CAPTURE_OVERLAY_SOURCE,
        waitForSource: WAIT_FOR_SOURCE,
      },
    );

    expect(result.hiddenBeforeAcknowledgement).toBe(true);
    expect(result.visualDismissalMs).toBeLessThan(100);
    expect(result.requestSettlementMs).toBeLessThan(100);
  });

  test('settles the request when cancellation progress arrives before service cleanup', async ({
    page,
  }) => {
    await page.unroute(WALLET_SERVICE_ROUTE);
    await registerWalletServiceRoute(
      page,
      buildWalletServiceHtml({
        cancelResponseDelayMs: 1_000,
        extraScript: CANCEL_SIGNING_PROGRESS_SCRIPT,
      }),
      WALLET_SERVICE_ROUTE,
    );

    const result = await page.evaluate(
      async ({ routerPath, walletOrigin, captureOverlaySource, waitForSource }) => {
        const mod = await import(routerPath);
        const { WalletIframeRouter } =
          mod as typeof import('@/SeamsWeb/walletIframe/client/router');
        const capture = eval(captureOverlaySource) as typeof import('./harness').captureOverlay;
        const waitFor = eval(waitForSource) as typeof import('./harness').waitFor;
        const router = new WalletIframeRouter({
          walletOrigin,
          servicePath: '/wallet-service',
          connectTimeoutMs: 3_000,
          requestTimeoutMs: 5_000,
          debug: true,
          sdkBasePath: '/sdk',
        });
        await router.init();

        const events: Array<{ status?: string }> = [];
        const requestStartedAt = performance.now();
        const request = router
          .executeAction({
            walletId: 'alice.testnet',
            nearAccountId: 'alice.testnet',
            receiverId: 'seams-v1.testnet',
            actionArgs: { type: 'Transfer', amount: '1' } as any,
            options: { onEvent: (event) => events.push(event) },
          })
          .then(
            () => ({ message: '', code: '' }),
            (error: Error & { code?: string }) => ({
              message: error.message,
              code: error.code || '',
            }),
          );
        await waitFor(() => router.getOverlayState().visible, 3_000);
        const requestResult = await request;
        const requestSettlementMs = performance.now() - requestStartedAt;
        await new Promise((resolve) => setTimeout(resolve, 1_100));
        const overlay = capture();

        return {
          requestResult,
          requestSettlementMs,
          overlayHidden: !router.getOverlayState().visible && !overlay.visible,
          cancellationEventCount: events.filter((event) => event.status === 'cancelled').length,
        };
      },
      {
        routerPath: SDK_ESM_PATHS.walletIframeRouter,
        walletOrigin: WALLET_ORIGIN,
        captureOverlaySource: CAPTURE_OVERLAY_SOURCE,
        waitForSource: WAIT_FOR_SOURCE,
      },
    );

    expect(result.requestResult).toEqual({ message: 'Request cancelled.', code: 'cancelled' });
    expect(result.overlayHidden).toBe(true);
    expect(result.cancellationEventCount).toBe(1);
    expect(result.requestSettlementMs).toBeLessThan(250);
  });
});
