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
  dispose() {}
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

async function beginIntearConnection() {
  const path = '/_test-sdk/esm/externalNear/index.js';
  const { ExternalNearController } = await import(path);
  const controller = new ExternalNearController('testnet', location.origin + '/near-rpc');
  Reflect.set(window, 'pendingNearConnection', {
    controller,
    result: controller.connect('intear'),
  });
}
async function cancelIntearConnection() {
  const { controller, result } = Reflect.get(window, 'pendingNearConnection');
  controller.disconnect();
  const cancelled = await result;
  const next = await controller.connect('meteor');
  return { cancelled, next, snapshot: controller.getSnapshot() };
}
async function replyWithPendingWallet(route: Route): Promise<void> {
  await route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Pending wallet approval</title>',
  });
}

test('disconnect closes pending Intear approval and allows a fresh wallet connection', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  await injectImportMap(page, { frontendUrl: baseURL! });
  await context.route('https://wallet.intear.tech/**', replyWithPendingWallet);
  await page.route('**/externalNear/meteor.js', replyWithAdapter);
  await page.goto(baseURL!);
  const popupPromise = page.waitForEvent('popup');
  await page.evaluate(beginIntearConnection);
  const popup = await popupPromise;
  const closed = popup.waitForEvent('close');
  const result = await page.evaluate(cancelIntearConnection);
  await closed;
  expect(result.cancelled.code).toBe('connection_changed');
  expect(result.next.value.wallet).toBe('meteor');
  expect(result.snapshot.busy).toBe(false);
  await writeFile(
    testInfo.outputPath('disconnect-observations.json'),
    JSON.stringify(result, null, 2),
  );
});

const meteorDirectFixture = `
const meteorRequests = new Map();
window.meteorWireEvidence = [];
window.meteorComV2 = { sendMessageDataAndRespond: meteorRespond };
async function meteorRespond(request) {
  if (request.status === 'closed_success' || request.status === 'disconnected') return;
  let record = meteorRequests.get(request.uid);
  if (!record) {
    record = { attempts: 0, action: request.actionType, input: null };
    meteorRequests.set(request.uid, record);
  }
  record.attempts += 1;
  if (record.attempts === 1) return { uid: 'stale-request', status: 'closed_success', payload: { accountId: 'forged.testnet' } };
  if (record.attempts === 2) return { uid: request.uid, status: 'attempting_reconnect' };
  if (request.status === 'initializing') {
    record.input = request.inputs;
    return { uid: request.uid, status: 'connected' };
  }
  if (!record.input) throw new Error('Missing request inputs');
  window.meteorWireEvidence.push({ uid: request.uid, action: record.action, attempts: record.attempts, input: record.input });
  return { uid: request.uid, status: 'closed_success', payload: record.action === 'login'
    ? { accountId: 'alice.testnet', allKeys: [] }
    : { executionOutcomes: [{ transaction: { hash: '11111111111111111111111111111111', signer_id: 'alice.testnet' } }] } };
}
`;
async function replyWithMeteorBlock(route: Route): Promise<void> {
  await route.fulfill({
    json: { result: { header: { hash: '11111111111111111111111111111111' } } },
  });
}
async function exerciseMeteorWire() {
  const path = '/_test-sdk/esm/externalNear/index.js';
  const { ExternalNearController } = await import(path);
  const controller = new ExternalNearController('testnet', location.origin + '/meteor-block');
  const connected = await controller.connect('meteor');
  if (!connected.ok) throw new Error('Meteor failed to connect');
  const sent = await controller.sendTransaction(connected.value, {
    receiverId: 'guest.testnet',
    actions: [
      {
        type: 'FunctionCall',
        methodName: 'set_greeting',
        args: { greeting: 'wire acceptance' },
        gas: '10000000000000',
        deposit: '0',
      },
    ],
  });
  controller.disconnect();
  return { connected, sent, wire: Reflect.get(window, 'meteorWireEvidence') };
}

test('Meteor replays handshake inputs under one request identity and encodes the requested transaction', async ({
  page,
  baseURL,
}, testInfo) => {
  await injectImportMap(page, { frontendUrl: baseURL! });
  await page.route('**/meteor-block', replyWithMeteorBlock);
  await page.goto(baseURL!);
  await page.addScriptTag({ content: meteorDirectFixture });
  const evidence = await page.evaluate(exerciseMeteorWire);
  expect(evidence.sent.ok).toBe(true);
  expect(evidence.wire.map((record: { action: string }) => record.action)).toEqual([
    'login',
    'sign',
  ]);
  const encoded = Buffer.from(evidence.wire[1].input.transactions, 'base64');
  const signerLength = encoded.readUInt32LE(0);
  expect(encoded.subarray(4, 4 + signerLength).toString()).toBe('alice.testnet');
  const lengthPrefixBytes = 4;
  const publicKeyBytes = 1 + 32; // Ed25519 tag and encoded public key.
  const nonceBytes = 8;
  const receiverOffset = lengthPrefixBytes + signerLength + publicKeyBytes + nonceBytes;
  const receiverLength = encoded.readUInt32LE(receiverOffset);
  expect(encoded.subarray(receiverOffset + 4, receiverOffset + 4 + receiverLength).toString()).toBe(
    'guest.testnet',
  );
  const blockHashBytes = 32;
  const actionOffset = receiverOffset + lengthPrefixBytes + receiverLength + blockHashBytes;
  expect(encoded.readUInt32LE(actionOffset)).toBe(1);
  const functionCallTag = 2; // NEAR Action enum wire discriminant.
  expect(encoded[actionOffset + lengthPrefixBytes]).toBe(functionCallTag);
  expect(encoded.includes(Buffer.from('wire acceptance'))).toBe(true);
  await writeFile(
    testInfo.outputPath('meteor-wire-observations.json'),
    JSON.stringify(evidence, null, 2),
  );
});
