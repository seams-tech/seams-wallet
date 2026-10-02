import {
  expect,
  type BrowserContext,
  type Page,
  type Route,
  type TestInfo,
} from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import {
  WALLET_MANAGEMENT_PROTOCOL_HEADER,
  WALLET_MANAGEMENT_PROTOCOL_VERSION,
} from '../../../packages/shared-ts/src/utils/walletManagementProtocol';
import type { IntendedBehaviourHarness } from './harness';

class PreviousProtocolRequest {
  requests = 0;
  url = '';
  headers: Record<string, string> = {};
  body = '';

  async forward(route: Route): Promise<void> {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    this.requests += 1;
    this.url = route.request().url();
    this.body = route.request().postData() ?? '';
    this.headers = await route.request().allHeaders();
    delete this.headers[WALLET_MANAGEMENT_PROTOCOL_HEADER.toLowerCase()];
    await route.continue({ headers: this.headers });
  }
}

class PublishedClientModule {
  constructor(readonly source: string) {}

  async serve(route: Route): Promise<void> {
    await route.fulfill({ contentType: 'text/javascript', body: this.source });
  }
}

async function callPublishedRegistration(input: {
  gatewayOrigin: string;
  publishableKey: string;
  environmentId: string;
}): Promise<string> {
  const moduleUrl = '/__published-client.js';
  const client = await import(moduleUrl);
  try {
    await client.setupWalletRegistration({
      relayerUrl: input.gatewayOrigin,
      auth: { publishableKey: input.publishableKey, environmentId: input.environmentId },
      request: {
        wallet: { kind: 'server_allocated' },
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
        authMethod: { kind: 'passkey', rpId: 'localhost' },
      },
    });
    return 'unexpected success';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function readAcceptedSetupOperations(
  _body: HTMLElement,
  modulePath: string,
): Promise<string[]> {
  const { seamsWalletDB } = await import(modulePath);
  const database = await seamsWalletDB.getDB();
  const prefix = 'wallet_registration_setup:';
  const rows = await database.getAll('app_state', IDBKeyRange.bound(prefix, `${prefix}\uffff`));
  const accepted: string[] = [];
  for (const row of rows) {
    if (row.value.state === 'accepted') accepted.push(row.value.operationId);
  }
  return accepted;
}

async function verifyPublishedClientRejection(
  page: Page,
  previous: PreviousProtocolRequest,
  root: string,
): Promise<void> {
  const definition = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  expect(definition.name).toBe('@seams/wallet');
  expect(definition.version).toBe('0.7.3');
  const bundle = await build({
    entryPoints: [path.join(root, 'dist/esm/core/rpcClients/relayer/walletRegistration.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
  });
  const module = new PublishedClientModule(bundle.outputFiles[0].text);
  const serve = module.serve.bind(module);
  await page.route('**/__published-client.js', serve);
  try {
    const message = await page.evaluate(callPublishedRegistration, {
      gatewayOrigin: new URL(previous.url).origin,
      publishableKey: previous.headers.authorization.replace(/^Bearer /, ''),
      environmentId: previous.headers['x-seams-environment-id'],
    });
    expect(message).toContain('Reload this page and try again');
    expect(message).toContain('upgrade the Wallet SDK');
  } finally {
    await page.unroute('**/__published-client.js', serve);
  }
}

export async function verifyWalletProtocolCutover(
  {
    harness,
    context,
    page,
  }: {
    harness: IntendedBehaviourHarness;
    context: BrowserContext;
    page: Page;
  },
  testInfo: TestInfo,
): Promise<void> {
  const previous = new PreviousProtocolRequest();
  const forward = previous.forward.bind(previous);
  const setup = '**/wallets/register/setup';
  await context.route(setup, forward);
  try {
    await expect(harness.registerPasskeyWallet()).rejects.toThrow('Reload this page and try again');
    await expect(page.getByTestId('intended-result-json')).toContainText('upgrade the Wallet SDK');
    expect(previous.requests).toBe(1);
  } finally {
    await context.unroute(setup, forward);
  }

  const publishedRoot = process.env.SEAMS_PUBLISHED_WALLET_ROOT;
  if (publishedRoot) await verifyPublishedClientRejection(page, previous, publishedRoot);

  const unsupported = await context.request.post(previous.url, {
    headers: { ...previous.headers, [WALLET_MANAGEMENT_PROTOCOL_HEADER]: 'unsupported' },
    data: '{invalid JSON',
  });
  expect(unsupported.status()).toBe(409);
  expect(await unsupported.json()).toMatchObject({ ok: false, code: 'wallet_protocol_mismatch' });

  const previousVersion = await context.request.post(previous.url, {
    headers: { ...previous.headers, [WALLET_MANAGEMENT_PROTOCOL_HEADER]: '1' },
    data: '{invalid JSON',
  });
  expect(previousVersion.status()).toBe(409);
  expect(await previousVersion.json()).toMatchObject({
    ok: false,
    code: 'wallet_protocol_mismatch',
  });

  const missingOperation = JSON.parse(previous.body);
  delete missingOperation.registrationOperationId;
  const rejectedOperation = await context.request.post(previous.url, {
    headers: {
      ...previous.headers,
      [WALLET_MANAGEMENT_PROTOCOL_HEADER]: WALLET_MANAGEMENT_PROTOCOL_VERSION,
    },
    data: missingOperation,
  });
  expect(rejectedOperation.status()).toBe(400);
  expect(await rejectedOperation.json()).toMatchObject({
    ok: false,
    code: 'invalid_body',
    message: 'registrationOperationId is required',
  });

  const preflight = await context.request.fetch(previous.url, {
    method: 'OPTIONS',
    headers: {
      Origin: new URL(page.url()).origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': WALLET_MANAGEMENT_PROTOCOL_HEADER,
    },
  });
  expect(preflight.status()).toBe(204);
  expect(preflight.headers()['access-control-allow-headers']).toContain(
    WALLET_MANAGEMENT_PROTOCOL_HEADER,
  );

  await page.reload();
  await harness.registerPasskeyWallet();
  await harness.signTempoTransaction('post_registration');
  await harness.signArcEvmTransaction('post_registration');
  await harness.awaitNearReady();
  const databaseModule = `/@fs/${path.resolve(import.meta.dirname, '../../../packages/wallet/dist/esm/core/indexedDB/singletons.js')}`;
  const acceptedSetupOperations = await page
    .locator('iframe[allow*="publickey-credentials-get"]')
    .last()
    .contentFrame()
    .locator('body')
    .evaluate(readAcceptedSetupOperations, databaseModule);
  expect(acceptedSetupOperations).toEqual([]);
  await writeFile(
    testInfo.outputPath('wallet-protocol-cutover.json'),
    JSON.stringify(
      {
        oldRequest:
          'current browser client with the protocol header removed to reproduce the published request shape',
        rejectedRequests: previous.requests,
        published073Client: publishedRoot ? 'rejected with upgrade message' : 'not requested',
        upgradeMessageVisible: true,
        unsupportedProtocolRejectedBeforeJsonParsing: true,
        previousProtocolRejectedBeforeJsonParsing: true,
        missingSetupOperationRejected: true,
        preflightAccepted: true,
        registrationAfterReload: 'passed',
        acceptedSetupOperationsAfterPublication: acceptedSetupOperations,
        verifiedSignatures: ['Tempo', 'Arc'],
      },
      null,
      2,
    ),
  );
}
