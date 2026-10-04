import { expect, test, type Route } from '@playwright/test';
import { build } from 'esbuild';
import type { AppearanceConfigInput } from '../../packages/wallet/src/core/types/seams';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setupBasicPasskeyTest } from '../setup';
import { buildWalletServiceHtml, registerWalletServiceRoute } from './harness';

const hostScript = `
const originalConfigAdopt = adoptPort;
let configContext;
let configurationModule;
let originalConfigMessage;
function acceptConfiguration(event) {
  void applyConfiguration(event).catch(reportConfigurationFailure.bind(null, event.data.requestId));
}
function reportConfigurationFailure(requestId, error) {
  adoptedPort.postMessage({ type: 'ERROR', requestId, payload: { code: 'config_probe_failed', message: String(error) } });
}
async function applyConfiguration(event) {
  if (event.data.type !== 'PM_SET_CONFIG') return originalConfigMessage(event);
  configurationModule ||= await import('/__config-probe.js');
  configContext ||= configurationModule.createHostContext();
  configurationModule.applyWalletConfig(configContext, event.data.payload);
  const resolved = configurationModule.resolveWalletHostConfig(configContext.walletConfigs);
  document.body.classList.add('seams-wallet-ui');
  const style = getComputedStyle(document.body);
  window.configurationReceipt = {
    rendered: {
      accentPrimary: style.getPropertyValue('--seams-colors-accentPrimary').trim(),
      buttonBackground: style.getPropertyValue('--seams-colors-buttonBackground').trim(),
      card: style.getPropertyValue('--seams-shape-card').trim(),
      control: style.getPropertyValue('--seams-shape-control').trim(),
    },
    authPolicy: resolved.signing.emailOtp.authPolicy,
    delegateRoute: resolved.network.relayer.routes.delegateAction,
    relayerUrl: resolved.network.relayer.url,
    theme: resolved.ui.appearance.theme.mode,
    themeId: resolved.ui.appearance.theme.id,
    colors: resolved.ui.appearance.theme.colors,
    shape: resolved.ui.appearance.theme.shape ?? {},
    walletMode: resolved.wallet.mode,
    hasNestedOrigin: Object.hasOwn(resolved.wallet.iframe, 'origin'),
    rpId: resolved.wallet.iframe.rpIdOverride,
  };
  postResult(event.data.requestId, undefined);
}
function adoptConfigurationPort(port) {
  originalConfigAdopt(port);
  originalConfigMessage = adoptedPort.onmessage;
  adoptedPort.onmessage = acceptConfiguration;
}
adoptPort = adoptConfigurationPort;
`;

async function serveProbe(source: string, route: Route): Promise<void> {
  await route.fulfill({ contentType: 'text/javascript', body: source });
}

async function configureClient(): Promise<void> {
  const modulePath = '/__config-probe.js';
  const sdk = await import(modulePath);
  const config = sdk.buildConfigsFromEnv({
    chains: [{ network: 'near-testnet' }],
    relayer: { url: 'https://relay.example.localhost', delegateActionRoute: '/custom/delegate' },
    emailOtpAuthPolicy: 'per_operation',
    registration: { publishableKey: 'pk_test_configuration' },
    appearance: {
      theme: {
        id: 'first',
        mode: 'dark',
        colors: { accentPrimary: '#123456', buttonBackground: '#abcdef' },
        shape: { card: '8px' },
      },
    },
    iframeWallet: {
      walletOrigin: 'https://wallet.example.localhost',
      rpIdOverride: 'wallet.example.localhost',
    },
  });
  const router = await sdk.createWalletIframeRouter({
    configs: config,
    walletOrigin: 'https://wallet.example.localhost',
    getAppearance: readAppearance.bind(null, config.ui.appearance),
  });
  await router.init();
  (window as any).configurationRouter = router;
}

function readAppearance(appearance: unknown): unknown {
  return appearance;
}

function readReceipt() {
  return (window as any).configurationReceipt;
}

async function updateAppearance(appearance: AppearanceConfigInput): Promise<void> {
  await (window as any).configurationRouter.setAppearance(appearance);
}

function disposeClient(): void {
  (window as any).configurationRouter.dispose();
}

test('iframe configuration preserves custom relay routes and Email OTP policy across appearance changes', async ({
  page,
}, info) => {
  page.on('pageerror', reportProbeError);
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({
    stdin: {
      contents: `
        export { createWalletIframeRouter } from './packages/wallet/src/SeamsWeb/assembly/createWalletIframeRouter.ts';
        export { buildConfigsFromEnv } from './packages/wallet/src/core/config/defaultConfigs.ts';
        export { resolveWalletHostConfig } from './packages/wallet/src/SeamsWeb/walletIframe/host/configuration.ts';
        export { createHostContext, applyWalletConfig } from './packages/wallet/src/SeamsWeb/walletIframe/host/context.ts';
      `,
      resolveDir: root,
    },
    tsconfig: path.join(root, 'packages/wallet/tsconfig.json'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
  });
  await setupBasicPasskeyTest(page, { skipSeamsWebInit: true });
  await page.route('**/__config-probe.js', serveProbe.bind(null, bundle.outputFiles[0]!.text));
  await registerWalletServiceRoute(
    page,
    buildWalletServiceHtml({ extraScript: hostScript }),
    '**://wallet.example.localhost/wallet-service*',
  );
  await page.addScriptTag({ content: `window.readAppearance = ${readAppearance.toString()};` });
  await page.evaluate(configureClient);
  const frame = page.frames().find(isWalletFrame)!;
  const initial = await frame.evaluate(readReceipt);
  expect(initial).toMatchObject({
    authPolicy: 'per_operation',
    delegateRoute: '/custom/delegate',
    relayerUrl: 'https://relay.example.localhost',
    walletMode: 'direct',
    hasNestedOrigin: false,
    rpId: 'wallet.example.localhost',
  });
  await page.evaluate<void, AppearanceConfigInput>(updateAppearance, {
    theme: {
      id: 'first',
      mode: 'light',
      colors: { accentPrimary: '#112233' },
      shape: { control: '4px' },
    },
  });
  const updated = await frame.evaluate(readReceipt);
  expect(updated).toEqual({
    ...initial,
    theme: 'light',
    colors: { accentPrimary: '#112233', buttonBackground: '#abcdef' },
    shape: { card: '8px', control: '4px' },
    rendered: {
      accentPrimary: '#112233',
      buttonBackground: '#abcdef',
      card: '8px',
      control: '4px',
    },
  });
  await page.evaluate<void, AppearanceConfigInput>(updateAppearance, {
    theme: { id: 'second', mode: 'light', colors: { accentPrimary: '#654321' } },
  });
  const switched = await frame.evaluate(readReceipt);
  expect(switched).toEqual({
    ...updated,
    themeId: 'second',
    colors: { accentPrimary: '#654321' },
    shape: {},
    rendered: { accentPrimary: '#654321', buttonBackground: '', card: '', control: '' },
  });
  await page.evaluate(disposeClient);
  const artifact = info.outputPath('configuration-forwarding.json');
  await mkdir(path.dirname(artifact), { recursive: true });
  await writeFile(artifact, JSON.stringify({ initial, updated, switched }, null, 2));
  await info.attach('configuration-forwarding.json', {
    path: artifact,
    contentType: 'application/json',
  });
});

function isWalletFrame(frame: { url(): string }): boolean {
  return frame.url().startsWith('https://wallet.example.localhost/wallet-service');
}

function reportProbeError(error: Error): void {
  console.error(error.message);
}
