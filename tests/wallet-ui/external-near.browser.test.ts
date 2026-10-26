import { test, expect, type Route } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { injectImportMap } from '../setup/bootstrap';

async function exerciseConnections() {
  const path = '/_test-sdk/esm/externalNear/index.js';
  const { ExternalNearController } = await import(path);
  const controller = new ExternalNearController('testnet', location.origin + '/near-rpc');
  const first = await controller.connect();
  if (!first.ok) throw new Error('Connection failed');
  window.postMessage({ type: 'near-wallet-injected', manifest: { id: 'meteor-wallet' } }, '*');
  const transaction = { receiverId: 'guest.testnet', actions: [{ type: 'Transfer', amount: '1' }] };
  const pending = controller.sendTransaction(first.value, transaction);
  controller.disconnect();
  const stale = await pending;
  const second = await controller.connect();
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
