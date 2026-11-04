import { writeFile } from 'node:fs/promises';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { encodeFunctionData, parseAbi } from 'viem';
import { setupBasicPasskeyTest } from '../setup';
import { injectImportMap } from '../setup/bootstrap';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import { buildWalletServiceHtml, registerWalletServiceRoute } from './harness';
/**
 * Long raw calldata across the REAL wallet-iframe boundary: the parent router,
 * the cross-origin wallet frame and the real confirmer take part; the only
 * stand-in is the wallet-service host runtime, whose stub hands the signing
 * request straight to `mountConfirmUI`. The raw calldata must scroll inside the
 * transaction details while the confirmation card stays within the screen.
 */

const WALLET_ORIGIN = 'https://wallet.example.localhost';
const WALLET_SERVICE_ROUTE = '**://wallet.example.localhost/wallet-service*';
const CONTRACT = '0xbb442b6d9a4c1f0f3e2d3c4b5a6978695a4b3a48';
const SET_GREETING_ABI = [
  {
    type: 'function',
    name: 'setGreeting',
    inputs: [{ name: 'newGreeting', type: 'string' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

const childScript = (calldata: string) => String.raw`
  const CALLDATA = '${calldata}';
  const ABI = ${JSON.stringify(SET_GREETING_ABI)};
  const originalAdoptPort = adoptPort;
  adoptPort = function patchedAdoptPort(port) {
    originalAdoptPort(port);
    if (!adoptedPort) return;
    const originalHandler = adoptedPort.onmessage;
    adoptedPort.onmessage = (event) => {
      originalHandler?.(event);
      const message = event.data || {};
      if (message.type !== 'PM_SIGN_TEMPO' || typeof message.requestId !== 'string') return;
      window.__mountReal(message.requestId).catch((e) => { window.__mountError = String((e && e.stack) || e); });
    };
  };
  window.__measurements = [];
  window.__mountReal = async (requestId) => {
    const confirmUi = await import('/_test-sdk/esm/sdk/tx-confirm-ui.js');
    const evm = await import('/_test-sdk/esm/core/signingEngine/chains/evm/display/evmTx.js');
    const model = evm.buildEvmDisplayModel({ request: { chain: 'evm', kind: 'eip1559', senderSignatureAlgorithm: 'secp256k1',
      tx: { chainId: 42431, nonce: 1n, maxPriorityFeePerGas: 1500000000n, maxFeePerGas: 3000000000n, gasLimit: 200000n,
        to: '${CONTRACT}', value: 0n, data: CALLDATA, accessList: [], abi: ABI } } });
    const ctx = { surfaceMeasurementBinding: { kind: 'wallet_iframe', requestId,
        postMeasurement: (m) => { window.__measurements.push(m.heightCssPx); adoptedPort.postMessage({ type: 'SURFACE_MEASUREMENT', payload: m }); } } };
    const handle = await confirmUi.mountConfirmUI({ ctx, summary: { intentDigest: 'tree-growth' }, model,
      securityContext: { blockHeight: '1', blockHash: 'h' }, loading: false, theme: 'light', uiMode: 'modal' });
    window.__confirmHandle = handle;
    window.__mounted = true;
  };
`;

async function openRealModal(page: Page, options: { greeting?: string } = {}): Promise<Frame> {
  await page.goto('about:blank');
  await injectImportMap(page);
  const calldata = encodeFunctionData({
    abi: parseAbi(['function setGreeting(string newGreeting)']),
    functionName: 'setGreeting',
    args: [options.greeting ?? 'Hello Tempo'],
  });
  // The stub document must reset the UA body margin exactly like the real
  // wallet-service document does (wallet-service.css): with an 8px margin the
  // host is 16px narrower than the frame, the parent eases the width down to
  // the host each round, and the two chase each other in width.
  const html = buildWalletServiceHtml({ extraScript: childScript(calldata) }).replace(
    '</head>',
    `<link rel="stylesheet" href="/sdk/wallet-ui.css" />
      ${buildTestBrowserImportMapHtml()}</head>`,
  );
  await registerWalletServiceRoute(page, html, WALLET_SERVICE_ROUTE);

  await page.evaluate(
    async ({ walletOrigin, calldata, contract }) => {
      const routerModule = (await import(
        /* @vite-ignore */ '/_test-sdk/esm/SeamsWeb/walletIframe/client/router.js' as string
      )) as typeof import('@/SeamsWeb/walletIframe/client/router');
      const router = new routerModule.WalletIframeRouter({
        hostConfig: (window as any).__SEAMS_TEST_HOST_CONFIG__,
        walletOrigin,
        servicePath: '/wallet-service',
        sdkBasePath: '/sdk',
        requestTimeoutMs: 60_000,
        testOptions: { ownerTag: 'tree-growth-integration' },
      });
      await router.init();
      (window as any).__treeGrowthRouter = router;
      void router
        .signTempo({
          walletSession: { walletId: 'alice.testnet', walletSessionUserId: 'u' } as any,
          request: {
            chain: 'evm',
            kind: 'eip1559',
            senderSignatureAlgorithm: 'secp256k1',
            tx: {
              chainId: 42431,
              nonce: 1n,
              maxPriorityFeePerGas: 1_500_000_000n,
              maxFeePerGas: 3_000_000_000n,
              gasLimit: 200_000n,
              to: contract,
              value: 0n,
              data: calldata,
              accessList: [],
            },
          } as any,
          chainTarget: {
            kind: 'evm',
            namespace: 'eip155',
            chainId: 42431,
            networkSlug: 'tempo-testnet',
          } as any,
          options: { confirmationConfig: { uiMode: 'modal' } },
        })
        .catch(() => undefined);
    },
    { walletOrigin: WALLET_ORIGIN, calldata, contract: CONTRACT },
  );

  await page.waitForFunction(
    () => {
      const dialog = document.querySelector('dialog.seams-wallet-overlay-dialog');
      return (
        !!dialog &&
        dialog.classList.contains('is-modal') &&
        !dialog.classList.contains('is-provisional')
      );
    },
    undefined,
    { timeout: 30_000 },
  );
  const frame = page.frames().find((candidate) => candidate.url().startsWith(WALLET_ORIGIN));
  if (!frame)
    throw new Error(
      `wallet frame missing: ${page
        .frames()
        .map((f) => f.url())
        .join(', ')}`,
    );
  await frame.waitForFunction(
    () => {
      const state = window as unknown as { __mounted?: boolean; __mountError?: string };
      if (state.__mountError) throw new Error(`mountConfirmUI failed: ${state.__mountError}`);
      return state.__mounted === true && !!document.querySelector('.seams-review-technical');
    },
    undefined,
    { timeout: 30_000 },
  );
  // An unstyled confirmer does not hug its box, and every geometry assertion
  // would then fail for that reason alone.
  const styled = await frame.evaluate(
    () =>
      !!document.querySelector<HTMLLinkElement>('link[href="/sdk/wallet-ui.css"]')?.sheet?.cssRules
        .length,
  );
  if (!styled)
    throw new Error(
      '/sdk/wallet-ui.css did not load. The route serves packages/wallet/dist/public: build it ' +
        'with `pnpm -C packages/wallet build:static-wallet-assets` after the SDK build.',
    );
  // Let the confirmer's own settling (headings, halo) finish before measuring.
  await page.waitForTimeout(600);
  return frame;
}

function readRawDisclosureGeometry() {
  const raw = document.querySelector<HTMLDetailsElement>('.seams-review-raw');
  const card = document.querySelector<HTMLElement>('.modal-container-root');
  if (!raw || !card) throw new Error('Raw disclosure and confirmation card are required');
  const cardHeight = card.getBoundingClientRect().height;
  const viewportHeight = document.documentElement.clientHeight;
  return {
    open: raw.open,
    cardHeight,
    viewportHeight,
    fits: Math.abs(cardHeight - viewportHeight) <= 1,
  };
}

function scrollTechnicalDetailsToEnd() {
  const details = document.querySelector<HTMLElement>('.seams-review-technical > div');
  if (!details) throw new Error('Transaction details are required');
  details.scrollTop = details.scrollHeight;
  return {
    top: details.scrollTop,
    height: details.clientHeight,
    contentHeight: details.scrollHeight,
  };
}

test.describe('wallet iframe long calldata', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    await setupBasicPasskeyTest(page, {
      skipSeamsWebInit: true,
      injectWalletServiceImportMap: true,
    });
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__treeGrowthRouter?.dispose();
      delete (window as any).__treeGrowthRouter;
    });
    await page.unroute(WALLET_SERVICE_ROUTE).catch(() => {});
  });

  test('long raw calldata scrolls inside the details while the modal stays within the screen', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const frame = await openRealModal(page, { greeting: `Hello Tempo ${'x'.repeat(120)}` });
    await frame.locator('.seams-review-technical:not([open]) > summary').click();
    await page.waitForTimeout(400);

    const rawSummary = frame.locator('.seams-review-raw > summary');
    const before = await frame.evaluate(readRawDisclosureGeometry);
    await rawSummary.click();
    await expect.poll(frame.evaluate.bind(frame, readRawDisclosureGeometry)).toMatchObject({
      open: true,
      fits: true,
      cardHeight: before.cardHeight,
    });
    const opening = await frame.evaluate(readRawDisclosureGeometry);
    const scrolled = await frame.evaluate(scrollTechnicalDetailsToEnd);
    expect(scrolled.top).toBeGreaterThan(0);
    expect(Math.abs(scrolled.top + scrolled.height - scrolled.contentHeight)).toBeLessThanOrEqual(
      1,
    );
    await page.screenshot({ path: testInfo.outputPath('scrollable-transaction-details.png') });
    await rawSummary.click();
    await expect.poll(frame.evaluate.bind(frame, readRawDisclosureGeometry)).toMatchObject({
      open: false,
      fits: true,
    });
    const closing = await frame.evaluate(readRawDisclosureGeometry);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await rawSummary.click();
    await expect.poll(frame.evaluate.bind(frame, readRawDisclosureGeometry)).toMatchObject({
      open: true,
      fits: true,
    });
    const reducedOpening = await frame.evaluate(readRawDisclosureGeometry);
    await rawSummary.click();
    await expect.poll(frame.evaluate.bind(frame, readRawDisclosureGeometry)).toMatchObject({
      open: false,
      fits: true,
    });
    const reducedClosing = await frame.evaluate(readRawDisclosureGeometry);
    await writeFile(
      testInfo.outputPath('raw-disclosure-motion.json'),
      JSON.stringify({ opening, scrolled, closing, reducedOpening, reducedClosing }, null, 2),
    );
  });
});
