import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { setupBasicPasskeyTest, SDK_ESM_PATHS } from '../setup';
import { buildWalletServiceHtml, registerWalletServiceRoute } from './harness';
import {
  thresholdEcdsaChainTargetFromChainFamily,
  toWalletId,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import {
  buildEvmFamilyEcdsaSignerBinding,
  exactEcdsaSigningLaneIdentity,
} from '@/core/signingEngine/session/identity/exactSigningLaneIdentity';
import {
  buildEvmFamilyEcdsaKeyIdentity,
  toEvmFamilyEcdsaKeyHandle,
  toRpId,
} from '@/core/signingEngine/session/identity/evmFamilyEcdsaIdentity';
import { buildMpcMaterialActivationRefFixture } from '../unit/helpers/ecdsaMaterialRef.fixtures';

const WALLET_ORIGIN = 'https://wallet.example.localhost';
const WALLET_SERVICE_ROUTE = '**://wallet.example.localhost/wallet-service*';
const EXPORT_WALLET_ID = toWalletId('alice.testnet');
const EXPORT_CHAIN_TARGET = thresholdEcdsaChainTargetFromChainFamily({
  chain: 'evm',
  chainId: 11155111,
  networkSlug: 'sepolia',
});
const EXPORT_LANE = exactEcdsaSigningLaneIdentity({
  signer: buildEvmFamilyEcdsaSignerBinding({
    walletId: EXPORT_WALLET_ID,
    chainTarget: EXPORT_CHAIN_TARGET,
    keyHandle: toEvmFamilyEcdsaKeyHandle('ecdsa-key-handle-export-variant'),
    key: buildEvmFamilyEcdsaKeyIdentity({
      walletId: EXPORT_WALLET_ID,
      ecdsaThresholdKeyId: 'ecdsa-threshold-export-variant',
      signingRootId: 'signing-root-export-variant',
      signingRootVersion: 'root-v1',
      participantIds: [1, 2],
      thresholdOwnerAddress: '0x2222222222222222222222222222222222222222',
    }),
    materialActivation: buildMpcMaterialActivationRefFixture('export-variant', EXPORT_WALLET_ID),
  }),
  auth: {
    kind: 'passkey',
    rpId: toRpId('example.localhost'),
    credentialIdB64u: 'credential-export-variant',
  },
});

const PREFERENCES_PUSH_STUB = `
  // Extend the base wallet-service stub with preference RPCs + push updates.
  (function installPreferencesPushStub() {
    let walletId = 'alice.testnet';
    let revision = 0;
    let heldSnapshot = null;
    let holdNextSnapshot = false;
    window.holdNextPreferenceSnapshot = () => { holdNextSnapshot = true; };
    window.hasHeldPreferenceSnapshot = () => heldSnapshot !== null;
    window.releasePreferenceSnapshot = () => {
      const held = heldSnapshot;
      heldSnapshot = null;
      respond(held.requestId, held.snapshot);
    };
    window.advancePreferenceWallet = () => {
      walletId = 'bob.testnet';
      confirmationConfig = { behavior: 'skipClick', uiMode: 'drawer', autoProceedDelay: 9 };
      pushPreferencesChanged();
    };
    window.pushStalePreference = () => adoptedPort.postMessage({
      type: 'PREFERENCES_CHANGED',
      payload: { walletId: 'alice.testnet', revision: 0, confirmationConfig: { behavior: 'requireClick', uiMode: 'modal' } },
    });
    let confirmationConfig = { behavior: 'requireClick', uiMode: 'modal', autoProceedDelay: 0 };

    const makeLoginSession = () => ({
      login: {
        isLoggedIn: true,
        walletId,
        nearAccountId: walletId,
        publicKey: null,
        userData: null,
        currentAuthMethod: { kind: 'none' },
        authMethods: [],
      },
      signingSession: null,
      currentAuthMethod: { kind: 'none' },
      authMethods: [],
    });

    const respond = (requestId, result) => {
      if (!requestId) return;
      try {
        adoptedPort.postMessage({ type: 'PM_RESULT', requestId, payload: { ok: true, result } });
      } catch (err) {
        console.error('[wallet-stub] failed to post PM_RESULT', err);
      }
    };

    const pushPreferencesChanged = () => {
      try {
        adoptedPort.postMessage({
          type: 'PREFERENCES_CHANGED',
          payload: {
            walletId,
            confirmationConfig,
            revision: ++revision,
          }
        });
      } catch (err) {
        console.error('[wallet-stub] failed to post PREFERENCES_CHANGED', err);
      }
    };

    const wrapPort = () => {
      if (!adoptedPort || adoptedPort.__seamsPrefsWrapped) return;
      adoptedPort.__seamsPrefsWrapped = true;
      const original = adoptedPort.onmessage;
      adoptedPort.onmessage = (event) => {
        const message = event.data || {};
        if (!message || typeof message !== 'object') return original && original(event);
        const { type, requestId } = message;

        if (type === 'PM_GET_EXACT_WALLET_SESSION_STATE') {
          respond(requestId, { revision: ++sessionObservationRevision, walletId, state: exactSessionState, session: publicSessionForState(exactSessionState) });
          return;
        }

        if (type === 'PM_GET_WALLET_SESSION') {
          respond(requestId, makeLoginSession());
          return;
        }

        if (type === 'PM_GET_CONFIRMATION_CONFIG') {
          const snapshot = { walletId, revision, confirmationConfig };
          if (holdNextSnapshot) {
            holdNextSnapshot = false;
            heldSnapshot = { requestId, snapshot };
          } else respond(requestId, snapshot);
          return;
        }

        if (type === 'PM_SET_CONFIRMATION_CONFIG') {
          const config = message?.payload?.config || {};
          confirmationConfig = { ...confirmationConfig, ...config };
          respond(requestId, { walletId, revision: ++revision, confirmationConfig });
          pushPreferencesChanged();
          return;
        }

        if (type === 'PM_SET_CONFIG') {
          const appearance = message.payload.kind === 'configure' ? message.payload.config.ui.appearance : message.payload.appearance;
          const themeMode = appearance.theme.mode;
          if (themeMode === 'dark' || themeMode === 'light') {
            window.__lastSetTheme = themeMode;
          }
          respond(requestId, undefined);
          return;
        }

        if (type === 'PM_SIGN_DELEGATE_ACTION') {
          window.parent?.postMessage({ type: 'TEST_SIGNING_SURFACE_STARTED' }, '*');
          respond(requestId, undefined);
          return;
        }

        if (type === 'PM_EXPORT_KEYPAIR_UI') {
          // Leave the export open so the parent surface can be read.
          window.parent?.postMessage({
            type: 'TEST_EXPORT_SURFACE_STARTED',
            variant: message?.payload?.options?.variant ?? null,
          }, '*');
          return;
        }

        return original && original(event);
      };
      pushPreferencesChanged();
    };

    const __origAdoptPort = adoptPort;
    adoptPort = (port) => {
      __origAdoptPort(port);
      wrapPort();
    };
  })();
`;

test.describe('Wallet iframe preferences sync', () => {
  test.beforeEach(async ({ page }) => {
    await setupBasicPasskeyTest(page, { skipSeamsWebInit: true });
    await page.waitForTimeout(200);
    await registerWalletServiceRoute(
      page,
      buildWalletServiceHtml({ extraScript: PREFERENCES_PUSH_STUB }),
      WALLET_SERVICE_ROUTE,
    );
  });

  test.afterEach(async ({ page }) => {
    await page.unroute(WALLET_SERVICE_ROUTE).catch(() => {});
  });

  test('uses the mirrored wallet preference to present signing and export in a drawer', async ({
    page,
  }) => {
    const seamsPath = SDK_ESM_PATHS.seamsWeb;
    const result = await page.evaluate(
      async ({ walletOrigin, seamsPath, walletId, chainTarget, laneIdentity }) => {
        const base =
          window.location.origin === 'null' ? 'https://example.localhost' : window.location.origin;
        const mod = await import(new URL(seamsPath, base).toString());
        const { SeamsWeb } = mod as typeof import('@/SeamsWeb');
        const seams = new SeamsWeb({
          chains: [
            {
              network: 'near-testnet',
              rpcUrl: 'https://test.rpc.fastnear.com',
              explorerUrl: 'https://testnet.nearblocks.io',
            },
          ],
          relayer: { url: 'http://localhost:3000' },
          iframeWallet: {
            walletOrigin,
            walletServicePath: '/wallet-service',
            sdkBasePath: '/sdk',
          },
        });

        await seams.connection.connect();
        const router = await (seams as any).walletIframe.requireRouter();
        await router.setConfirmationConfig({ uiMode: 'drawer' });
        const signing = router
          .post({
            type: 'PM_SIGN_DELEGATE_ACTION',
            payload: { walletId: 'alice.testnet', options: {} },
          })
          .catch(() => undefined);

        await new Promise<void>((resolve) => {
          const onStarted = (event: MessageEvent) => {
            if (event.data?.type !== 'TEST_SIGNING_SURFACE_STARTED') return;
            window.removeEventListener('message', onStarted);
            resolve();
          };
          window.addEventListener('message', onStarted);
        });

        const signingMode = router.getOverlayState().mode;
        await signing;

        // The Confirmer UI setting also decides the export surface, so the
        // parent frame and the export viewer agree on one variant.
        const exportStarted = new Promise<string | null>((resolve) => {
          const onStarted = (event: MessageEvent) => {
            if (event.data?.type !== 'TEST_EXPORT_SURFACE_STARTED') return;
            window.removeEventListener('message', onStarted);
            resolve(event.data.variant ?? null);
          };
          window.addEventListener('message', onStarted);
        });
        void router
          .exportKeypairWithUI({
            kind: 'ecdsa',
            walletSession: { walletId, walletSessionUserId: 'alice.testnet' },
            chainTarget,
            laneIdentity,
            options: { theme: 'light' },
          })
          .catch(() => undefined);
        const exportVariant = await exportStarted;
        const exportMode = router.getOverlayState().mode;
        router.dispose();
        return { signingMode, exportMode, exportVariant };
      },
      {
        walletOrigin: WALLET_ORIGIN,
        seamsPath,
        walletId: EXPORT_WALLET_ID,
        chainTarget: EXPORT_CHAIN_TARGET,
        laneIdentity: EXPORT_LANE,
      },
    );

    expect(result).toEqual({
      signingMode: 'bottom_drawer',
      exportMode: 'bottom_drawer',
      exportVariant: 'drawer',
    });
  });

  test('configuration selects chain targets and forwards appearance to the wallet host', async ({
    page,
  }, testInfo) => {
    const seamsPath = SDK_ESM_PATHS.seamsWeb;
    const result = await page.evaluate(
      async ({ walletOrigin, seamsPath }) => {
        try {
          const base =
            window.location.origin === 'null'
              ? 'https://example.localhost'
              : window.location.origin;
          const mod = await import(new URL(seamsPath, base).toString());
          const { SeamsWeb } = mod as typeof import('@/SeamsWeb');

          const seams = new SeamsWeb({
            chains: [
              {
                network: 'tempo-testnet',
                chainId: 42431,
                rpcUrl: 'https://rpc.moderato.tempo.xyz',
              },
              {
                network: 'near-testnet',
                rpcUrl: 'https://test.rpc.fastnear.com',
                explorerUrl: 'https://testnet.nearblocks.io',
              },
            ],
            relayer: { url: 'http://localhost:3000' },
            iframeWallet: {
              walletOrigin,
              walletServicePath: '/wallet-service',
              sdkBasePath: '/sdk',
            },
          });

          await seams.connection.connect();
          seams.config.setAppearance({ theme: { id: 'brand', mode: 'dark' } });
          const appearanceTheme = seams.theme;
          const { setTheme, chainTarget, configuredChainTargets } = seams.config;
          setTheme('light');
          const target = chainTarget('tempo-testnet');
          const targets = configuredChainTargets();

          return { success: true, currentTheme: seams.theme, appearanceTheme, target, targets };
        } catch (error: any) {
          return { success: false, error: error?.message || String(error) };
        }
      },
      { walletOrigin: WALLET_ORIGIN, seamsPath },
    );

    if (!result.success) {
      expect(result.success, result.error).toBe(true);
      return;
    }

    expect(result.currentTheme).toBe('light');
    expect(result.appearanceTheme).toBe('dark');
    expect(result.targets).toEqual([result.target]);

    const walletFrame = page.frames().find((frame) => {
      const url = frame.url();
      return url.startsWith(WALLET_ORIGIN) && url.includes('/wallet-service');
    });
    expect(walletFrame, 'wallet iframe should be mounted').toBeTruthy();

    await walletFrame!.waitForFunction(() => (window as any).__lastSetTheme === 'light', null, {
      timeout: 3000,
    });
    await writeFile(testInfo.outputPath('configuration.json'), JSON.stringify(result, null, 2));
  });
});

async function initializePreferenceOrdering(): Promise<void> {
  const routerPath = '/_test-sdk/esm/SeamsWeb/walletIframe/client/router.js';
  const { WalletIframeRouter } = await import(routerPath);
  const router = new WalletIframeRouter({
    hostConfig: (window as any).__SEAMS_TEST_HOST_CONFIG__,
    walletOrigin: 'https://wallet.example.localhost',
    servicePath: '/wallet-service',
    sdkBasePath: '/sdk',
  });
  const probe = { router, events: [], result: null, failure: null, initialized: false };
  (window as any).preferenceOrdering = probe;
  router.onPreferencesChanged(recordOrderedPreference);
  void router.init().then(recordPreferenceInitialized, recordPreferenceFailure);
}
function recordPreferenceInitialized(): void {
  (window as any).preferenceOrdering.initialized = true;
}
function recordOrderedPreference(payload: unknown): void {
  (window as any).preferenceOrdering.events.push(payload);
}
function beginPreferenceRead(): void {
  const probe = (window as any).preferenceOrdering;
  probe.result = null;
  probe.failure = null;
  void probe.router.getConfirmationConfig().then(recordPreferenceResult, recordPreferenceFailure);
}
function recordPreferenceResult(result: unknown): void {
  (window as any).preferenceOrdering.result = result;
}
function recordPreferenceFailure(error: Error): void {
  (window as any).preferenceOrdering.failure = error.message;
}
function readPreferenceOrdering() {
  const { events, result, failure, initialized } = (window as any).preferenceOrdering;
  return { events, result, failure, initialized };
}
function holdPreferenceRead(): void {
  (window as any).holdNextPreferenceSnapshot();
}
function hasPreferenceRead(): boolean {
  return (window as any).hasHeldPreferenceSnapshot();
}
function advancePreferenceWallet(): void {
  (window as any).advancePreferenceWallet();
}
function releasePreferenceRead(): void {
  (window as any).releasePreferenceSnapshot();
}
function pushStalePreference(): void {
  (window as any).pushStalePreference();
}
function disposePreferenceOrdering(): void {
  (window as any).preferenceOrdering.router.dispose();
}
async function verifyPreferenceOrdering({ page }: { page: Page }, info: TestInfo): Promise<void> {
  await setupBasicPasskeyTest(page, { skipSeamsWebInit: true });
  await registerWalletServiceRoute(
    page,
    buildWalletServiceHtml({
      extraScript: PREFERENCES_PUSH_STUB + '\nwindow.holdNextPreferenceSnapshot();',
    }),
    WALLET_SERVICE_ROUTE,
  );
  await page.addScriptTag({
    content: [
      recordPreferenceInitialized,
      recordOrderedPreference,
      recordPreferenceResult,
      recordPreferenceFailure,
    ]
      .map(functionSource)
      .join('\n'),
  });
  await page.evaluate(initializePreferenceOrdering);
  await expect.poll(hasWalletPreferenceFrame.bind(null, page)).toBe(true);
  const frame = page.frames().find(walletPreferenceFrame)!;
  await expect.poll(frame.evaluate.bind(frame, hasPreferenceRead)).toBe(true);
  await frame.evaluate(advancePreferenceWallet);
  await expect.poll(page.evaluate.bind(page, readPreferenceOrdering)).toMatchObject({
    events: [{ walletId: 'alice.testnet' }, { walletId: 'bob.testnet' }],
  });
  await frame.evaluate(pushStalePreference);
  await frame.evaluate(releasePreferenceRead);
  await expect
    .poll(page.evaluate.bind(page, readPreferenceOrdering))
    .toMatchObject({ initialized: true });
  await page.evaluate(beginPreferenceRead);
  await expect.poll(page.evaluate.bind(page, readPreferenceOrdering)).toMatchObject({
    result: { uiMode: 'drawer', behavior: 'skipClick', autoProceedDelay: 9 },
  });
  const ordered = await page.evaluate(readPreferenceOrdering);
  expect(ordered.events).toHaveLength(2);
  expect(ordered.events[1].revision).toBeGreaterThan(ordered.events[0].revision);
  await frame.evaluate(holdPreferenceRead);
  await page.evaluate(beginPreferenceRead);
  await expect.poll(frame.evaluate.bind(frame, hasPreferenceRead)).toBe(true);
  await page.evaluate(disposePreferenceOrdering);
  await expect.poll(page.evaluate.bind(page, readPreferenceOrdering)).toMatchObject({
    failure: expect.stringContaining('connection'),
  });
  const disposed = await page.evaluate(readPreferenceOrdering);
  expect(disposed.events).toEqual(ordered.events);
  const receipt = { ordered, disposed };
  const artifact = info.outputPath('preference-ordering.json');
  await writeFile(artifact, JSON.stringify(receipt, null, 2));
  await info.attach('preference-ordering', { path: artifact, contentType: 'application/json' });
}
function functionSource(fn: Function): string {
  return fn.toString();
}
function hasWalletPreferenceFrame(page: Page): boolean {
  return page.frames().some(walletPreferenceFrame);
}
function walletPreferenceFrame(frame: { url(): string }): boolean {
  return frame.url().startsWith('https://wallet.example.localhost/wallet-service');
}

test(
  'wallet-bound preference events outrank delayed snapshots and stop on disposal',
  verifyPreferenceOrdering,
);
