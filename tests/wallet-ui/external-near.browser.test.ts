import { test, expect, type Route } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { injectImportMap } from '../setup/bootstrap';

async function exerciseConnections() {
  const path = '/_test-sdk/esm/externalNear/index.js';
  const { ExternalNearController } = await import(path);
  const controller = new ExternalNearController('testnet', location.origin + '/near-rpc');
  const first = await controller.connect('meteor');
  if (!first.ok) throw new Error('Connection failed');
  window.postMessage({ type: 'near-wallet-injected', manifest: { id: 'meteor-wallet' } }, '*');
  const transaction = { receiverId: 'guest.testnet', actions: [{ type: 'Transfer', amount: '1' }] };
  const pending = controller.sendTransaction(first.value, transaction);
  controller.disconnect();
  const stale = await pending;
  const second = await controller.connect('meteor');
  if (!second.ok) throw new Error('Reconnect failed');
  const sent = await controller.sendTransaction(second.value, transaction);
  if (!sent.ok) throw new Error('Send failed');
  const receipt = await controller.checkOutcome(sent.value);
  const unknown = await controller.sendTransaction(second.value, transaction);
  return { stale, receipt, unknown, account: controller.getSnapshot().connection.accountId };
}

const adapter = `
let sends = 0;
export class MeteorExtensionProvider {
  async connect() { return ['alice.testnet']; }
  async accounts() { return ['alice.testnet']; }
  async disconnect() {}
  async send() {
    sends += 1;
    if (sends > 1) throw new Error('Transport lost after dispatch');
    return [{transaction:{hash:'11111111111111111111111111111111',signer_id:'alice.testnet'}}];
  }
}`;

test('disconnect invalidates prepared requests and transport loss never resends', async ({
  page,
  baseURL,
}, testInfo) => {
  await injectImportMap(page, { frontendUrl: baseURL! });
  await page.route('**/externalNear/meteor.js', replyWithAdapter);
  await page.route('**/near-rpc', replyWithReceipt);
  await page.goto(baseURL!);
  const evidence = await page.evaluate(exerciseConnections);
  expect(evidence.stale.code).toBe('connection_changed');
  expect(evidence.receipt.kind).toBe('confirmed');
  expect(evidence.unknown.code).toBe('submission_unknown');
  expect(evidence.account).toBe('alice.testnet');
  await writeFile(
    testInfo.outputPath('external-near-observations.json'),
    JSON.stringify(evidence, null, 2),
  );
});

async function replyWithAdapter(route: Route): Promise<void> {
  await route.fulfill({ contentType: 'application/javascript', body: adapter });
}
async function replyWithReceipt(route: Route): Promise<void> {
  await route.fulfill({
    json: {
      result: {
        final_execution_status: 'FINAL',
        transaction: { hash: '11111111111111111111111111111111', signer_id: 'alice.testnet' },
        status: { SuccessValue: '' },
        receipts_outcome: [],
      },
    },
  });
}

const hotFixture = `
window.hotFixture = { sends: 0, request: hotRequest };
async function hotRequest(method) {
  if (method === 'near:signIn') return { accountId: 'alice.near' };
  window.hotFixture.sends += 1;
  return { transactions: [{ transaction: {
    hash: '11111111111111111111111111111111', signer_id: 'alice.near'
  } }] };
}
`;

async function exerciseHot() {
  const path = '/_test-sdk/esm/externalNear/index.js';
  const { ExternalNearController } = await import(path);
  const fixture = Reflect.get(window, 'hotFixture');
  Reflect.set(window, 'hotExtension', { request: fixture.request });
  const controller = new ExternalNearController('mainnet', location.origin + '/near-rpc');
  const connected = await controller.connect('hot');
  if (!connected.ok) throw new Error('HOT connection failed');
  const transaction = { receiverId: 'bob.near', actions: [{ type: 'Transfer', amount: '1' }] };
  const sent = await controller.sendTransaction(connected.value, transaction);
  Reflect.set(window, 'hotExtension', { request: fixture.request });
  const replaced = await controller.sendTransaction(connected.value, transaction);
  const testnet = new ExternalNearController('testnet', location.origin + '/near-rpc');
  const unsupported = await testnet.connect('hot');
  controller.disconnect();
  return { wallet: connected.value.wallet, sent, replaced, unsupported, sends: fixture.sends };
}

test('HOT routes to its captured extension and rejects replacement and testnet', async ({
  page,
  baseURL,
}, testInfo) => {
  await injectImportMap(page, { frontendUrl: baseURL! });
  await page.goto(baseURL!);
  await page.addScriptTag({ content: hotFixture });
  const result = await page.evaluate(exerciseHot);
  expect(result.wallet).toBe('hot');
  expect(result.sent.ok).toBe(true);
  expect(result.replaced.code).toBe('unavailable');
  expect(result.unsupported.ok).toBe(false);
  expect(result.sends).toBe(1);
  await writeFile(
    testInfo.outputPath('hot-wallet-observations.json'),
    JSON.stringify(result, null, 2),
  );
});

async function exerciseIntear() {
  const path = '/_test-sdk/esm/externalNear/index.js';
  const { ExternalNearController } = await import(path);
  const controller = new ExternalNearController('testnet', location.origin + '/near-rpc');
  const connected = await controller.connect('intear');
  if (!connected.ok) throw new Error('Intear connection failed');
  const result = await controller.sendTransaction(connected.value, {
    receiverId: 'guest.testnet',
    actions: [{ type: 'Transfer', amount: '1' }],
  });
  controller.disconnect();
  return { connected, result, final: controller.getSnapshot() };
}

async function replyWithIntear(route: Route): Promise<void> {
  await route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><script>
    const target = new URL(document.referrer).origin;
    window.addEventListener('message', receive);
    function receive(event) {
      if (event.source !== opener || event.origin !== target) return;
      if (event.data.type === 'signIn') {
        if (event.data.data.contractId || event.data.data.message !== '{}') throw new Error('Unexpected key grant');
        const spoof = document.createElement('iframe');
        spoof.srcdoc = '<script>top.opener.postMessage({type:"connected",accountId:"forged.testnet",functionCallKeyAdded:false,useBridge:false,walletUrl:"https://wallet.intear.tech"},"*")<\\/script>';
        document.body.append(spoof);
        setTimeout(sendAccount, 100);
      } else {
        opener.postMessage({type:'sent',outcomes:[{transaction:{hash:'11111111111111111111111111111111',signer_id:'alice.testnet'}}]},target);
      }
    }
    function sendAccount() {
      opener.postMessage({type:'connected',accountId:'alice.testnet',functionCallKeyAdded:false,useBridge:false,walletUrl:'https://wallet.intear.tech'},target);
    }
    opener.postMessage({type:'ready'}, target);
  </script><body>Controlled Intear wallet</body>`,
  });
}

test('Intear binds popup responses to their source and keeps custody grants absent', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  await injectImportMap(page, { frontendUrl: baseURL! });
  await context.route('https://wallet.intear.tech/**', replyWithIntear);
  await page.goto(baseURL!);
  const result = await page.evaluate(exerciseIntear);
  expect(result.connected.value.wallet).toBe('intear');
  expect(result.connected.value.accountId).toBe('alice.testnet');
  expect(result.result.ok).toBe(true);
  expect(result.final.connection.kind).toBe('disconnected');
  await writeFile(
    testInfo.outputPath('intear-wallet-observations.json'),
    JSON.stringify(result, null, 2),
  );
});

async function renderPicker() {
  const reactPath = 'react';
  const domPath = 'react-dom/client';
  const pickerPath = '/_test-sdk/esm/react/externalNear.js';
  const controllerPath = '/_test-sdk/esm/externalNear/index.js';
  const React = await import(reactPath);
  const { createRoot } = await import(domPath);
  const { ExternalNearWalletPicker } = await import(pickerPath);
  const { ExternalNearController } = await import(controllerPath);
  const root = document.createElement('div');
  root.style.maxWidth = '880px';
  root.style.fontFamily = 'system-ui';
  document.body.append(root);
  createRoot(root).render(
    React.createElement(ExternalNearWalletPicker, {
      controller: new ExternalNearController('testnet', location.origin + '/near-rpc'),
    }),
  );
}

test('NEAR picker shows three wallets with explicit transport and network limits', async ({
  page,
  baseURL,
}, testInfo) => {
  await injectImportMap(page, { frontendUrl: baseURL! });
  await page.goto(baseURL!);
  await page.evaluate(renderPicker);
  await expect(page.getByRole('button', { name: 'HOT Wallet Mainnet only' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Meteor Wallet Browser extension' })).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Intear Wallet Opens wallet.intear.tech' }),
  ).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('near-wallet-picker.png') });
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.getByRole('heading', { name: 'Choose your NEAR wallet' })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('near-wallet-picker-mobile.png'),
    fullPage: true,
  });
});
