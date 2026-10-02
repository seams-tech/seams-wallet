import { expect, test, type Route } from '@playwright/test';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { alphabetizeStringify } from '../../packages/shared-ts/src/utils/digests';

class SetupServer {
  readonly requests: Array<{ operationId: string; environment: string }> = [];
  mode: 'lost' | 'accepted' | 'changed' | 'changed_ceremony' = 'lost';

  async handle(route: Route): Promise<void> {
    expect(route.request().headers()['x-seams-wallet-protocol']).toBe('2');
    const body = route.request().postDataJSON();
    const environment = route.request().headers()['x-seams-environment-id'];
    this.requests.push({ operationId: body.registrationOperationId, environment });
    if (this.mode === 'lost') {
      await route.abort('connectionreset');
      return;
    }
    const walletId = this.mode === 'changed' ? 'changed-wallet' : 'reserved-wallet';
    const intent = {
      version: 'registration_intent_v1',
      walletId,
      authMethod: body.authMethod,
      signerSelection: body.signerSelection,
      foundingWalletAuthMethodId: 'wallet-auth-method:fixture',
      nonceB64u: 'A'.repeat(43),
    };
    await route.fulfill({
      json: {
        ok: true,
        kind: 'near_ed25519',
        registrationCeremonyId:
          this.mode === 'changed_ceremony' ? 'wrc_changed' : `wrc_${environment}`,
        walletId,
        walletAuthMethodId: intent.foundingWalletAuthMethodId,
        registrationIntentDigestB64u: createHash('sha256')
          .update(alphabetizeStringify(intent))
          .digest('base64url'),
        intent,
        signedSetup: 'fixture-signed-setup',
      },
    });
  }
}

async function attemptSetup(environmentId: string): Promise<string> {
  const moduleUrl = '/__setup-client.js';
  const client = await import(moduleUrl);
  try {
    const result = await client.setupWalletRegistration({
      relayerUrl: location.origin,
      auth: { publishableKey: 'test-publishable-key', environmentId },
      request: {
        wallet: { kind: 'server_allocated' },
        authMethod: { kind: 'passkey', rpId: 'localhost' },
        signerSelection: {
          kind: 'signer_set',
          signers: [
            {
              kind: 'near_ed25519',
              accountProvisioning: {
                kind: 'implicit_account',
                accountIdSource: 'ed25519_public_key',
              },
              signerSlot: 1,
              participantIds: [1, 2],
              derivationVersion: 1,
            },
          ],
        },
      },
    });
    return result.ok ? result.walletId : result.message;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function readJournal(): Promise<unknown[]> {
  const moduleUrl = '/__setup-client.js';
  const client = await import(moduleUrl);
  const database = await client.seamsWalletDB.getDB();
  return database.getAll('app_state');
}

async function finishRegistration(environmentId: string): Promise<void> {
  const moduleUrl = '/__setup-client.js';
  const client = await import(moduleUrl);
  await client.registrationSetupRepository.complete({
    registrationCeremonyId: `wrc_${environmentId}`,
    walletId: 'reserved-wallet',
  });
}

async function corruptJournal(): Promise<void> {
  const moduleUrl = '/__setup-client.js';
  const client = await import(moduleUrl);
  const database = await client.seamsWalletDB.getDB();
  const rows = await database.getAll('app_state');
  for (const row of rows) {
    row.value.operationId = 'invalid';
    await database.put('app_state', row);
  }
}

test('setup delivery survives lost replies, concurrent tabs and reloads with scoped cleanup', async ({
  context,
  page,
}, testInfo) => {
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({
    stdin: {
      contents: `
        export { setupWalletRegistration } from './packages/wallet/src/core/rpcClients/relayer/walletRegistration';
        export { registrationSetupRepository, registrationSetupScopeDigest } from './packages/wallet/src/core/indexedDB/seamsWalletDB/registrationSetup';
        export { seamsWalletDB } from './packages/wallet/src/core/indexedDB/singletons';
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
  await context.route('**/__setup-client.js', serveModule.bind(null, bundle.outputFiles[0].text));
  const server = new SetupServer();
  await context.route('**/wallets/register/setup', server.handle.bind(server));
  await page.goto('/');
  const secondTab = await context.newPage();
  await secondTab.goto('/');

  const lost = await Promise.all([
    page.evaluate(attemptSetup, 'development'),
    secondTab.evaluate(attemptSetup, 'development'),
  ]);
  expect(lost).not.toContain('reserved-wallet');
  expect(server.requests).toHaveLength(2);
  const operationId = server.requests[0].operationId;
  expect(operationId).toMatch(/^wreg_[A-Za-z0-9_-]{43}$/);
  expect(server.requests[1].operationId).toBe(operationId);
  expect(await page.evaluate(readJournal)).toHaveLength(1);

  await page.reload();
  server.mode = 'accepted';
  expect(await page.evaluate(attemptSetup, 'development')).toBe('reserved-wallet');
  expect(server.requests.at(-1)?.operationId).toBe(operationId);
  const accepted = await page.evaluate(readJournal);
  expect(accepted).toMatchObject([{ value: { state: 'accepted', walletId: 'reserved-wallet' } }]);
  expect(JSON.stringify(accepted)).not.toContain('test-publishable-key');

  server.mode = 'changed';
  expect(await secondTab.evaluate(attemptSetup, 'development')).toContain(
    'changed its operation, wallet or ceremony',
  );
  expect(await page.evaluate(readJournal)).toEqual(accepted);

  server.mode = 'changed_ceremony';
  expect(await page.evaluate(attemptSetup, 'development')).toContain(
    'changed its operation, wallet or ceremony',
  );
  expect(await page.evaluate(readJournal)).toEqual(accepted);

  server.mode = 'accepted';
  expect(await secondTab.evaluate(attemptSetup, 'production')).toBe('reserved-wallet');
  const otherOperationId = server.requests.at(-1)?.operationId;
  expect(otherOperationId).not.toBe(operationId);
  await page.evaluate(finishRegistration, 'development');
  expect(await page.evaluate(readJournal)).toMatchObject([
    { value: { operationId: otherOperationId } },
  ]);
  expect(await page.evaluate(attemptSetup, 'development')).toBe('reserved-wallet');
  const nextOperationId = server.requests.at(-1)?.operationId;
  expect(nextOperationId).not.toBe(operationId);

  await page.evaluate(corruptJournal);
  const requestsBeforeCorruption = server.requests.length;
  expect(await page.evaluate(attemptSetup, 'development')).toContain('journal scope is invalid');
  expect(server.requests).toHaveLength(requestsBeforeCorruption);

  const evidence = testInfo.outputPath('registration-setup-delivery.json');
  await writeFile(
    evidence,
    JSON.stringify(
      {
        browser: testInfo.project.name,
        requests: server.requests,
        accepted,
        concurrentTabsSharedOperation: true,
        reloadReusedOperation: true,
        changedWalletRejected: true,
        changedCeremonyRejected: true,
        scopedCleanup: true,
        corruptJournalRejectedBeforeNetwork: true,
        service: 'Controlled reply fixture; server reservation replay is outside this scenario',
      },
      null,
      2,
    ),
  );
  await testInfo.attach('setup-delivery', { path: evidence, contentType: 'application/json' });
});

async function serveModule(source: string, route: Route): Promise<void> {
  await route.fulfill({ contentType: 'text/javascript', body: source });
}
