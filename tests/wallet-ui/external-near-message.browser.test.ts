import { test, expect, type Route } from '@playwright/test';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { base58Encode } from '../../packages/shared-ts/src/utils/base58';
import { injectImportMap } from '../setup/bootstrap';

const keys = generateKeyPairSync('ed25519');
const publicKeyDer = keys.publicKey.export({ format: 'der', type: 'spki' });
const publicKey = `ed25519:${base58Encode(publicKeyDer.subarray(-32))}`;

type MessageWireInput = {
  accountId: string;
  message: string;
  recipient: string;
  nonce: number[];
  callbackUrl?: string;
  state?: string;
};

// Encode independently of the SDK's Borsh schema.
function encodeString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const size = Buffer.alloc(4);
  size.writeUInt32LE(bytes.length);
  return Buffer.concat([size, bytes]);
}

function messageDigest(input: MessageWireInput): Buffer {
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(2 ** 31 + 413);
  const callback =
    input.callbackUrl === undefined
      ? Buffer.from([0])
      : Buffer.concat([Buffer.from([1]), encodeString(input.callbackUrl)]);
  return createHash('sha256')
    .update(
      Buffer.concat([
        tag,
        encodeString(input.message),
        Buffer.from(input.nonce),
        encodeString(input.recipient),
        callback,
      ]),
    )
    .digest();
}

async function replyWithSignature(route: Route): Promise<void> {
  const input: MessageWireInput = route.request().postDataJSON();
  await route.fulfill({
    json: {
      accountId: input.accountId,
      publicKey,
      signature: sign(null, messageDigest(input), keys.privateKey).toString('base64'),
    },
  });
}

const meteorFixture = `
window.messageFixture = { mode: 'success', requests: [], acknowledgements: [], held: null, hotRequests: [] };
window.meteorComV2 = { sendMessageDataAndRespond: respondToMeteor };
window.hotExtension = { request: hotRequest };
async function hotRequest(method) {
  window.messageFixture.hotRequests.push(method);
  if (method !== 'near:signIn') throw new Error('Unexpected HOT signing request');
  return { accountId: 'alice.near' };
}
async function respondToMeteor(request) {
  const fixture = window.messageFixture;
  if (request.status === 'closed_success' || request.status === 'disconnected') {
    fixture.acknowledgements.push({ uid: request.uid, status: request.status });
    return;
  }
  if (request.actionType === 'login') {
    return { uid: request.uid, status: 'closed_success', payload: { accountId: 'alice.testnet' } };
  }
  if (request.actionType !== 'sign_message') throw new Error('Unexpected wallet action');
  if (!request.inputs) return;
  fixture.requests.push(structuredClone(request));
  if (fixture.mode === 'hold') {
    return new Promise(captureHeldRequest.bind(null, request));
  }
  if (fixture.mode === 'decline') return { uid: request.uid, status: 'closed_window' };
  return completeMessage(request, fixture.mode);
}
function captureHeldRequest(request, resolve) {
  window.messageFixture.held = { request, resolve };
}
async function completeMessage(request, mode) {
  const input = structuredClone(request.inputs);
  if (mode === 'message') input.message += ' changed';
  if (mode === 'recipient') input.recipient += '.invalid';
  if (mode === 'nonce') input.nonce[0] ^= 1;
  if (mode === 'callback') input.callbackUrl += '/changed';
  const response = await fetch('/ownership-sign', { method: 'POST', body: JSON.stringify(input) });
  const payload = await response.json();
  if (mode === 'account') payload.accountId = 'mallory.testnet';
  if (mode === 'key') payload.publicKey = 'ed25519:111';
  if (mode === 'signature') payload.signature = btoa('invalid');
  if (mode === 'state') payload.state = 'wrong-state';
  return { uid: request.uid, status: 'closed_success', payload };
}
`;

async function exerciseOwnershipCheck() {
  const path = '/_test-sdk/esm/externalNear/index.js';
  const { ExternalNearController } = await import(path);
  const controller = new ExternalNearController({
    network: 'testnet',
    rpcUrl: location.origin + '/near-rpc',
    wallets: ['meteor'],
  });
  const connected = await controller.connect('meteor');
  if (!connected.ok) throw new Error('Meteor connection failed.');
  const fixture = Reflect.get(window, 'messageFixture');
  const nonce = new Uint8Array(32);
  for (let index = 0; index < nonce.length; index++) nonce[index] = index;
  const input = {
    message: 'Verify GetSignal ownership · 所有者',
    recipient: 'getsignal.example',
    nonce,
    callbackUrl: location.origin + '/ownership/callback',
    state: 'getsignal-challenge',
  };
  const pending = controller.signMessage(connected.value, input);
  nonce.fill(255);
  const duplicate = await controller.signMessage(connected.value, input);
  const signed = await pending;
  const invalidNonce = await controller.signMessage(connected.value, {
    message: input.message,
    recipient: input.recipient,
    nonce: new Uint8Array(31),
  });
  const failures = [];
  for (const mode of [
    'message',
    'recipient',
    'nonce',
    'callback',
    'account',
    'key',
    'signature',
    'state',
    'decline',
  ]) {
    fixture.mode = mode;
    const result = await controller.signMessage(connected.value, input);
    failures.push({ mode, result });
  }
  fixture.mode = 'success';
  const withoutCallback = await controller.signMessage(connected.value, {
    message: '',
    recipient: input.recipient,
    nonce: new Uint8Array(32),
  });
  const transport = Reflect.get(window, 'meteorComV2');
  Reflect.set(window, 'meteorComV2', {
    sendMessageDataAndRespond: transport.sendMessageDataAndRespond,
  });
  const replacedTransport = await controller.signMessage(connected.value, input);
  const hot = new ExternalNearController({
    network: 'mainnet',
    rpcUrl: location.origin + '/near-rpc',
    wallets: ['hot'],
  });
  const hotConnection = await hot.connect('hot');
  if (!hotConnection.ok) throw new Error('HOT connection failed.');
  const unsupportedWallet = await hot.signMessage(hotConnection.value, input);
  hot.disconnect();
  controller.disconnect();
  return {
    signed,
    duplicate,
    invalidNonce,
    failures,
    withoutCallback,
    replacedTransport,
    unsupportedWallet,
    hotRequests: fixture.hotRequests,
    wire: fixture.requests,
    snapshot: controller.getSnapshot(),
  };
}

function nonceByte(_: unknown, index: number): number {
  return index;
}

test('Meteor proves message ownership and rejects changed signed fields without submitting a transaction', async ({
  page,
  baseURL,
}, testInfo) => {
  const rpcRequests: string[] = [];
  page.on('request', recordRpcRequest.bind(null, rpcRequests));
  await injectImportMap(page, { frontendUrl: baseURL! });
  await page.route('**/ownership-sign', replyWithSignature);
  await page.goto(baseURL!);
  await page.addScriptTag({ content: meteorFixture });
  const evidence = await page.evaluate(exerciseOwnershipCheck);
  expect(evidence.signed.ok).toBe(true);
  expect(evidence.signed.value.accountId).toBe('alice.testnet');
  expect(evidence.signed.value.state).toBe('getsignal-challenge');
  expect(evidence.duplicate.code).toBe('pending_request');
  expect(evidence.invalidNonce.code).toBe('invalid_input');
  expect(evidence.withoutCallback.ok).toBe(true);
  expect(evidence.withoutCallback.value.state).toBeUndefined();
  expect(evidence.replacedTransport.code).toBe('unavailable');
  expect(evidence.unsupportedWallet.code).toBe('unavailable');
  expect(evidence.hotRequests).toEqual(['near:signIn']);
  expect(evidence.wire).toHaveLength(11);
  expect(evidence.wire[0].network).toBe('testnet');
  expect(evidence.wire[0].inputs.nonce).toEqual(Array.from({ length: 32 }, nonceByte));
  for (const failure of evidence.failures) {
    expect(failure.result.code, failure.mode).toBe('unavailable');
  }
  const digest = messageDigest(evidence.wire[0].inputs);
  expect(
    verify(null, digest, keys.publicKey, Buffer.from(evidence.signed.value.signature, 'base64')),
  ).toBe(true);
  expect(evidence.snapshot.busy).toBe(false);
  expect(rpcRequests).toEqual([]);
  await writeFile(
    testInfo.outputPath('meteor-message-ownership.json'),
    JSON.stringify(
      {
        ...evidence,
        digestHex: digest.toString('hex'),
        verifier: 'Node.js Ed25519 with independent NEP-413 encoding',
        rpcRequests,
      },
      null,
      2,
    ),
  );
});

function recordRpcRequest(requests: string[], request: { url(): string }): void {
  if (request.url().endsWith('/near-rpc')) requests.push(request.url());
}

async function beginMessageApproval() {
  const path = '/_test-sdk/esm/externalNear/index.js';
  const { ExternalNearController } = await import(path);
  const controller = new ExternalNearController({
    network: 'mainnet',
    rpcUrl: location.origin + '/near-rpc',
    wallets: ['meteor'],
  });
  const connected = await controller.connect('meteor');
  if (!connected.ok) throw new Error('Meteor connection failed.');
  Reflect.get(window, 'messageFixture').mode = 'hold';
  Reflect.set(window, 'pendingMessage', {
    controller,
    connection: connected.value,
    result: controller.signMessage(connected.value, {
      message: 'Verify GetSignal ownership',
      recipient: 'getsignal.example',
      nonce: new Uint8Array(32),
    }),
  });
}

function hasHeldMessage(): boolean {
  return Reflect.get(window, 'messageFixture').held !== null;
}

async function replaceMessageConnection() {
  const pending = Reflect.get(window, 'pendingMessage');
  const fixture = Reflect.get(window, 'messageFixture');
  const previousHeld = fixture.held;
  pending.controller.disconnect();
  const cancelled = await pending.result;
  const next = await pending.controller.connect('meteor');
  if (!next.ok) throw new Error('Meteor reconnect failed.');
  const stale = await pending.controller.signMessage(pending.connection, {
    message: 'stale',
    recipient: 'getsignal.example',
    nonce: new Uint8Array(32),
  });
  fixture.held = null;
  Reflect.set(
    window,
    'nextMessage',
    pending.controller.signMessage(next.value, {
      message: 'fresh',
      recipient: 'getsignal.example',
      nonce: new Uint8Array(32),
    }),
  );
  Reflect.set(window, 'previousHeldMessage', previousHeld);
  return { cancelled, stale };
}

async function completeMessageApprovals() {
  const fixture = Reflect.get(window, 'messageFixture');
  const previous = Reflect.get(window, 'previousHeldMessage');
  const complete = Reflect.get(window, 'completeMessage');
  previous.resolve(await complete(previous.request, 'success'));
  const controller = Reflect.get(window, 'pendingMessage').controller;
  const afterLateReply = controller.getSnapshot();
  fixture.held.resolve(await complete(fixture.held.request, 'success'));
  const fresh = await Reflect.get(window, 'nextMessage');
  const final = controller.getSnapshot();
  controller.disconnect();
  return {
    afterLateReply,
    fresh,
    final,
    acknowledgements: fixture.acknowledgements,
    wire: fixture.requests,
  };
}

test('disconnect cancels message approval and late replies preserve a newer pending connection', async ({
  page,
  baseURL,
}, testInfo) => {
  await injectImportMap(page, { frontendUrl: baseURL! });
  await page.route('**/ownership-sign', replyWithSignature);
  await page.goto(baseURL!);
  await page.addScriptTag({ content: meteorFixture });
  await page.evaluate(beginMessageApproval);
  await page.waitForFunction(hasHeldMessage);
  const replaced = await page.evaluate(replaceMessageConnection);
  await page.waitForFunction(hasHeldMessage);
  const completed = await page.evaluate(completeMessageApprovals);
  expect(replaced.cancelled.code).toBe('connection_changed');
  expect(replaced.stale.code).toBe('connection_changed');
  expect(completed.afterLateReply.busy).toBe(true);
  expect(completed.fresh.ok).toBe(true);
  expect(completed.final.busy).toBe(false);
  expect(completed.wire).toHaveLength(2);
  expect(completed.wire[0].network).toBe('mainnet');
  expect(completed.acknowledgements).toContainEqual({
    uid: completed.wire[0].uid,
    status: 'disconnected',
  });
  await writeFile(
    testInfo.outputPath('meteor-message-cancellation.json'),
    JSON.stringify({ replaced, completed }, null, 2),
  );
});
