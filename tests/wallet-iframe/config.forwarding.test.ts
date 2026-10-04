import { expect, test, type Route } from '@playwright/test';
import { build } from 'esbuild';
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
  const resolved = configurationModule.buildConfigsFromEnv(configContext.walletConfigs, {
    allowDirectWalletMode: 'wallet_host',
  });
  window.configurationReceipt = {
    authPolicy: resolved.signing.emailOtp.authPolicy,
    delegateRoute: resolved.network.relayer.routes.delegateAction,
    relayerUrl: resolved.network.relayer.url,
    theme: resolved.ui.appearance.theme.mode,
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
    iframeWallet: { walletOrigin: 'https://wallet.example.localhost' },
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

async function updateAppearance(): Promise<void> {
  await (window as any).configurationRouter.setAppearance({ theme: { mode: 'light' } });
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
  });
  await page.evaluate(updateAppearance);
  const updated = await frame.evaluate(readReceipt);
  expect(updated).toEqual({ ...initial, theme: 'light' });
  await page.evaluate(disposeClient);
  const artifact = info.outputPath('configuration-forwarding.json');
  await mkdir(path.dirname(artifact), { recursive: true });
  await writeFile(artifact, JSON.stringify({ initial, updated }, null, 2));
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
