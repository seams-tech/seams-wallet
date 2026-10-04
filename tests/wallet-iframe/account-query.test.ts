import { expect, test, type Route } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

class AccountRpc {
  readonly accounts: string[] = [];

  async handle(route: Route): Promise<void> {
    const request = route.request().postDataJSON();
    const accountId = request.params.account_id;
    this.accounts.push(accountId);
    if (accountId === 'retry.testnet' && this.accounts.filter(isRetryAccount).length === 1) {
      await route.fulfill({ status: 503, body: 'Temporarily unavailable' });
      return;
    }
    if (accountId === 'unavailable.testnet') {
      await route.fulfill({ status: 503, body: 'Temporarily unavailable' });
      return;
    }
    if (accountId === 'absent.testnet') {
      await route.fulfill({
        json: {
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32000, message: 'UNKNOWN_ACCOUNT', data: 'Account does not exist' },
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          amount: '1000000000000000000000000',
          locked: '0',
          code_hash: '11111111111111111111111111111111',
          storage_usage: 182,
          storage_paid_at: 0,
          block_height: 1,
          block_hash: '11111111111111111111111111111111',
        },
      },
    });
  }
}

function isRetryAccount(accountId: string): boolean {
  return accountId === 'retry.testnet';
}

async function queryAccounts() {
  const moduleUrl = '/__account-sdk.js';
  const sdk = await import(moduleUrl);
  const seams = new sdk.SeamsWeb(
    sdk.defineSeamsConfig({
      walletOrigin: 'https://wallet.example.localhost',
      relayerUrl: location.origin,
      projectEnvironmentId: 'account-query:dev',
      publishableKey: 'pk_test',
      chains: [{ network: 'near-testnet' }],
    }),
    new sdk.MinimalNearClient(`${location.origin}/__account-rpc`),
  );
  try {
    const present = await seams.near.accountExists('present.testnet');
    const absent = await seams.near.accountExists('absent.testnet');
    const retried = await seams.near.accountExists('retry.testnet');
    let unavailable = '';
    try {
      await seams.near.accountExists('unavailable.testnet');
    } catch (error) {
      unavailable = error instanceof Error ? error.message : String(error);
    }
    let invalid = '';
    try {
      await seams.near.accountExists('INVALID ACCOUNT');
    } catch (error) {
      invalid = error instanceof Error ? error.message : String(error);
    }
    return { present, absent, retried, unavailable, invalid };
  } finally {
    seams.dispose();
  }
}

async function serveModule(source: string, route: Route): Promise<void> {
  await route.fulfill({ contentType: 'text/javascript', body: source });
}

test('public account queries use the injected RPC and distinguish absence from unavailable reads', async ({
  page,
}, testInfo) => {
  const rpc = new AccountRpc();
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({
    stdin: {
      contents: `
        export { SeamsWeb, defineSeamsConfig } from './packages/wallet/dist/esm/index.js';
        export { MinimalNearClient } from './packages/wallet/dist/esm/advanced.js';
      `,
      resolveDir: root,
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
  });
  await page.route('**/__account-sdk.js', serveModule.bind(null, bundle.outputFiles[0]!.text));
  await page.route('**/__account-rpc', rpc.handle.bind(rpc));
  await page.goto('/');
  const result = await page.evaluate(queryAccounts);
  expect(result.present).toBe(true);
  expect(result.absent).toBe(false);
  expect(result.retried).toBe(true);
  expect(result.unavailable).toContain('503');
  expect(result.invalid).toContain('Invalid NEAR account ID');
  expect(rpc.accounts).toEqual([
    'present.testnet',
    'absent.testnet',
    'retry.testnet',
    'retry.testnet',
    'unavailable.testnet',
    'unavailable.testnet',
  ]);
  await expect(page.locator('iframe')).toHaveCount(0);
  const artifact = testInfo.outputPath('account-query.json');
  await mkdir(path.dirname(artifact), { recursive: true });
  await writeFile(artifact, JSON.stringify({ result, accounts: rpc.accounts }, null, 2));
  await testInfo.attach('account-query.json', {
    path: artifact,
    contentType: 'application/json',
  });
});
