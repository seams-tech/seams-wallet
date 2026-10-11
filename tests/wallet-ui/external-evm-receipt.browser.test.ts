import { expect, test, type Route } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { injectImportMap } from '../setup/bootstrap';

type ReceiptCase =
  | 'confirmed'
  | 'reverted'
  | 'wrong_sender'
  | 'wrong_hash'
  | 'wrong_chain'
  | 'timeout'
  | 'cancelled';
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const HASH = `0x${'22'.repeat(32)}`;

async function replyToRpc(counts: Map<string, number>, route: Route): Promise<void> {
  const scenario = new URL(route.request().url()).pathname.split('/').at(-1);
  const request = route.request().postDataJSON();
  const key = `${scenario}:${request.method}`;
  const count = (counts.get(key) ?? 0) + 1;
  counts.set(key, count);
  let result: unknown = null;
  if (request.method === 'eth_chainId') {
    result = scenario === 'wrong_chain' ? '0x2' : '0x1';
  } else if (request.method === 'eth_getTransactionReceipt') {
    const pending =
      scenario === 'timeout' ||
      scenario === 'cancelled' ||
      ((scenario === 'confirmed' || scenario === 'reverted') && count === 1);
    if (!pending) {
      result = {
        transactionHash: scenario === 'wrong_hash' ? `0x${'33'.repeat(32)}` : HASH,
        from: scenario === 'wrong_sender' ? '0x3333333333333333333333333333333333333333' : ACCOUNT,
        status: scenario === 'reverted' ? '0x0' : '0x1',
        blockNumber: '0x10',
      };
    }
  }
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }),
  });
}

async function waitInBrowser(scenario: ReceiptCase) {
  const modulePath = '/_test-sdk/esm/externalEvm/index.js';
  const { ExternalEvmController } = (await import(modulePath)) as typeof import('@/externalEvm');
  const controller = new ExternalEvmController([
    {
      chainId: 1,
      name: 'Receipt test chain',
      rpcUrl: `${location.origin}/receipt-test/${scenario}`,
    },
  ]);
  const result = await controller.waitForReceipt(
    {
      kind: 'submitted',
      hash: `0x${'22'.repeat(32)}`,
      account: '0x1111111111111111111111111111111111111111',
      chainId: 1,
    },
    {
      timeoutMs: scenario === 'timeout' ? 50 : 5_000,
      signal: scenario === 'cancelled' ? AbortSignal.timeout(250) : undefined,
    },
  );
  return result.kind === 'unresolved'
    ? { kind: result.kind, reason: result.reason }
    : { kind: result.kind, blockNumber: String(result.blockNumber) };
}

test('receipt waiting follows pending inclusion and rejects mismatched, expired, and cancelled observations', async ({
  page,
  baseURL,
}, testInfo) => {
  const counts = new Map<string, number>();
  await injectImportMap(page);
  await page.route('**/receipt-test/*', replyToRpc.bind(null, counts));
  await page.goto(baseURL!);
  const scenarios: ReceiptCase[] = [
    'confirmed',
    'reverted',
    'wrong_sender',
    'wrong_hash',
    'wrong_chain',
    'timeout',
    'cancelled',
  ];
  const observations = [];
  for (const scenario of scenarios) {
    const result = await page.evaluate(waitInBrowser, scenario);
    observations.push({ scenario, result });
    if (scenario === 'confirmed' || scenario === 'reverted') {
      expect(result).toEqual({ kind: scenario, blockNumber: '16' });
      expect(counts.get(`${scenario}:eth_getTransactionReceipt`)).toBe(2);
    } else {
      expect(result.kind).toBe('unresolved');
    }
  }
  expect(counts.get('wrong_chain:eth_getTransactionReceipt')).toBeUndefined();
  expect(counts.get('timeout:eth_getTransactionReceipt')).toBe(1);
  expect(counts.get('cancelled:eth_getTransactionReceipt')).toBe(1);
  const artifact = testInfo.outputPath('receipt-observations.json');
  await writeFile(
    artifact,
    JSON.stringify({ observations, rpcCounts: Object.fromEntries(counts) }, null, 2),
  );
  await testInfo.attach('receipt-observations', {
    path: artifact,
    contentType: 'application/json',
  });
});
