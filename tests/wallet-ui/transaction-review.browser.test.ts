import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { injectImportMap } from '../setup/bootstrap';
import { routePreactModules } from '../setup/preact';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import { buildWalletServiceHtml, registerWalletServiceRoute } from '../wallet-iframe/harness';

const walletOrigin = 'https://wallet.example.localhost';
const walletId = 'review.testnet';

// Raw wallet responses exercise the production boundary parser.
const session = {
  appIdentity: {
    kind: 'resolved',
    walletId,
    nearAccountId: walletId,
    nearOperationalPublicKey: null,
    userData: null,
    authMethods: [],
    thresholdEcdsaEthereumAddress: null,
    thresholdEcdsaPublicKeyB64u: null,
  },
  authentication: { kind: 'authenticated', walletId, authMethod: 'passkey' },
  capabilityProjection: { kind: 'not_requested' },
  nonceDiagnostics: null,
};

const hostScript = `
  const reviewRequests = new Map();
  window.reviewClosedReceipts = [];
  window.reviewPostActivity = (requestId, payload) => adoptedPort.postMessage({
    type: 'TRANSACTION_ACTIVITY', requestId, payload,
  });
  window.reviewPushPreferences = confirmationConfig => adoptedPort.postMessage({
    type: 'PREFERENCES_CHANGED',
    payload: { walletId: 'review.testnet', confirmationConfig, updatedAt: Date.now() },
  });
  function postReviewMessage(message) {
    if (window.reviewRetainReceipt && message.type === 'PM_RESULT') {
      window.reviewPostActivity(message.requestId, 'expanded');
    }
    adoptedPort.postMessage(message);
  }
  window.reviewSetExactSession = state => { exactSessionState = state; };
  const originalAdopt = adoptPort;
  adoptPort = function(port) {
    originalAdopt(port);
    const ordinary = adoptedPort.onmessage;
    adoptedPort.onmessage = async function(event) {
      const message = event.data;
      if (message.type === 'PM_HAS_PASSKEY') { postResult(message.requestId, false); return; }
      if (message.type === 'PM_GET_RECENT_UNLOCKS') { postResult(message.requestId, []); return; }
      if (message.type === 'PM_PREFETCH_BLOCKHEIGHT') { postResult(message.requestId, undefined); return; }
      if (message.type === 'PM_GET_WALLET_SESSION') {
        postResult(message.requestId, ${JSON.stringify(session)});
        return;
      }
      if (message.type === 'PM_SET_TRANSACTION_VIEW') {
        window.reviewClosedReceipts.push(message.payload);
        return;
      }
      if (message.type === 'PM_ACTIVATE_TRANSACTION_REVIEW') {
        if (window.reviewIgnoreActivation) return;
        reviewRequests.get(message.payload.requestId)?.admission.activate(message.payload);
        return;
      }
      if (message.type === 'PM_CANCEL' && message.payload?.transactionReview) {
        reviewRequests.get(message.payload.requestId)?.admission.cancel(Object.assign(new Error('Cancelled'), { code: message.payload.reviewErrorCode ?? 'cancelled' }));
        return;
      }
      if (!message.transactionReview) { ordinary(event); return; }
      if (window.reviewHostFailure) {
        window.parent.postMessage({ type: 'TEST_REVIEW_DISPATCH', message }, '*');
        adoptedPort.postMessage({ type: 'ERROR', requestId: message.requestId, payload: { code: 'test_core_error', message: 'Core signing rejected' } });
        return;
      }
      const metadata = message.transactionReview;
        const { prepareReview } = await import(location.origin + '/review-wallet-probe.js');
      const admission = prepareReview(metadata, postReviewMessage);
      reviewRequests.set(message.requestId, { admission });
      window.parent.postMessage({ type: 'TEST_REVIEW_DISPATCH', message }, '*');
    };
  };
`;

let hostBundle: string;
test.beforeAll(() => {
  const output = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve(import.meta.dirname, '../scripts/build-preact-probe.mjs'),
        'ReviewWalletHostProbe.ts',
      ],
      { encoding: 'utf8' },
    ),
  );
  hostBundle = output[0].code;
});

async function mountReviewApplication(page: Page): Promise<void> {
  await page.route('**/review-wallet-probe.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: hostBundle }),
  );
  await injectImportMap(page);
  await routePreactModules(page);
  await page.route('**/review-app', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': "style-src 'self'; style-src-attr 'none'" },
      body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}</head><body></body></html>`,
    }),
  );
  await page.goto('/review-app');
  await registerWalletServiceRoute(
    page,
    buildWalletServiceHtml({
      exactSessionState: {
        kind: 'wallet_unlocked_without_signing_session',
        walletId,
        reason: 'absent',
      },
      extraScript: hostScript,
    })
      .replace(
        '<head>',
        `<head><meta http-equiv="Content-Security-Policy" content="style-src 'self'; style-src-attr 'none'">${buildTestBrowserImportMapHtml()}<link rel="stylesheet" href="${walletOrigin}/_test-sdk/esm/sdk/wallet-ui.css">`,
      )
      .replace(/<style>[\s\S]*?<\/style>/, '')
      .replace(/<main>[\s\S]*?<\/main>/, ''),
    '**://wallet.example.localhost/wallet-service*',
  );
  await page.evaluate(
    async ({ walletOrigin }) => {
      const React = await import('react');
      const { createRoot } = await import('react-dom/client');
      const { SeamsWebProvider } = await import('/_test-sdk/esm/react/context/SeamsWebProvider.js');
      const { useWallet } = await import('/_test-sdk/esm/react/hooks/useWallet.js');
      const { TransactionReviewHost } =
        await import('/_test-sdk/esm/react/transactionReview/TransactionReviewHost.js');
      const { useSeams } = await import('/_test-sdk/esm/react/context/index.js');
      const h = React.createElement;
      const PurchaseContext = React.createContext('missing-context');
      const state = window as any;
      state.reviewResults = [];
      state.reviewViolations = [];
      document.addEventListener('securitypolicyviolation', (event) =>
        state.reviewViolations.push({
          directive: event.violatedDirective,
          source: event.sourceFile,
          line: event.lineNumber,
          blocked: event.blockedURI,
        }),
      );
      state.reviewDispatches = [];
      state.reviewSigned = 0;
      window.addEventListener('message', (event) => {
        if (event.data?.type === 'TEST_REVIEW_DISPATCH')
          state.reviewDispatches.push(event.data.message);
        if (event.data?.type === 'TEST_REVIEW_SIGNED') state.reviewSigned += 1;
      });
      function Purchase({ controls }: any) {
        const context = React.useContext(PurchaseContext);
        const [note, setNote] = React.useState('');
        return h(
          'div',
          null,
          h('p', null, context),
          h(
            'label',
            null,
            'Purchase note',
            h('input', { value: note, onChange: updateNote.bind(null, setNote) }),
          ),
          h('button', { onClick: controls.continueToWallet }, 'Continue to wallet'),
          h('button', { onClick: controls.cancel }, 'Cancel purchase'),
        );
      }
      function updateNote(setNote: (value: string) => void, event: any) {
        setNote(event.target.value);
      }
      function renderPurchase(controls: any) {
        state.reviewControls = controls;
        return h(Purchase, { controls });
      }
      function capture(value: unknown) {
        state.reviewResults.push({ kind: 'result', value });
      }
      function captureError(error: any) {
        state.reviewResults.push({ kind: 'error', code: error.code, message: error.message });
      }
      function Checkout() {
        const wallet = useWallet();
        const { seams } = useSeams();
        state.reviewWallet = wallet;
        state.reviewSeams = seams;
        function start() {
          if (!wallet.near) return;
          const args = {
            receiverId: 'receiver.testnet',
            actions: [{ type: 'Transfer', amount: '1' }],
            review: {
              title: 'Review purchase',
              validity: { kind: 'unbounded' },
              render: renderPurchase,
            },
          };
          wallet.near.signAndSendTransaction(args).then(capture, captureError);
          args.receiverId = 'mutated.testnet';
          args.actions[0].amount = '999';
        }
        return h('button', { onClick: start, disabled: !wallet.near }, 'Buy');
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
      const root = createRoot(container);
      state.reviewRoot = root;
      root.render(
        h(
          React.StrictMode,
          null,
          h(
            SeamsWebProvider,
            { config },
            h(
              PurchaseContext.Provider,
              { value: 'Purchase context preserved' },
              h(TransactionReviewHost, null, h(Checkout)),
            ),
          ),
        ),
      );
    },
    { walletOrigin },
  );
  await expect(page.getByRole('button', { name: 'Buy', exact: true })).toBeEnabled();
}

test.setTimeout(25_000);

test.beforeEach(async ({ page }) => {
  await mountReviewApplication(page);
});

test('context, immutable intent, continuous iframe handoff and explicit wallet approval', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Buy', exact: true }).focus();
  await page.getByRole('button', { name: 'Buy', exact: true }).press('Enter');
  await expect(page.getByText('Purchase context preserved')).toBeVisible();
  const iframe = page.locator('iframe.seams-wallet-overlay-iframe');
  await expect(iframe).toHaveAttribute('inert', '');
  await page.evaluate(() => {
    (window as any).originalReviewFrame = document.querySelector(
      'iframe.seams-wallet-overlay-iframe',
    );
  });
  await page.getByRole('button', { name: 'Continue to wallet' }).click();
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  await expect(wallet.locator('button.confirm')).toBeVisible();
  await expect(iframe).not.toHaveAttribute('inert', '');
  await expect
    .poll(async () => {
      const button = await wallet.locator('button.confirm').boundingBox();
      const frame = await iframe.boundingBox();
      return (
        button &&
        frame &&
        button.y >= frame.y &&
        button.y + button.height <= frame.y + frame.height + 1
      );
    })
    .toBe(true);
  expect(
    await page.evaluate(() => ({
      signed: (window as any).reviewSigned,
      sameFrame:
        (window as any).originalReviewFrame ===
        document.querySelector('iframe.seams-wallet-overlay-iframe'),
      dispatches: (window as any).reviewDispatches,
      dialogs: document.querySelectorAll('dialog[open]').length,
    })),
  ).toMatchObject({
    signed: 0,
    sameFrame: true,
    dialogs: 1,
    dispatches: [
      { payload: { transaction: { receiverId: 'receiver.testnet', actions: [{ amount: '1' }] } } },
    ],
  });
  await wallet.locator('button.confirm').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).reviewResults))
    .toEqual([{ kind: 'result', value: { success: true, transactionId: 'review-transaction' } }]);
  await expect(page.getByRole('button', { name: 'Buy', exact: true })).toBeFocused();
  expect(await page.evaluate(() => (window as any).reviewViolations)).toEqual([]);
});

test('Back preserves review state and resumes the same pending wallet approval', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const note = page.getByRole('textbox', { name: 'Purchase note' });
  await note.fill('Keep my purchase note');
  const originalDialog = await page.locator('dialog[open]').elementHandle();
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  for (let visit = 0; visit < 2; visit += 1) {
    await page.getByRole('button', { name: 'Continue to wallet' }).click();
    await wallet.getByRole('button', { name: 'Back to review', exact: true }).click();
    await expect(note).toBeVisible();
    await expect(note).toHaveValue('Keep my purchase note');
    await expect(page.getByRole('heading', { name: 'Review purchase', exact: true })).toBeFocused();
    expect(
      await originalDialog?.evaluate(
        (element) => element === document.querySelector('dialog[open]'),
      ),
    ).toBe(true);
    expect(await page.evaluate(() => (window as any).reviewDispatches.length)).toBe(1);
    expect(await page.evaluate(() => (window as any).reviewSigned)).toBe(0);
  }
  await page.getByRole('button', { name: 'Continue to wallet' }).click();
  await wallet.locator('button.confirm').click();
  await expect.poll(() => page.evaluate(() => (window as any).reviewResults.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).reviewDispatches.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).reviewSigned)).toBe(1);
  expect(await page.evaluate(() => (window as any).reviewViolations)).toEqual([]);
});

test('cancelling after Back settles the pending request and releases the review queue', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to wallet' }).click();
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  await wallet.getByRole('button', { name: 'Back to review', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel purchase' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).reviewResults[0]?.code))
    .toBe('cancelled');
  expect(await page.evaluate(() => (window as any).reviewSigned)).toBe(0);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Purchase note' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel purchase' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).reviewResults.length)).toBe(2);
  expect(await page.evaluate(() => (window as any).reviewDispatches.length)).toBe(1);
});

test('Back keeps the original quote deadline and rejects an expired Continue', async ({ page }) => {
  const deadline = Date.now() + 60_000;
  await page.clock.setFixedTime(new Date(deadline - 60_000));
  await page.evaluate(async (atMs) => {
    const { createElement } = await import('react');
    const state = window as any;
    function render(controls: any) {
      return createElement('button', { onClick: controls.continueToWallet }, 'Continue quote');
    }
    function captureError(error: any) {
      state.reviewResults.push({ kind: 'error', code: error.code });
    }
    void state.reviewWallet.near
      .signAndSendTransaction({
        receiverId: 'receiver.testnet',
        actions: [{ type: 'Transfer', amount: '1' }],
        review: { title: 'Expiring quote', validity: { kind: 'expires_at', atMs }, render },
      })
      .catch(captureError);
  }, deadline);
  await page.getByRole('button', { name: 'Continue quote', exact: true }).click();
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  await wallet.getByRole('button', { name: 'Back to review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue quote', exact: true })).toBeVisible();
  await page.clock.setFixedTime(new Date(deadline + 1));
  await page.getByRole('button', { name: 'Continue quote', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).reviewResults))
    .toEqual([{ kind: 'error', code: 'review_expired' }]);
  expect(await page.evaluate(() => (window as any).reviewSigned)).toBe(0);
  expect(await page.evaluate(() => (window as any).reviewDispatches.length)).toBe(1);
});

test('double Continue dispatches once and releases the lease after approval', async ({ page }) => {
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByText('Purchase context preserved')).toBeVisible();
  await page.evaluate(() => {
    const controls = (window as any).reviewControls;
    controls.continueToWallet();
    controls.continueToWallet();
  });
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  await expect(wallet.locator('button.confirm')).toBeVisible();
  expect(await page.evaluate(() => (window as any).reviewDispatches.length)).toBe(1);
  await wallet.locator('button.confirm').click();
  await expect.poll(() => page.evaluate(() => (window as any).reviewResults.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).reviewSigned)).toBe(1);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByText('Purchase context preserved')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel purchase' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).reviewResults[1]?.code))
    .toBe('cancelled');
  expect(await page.evaluate(() => (window as any).reviewDispatches.length)).toBe(1);
});

for (const phase of ['reviewing', 'wallet_approval'] as const) {
  test(`iframe disconnect during ${phase} settles once and invalidates old controls`, async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Buy', exact: true }).click();
    await expect(page.getByText('Purchase context preserved')).toBeVisible();
    if (phase === 'wallet_approval') {
      await page.getByRole('button', { name: 'Continue to wallet' }).click();
      await expect(
        page.frameLocator('iframe.seams-wallet-overlay-iframe').locator('button.confirm'),
      ).toBeVisible();
    }
    await page.evaluate(async () => {
      const { getTransactionReviewBridge } =
        await import('/_test-sdk/esm/react/SeamsWeb/publicApi/transactionReview.js');
      const state = window as any;
      const router = await getTransactionReviewBridge(state.reviewSeams.near)!
        .getWalletIframe()
        .requireTransportRouter();
      router.dispose();
      state.reviewControls.continueToWallet();
      state.reviewControls.cancel();
    });
    const expectedError =
      phase === 'reviewing'
        ? { kind: 'error', message: 'Wallet iframe connection closed' }
        : { kind: 'error', code: 'connection_closed' };
    await expect
      .poll(() => page.evaluate(() => (window as any).reviewResults))
      .toMatchObject([expectedError]);
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).reviewSigned)).toBe(0);
    expect(await page.evaluate(() => (window as any).reviewDispatches.length)).toBe(
      phase === 'reviewing' ? 0 : 1,
    );
  });
}

test('iframe reload cancels its review and a fresh connection can review again', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByText('Purchase context preserved')).toBeVisible();
  await page.evaluate(() => {
    (window as any).oldReviewControls = (window as any).reviewControls;
  });
  const frame = page.frames().find((frame) => frame.url().startsWith(walletOrigin))!;
  await frame.evaluate(() => {
    location.reload();
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).reviewResults))
    .toMatchObject([{ kind: 'error', message: 'Wallet iframe connection closed' }]);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByText('Purchase context preserved')).toBeVisible();
  await page.evaluate(() => {
    (window as any).oldReviewControls.continueToWallet();
  });
  expect(await page.evaluate(() => (window as any).reviewDispatches)).toEqual([]);
  await page.getByRole('button', { name: 'Continue to wallet' }).click();
  await page.frameLocator('iframe.seams-wallet-overlay-iframe').locator('button.confirm').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).reviewResults[1]?.kind))
    .toBe('result');
});

test('handoff keeps both views inert and activates through the animation timer fallback', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByText('Purchase context preserved')).toBeVisible();
  await pauseReviewHandoff(page);
  await page.getByRole('button', { name: 'Continue to wallet' }).click();
  const iframe = page.locator('iframe.seams-wallet-overlay-iframe');
  const review = page.locator('.seams-transaction-review-slot');
  await expect(iframe).toHaveCSS('opacity', '0.5');
  await expect(review.locator('.seams-transaction-review-content')).toHaveCSS('opacity', '0.5');
  await expect(page.locator('dialog[open]')).toHaveCSS('opacity', '1');
  await expect(page.locator('dialog[open]')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(review).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(
    page.frameLocator('iframe.seams-wallet-overlay-iframe').locator('.modal-container-root'),
  ).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(iframe).toHaveAttribute('inert', '');
  await expect(review).toHaveAttribute('inert', '');
  await expect(review).toHaveAttribute('aria-hidden', 'true');
  expect(await page.evaluate(() => (window as any).reviewSigned)).toBe(0);
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  await expect(iframe).not.toHaveAttribute('inert', '');
  await expect(review).toBeHidden();
  await expect(wallet.locator('button.confirm')).toBeEnabled();
  await wallet.locator('button.confirm').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).reviewResults[0]?.kind))
    .toBe('result');
});

test('preference changes during review cannot bypass the reserved wallet approval', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByText('Purchase context preserved')).toBeVisible();
  const frame = page.frames().find((frame) => frame.url().startsWith(walletOrigin))!;
  await frame.evaluate(() => {
    (window as any).reviewPushPreferences({
      uiMode: 'drawer',
      behavior: 'skipClick',
      autoProceedDelay: 0,
    });
  });
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).reviewSeams.preferences.getConfirmationConfig().behavior),
    )
    .toBe('skipClick');
  await page.getByRole('button', { name: 'Continue to wallet' }).click();
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  await expect(wallet.locator('button.confirm')).toBeVisible();
  expect(await page.evaluate(() => (window as any).reviewSigned)).toBe(0);
  expect(await page.evaluate(() => (window as any).reviewResults)).toEqual([]);
  const config = await page.evaluate(
    () => (window as any).reviewDispatches[0].payload.options.confirmationConfig,
  );
  expect(config).toMatchObject({ uiMode: 'modal', behavior: 'requireClick' });
  await wallet.locator('button.confirm').click();
  await expect.poll(() => page.evaluate(() => (window as any).reviewSigned)).toBe(1);
});

test('settled receipt is replaced atomically and late activity cannot reclaim the review', async ({
  page,
}) => {
  const frame = page.frames().find((frame) => frame.url().startsWith(walletOrigin))!;
  await frame.evaluate(() => {
    (window as any).reviewRetainReceipt = true;
  });
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to wallet' }).click();
  await page.frameLocator('iframe.seams-wallet-overlay-iframe').locator('button.confirm').click();
  await expect.poll(() => page.evaluate(() => (window as any).reviewResults.length)).toBe(1);
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  const receiptId = await page.evaluate(() => (window as any).reviewDispatches[0].requestId);
  await page.evaluate(() => {
    const state = window as any;
    state.reviewDialogOpenChanges = 0;
    function recordChanges(records: MutationRecord[]) {
      state.reviewDialogOpenChanges += records.length;
    }
    new MutationObserver(recordChanges).observe(document.querySelector('dialog[open]')!, {
      attributes: true,
      attributeFilter: ['open'],
    });
  });
  await page.getByRole('button', { name: 'Buy', exact: true }).dispatchEvent('click');
  await expect(page.getByText('Purchase context preserved')).toBeVisible();
  await expect
    .poll(() => frame.evaluate(() => (window as any).reviewClosedReceipts))
    .toEqual([{ requestId: receiptId, view: 'closed' }]);
  for (const view of ['expanded', 'toast', 'closed']) {
    await frame.evaluate(
      ({ receiptId, view }) => {
        (window as any).reviewPostActivity(receiptId, view);
      },
      { receiptId, view },
    );
    await expect(page.getByText('Purchase context preserved')).toBeVisible();
  }
  expect(await page.evaluate(() => (window as any).reviewDialogOpenChanges)).toBe(0);
  await page.getByRole('button', { name: 'Cancel purchase' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).reviewResults.length)).toBe(2);
});

test('review cancellation and owner disposal never dispatch a wallet request', async ({ page }) => {
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel purchase' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).reviewResults[0]?.code))
    .toBe('cancelled');
  await page.evaluate(() => (window as any).reviewControls.continueToWallet());
  expect(await page.evaluate(() => (window as any).reviewDispatches)).toEqual([]);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByText('Purchase context preserved')).toBeVisible();
  await page.evaluate(() => (window as any).reviewRoot.unmount());
  await expect
    .poll(() => page.evaluate(() => (window as any).reviewResults[1]?.code))
    .toBe('review_owner_disposed');
  expect(await page.evaluate(() => (window as any).reviewDispatches)).toEqual([]);
});

test('FIFO reviews keep one owner, expire queued quotes and ignore old controls', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByText('Purchase context preserved')).toBeVisible();
  await page.evaluate(() => {
    const state = window as any;
    state.oldReviewControls = state.reviewControls;
    const review = {
      title: 'Queued quote',
      validity: { kind: 'expires_at', atMs: Date.now() + 500 },
      render: () => 'Queued content',
    };
    state.reviewWallet.near
      .signAndSendTransaction({ receiverId: 'receiver.testnet', actions: [], review })
      .catch((error: any) => {
        state.queuedError = error.code;
      });
  });
  await expect.poll(() => page.evaluate(() => (window as any).queuedError)).toBe('review_expired');
  await expect(page.getByText('Queued content')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel purchase' }).click();
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByText('Purchase context preserved')).toBeVisible();
  await page.evaluate(() => (window as any).oldReviewControls.continueToWallet());
  expect(await page.evaluate(() => (window as any).reviewDispatches)).toEqual([]);
  await page.getByRole('button', { name: 'Cancel purchase' }).click();
});

test('async failures stay visible until dismissal and the next review can render', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByText('Purchase context preserved')).toBeVisible();
  await page.evaluate(() => (window as any).reviewControls.fail(new Error('Quote fetch failed')));
  await expect(page.getByRole('alert')).toHaveText(
    'The application review could not be displayed.',
  );
  expect(await page.evaluate(() => (window as any).reviewResults)).toEqual([]);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).reviewResults[0]?.code))
    .toBe('review_render_failed');
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByText('Purchase context preserved')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect
    .poll(() => page.evaluate(() => (window as any).reviewResults[1]?.code))
    .toBe('cancelled');
});

test('review geometry fits narrow screens and large content with reduced motion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByText('Purchase context preserved')).toBeVisible();
  await page.evaluate(() => {
    const content = document.querySelector('.seams-transaction-review-content')!;
    const extra = document.createElement('p');
    extra.textContent = 'Long purchase details '.repeat(500);
    content.append(extra);
  });
  const dialog = page.locator('dialog[open]');
  await expect
    .poll(async () => {
      const bounds = await dialog.boundingBox();
      return (
        bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.width <= 320 && bounds.height <= 568
      );
    })
    .toBe(true);
  await page.getByRole('button', { name: 'Cancel purchase' }).click();
});

test('expanded wallet approval scrolls keyboard focus into a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to wallet', exact: true }).click();
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  const details = wallet.getByText('Transaction details', { exact: true });
  await details.click();
  const confirm = wallet.locator('button.confirm');
  await confirm.focus();
  await expect(confirm).toBeInViewport({ ratio: 1 });
  await confirm.press('Enter');
  await expect
    .poll(() => page.evaluate(() => (window as any).reviewResults[0]?.kind))
    .toBe('result');
});

test('wallet admission arbitrates credential cancellation and preserves a started signature', async ({
  page,
}) => {
  const outcomes = await page.evaluate(async () => {
    const probeUrl = '/review-wallet-probe.js';
    const { TransactionReviewAdmission } = await import(probeUrl);
    const phases: string[] = [];
    const errors: string[] = [];
    function report(state: any) {
      phases.push(state.phase);
    }
    function reject(error: any) {
      errors.push(error.code);
    }
    async function active(requestId: string, atMs: number) {
      const metadata = {
        kind: 'transaction_review_v1',
        connectionId: 'test',
        requestId,
        surfaceId: requestId,
        generation: 1,
        validity: { kind: 'expires_at', atMs },
      };
      const admission = new TransactionReviewAdmission(metadata, 'mpc', report, reject);
      const element = document.createElement('div');
      document.body.append(element);
      admission.attach(element);
      element.dataset.seamsConfirmReady = 'true';
      await new Promise((resolve) => requestAnimationFrame(resolve));
      admission.activate({ ...metadata, phase: 'activated' });
      return admission;
    }
    const cancelled = await active('cancelled', Date.now() + 10_000);
    cancelled.beforeCredential();
    cancelled.cancel(Object.assign(new Error('cancelled'), { code: 'cancelled' }));
    const aborted = cancelled.abortController.signal.aborted;
    let prevented = false;
    try {
      cancelled.afterCredential();
    } catch {
      prevented = true;
    }
    const deferredUntilUnwind = errors.length === 0;
    cancelled.finish();
    cancelled.finish();
    const signing = await active('signing', Date.now() + 100);
    signing.beforeSigning();
    const cancellationIgnored = !signing.cancel(new Error('owner disposed'));
    await new Promise((resolve) => setTimeout(resolve, 150));
    let nextSignatureExpired = false;
    try {
      signing.beforeSigning();
    } catch {
      nextSignatureExpired = true;
    }
    const preserved = !signing.abortController.signal.aborted && !signing.cancelled;
    signing.finish();
    return {
      aborted,
      prevented,
      deferredUntilUnwind,
      errors,
      cancellationIgnored,
      nextSignatureExpired,
      preserved,
    };
  });
  expect(outcomes).toEqual({
    aborted: true,
    prevented: true,
    deferredUntilUnwind: true,
    errors: ['cancelled'],
    cancellationIgnored: true,
    nextSignatureExpired: true,
    preserved: true,
  });
});

test('all six methods forward one core failure and preserve callback ownership', async ({
  page,
}) => {
  const walletFrame = page.frames().find((frame) => frame.url().startsWith(walletOrigin))!;
  await walletFrame.evaluate(() => {
    (window as any).reviewHostFailure = true;
  });
  const methods = ['nearSign', 'nearExecute', 'evmSign', 'evmExecute', 'tempoSign', 'tempoExecute'];
  for (const method of methods) {
    await page.evaluate((method) => {
      const state = window as any;
      const wallet = state.reviewWallet;
      state.methodCallbacks = [];
      state.methodOutcome = null;
      function render(controls: any) {
        state.methodControls = controls;
        return 'Method review';
      }
      function onError() {
        state.methodCallbacks.push('onError');
      }
      function afterCall() {
        state.methodCallbacks.push('afterCall');
      }
      function failed(error: any) {
        state.methodOutcome = { kind: 'error', message: error.message };
      }
      function completed(value: unknown) {
        state.methodOutcome = { kind: 'result', value };
      }
      const review = { title: method, validity: { kind: 'unbounded' }, render };
      const options = { onError, afterCall };
      const receiverId = 'receiver.testnet';
      const actions = [{ type: 'Transfer', amount: '1' }];
      const evm = {
        chainTarget: 'arc-testnet',
        request: {
          chain: 'evm',
          kind: 'eip1559',
          senderSignatureAlgorithm: 'secp256k1',
          tx: {
            chainId: 5042002,
            maxPriorityFeePerGas: 1n,
            maxFeePerGas: 2n,
            gasLimit: 21000n,
            value: 0n,
            to: '0x0000000000000000000000000000000000000001',
          },
        },
        review,
        options,
      };
      const tempo = {
        chainTarget: 'tempo-testnet',
        request: {
          chain: 'tempo',
          kind: 'tempoTransaction',
          senderSignatureAlgorithm: 'secp256k1',
          tx: {
            chainId: 42431,
            maxPriorityFeePerGas: 1n,
            maxFeePerGas: 2n,
            gasLimit: 21000n,
            nonceKey: 0n,
            calls: [{ to: '0x0000000000000000000000000000000000000001', value: 0n }],
          },
        },
        review,
        options,
      };
      let result: Promise<unknown>;
      switch (method) {
        case 'nearSign':
          result = wallet.near.signAndSendTransaction({ receiverId, actions, review, options });
          break;
        case 'nearExecute':
          result = wallet.near.executeAction({
            receiverId,
            actionArgs: actions[0],
            review,
            options,
          });
          break;
        case 'evmSign':
          result = wallet.evm.signTransaction(evm);
          break;
        case 'evmExecute':
          result = wallet.evm.executeTransaction(evm);
          break;
        case 'tempoSign':
          result = wallet.tempo.signTransaction(tempo);
          break;
        case 'tempoExecute':
          result = wallet.tempo.executeTransaction(tempo);
          break;
        default:
          throw new Error('Unknown method');
      }
      result.then(completed, failed);
    }, method);
    await expect(page.getByText('Method review', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).methodCallbacks)).toEqual([]);
    await page.evaluate(() => (window as any).methodControls.continueToWallet());
    await expect
      .poll(() => page.evaluate(() => (window as any).methodOutcome))
      .toMatchObject({ kind: 'error', message: 'Core signing rejected' });
    const expectedCallbacks = method.startsWith('near') ? ['onError', 'afterCall'] : [];
    expect(await page.evaluate(() => (window as any).methodCallbacks)).toEqual(expectedCallbacks);
  }
  expect(await page.evaluate(() => (window as any).reviewDispatches.length)).toBe(6);
});

test('missing and duplicate hosts reject before dispatch and disposed methods stay invalid', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const state = window as any;
    const controllersUrl = '/_test-sdk/esm/react/transactionReview/controller.js';
    const callsUrl = '/_test-sdk/esm/react/transactionReview/boundCalls.js';
    const { ReviewHostController, ReviewOwner } = await import(controllersUrl);
    const { createReviewedBoundCalls } = await import(callsUrl);
    let duplicateCode = '';
    try {
      new ReviewHostController(state.reviewSeams).retain();
    } catch (error: any) {
      duplicateCode = error.code;
    }
    const calls = createReviewedBoundCalls({
      seams: state.reviewSeams,
      walletId: 'review.testnet',
      walletSession: state.reviewWallet.wallet.walletSession,
      nearAccount: { kind: 'named', accountId: 'review.testnet' },
      host: null,
      owner: new ReviewOwner(),
    });
    let missingCode = '';
    try {
      await calls.nearSign({
        receiverId: 'receiver.testnet',
        actions: [],
        review: {
          title: 'Unavailable',
          validity: { kind: 'unbounded' },
          render: () => null,
        },
      });
    } catch (error: any) {
      missingCode = error.code;
    }
    const disposedMethod = state.reviewWallet.near.signAndSendTransaction;
    state.reviewRoot.unmount();
    await Promise.resolve();
    let disposedCode = '';
    try {
      await disposedMethod({
        receiverId: 'receiver.testnet',
        actions: [],
        review: {
          title: 'Disposed',
          validity: { kind: 'unbounded' },
          render: () => null,
        },
      });
    } catch (error: any) {
      disposedCode = error.code;
    }
    return { duplicateCode, missingCode, disposedCode, dispatches: state.reviewDispatches.length };
  });
  expect(result).toEqual({
    duplicateCode: 'review_host_unavailable',
    missingCode: 'review_host_unavailable',
    disposedCode: 'review_owner_disposed',
    dispatches: 0,
  });
});

test('Suspense loading is cancellable and has a bounded lifetime', async ({ page }) => {
  await page.clock.install();
  await page.evaluate(async () => {
    const React = await import('react');
    const state = window as any;
    function Pending(): never {
      throw new Promise(() => {});
    }
    function render() {
      return React.createElement(Pending);
    }
    state.reviewWallet.near
      .signAndSendTransaction({
        receiverId: 'receiver.testnet',
        actions: [],
        review: {
          title: 'Loading quote',
          validity: { kind: 'unbounded' },
          render,
        },
      })
      .catch((error: any) => {
        state.loadingCode = error.code;
      });
  });
  await expect(page.getByRole('status')).toHaveText('Loading review…');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  await page.clock.fastForward(30_001);
  await expect
    .poll(() => page.evaluate(() => (window as any).loadingCode))
    .toBe('review_prepare_timeout');
  expect(await page.evaluate(() => (window as any).reviewDispatches)).toEqual([]);
});

test('missing wallet activation acknowledgement cancels and releases the lease', async ({
  page,
}) => {
  await page.clock.install();
  const frame = page.frames().find((frame) => frame.url().startsWith(walletOrigin))!;
  await frame.evaluate(() => {
    (window as any).reviewIgnoreActivation = true;
  });
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to wallet' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).reviewDispatches.length)).toBe(1);
  await page.clock.fastForward(30_001);
  await expect
    .poll(() => page.evaluate(() => (window as any).reviewResults[0]?.code))
    .toBe('review_prepare_timeout');
  expect(await page.evaluate(() => (window as any).reviewSigned)).toBe(0);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByText('Purchase context preserved')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel purchase' }).click();
});

test('keyboard review preserves local input and wallet Escape cancels before signing', async ({
  page,
  browserName,
}) => {
  // macOS WebKit uses Option-Tab to include buttons with default keyboard settings.
  const nextControl = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
  const buy = page.getByRole('button', { name: 'Buy', exact: true });
  await buy.focus();
  await buy.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Review purchase', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Review purchase', exact: true })).toBeFocused();
  await page.keyboard.press(nextControl);
  const note = page.getByRole('textbox', { name: 'Purchase note' });
  await expect(note).toBeFocused();
  await note.fill('Keep this note while reviewing');
  await page.keyboard.press(nextControl);
  await expect(page.getByRole('button', { name: 'Continue to wallet' })).toBeFocused();
  await page.keyboard.press(nextControl);
  await expect(page.getByRole('button', { name: 'Cancel purchase' })).toBeFocused();
  await page.keyboard.press(`Shift+${nextControl}`);
  await expect(note).toHaveValue('Keep this note while reviewing');
  await page.keyboard.press('Space');
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  await expect(wallet.locator('button.confirm')).toBeVisible();
  await wallet.locator('button.confirm').focus();
  await page.keyboard.press('Escape');
  await expect
    .poll(() => page.evaluate(() => (window as any).reviewResults[0]?.code))
    .toBe('cancelled');
  expect(await page.evaluate(() => (window as any).reviewSigned)).toBe(0);
  await expect(buy).toBeFocused();
});

test('same-wallet session replacement cancels active and queued reviews and releases ownership', async ({
  page,
}) => {
  const frame = page.frames().find((frame) => frame.url().startsWith(walletOrigin));
  if (!frame) throw new Error('Wallet service frame is missing');
  await frame.evaluate(() => {
    (window as any).reviewSetExactSession({
      kind: 'active_session',
      status: 'active',
      walletId: 'review.testnet',
      authorizationId: 'wsa_review_first',
      walletSessionId: 'wss_review_first',
      authMethod: 'passkey',
      expiresAtMs: Date.now() + 60_000,
    });
  });
  await page.evaluate(async () => {
    const { getTransactionReviewBridge } =
      await import('/_test-sdk/esm/react/SeamsWeb/publicApi/transactionReview.js');
    const state = window as any;
    state.reviewRouter = await getTransactionReviewBridge(state.reviewSeams.near)!
      .getWalletIframe()
      .requireTransportRouter();
    await state.reviewRouter.getExactSessionState();
  });
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByText('Purchase context preserved')).toBeVisible();
  await page.evaluate(() => {
    const state = window as any;
    state.reviewWallet.near
      .signAndSendTransaction({
        receiverId: 'receiver.testnet',
        actions: [],
        review: {
          title: 'Queued purchase',
          validity: { kind: 'unbounded' },
          render: () => 'Queued purchase content',
        },
      })
      .catch((error: any) => {
        state.queuedReplacementError = error.code;
      });
  });
  await frame.evaluate(() => {
    (window as any).reviewSetExactSession({
      kind: 'active_session',
      status: 'active',
      walletId: 'review.testnet',
      authorizationId: 'wsa_review_second',
      walletSessionId: 'wss_review_second',
      authMethod: 'passkey',
      expiresAtMs: Date.now() + 60_000,
    });
  });
  await page.evaluate(() => (window as any).reviewRouter.getExactSessionState());
  await expect
    .poll(() => page.evaluate(() => (window as any).reviewResults[0]?.code))
    .toBe('review_identity_changed');
  await expect
    .poll(() => page.evaluate(() => (window as any).queuedReplacementError))
    .toBe('review_identity_changed');
  expect(await page.evaluate(() => (window as any).reviewDispatches)).toEqual([]);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByText('Purchase context preserved')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel purchase' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).reviewResults[1]?.code))
    .toBe('cancelled');
});

test('host disposal after signing preserves the eventual wallet result', async ({ page }) => {
  const frame = page.frames().find((frame) => frame.url().startsWith(walletOrigin));
  if (!frame) throw new Error('Wallet service frame is missing');
  await frame.evaluate(() => {
    const state = window as any;
    state.reviewResultGate = new Promise<void>((resolve) => {
      state.releaseReviewResult = resolve;
    });
  });
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to wallet' }).click();
  await page.frameLocator('iframe.seams-wallet-overlay-iframe').locator('button.confirm').click();
  await expect.poll(() => page.evaluate(() => (window as any).reviewSigned)).toBe(1);
  await page.evaluate(() => (window as any).reviewRoot.unmount());
  expect(await page.evaluate(() => (window as any).reviewResults)).toEqual([]);
  await frame.evaluate(() => (window as any).releaseReviewResult());
  await expect
    .poll(() => page.evaluate(() => (window as any).reviewResults))
    .toEqual([{ kind: 'result', value: { success: true, transactionId: 'review-transaction' } }]);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('a thrown renderer shows the error boundary until dismissal without dispatch', async ({
  page,
}) => {
  await page.evaluate(() => {
    const state = window as any;
    state.reviewWallet.near
      .signAndSendTransaction({
        receiverId: 'receiver.testnet',
        actions: [],
        review: {
          title: 'Failing purchase',
          validity: { kind: 'unbounded' },
          render: () => {
            throw new Error('Quote render failed');
          },
        },
      })
      .catch((error: any) => {
        state.renderFailure = error.code;
      });
  });
  await expect(page.getByRole('alert')).toHaveText(
    'The application review could not be displayed.',
  );
  expect(await page.evaluate(() => (window as any).renderFailure)).toBeUndefined();
  expect(await page.evaluate(() => (window as any).reviewDispatches)).toEqual([]);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).renderFailure))
    .toBe('review_render_failed');
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByText('Purchase context preserved')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel purchase' }).click();
});

test('Escape during a paused handoff cancels without waiting for animation completion', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByText('Purchase context preserved')).toBeVisible();
  await pauseReviewHandoff(page);
  await page.getByRole('button', { name: 'Continue to wallet' }).click();
  await expect(page.locator('iframe.seams-wallet-overlay-iframe')).toHaveCSS('opacity', '0.5');
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0, { timeout: 1000 });
  await expect
    .poll(() => page.evaluate(() => (window as any).reviewResults[0]?.code))
    .toBe('cancelled');
  expect(await page.evaluate(() => (window as any).reviewSigned)).toBe(0);
});

async function pauseReviewHandoff(page: Page): Promise<void> {
  await page.evaluate(() => {
    const animate = Element.prototype.animate;
    const browserWindow: Window = window;
    const schedule = browserWindow.setTimeout.bind(browserWindow);
    function pauseHandoff(
      this: Element,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions,
    ): Animation {
      const animation = animate.call(this, keyframes, options);
      if (Array.isArray(keyframes) && 'opacity' in keyframes[0]) {
        animation.pause();
        animation.currentTime = 90;
      }
      return animation;
    }
    function slowFallback(handler: TimerHandler, timeout?: number, ...args: unknown[]): number {
      return schedule(handler, timeout === 180 ? 1800 : timeout, ...args);
    }
    Element.prototype.animate = pauseHandoff;
    browserWindow.setTimeout = slowFallback;
  });
}

for (const dismissal of ['escape', 'backdrop'] as const) {
  test(`failed review preserves its error when dismissed by ${dismissal}`, async ({ page }) => {
    await page.getByRole('button', { name: 'Buy', exact: true }).click();
    await expect(page.getByText('Purchase context preserved')).toBeVisible();
    await page.evaluate(() => (window as any).reviewControls.fail(new Error('Quote fetch failed')));
    await expect(page.getByRole('alert')).toBeVisible();
    if (dismissal === 'escape') await page.keyboard.press('Escape');
    else await page.mouse.click(10, 10);
    await expect
      .poll(() => page.evaluate(() => (window as any).reviewResults[0]?.code))
      .toBe('review_render_failed');
    expect(await page.evaluate(() => (window as any).reviewDispatches)).toEqual([]);
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  });
}

test('cancelAll preserves a signing review until its real result settles', async ({ page }) => {
  const frame = page.frames().find((frame) => frame.url().startsWith(walletOrigin))!;
  await frame.evaluate(() => {
    const state = window as any;
    state.reviewResultGate = new Promise<void>((resolve) => {
      state.releaseReviewResult = resolve;
    });
  });
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to wallet' }).click();
  await page.frameLocator('iframe.seams-wallet-overlay-iframe').locator('button.confirm').click();
  await expect.poll(() => page.evaluate(() => (window as any).reviewSigned)).toBe(1);
  await page.evaluate(async () => {
    const { getTransactionReviewBridge } =
      await import('/_test-sdk/esm/react/SeamsWeb/publicApi/transactionReview.js');
    const router = await getTransactionReviewBridge((window as any).reviewSeams.near)!
      .getWalletIframe()
      .requireTransportRouter();
    await router.cancelAll();
  });
  expect(await page.evaluate(() => (window as any).reviewResults)).toEqual([]);
  await frame.evaluate(() => (window as any).releaseReviewResult());
  await expect
    .poll(() => page.evaluate(() => (window as any).reviewResults))
    .toEqual([{ kind: 'result', value: { success: true, transactionId: 'review-transaction' } }]);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('cancelAll removes queued reviews before releasing the active review', async ({ page }) => {
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByText('Purchase context preserved')).toBeVisible();
  await page.evaluate(async () => {
    const { getTransactionReviewBridge } =
      await import('/_test-sdk/esm/react/SeamsWeb/publicApi/transactionReview.js');
    (window as any).reviewRouter = await getTransactionReviewBridge(
      (window as any).reviewSeams.near,
    )!
      .getWalletIframe()
      .requireTransportRouter();
  });
  await page.getByRole('button', { name: 'Buy', exact: true }).dispatchEvent('click');
  await expect
    .poll(() => page.evaluate(() => (window as any).reviewRouter.reviewWaiters.size))
    .toBe(1);
  await page.evaluate(() => (window as any).reviewRouter.cancelAll());
  await expect.poll(() => page.evaluate(() => (window as any).reviewResults.length)).toBe(2);
  expect(
    await page.evaluate(() =>
      (window as any).reviewResults.every((result: any) => result.kind === 'error'),
    ),
  ).toBe(true);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).reviewDispatches)).toEqual([]);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByText('Purchase context preserved')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel purchase' }).click();
});

test('a replacement review host can register in the same commit as the previous host unmounts', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { ReviewHostController } =
      await import('/_test-sdk/esm/react/transactionReview/controller.js');
    const state = window as any;
    state.reviewRoot.unmount();
    const replacement = new ReviewHostController(state.reviewSeams);
    let release: () => void;
    try {
      release = replacement.retain();
    } catch (error: any) {
      return { replacementError: error.code, duplicateError: null };
    }
    await Promise.resolve();
    let duplicateError = null;
    try {
      new ReviewHostController(state.reviewSeams).retain();
    } catch (error: any) {
      duplicateError = error.code;
    }
    release();
    return { replacementError: null, duplicateError };
  });
  expect(result).toEqual({ replacementError: null, duplicateError: 'review_host_unavailable' });
});
