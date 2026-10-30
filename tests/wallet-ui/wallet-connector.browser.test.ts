import { expect, test, type Route } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { buildWalletServiceHtml } from '@/plugins/plugin-utils';
import { DEFAULT_TEST_CONFIG } from '../setup/config';
import { createTestWalletHostConfig, installTestWalletHostConfig } from '../setup/walletHostConfig';
import { installWalletSdkCorsShim } from '../setup/cross-origin-headers';
import { routePreactModules } from '../setup/preact';
import { injectImportMap } from '../setup/bootstrap';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import { registerWalletServiceRoute } from '../wallet-iframe/harness';

const walletOrigin = 'https://wallet.example.localhost';
const walletRoute = '**://wallet.example.localhost/wallet-service*';

const contextModule = `
import { WalletIframeRouter } from '/_test-sdk/esm/SeamsWeb/walletIframe/client/router.js';
import { replaceWalletHostAppearance } from '/_test-sdk/esm/SeamsWeb/walletIframe/shared/configuration.js';
const router = new WalletIframeRouter({
  hostConfig: replaceWalletHostAppearance(window.__SEAMS_TEST_HOST_CONFIG__, {
    palette: 'default',
    theme: { id: 'default', mode: 'light', colors: { buttonBackground: '#8d2e35' } },
  }),
  walletOrigin: '${walletOrigin}',
  servicePath: '/wallet-service',
  sdkBasePath: '/sdk',
  testOptions: { ownerTag: 'wallet-connector' },
});
window.__connectorRouter = router;
const seams = {
  authMenu: {
    prepare() {},
    onWalletConnectionRequest: router.onWalletConnectionRequest.bind(router),
    resolveWalletConnection: router.resolveWalletConnection.bind(router),
    open: router.openHostedAuthMenu.bind(router),
    cancel: router.cancelHostedAuthMenu.bind(router),
    onExternalAuthRequest: router.onHostedAuthMenuExternalAuthRequest.bind(router),
    resolveExternalAuth: router.resolveHostedAuthMenuExternalAuth.bind(router),
  },
};
export function useSeams() {
  return { seams, loginState: { isLoggedIn: false } };
}
`;

const application = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HostedSeamsAuthMenu } from '/_test-sdk/esm/react/components/HostedSeamsAuthMenu/public.js';
import { ExternalNearController } from '/_test-sdk/esm/externalNear/index.js';
import { ExternalEvmController } from '/_test-sdk/esm/externalEvm/index.js';
const controller = new ExternalNearController({
  network: 'testnet',
  rpcUrl: location.origin + '/near-rpc',
  wallets: ['meteor'],
});
const evm = new ExternalEvmController([
  { chainId: 1, name: 'Ethereum', rpcUrl: 'https://rpc.example.test' },
]);
const provider = {
  async request(args) {
    if (args.method === 'eth_chainId') return '0x1';
    if (args.method === 'eth_accounts' || args.method === 'eth_requestAccounts')
      return ['0x1111111111111111111111111111111111111111'];
    throw new Error('Unexpected provider request: ' + args.method);
  },
  on() {},
  removeListener() {},
};
evm.start(window);
window.dispatchEvent(
  new CustomEvent('eip6963:announceProvider', {
    detail: {
      info: {
        uuid: '350670db-19fa-4704-a166-e52e178b59d2',
        name: 'Rabby',
        rdns: 'io.rabby',
        icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E',
      },
      provider,
    },
  }),
);
const root = createRoot(document.querySelector('main'));
window.__connector = { controller, evm, root, outcomes: [], connections: [] };
function outcome(value) {
  window.__connector.outcomes.push(value);
}
function connected(connection) {
  window.__connector.connections.push(connection);
}
const primary = [{ kind: 'near', wallet: 'meteor', controller, onConnected: connected }];
const secondary = evm.getSnapshot().wallets.map(evmAlternative);
function evmAlternative(wallet) {
  return { kind: 'evm', wallet, controller: evm, onConnected: connected };
}
function render(mode = 'both') {
  const props = { onOutcome: outcome, initialMode: 'register' };
  if (mode !== 'omitted')
    props.walletAlternatives = {
      primary: mode === 'secondary' || mode === 'empty' ? [] : primary,
      secondary: mode === 'primary' || mode === 'empty' ? [] : secondary,
    };
  root.render(
    React.createElement(React.StrictMode, null, React.createElement(HostedSeamsAuthMenu, props)),
  );
}
window.__connector.render = render;
function replaceController() {
  const replacement = new ExternalNearController({
    network: 'testnet',
    rpcUrl: location.origin + '/near-rpc',
    wallets: ['meteor'],
  });
  primary[0].controller = replacement;
  window.__connector.controller = replacement;
  render();
}
window.__connector.replaceController = replaceController;
render(new URLSearchParams(location.search).get('mode') || 'both');
`;

function serveContext(route: Route) {
  return route.fulfill({ contentType: 'application/javascript', body: contextModule });
}
function serveApplication(route: Route) {
  return route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}
    <link rel="stylesheet" href="/_test-sdk/esm/react/styles/styles.css">
    <style>body { margin: 0; background: #ddd; } main { padding: 24px; max-width: 420px; margin: auto; }</style>
    </head><body><main></main><script type="module">${application}</script></body></html>`,
  });
}
function serveMeteor(route: Route) {
  return route.fulfill({
    contentType: 'application/javascript',
    body: `
    function pending(resolve, reject) { window.__resolveMeteor = resolve; window.__rejectMeteor = reject; }
    export class MeteorExtensionProvider {
      connect() { window.__meteorAttempts = (window.__meteorAttempts || 0) + 1; return new Promise(pending); }
      dispose() {}
    }
  `,
  });
}

test.beforeEach(async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('Connector test origin is missing');
  await page.addInitScript(
    installTestWalletHostConfig,
    createTestWalletHostConfig(DEFAULT_TEST_CONFIG),
  );
  await installWalletSdkCorsShim(page, {
    appOrigin: new URL(baseURL).origin,
    walletOrigin,
    mirror: true,
    injectWalletServiceImportMap: true,
    logStyle: 'setup',
  });
  await injectImportMap(page);
  await routePreactModules(page);
  await page.route('**/_test-sdk/esm/react/context/index.js', serveContext);
  await page.route('**/externalNear/meteor.js', serveMeteor);
  await page.route('**/wallet-connector-test*', serveApplication);
  await registerWalletServiceRoute(
    page,
    buildWalletServiceHtml('/_test-sdk/esm/sdk', undefined, 'runtime'),
    walletRoute,
  );
});

test.afterEach(async ({ page }) => {
  await page.evaluate(
    'void window.__connector?.root.unmount(); void window.__connectorRouter?.dispose()',
  );
});

test('combined menu rejects Meteor, connects EVM, and ignores a cancelled session result', async ({
  page,
}, testInfo) => {
  await page.goto('/wallet-connector-test');
  const auth = page.frameLocator('iframe[data-seams-owner="wallet-connector"]');
  const meteor = auth.getByRole('button', { name: /Meteor Wallet/ });
  await expect(meteor).toBeVisible();
  await expect(auth.getByRole('button', { name: /Rabby/ })).toBeHidden();
  await expect(auth.getByRole('button', { name: 'Recover wallet' })).toBeHidden();
  await auth.getByText('Recover or link wallet', { exact: true }).click();
  await expect(auth.getByRole('button', { name: /Link this device/ })).toBeVisible();
  await auth.getByText('Recover or link wallet', { exact: true }).click();
  const icon = meteor.locator('.seams-alternative-icon');
  await expect(icon).toHaveCSS('filter', 'grayscale(1)');
  await meteor.hover();
  await expect(icon).toHaveCSS('filter', 'grayscale(0)');
  await meteor.click();
  await expect(meteor).toBeDisabled();
  await page.waitForFunction('typeof window.__rejectMeteor === "function"');
  await page.evaluate("window.__rejectMeteor(new Error('Meteor request rejected'))");
  await expect(
    auth.getByRole('alert').filter({ hasText: 'Meteor Wallet did not connect' }),
  ).toBeVisible();
  await expect(meteor).toBeEnabled();
  await meteor.click();
  await page.waitForFunction('window.__meteorAttempts === 2');
  await page.evaluate('window.__lateMeteor = window.__resolveMeteor');
  await auth.locator('[data-auth-menu-dismiss]').click();
  await expect.poll(page.evaluate.bind(page, 'window.__connector.outcomes.length')).toBe(1);
  await page.evaluate("window.__connector.render('primary')");
  await expect(meteor).toBeVisible();
  await page.evaluate("window.__lateMeteor(['late.testnet'])");
  expect(await page.evaluate('window.__connector.connections.length')).toBe(0);
  await page.evaluate("window.__connector.render('both')");
  await expect(meteor).toBeVisible();
  await meteor.click();
  await page.waitForFunction('window.__meteorAttempts === 3');
  await page.evaluate(
    'window.__replacedMeteor = window.__resolveMeteor; window.__connector.replaceController()',
  );
  await expect(meteor).toBeEnabled();
  await page.evaluate("window.__replacedMeteor(['replaced.testnet'])");
  expect(await page.evaluate('window.__connector.connections.length')).toBe(0);
  await auth.locator('summary').filter({ hasText: 'More wallets' }).click();
  const rabby = auth.getByRole('button', { name: /Rabby/ });
  await expect(rabby).toBeVisible();
  await expect
    .poll(
      auth
        .locator('.seams-content-switcher')
        .evaluate.bind(auth.locator('.seams-content-switcher'), contentFits),
    )
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('combined-wallet-expanded.png') });
  await rabby.click();
  await expect.poll(page.evaluate.bind(page, 'window.__connector.connections.length')).toBe(1);
  const results = await page.evaluate(
    '({ outcomes: window.__connector.outcomes, connections: window.__connector.connections, evm: window.__connector.evm.getSnapshot().connection })',
  );
  expect(results.evm.kind).toBe('connected');
  expect(results.connections[0].account).toBe('0x1111111111111111111111111111111111111111');
  expect(results.outcomes.at(-1).kind).toBe('wallet_connected');
  await writeFile(
    testInfo.outputPath('combined-wallet-results.json'),
    JSON.stringify(results, null, 2),
  );
});

for (const mode of ['omitted', 'empty', 'primary', 'secondary']) {
  test(`wallet groups follow explicit ${mode} configuration`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/wallet-connector-test?mode=' + mode);
    const auth = page.frameLocator('iframe[data-seams-owner="wallet-connector"]');
    await expect(auth.locator('.seams-title')).toBeVisible();
    await expect(auth.getByText('Or connect another wallet', { exact: true })).toHaveCount(
      mode === 'primary' ? 1 : 0,
    );
    await expect(auth.locator('summary').filter({ hasText: 'More wallets' })).toHaveCount(
      mode === 'secondary' ? 1 : 0,
    );
    await expect(auth.getByText('Recover or link wallet', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('combined-wallet-' + mode + '.png') });
  });
}

function contentFits(element: HTMLElement): boolean {
  const content = element.querySelector<HTMLElement>('.seams-content-sizer');
  return (
    content !== null && Math.abs(element.getBoundingClientRect().height - content.scrollHeight) <= 1
  );
}
