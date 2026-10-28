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
    palette: 'default', theme: { id: 'default', mode: 'light', colors: { buttonBackground: '#8d2e35' } },
  }),
  walletOrigin: '${walletOrigin}', servicePath: '/wallet-service', sdkBasePath: '/sdk',
  testOptions: { ownerTag: 'wallet-connector' },
});
window.__connectorRouter = router;
const seams = {
  authMenu: {
    prepare() {},
    open: router.openHostedAuthMenu.bind(router),
    cancel: router.cancelHostedAuthMenu.bind(router),
    onExternalAuthRequest: router.onHostedAuthMenuExternalAuthRequest.bind(router),
    resolveExternalAuth: router.resolveHostedAuthMenuExternalAuth.bind(router),
  },
};
export function useSeams() { return { seams, loginState: { isLoggedIn: false } }; }
`;

const application = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { WalletConnectorMenu } from '/_test-sdk/esm/react/components/HostedSeamsAuthMenu/WalletConnectorMenu.js';
import { Theme } from '/_test-sdk/esm/react/components/theme/ThemeProvider.js';
import { ExternalNearController } from '/_test-sdk/esm/externalNear/index.js';

const controller = new ExternalNearController({ network: 'testnet', rpcUrl: location.origin + '/near-rpc', wallets: ['meteor', 'hot'] });
const root = createRoot(document.querySelector('main'));
window.__connector = { controller, root, outcomes: [], connections: [], closes: 0 };
const motion = { frames: [], readyAt: null, done: false };
window.__connector.motion = motion;
function recordFrame(time) {
  const panel = document.querySelector('.seams-wallet-connector');
  const anchor = panel?.querySelector('[data-seams-auth-menu-host]');
  const frame = document.querySelector('iframe[data-seams-owner="wallet-connector"]');
  const ready = anchor?.hasAttribute('data-seams-auth-menu-ready') ?? false;
  if (!panel) return;
  const bounds = panel.getBoundingClientRect();
  const frameBounds = ready ? frame?.getBoundingClientRect() : null;
  motion.frames.push({ height: bounds.height, top: bounds.top, ready,
    frameHeight: frameBounds?.height ?? null, frameTop: frameBounds?.top ?? null });
  if (ready && motion.readyAt === null) motion.readyAt = time;
  if (motion.readyAt !== null && time - motion.readyAt > 400) {
    motion.done = true;
  } else {
    requestAnimationFrame(recordFrame);
  }
}
function recordTransition() { requestAnimationFrame(recordFrame); }
window.__connector.recordTransition = recordTransition;
function outcome(value) { window.__connector.outcomes.push(value); }
function connected(connection) { window.__connector.connections.push(connection); root.unmount(); }
function close() { window.__connector.closes += 1; }
const custom = new URLSearchParams(location.search).has('custom');
const brandedThemes = {
  rose: {
    mode: 'light',
    tokens: {
      colors: {
        colorBackground: '#fff7f8', textPrimary: '#34141f', textSecondary: '#79515f',
        secondaryButtonBackground: '#ffffff', secondaryButtonHoverBackground: '#fce5ea',
        secondaryButtonBorder: '#dda3b2', secondaryButtonText: '#532531', borderHover: '#ad304c',
        buttonBackground: '#8d2e35', textButton: '#fff5e7', passkeyHaloBackground: '#f3d5dc',
      },
      shape: { card: '28px', control: '18px', controlHeight: '52px' },
      spacing: { xs: '6px', sm: '10px', md: '18px', lg: '28px' },
      shadows: { md: '0 5px 15px rgb(70 20 40 / 0.2)' },
    },
  },
  forest: {
    mode: 'dark',
    tokens: {
      colors: {
        colorBackground: '#12241d', textPrimary: '#d6f2e4', textSecondary: '#a1c6b3',
        secondaryButtonBackground: '#1c4032', secondaryButtonHoverBackground: '#285a46',
        secondaryButtonBorder: '#426a57', secondaryButtonText: '#d6f2e4', borderHover: '#bce9d1',
        buttonBackground: '#a2dbbd', textButton: '#10291c', passkeyHaloBackground: '#294f3e',
      },
      shape: { card: '32px', control: '24px', controlHeight: '56px' },
      spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px' },
      shadows: { md: '0 5px 15px rgb(0 0 0 / 0.3)' },
    },
  },
};
const props = {
  onOutcome: outcome,
  onClose: close,
  externalNear: { controller, onConnected: connected },
  ...(custom ? {
    title: 'Choose your wallet',
    description: 'A branded connector using the same hosted authentication surface.',
    options: {
      seams: { label: 'Create my wallet', description: 'Secure access with a passkey' },
      meteor: { label: 'Use Meteor', icon: React.createElement('span', { 'data-custom-icon': '' }, '☄') },
    },
    authMenu: { copy: { register: { title: 'Create your preview wallet' } } },
  } : {}),
};
root.render(React.createElement(React.StrictMode, null,
  React.createElement(Theme, { tag: 'div', theme: 'light', tokens: { light: { colors: { buttonBackground: '#8d2e35' } } } },
    React.createElement(WalletConnectorMenu, props))));
async function applyTheme(name) {
  const theme = brandedThemes[name];
  root.render(React.createElement(React.StrictMode, null,
    React.createElement(Theme, { tag: 'div', theme: theme.mode, tokens: { [theme.mode]: theme.tokens } },
      React.createElement(WalletConnectorMenu, props))));
  await window.__connectorRouter.setAppearance({ palette: 'default', theme: {
    id: name, mode: theme.mode, colors: theme.tokens.colors, shape: theme.tokens.shape,
  }});
}
window.__connector.applyTheme = applyTheme;
`;

function serveContext(route: Route) {
  return route.fulfill({ contentType: 'application/javascript', body: contextModule });
}

function serveApplication(route: Route) {
  return route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}
      <link rel="stylesheet" href="/_test-sdk/esm/react/styles/styles.css">
      <style>
        body { margin: 0; background: #ddd; }
        main { min-height: 100dvh; display: grid; place-items: center; }
        main > div { width: min(420px, calc(100vw - 32px)); }
      </style></head><body><main></main><script type="module">${application}</script></body></html>`,
  });
}

function serveMeteor(route: Route) {
  return route.fulfill({
    contentType: 'application/javascript',
    body: `
      function pending(resolve) { window.__resolveMeteor = resolve; }
      export class MeteorExtensionProvider {
        connect() { return new Promise(pending); }
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
  await page.evaluate('window.__connector?.root.unmount(); window.__connectorRouter?.dispose()');
});

test('default menu transitions into the isolated auth menu, returns on cancel, and keeps an external connection after closing', async ({
  page,
}, testInfo) => {
  await page.goto('/wallet-connector-test');
  const panel = page.locator('.seams-wallet-connector');
  await expect(page.getByRole('heading', { name: 'Connect wallet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to wallet selection' })).toHaveCount(0);
  const meteorIcon = page.getByRole('button', { name: /Connect Meteor Wallet/ }).locator('img');
  const hotIcon = page.getByRole('button', { name: /Connect HOT Wallet/ }).locator('img');
  await expect.poll(meteorIcon.evaluate.bind(meteorIcon, loadedWalletIcon)).toBe(true);
  await expect.poll(hotIcon.evaluate.bind(hotIcon, loadedWalletIcon)).toBe(true);
  await expect(page.getByRole('button', { name: /Connect HOT Wallet/ })).toBeDisabled();
  const seamsOption = page.getByRole('button', { name: /Create a Seams Wallet/ });
  const forwardShaft = seamsOption.locator('.seams-hover-arrow-line');
  await expect(forwardShaft).toHaveCSS('opacity', '0');
  await seamsOption.hover();
  await expect(forwardShaft).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: /Connect HOT Wallet/ }).hover();
  await expect(
    page.getByRole('button', { name: /Connect HOT Wallet/ }).locator('.seams-hover-arrow-line'),
  ).toHaveCSS('opacity', '0');
  const chooser = await panel.boundingBox();
  await page.screenshot({ path: testInfo.outputPath('connector-choices.png') });
  await page.evaluate('window.__connector.recordTransition()');
  await page.getByRole('button', { name: /Create a Seams Wallet/ }).click();
  const auth = page.frameLocator('iframe[data-seams-owner="wallet-connector"]');
  await expect(auth.locator('.seams-title')).toHaveText('Create a wallet');
  await expect(page.locator('[data-seams-auth-menu-ready]')).toHaveCount(1);
  await expect
    .poll(panel.evaluate.bind(panel, readPanelGeometry))
    .toMatchObject({ fitsContent: true });
  const expanded = await panel.boundingBox();
  await expect.poll(page.evaluate.bind(page, 'window.__connector.motion.done')).toBe(true);
  const motion: {
    frames: Array<{
      height: number;
      top: number;
      ready: boolean;
      frameHeight: number | null;
      frameTop: number | null;
    }>;
  } = await page.evaluate('window.__connector.motion');
  if (!chooser || !expanded) throw new Error('Connector bounds are missing');
  const minHeight = Math.min(chooser.height, expanded.height);
  const maxHeight = Math.max(chooser.height, expanded.height);
  const intermediate = motion.frames.filter(isIntermediateFrame.bind(null, minHeight, maxHeight));
  expect(intermediate.length).toBeGreaterThanOrEqual(2);
  for (const sample of motion.frames) {
    if (!sample.ready || sample.frameHeight === null || sample.frameTop === null) continue;
    expect(Math.abs(sample.height - sample.frameHeight)).toBeLessThanOrEqual(1);
    expect(Math.abs(sample.top - sample.frameTop)).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: testInfo.outputPath('connector-auth.png') });
  await page.getByRole('button', { name: 'Back to wallet selection' }).hover();
  await expect(
    page
      .getByRole('button', { name: 'Back to wallet selection' })
      .locator('.seams-hover-arrow-line'),
  ).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: 'Back to wallet selection' }).click();
  await expect(page.getByRole('heading', { name: 'Connect wallet' })).toBeFocused();
  expect(await page.evaluate('window.__connector.closes')).toBe(0);
  expect(await page.evaluate('window.__connector.outcomes.length')).toBe(0);
  await page.getByRole('button', { name: /Create a Seams Wallet/ }).click();
  await expect(auth.locator('.seams-title')).toHaveText('Create a wallet');
  await auth.locator('.auth-menu-root').press('Escape');
  await expect(page.getByRole('heading', { name: 'Connect wallet' })).toBeFocused();
  await page.getByRole('button', { name: /Connect Meteor Wallet/ }).click();
  await expect(page.getByRole('status')).toHaveText('Complete the request in your wallet.');
  await page.waitForFunction('typeof window.__resolveMeteor === "function"');
  await page.evaluate("window.__resolveMeteor(['alice.testnet'])");
  await expect(panel).toHaveCount(0);
  const result = await page.evaluate(
    '({ connection: window.__connector.controller.getSnapshot().connection, outcomes: window.__connector.outcomes, connections: window.__connector.connections, closes: window.__connector.closes })',
  );
  expect(result.connection.kind).toBe('connected');
  expect(result.connection.accountId).toBe('alice.testnet');
  expect(result.connections).toHaveLength(1);
  expect(result.outcomes).toHaveLength(1);
  expect(result.outcomes[0].kind).toBe('cancelled');
  await writeFile(
    testInfo.outputPath('connector-results.json'),
    JSON.stringify({ chooser, expanded, motion, result }, null, 2),
  );
});

test('custom options and reduced motion survive cancellation of a disabled wallet', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/wallet-connector-test?custom');
  await expect(page.getByRole('heading', { name: 'Choose your wallet' })).toBeVisible();
  await expect(page.locator('[data-custom-icon]')).toBeVisible();
  await expect(page.locator('.seams-wallet-connector')).toHaveCSS('transition-duration', '0s');
  await page.getByRole('button', { name: /Use Meteor/ }).click();
  await expect(page.getByRole('status')).toBeVisible();
  await page.waitForFunction('typeof window.__resolveMeteor === "function"');
  await page.evaluate(
    "window.__connector.controller.setWallets([]); window.__resolveMeteor(['late.testnet'])",
  );
  await page.getByRole('button', { name: /Create my wallet/ }).click();
  const auth = page.frameLocator('iframe[data-seams-owner="wallet-connector"]');
  await expect(auth.locator('.seams-title')).toHaveText('Create your preview wallet');
  expect(await page.evaluate('window.__connector.connections.length')).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('custom-connector-mobile.png') });
});

function readPanelGeometry(element: HTMLElement) {
  const content = element.querySelector<HTMLElement>('.seams-wallet-connector-content');
  if (!content) throw new Error('Connector content is missing');
  return { fitsContent: Math.abs(element.offsetHeight - content.offsetHeight) <= 1 };
}

function isIntermediateFrame(minHeight: number, maxHeight: number, frame: { height: number }) {
  return frame.height > minHeight + 1 && frame.height < maxHeight - 1;
}

function loadedWalletIcon(element: Element): boolean {
  return element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0;
}

test('connector follows branded light and dark tokens through hover, auth, and back navigation', async ({
  page,
}, testInfo) => {
  await page.goto('/wallet-connector-test');
  const panel = page.locator('.seams-wallet-connector');
  const option = page.getByRole('button', { name: /Create a Seams Wallet/ });
  await expect(option).toBeVisible();
  await page.evaluate("window.__connector.applyTheme('rose')");
  await expect(panel).toHaveCSS('background-color', 'rgb(255, 247, 248)');
  await expect(panel).toHaveCSS('border-radius', '28px');
  await expect(option).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(option).toHaveCSS('color', 'rgb(83, 37, 49)');
  await expect(option).toHaveCSS('border-radius', '18px');
  await expect(option).toHaveCSS('padding-top', '18px');
  await option.hover();
  await expect(option).toHaveCSS('background-color', 'rgb(252, 229, 234)');
  await page.screenshot({ path: testInfo.outputPath('connector-rose.png') });
  await option.click();
  const auth = page.frameLocator('iframe[data-seams-owner="wallet-connector"]');
  await expect(auth.locator('.auth-menu-root')).toHaveCSS('background-color', 'rgb(255, 247, 248)');
  await page.evaluate("window.__connector.applyTheme('forest')");
  await expect(auth.locator('.auth-menu-root')).toHaveCSS('background-color', 'rgb(18, 36, 29)');
  await expect(auth.locator('.auth-menu-root')).toHaveCSS('border-radius', '32px');
  await page.getByRole('button', { name: 'Back to wallet selection' }).click();
  await expect(option).toHaveCSS('background-color', 'rgb(28, 64, 50)');
  await expect(option).toHaveCSS('color', 'rgb(214, 242, 228)');
  await expect(option).toHaveCSS('border-radius', '24px');
  await expect(panel).toHaveCSS('background-color', 'rgb(18, 36, 29)');
  await expect(panel).toHaveCSS('border-radius', '32px');
  await page.screenshot({ path: testInfo.outputPath('connector-forest.png') });
});
