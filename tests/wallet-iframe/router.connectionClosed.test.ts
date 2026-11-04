import { expect, test } from '@playwright/test';
import { setupBasicPasskeyTest, SDK_ESM_PATHS } from '../setup';
import { buildWalletServiceHtml, registerWalletServiceRoute } from './harness';

const WALLET_ORIGIN = 'https://wallet.example.localhost';
const WALLET_SERVICE_ROUTE = '**://wallet.example.localhost/wallet-service*';

test.describe('WalletIframeRouter connection teardown', () => {
  test.beforeEach(async ({ page }) => {
    await setupBasicPasskeyTest(page, { skipSeamsWebInit: true });
    await registerWalletServiceRoute(page, buildWalletServiceHtml(), WALLET_SERVICE_ROUTE);
  });

  test.afterEach(async ({ page }) => {
    await page.unroute(WALLET_SERVICE_ROUTE).catch(() => {});
  });

  test('hides and removes an ordinary request surface on router disposal', async ({ page }) => {
    const result = await page.evaluate(
      async ({ routerPath, walletOrigin }) => {
        const routerModule = await import(routerPath);
        const router = new routerModule.WalletIframeRouter({
          hostConfig: (window as any).__SEAMS_TEST_HOST_CONFIG__,
          walletOrigin,
          servicePath: '/wallet-service',
          sdkBasePath: '/sdk',
          requestTimeoutMs: 10_000,
          testOptions: { ownerTag: 'connection-closed-request-test' },
        });
        await router.init();
        const request = router
          .signAndSendTransaction({
            walletId: 'connection-closed-request.testnet',
            nearAccountId: 'connection-closed-request.testnet',
            transaction: {
              receiverId: 'seams-v1.testnet',
              actions: [{ type: 'Transfer', amount: '1' } as any],
            },
            options: {},
          })
          .then(
            (value) => ({ kind: 'resolved' as const, value }),
            (error: unknown) => ({
              kind: 'rejected' as const,
              code:
                error && typeof error === 'object' && 'code' in error
                  ? String((error as { code?: unknown }).code)
                  : undefined,
              requestId:
                error && typeof error === 'object' && 'requestId' in error
                  ? (error as { requestId?: unknown }).requestId
                  : undefined,
            }),
          );
        const startedAt = Date.now();
        while (!router.getOverlayState().visible && Date.now() - startedAt < 3000) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const shown = router.getOverlayState().visible;
        const ownedDialog = document
          .querySelector('iframe[data-seams-owner="connection-closed-request-test"]')
          ?.closest('dialog.seams-wallet-overlay-dialog');
        router.dispose();
        const outcome = await Promise.race([
          request,
          new Promise<{ kind: 'timed_out' }>((resolve) =>
            setTimeout(() => resolve({ kind: 'timed_out' }), 500),
          ),
        ]);
        return {
          shown,
          outcome,
          hidden: !router.getOverlayState().visible,
          iframeRemoved: router.getIframeEl() === null,
          ownedDialogRemoved: ownedDialog ? !ownedDialog.isConnected : false,
        };
      },
      { routerPath: SDK_ESM_PATHS.walletIframeRouter, walletOrigin: WALLET_ORIGIN },
    );

    expect(result.shown).toBe(true);
    expect(result.outcome).toMatchObject({
      kind: 'resolved',
      value: { success: false, kind: 'submission_unknown' },
    });
    expect(result.hidden).toBe(true);
    expect(result.iframeRemoved).toBe(true);
    expect(result.ownedDialogRemoved).toBe(true);
  });
});
