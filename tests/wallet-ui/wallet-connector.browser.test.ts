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
// Exercise an image above the old menu limit, within the discovery limit.
const evmIconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">' +
  '<circle cx="16" cy="16" r="14" fill="#627eea"/><!--' +
  'a'.repeat(100_000) +
  '--></svg>';
const evmIcon = 'data:IMAGE/SVG+XML,' + encodeURIComponent(evmIconSvg);
let evmConnectionRequests = 0;
const provider = {
  async request(args) {
    if (args.method === 'eth_chainId') return '0x1';
    if (args.method === 'eth_requestAccounts') {
      evmConnectionRequests += 1;
      if (evmConnectionRequests === 1) {
        throw { code: 4001, message: 'User rejected the request.' };
      }
    }
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
        icon: evmIcon,
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
function render(mode = 'both', recoveryOptions = 'collapsible', customBrand = false, initialMode = 'register') {
  const props = { onOutcome: outcome, initialMode: customBrand ? 'login' : initialMode, recoveryOptions };
  if (customBrand) props.footerBrand = { kind: 'custom', logo: evmIcon, name: 'Example application' };
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
const parameters = new URLSearchParams(location.search);
render(parameters.get('mode') || 'both', parameters.get('recovery') || 'collapsible', parameters.has('brand'));
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

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const evidence = await page.evaluate(readConnectorResults);
    await page.screenshot({ path: testInfo.outputPath('before-cleanup.png') });
    await writeFile(
      testInfo.outputPath('failure-evidence.json'),
      JSON.stringify(evidence, null, 2),
    );
  }
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
  await expect(icon).toHaveCSS('filter', 'none');
  await meteor.hover();
  await expect(icon).toHaveCSS('filter', 'none');
  const walletFrame = page.frame({ url: /^https:\/\/wallet\.example\.localhost\/wallet-service/ });
  if (!walletFrame) throw new Error('Wallet frame is missing');
  await walletFrame.evaluate(`
    void 0;
    ${documentFits.toString()}
    ${recordLayout.toString()}
    ${startLayoutRecording.toString()}
    startLayoutRecording(document.documentElement);
  `);
  await meteor.click();
  await expect(meteor).toBeDisabled();
  await expect
    .poll(auth.locator('html').evaluate.bind(auth.locator('html'), documentFits))
    .toBe(true);
  await page.waitForFunction('typeof window.__rejectMeteor === "function"');
  await page.evaluate("window.__rejectMeteor(new Error('Meteor request rejected'))");
  await expect(
    auth.getByRole('alert').filter({ hasText: 'Meteor Wallet did not connect' }),
  ).toBeVisible();
  await expect(meteor).toBeEnabled();
  await expect
    .poll(auth.locator('html').evaluate.bind(auth.locator('html'), documentFits))
    .toBe(true);
  const layout = await auth.locator('html').evaluate(stopLayoutRecording);
  await writeFile(testInfo.outputPath('connection-layout.json'), JSON.stringify(layout, null, 2));
  expect(layout.overflow).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('meteor-connection-error.png') });
  await auth.getByText('Recover or link wallet', { exact: true }).click();
  await auth.getByRole('button', { name: /Recover wallet/ }).click();
  await expect(auth.locator('[data-recovery-code]')).toBeVisible();
  await expect(
    auth.getByRole('alert').filter({ hasText: 'Meteor Wallet did not connect' }),
  ).toHaveCount(0);
  await auth.getByRole('button', { name: 'Back to unlock wallet', exact: true }).click();
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
  await expect(rabby.locator('img')).toHaveJSProperty('naturalWidth', 32);
  await expect
    .poll(
      auth
        .locator('.seams-content-switcher')
        .evaluate.bind(auth.locator('.seams-content-switcher'), contentFits),
    )
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('combined-wallet-expanded.png') });
  await rabby.click();
  await expect(rabby).toBeEnabled();
  expect(await page.evaluate('window.__connector.connections.length')).toBe(0);
  await rabby.click();
  await expect.poll(page.evaluate.bind(page, 'window.__connector.connections.length')).toBe(1);
  const results = await page.evaluate(readConnectorResults);
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

function contentFits(element: HTMLElement | SVGElement): boolean {
  const content = element.querySelector<HTMLElement>('.seams-content-sizer');
  return (
    content !== null && Math.abs(element.getBoundingClientRect().height - content.scrollHeight) <= 1
  );
}

function documentFits(element: HTMLElement | SVGElement): boolean {
  return element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight;
}

function startLayoutRecording(element: HTMLElement): void {
  const measurements: object[] = [];
  const overflow: object[] = [];
  const timer = window.setInterval(recordLayout.bind(null, element, measurements, overflow), 10);
  Reflect.set(window, '__menuLayout', { timer, measurements, overflow });
}

function recordLayout(element: HTMLElement, measurements: object[], overflow: object[]): void {
  const measurement = {
    width: element.clientWidth,
    height: element.clientHeight,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
    scrollbarWidth: getComputedStyle(element).scrollbarWidth,
  };
  measurements.push(measurement);
  if (!documentFits(element) && measurement.scrollbarWidth !== 'none') overflow.push(measurement);
}

function stopLayoutRecording(): { measurements: object[]; overflow: object[] } {
  const recording = Reflect.get(window, '__menuLayout');
  window.clearInterval(recording.timer);
  return { measurements: recording.measurements, overflow: recording.overflow };
}

for (const recoveryOptions of ['collapsible', 'expanded', 'hidden']) {
  test(`recovery controls support ${recoveryOptions} and custom footer branding`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/wallet-connector-test?brand&mode=primary&recovery=' + recoveryOptions);
    const auth = page.frameLocator('iframe[data-seams-owner="wallet-connector"]');
    const recovery = auth.getByRole('button', { name: /Recover wallet/ });
    const brand = auth.locator('img[alt="Example application"]');
    await expect(brand).toBeAttached();
    await expect.poll(brand.evaluate.bind(brand, imageLoaded)).toBe(true);
    await expect(auth.getByText('Secured by', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('menu-' + recoveryOptions + '.png') });
    if (recoveryOptions === 'hidden') {
      await expect(recovery).toHaveCount(0);
      await expect(auth.getByText('Recover or link wallet', { exact: true })).toHaveCount(0);
      await page.evaluate("window.__connector.render('primary', 'expanded', true)");
    } else {
      if (recoveryOptions === 'collapsible') {
        await expect(recovery).toBeHidden();
        await auth.getByText('Recover or link wallet', { exact: true }).click();
      }
    }
    await expect(recovery).toBeVisible();
    await recovery.click();
    await expect(auth.locator('[data-recovery-code]')).toBeVisible();
    await expect(brand).toBeVisible();
    await expect
      .poll(auth.locator('html').evaluate.bind(auth.locator('html'), documentFits))
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath('recovery-' + recoveryOptions + '.png') });
    await page.evaluate("window.__connector.render('primary', 'hidden', false, 'login')");
    await expect(auth.getByText('Secured by', { exact: true })).toBeAttached();
    await expect(auth.getByRole('img', { name: 'Example application' })).toHaveCount(0);
    await writeFile(
      testInfo.outputPath('presentation-results.json'),
      JSON.stringify(
        { recoveryOptions, customBrandLoaded: true, defaultBrandRestored: true },
        null,
        2,
      ),
    );
  });
}

test('real Meteor adapter recovers after the extension becomes available', async ({
  page,
}, testInfo) => {
  await page.unroute('**/externalNear/meteor.js', serveMeteor);
  await page.setViewportSize({ width: 538, height: 750 });
  await page.goto('/wallet-connector-test?mode=primary');
  const auth = page.frameLocator('iframe[data-seams-owner="wallet-connector"]');
  const meteor = auth.getByRole('button', { name: /Meteor Wallet/ });
  await meteor.click();
  await expect(auth.getByRole('alert')).toContainText(
    'Open the Meteor extension and allow access to this site',
  );
  await expect(meteor).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('meteor-extension-unavailable.png') });
  await page.evaluate(`
    window.__meteorWire = [];
    window.meteorComV2 = { sendMessageDataAndRespond: ${respondToMeteor.toString()} };
  `);
  await meteor.click();
  await expect.poll(page.evaluate.bind(page, 'window.__connector.connections.length')).toBe(1);
  const results = await page.evaluate(readConnectorResults);
  expect(results.connections[0].accountId).toBe('connected.testnet');
  expect(results.outcomes.at(-1).kind).toBe('wallet_connected');
  expect(results.requests.map(requestAction)).toEqual([
    'initializing',
    'connected',
    'closed_success',
  ]);
  await writeFile(
    testInfo.outputPath('meteor-adapter-results.json'),
    JSON.stringify(results, null, 2),
  );
});

function requestAction(request: { status: string }): string {
  return request.status;
}

async function respondToMeteor(request: { uid: string; status: string }): Promise<unknown> {
  Reflect.get(window, '__meteorWire').push(request);
  if (request.status === 'initializing') return { uid: request.uid, status: 'connected' };
  if (request.status === 'connected')
    return {
      uid: request.uid,
      status: 'closed_success',
      payload: { accountId: 'connected.testnet' },
    };
  return null;
}

function readConnectorResults() {
  const connector = Reflect.get(window, '__connector');
  return {
    connections: connector.connections,
    outcomes: connector.outcomes,
    evm: connector.evm.getSnapshot().connection,
    requests: Reflect.get(window, '__meteorWire'),
  };
}

function imageLoaded(element: HTMLElement | SVGElement): boolean {
  return element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0;
}
