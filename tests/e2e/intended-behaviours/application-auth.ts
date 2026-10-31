import {
  expect,
  type BrowserContext,
  type Response as BrowserResponse,
  type Page,
  type Route,
  type TestInfo,
} from '@playwright/test';
import { parseStaticWalletConsoleBindingConfigV1 } from '@server/router/cloudflare/runtime/staticWalletConsoleBinding';
import { base58Encode } from '@shared/utils/base58';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applicationWalletHandoff } from '../../../examples/seams-auth-menu/src/applicationAuthBackend';
import type {} from '../../intended-app/src/ApplicationAuthPage';
import { readEnvFile } from '../../scripts/intended-google-oidc-env.mjs';
import { authenticateApplicationPasskey } from './application-login';
import { addWebAuthnVirtualAuthenticator, fulfillNearRpcStub } from './harness';
import { isolatedGatewayDatabasePath, loadIsolatedDatabaseSync } from './local-gateway-database';
import { nearTransactionHash } from './near-transaction-hash';

class ApplicationBackend {
  readonly session = { subject: 'getsignal-user-42', expiresAtMs: Date.now() + 3_600_000 };
  readonly broadcasts: string[] = [];
  loseNextBroadcast = false;
  lostBroadcast = false;
  pendingBroadcast: Route | null = null;
  statusUnavailable = false;
  statusRequests = 0;
  lastHandoff: { url: string; headers: Record<string, string>; body: string } | null = null;

  constructor(
    readonly appOrigin: string,
    readonly relayerUrl: string,
    readonly environmentId: string,
    readonly secretApiKey: string,
    readonly privateKey: CryptoKey,
  ) {}

  async handoff(route: Route): Promise<void> {
    const request = route.request();
    this.lastHandoff = {
      url: request.url(),
      headers: request.headers(),
      body: request.postData() || '',
    };
    const response = await this.exchange(
      new Request(request.url(), {
        method: request.method(),
        headers: request.headers(),
        body: request.postData(),
      }),
    );
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  }

  exchange(request: Request): Promise<Response> {
    return applicationWalletHandoff(request, {
      appOrigin: this.appOrigin,
      issuer: 'https://getsignal.example',
      environmentId: this.environmentId,
      relayerUrl: this.relayerUrl,
      secretApiKey: this.secretApiKey,
      privateKey: this.privateKey,
      readApplicationSession: this.readSession.bind(this),
    });
  }

  async replayHandoff(): Promise<number> {
    const previous = this.lastHandoff;
    if (!previous) throw new Error('Missing consumed handoff.');
    const response = await this.exchange(
      new Request(previous.url, { method: 'POST', headers: previous.headers, body: previous.body }),
    );
    return response.status;
  }

  async readSession() {
    return this.session;
  }

  async rpc(route: Route): Promise<void> {
    const request = requireRecord(route.request().postDataJSON(), 'RPC request');
    if (request.method === 'send_tx' && this.loseNextBroadcast) {
      this.loseNextBroadcast = false;
      this.lostBroadcast = true;
      this.pendingBroadcast = route;
      return;
    }
    if (request.method === 'EXPERIMENTAL_tx_status') {
      this.statusRequests += 1;
      if (this.statusUnavailable) {
        await route.fulfill({ status: 503, body: 'Transaction status unavailable' });
        return;
      }
      const encoded = this.broadcasts.at(-1);
      if (!encoded) throw new Error('No transaction exists for recovery.');
      const params = requireRecord(request.params, 'transaction status params');
      expect(params.tx_hash).toBe(nearTransactionHash(encoded));
      await route.fulfill({
        json: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            final_execution_status: 'FINAL',
            status: { SuccessValue: '' },
            transaction: { hash: nearTransactionHash(encoded) },
            transaction_outcome: {
              id: nearTransactionHash(encoded),
              outcome: {
                status: { SuccessValue: '' },
                logs: [],
                receipt_ids: [],
                gas_burnt: 0,
                tokens_burnt: '0',
                executor_id: 'fixture',
              },
            },
            receipts_outcome: [],
          },
        },
      });
      return;
    }
    if (request.method === 'query') {
      const params = requireRecord(request.params, 'query params');
      if (params.request_type === 'view_access_key') {
        await route.fulfill({
          json: {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              nonce: 1 + this.broadcasts.length,
              block_height: 1,
              block_hash: '11111111111111111111111111111111',
              permission: 'FullAccess',
            },
          },
        });
        return;
      }
    }
    await fulfillNearRpcStub(route);
  }

  async releaseLostBroadcast(): Promise<void> {
    const route = this.pendingBroadcast;
    if (!route) throw new Error('The broadcast has not reached the RPC boundary.');
    this.pendingBroadcast = null;
    await route.abort('failed');
  }

  observe(route: import('@playwright/test').Request): void {
    if (route.method() !== 'POST') return;
    if (!new URL(route.url()).hostname.endsWith('fastnear.com')) return;
    const body: unknown = route.postDataJSON();
    if (!body || typeof body !== 'object' || Reflect.get(body, 'method') !== 'send_tx') return;
    const params: unknown = Reflect.get(body, 'params');
    if (
      params &&
      typeof params === 'object' &&
      typeof Reflect.get(params, 'signed_tx_base64') === 'string'
    )
      this.broadcasts.push(Reflect.get(params, 'signed_tx_base64'));
  }
}

export async function verifyApplicationAuth(
  { page, context }: { page: Page; context: BrowserContext },
  testInfo: TestInfo,
): Promise<void> {
  console.info('[application-auth] browser fixture start');
  const authenticator = await context.newCDPSession(page);
  await authenticator.send('WebAuthn.enable');
  await addWebAuthnVirtualAuthenticator(authenticator);
  const appOrigin = process.env.SEAMS_INTENDED_APP_URL || 'http://localhost:4201';
  const relayerUrl = process.env.SEAMS_INTENDED_ROUTER_URL || 'http://127.0.0.1:4100';
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', keys.publicKey)).toString(
    'base64url',
  );
  console.info('[application-auth] configure issuer');
  const deployment = await configureApplicationTrust(publicKey);
  await expect.poll(gatewayReady.bind(null, relayerUrl), { timeout: 20_000 }).toBe(true);
  console.info('[application-auth] issuer configured');
  const backend = new ApplicationBackend(
    appOrigin,
    relayerUrl,
    deployment.environmentId,
    deployment.secretApiKey,
    keys.privateKey,
  );
  context.on('request', backend.observe.bind(backend));
  await context.route('https://rpc.testnet.fastnear.com/**', backend.rpc.bind(backend));
  await context.route(`${appOrigin}/api/wallet/handoff`, backend.handoff.bind(backend));
  page.on('response', logApplicationResponse);
  page.on('pageerror', logApplicationError);
  page.on('requestfailed', logApplicationRequestFailure);
  try {
    await page.goto(`${appOrigin}/application-auth`, { waitUntil: 'domcontentloaded' });
    console.info('[application-auth] example loaded');
    await Promise.all([runButton(page, 'Create owner wallet'), approveOwnerRegistration(page)]);
    const walletId = await page.getByLabel('Wallet ID', { exact: true }).inputValue();
    expect(walletId).not.toBe('');
    expect(await reusableAuthorityCount(walletId)).toEqual({ sessions: 0, quotas: 0 });
    const ownerSession = await page.evaluate(readSession);
    expect(ownerSession.authentication.kind).not.toBe('authenticated');

    await Promise.all([
      runButton(page, 'Link application account'),
      clickWalletControl(page, 'Connect app'),
    ]);
    await expect(page.getByText('Wallet connected for reading.', { exact: true })).toBeVisible();
    const firstSession = await page.evaluate(readSession);
    expect(firstSession.authentication.kind).toBe('external_authenticated');
    await page.reload();
    await expect(page.getByText('Wallet connected for reading.', { exact: true })).toBeVisible();
    await page
      .getByRole('button', { name: 'Prepare one yoctoNEAR self-transfer', exact: true })
      .click();
    await Promise.all([
      runButton(page, 'Review and approve transfer'),
      clickNearConfirmation(page),
    ]);
    await expect(page.getByRole('region', { name: 'Owner transaction' })).toHaveAttribute(
      'data-state',
      'completed',
      { timeout: 90_000 },
    );
    expect(backend.broadcasts.length).toBe(1);
    if (firstSession.authentication.kind !== 'external_authenticated')
      throw new Error('The read connection disappeared.');
    if (!firstSession.externalSettings) throw new Error('Missing external wallet settings.');
    const nearAccount = firstSession.externalSettings.accounts.find(nearAccountEntry);
    if (!nearAccount) throw new Error('Missing NEAR public identity.');
    expect(await freshSigningAdmissions(walletId)).toBe(1);
    console.info('[application-auth] first transaction complete');

    // A cancelled review preserves the readable connection and spends no approval.
    await page
      .getByRole('button', { name: 'Prepare one yoctoNEAR self-transfer', exact: true })
      .click();
    await page.getByRole('button', { name: 'Review and approve transfer', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Owner transaction' })).toHaveAttribute(
      'data-state',
      'approval',
    );
    await clickNearCancellation(page);
    await expect(page.getByRole('region', { name: 'Owner transaction' })).toHaveAttribute(
      'data-state',
      'cancelled',
    );
    expect((await page.evaluate(readSession)).authentication.kind).toBe('external_authenticated');
    expect(backend.broadcasts.length).toBe(1);
    console.info('[application-auth] cancellation complete');

    // Reload destroys an approval before signing. Its intact receipt proves non-submission.
    await page
      .getByRole('button', { name: 'Prepare one yoctoNEAR self-transfer', exact: true })
      .click();
    await page.getByRole('button', { name: 'Review and approve transfer', exact: true }).click();
    await page
      .locator('iframe[allow*="publickey-credentials-get"]')
      .last()
      .contentFrame()
      .locator('#seams-confirm-portal')
      .getByRole('button', { name: 'Cancel', exact: true })
      .waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Check existing transaction', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Owner transaction' })).toHaveAttribute(
      'data-state',
      'not_submitted',
    );
    expect(backend.broadcasts.length).toBe(1);

    // The next operation needs a new owner assertion even though material was just opened.
    await page
      .getByRole('button', { name: 'Prepare one yoctoNEAR self-transfer', exact: true })
      .click();
    await Promise.all([
      runButton(page, 'Review and approve transfer'),
      clickNearConfirmation(page),
    ]);
    expect(backend.broadcasts.length).toBe(2);
    expect(await freshSigningAdmissions(walletId)).toBe(2);
    console.info('[application-auth] second transaction complete');

    const appPasskey = await authenticateApplicationPasskey(page, appOrigin);
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await expect(page.getByText('Wallet connected for reading.', { exact: true })).toBeVisible();
    expect(await backend.replayHandoff()).toBe(403);
    const passkeySession = await page.evaluate(readSession);
    expect(passkeySession.authentication.kind).toBe('external_authenticated');
    expect(passkeySession.authentication.walletId).toBe(walletId);
    if (passkeySession.authentication.kind !== 'external_authenticated')
      throw new Error('Missing passkey application connection.');
    if (firstSession.authentication.kind !== 'external_authenticated')
      throw new Error('Missing initial application connection.');
    expect(passkeySession.authentication.associationId).toBe(
      firstSession.authentication.associationId,
    );
    console.info('[application-auth] application passkey login complete');

    // An interrupted response recovers the existing hash after reload and never rebroadcasts.
    backend.loseNextBroadcast = true;
    await page
      .getByRole('button', { name: 'Prepare one yoctoNEAR self-transfer', exact: true })
      .click();
    await page.getByRole('button', { name: 'Review and approve transfer', exact: true }).click();
    await clickNearConfirmation(page);
    await expect.poll(readBroadcastCount.bind(null, backend), { timeout: 90_000 }).toBe(3);
    await expect(page.getByRole('region', { name: 'Owner transaction' })).toHaveAttribute(
      'data-state',
      'submitting',
    );
    const unresolvedHash = nearTransactionHash(backend.broadcasts[2]);
    await expect(page.getByText(`Transaction: ${unresolvedHash}`, { exact: true })).toBeVisible();
    await backend.releaseLostBroadcast();
    await expect(page.getByRole('region', { name: 'Owner transaction' })).toHaveAttribute(
      'data-state',
      'unresolved',
      { timeout: 90_000 },
    );
    expect(backend.lostBroadcast).toBe(true);
    const broadcastsAfterLoss = backend.broadcasts.length;
    await page.evaluate(prepareApiOperation);
    const newRecovery = await page.evaluate(readApiRecovery);
    expect(await page.evaluate(approveApiOnce)).toBe('unresolved');
    const blockingState = await page.evaluate(readApiState);
    expect(blockingState.transactionId).toBe(unresolvedHash);
    expect(blockingState.recovery.operationId).not.toBe(newRecovery.operationId);
    const missingReceipt = await page.evaluate(recoverApiOperation, newRecovery);
    expect(missingReceipt.kind).toBe('recovery_unavailable');
    await page.evaluate(prepareApiOperation);
    expect(await page.evaluate(approveApiOnce)).toBe('unresolved');
    expect((await page.evaluate(readApiState)).recovery).toEqual(blockingState.recovery);
    expect(backend.broadcasts.length).toBe(broadcastsAfterLoss);

    // Failure to authenticate recovery must retain the known hash and remain retryable.
    await context.route('**/wallet/external-auth/settings', unavailableOwnerSettings);
    const failedRecovery = await page.evaluate(recoverCurrentApiOperation);
    expect(failedRecovery.kind).toBe('unresolved');
    expect(failedRecovery.transactionId).toBe(unresolvedHash);
    await context.unroute('**/wallet/external-auth/settings', unavailableOwnerSettings);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Owner transaction' })).toHaveAttribute(
      'data-state',
      'unknown',
    );
    await context.route('**/wallet/external-auth/settings', unavailableOwnerSettings);
    await page.getByRole('button', { name: 'Check existing transaction', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Owner transaction' })).toHaveAttribute(
      'data-state',
      'recovery_unavailable',
    );
    await context.unroute('**/wallet/external-auth/settings', unavailableOwnerSettings);
    backend.statusUnavailable = true;
    await page.getByRole('button', { name: 'Check existing transaction', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Owner transaction' })).toHaveAttribute(
      'data-state',
      'unresolved',
    );
    await expect(page.getByText(`Transaction: ${unresolvedHash}`, { exact: true })).toBeVisible();
    backend.statusUnavailable = false;
    await page.getByRole('button', { name: 'Check existing transaction', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Owner transaction' })).toHaveAttribute(
      'data-state',
      'completed',
    );
    expect(backend.broadcasts.length).toBe(broadcastsAfterLoss);
    const statusRequestsAfterSettlement = backend.statusRequests;
    const settledRecovery = await page.evaluate(recoverApiOperation, blockingState.recovery);
    expect(settledRecovery.kind).toBe('completed');
    expect(backend.statusRequests).toBe(statusRequestsAfterSettlement);

    // The same handle shares one in-flight approval and cannot replay after completion.
    await page.evaluate(prepareApiOperation);
    const duplicateApproval = page.evaluate(approveApiTwice);
    await clickNearConfirmation(page);
    expect(await duplicateApproval).toEqual(['completed', 'completed']);
    expect(backend.broadcasts.length).toBe(broadcastsAfterLoss + 1);
    expect(await page.evaluate(replayApiOperation)).toBe(true);

    console.info('[application-auth] recovery and concurrent calls complete');
    // An expired prepared handle cannot prompt or sign.
    await page.evaluate(prepareApiOperation);
    await page.clock.install();
    await page.clock.fastForward(121_000);
    expect(await page.evaluate(approveApiOnce)).toBe('expired');
    await page.clock.resume();
    expect(backend.broadcasts.length).toBe(broadcastsAfterLoss + 1);
    expect(await freshSigningAdmissions(walletId)).toBe(4);

    await page.evaluate(prepareApiOperation);
    backend.session.subject = 'getsignal-other-user';
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Application authentication', exact: true }),
    ).toHaveAttribute('data-state', 'failed');
    expect(await page.evaluate(approveApiOnce)).toBe('not_submitted');
    expect(backend.broadcasts.length).toBe(broadcastsAfterLoss + 1);
    backend.session.subject = 'getsignal-user-42';
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await expect(page.getByText('Wallet connected for reading.', { exact: true })).toBeVisible();
    expect(await reusableAuthorityCount(walletId)).toEqual({ sessions: 0, quotas: 0 });
    expect((await page.evaluate(readSession)).authentication.kind).toBe('external_authenticated');
    const verifiedTransactions = [];
    for (const broadcast of backend.broadcasts)
      verifiedTransactions.push(
        await verifyNearTransaction(broadcast, nearAccount.address, nearAccount.publicKey),
      );
    const artifact = {
      kind: 'application_owner_near_e2e_v1',
      walletId,
      sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      verifiedTransactions,
      recoveryEvidence: {
        unresolvedHash,
        newRecovery,
        blockingState,
        missingReceipt,
        failedRecovery,
        settledRecovery,
      },
      freshSigningAdmissions: await freshSigningAdmissions(walletId),
      checks: [
        'reload',
        'fresh_second_approval',
        'cancel_preserves_connection',
        'interrupted_approval_proves_non_submission',
        'hash_visible_before_broadcast_response',
        'unresolved_recovers_without_broadcast',
        'missing_receipt_cannot_prove_non_submission',
        'recovery_unavailable_remains_retryable',
        'recovery_error_retains_known_hash',
        'rpc_error_retains_known_hash',
        'settled_recovery_uses_durable_result',
        'blocked_approval_returns_original_identity',
        'concurrent_same_handle',
        'replay_rejected',
        'expired_handle',
        'handoff_replay',
        'pending_blocks_new_operation',
        'account_switch_invalidates_prepared_operation',
        'application_passkey_same_association',
      ],
      reusableAuthority: await reusableAuthorityCount(walletId),
      chain: 'canonical NEAR transaction with real MPC signature; deterministic RPC fixture',
      applicationLogin: {
        google: 'verified application-session fixture',
        passkey: appPasskey,
        stableSubject: backend.session.subject,
      },
      reproduce:
        'SEAMS_INTENDED_SKIP_BUILD=1 pnpm -C tests exec playwright test -c playwright.wallet-intended.ci.config.ts e2e/intended-behaviours/passkey.near-submission.contract.test.ts --grep application',
    };
    const artifactPath = path.resolve('.artifacts/application-auth/receipt.json');
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, JSON.stringify(artifact, null, 2));
    await page.screenshot({
      path: path.join(path.dirname(artifactPath), 'example.png'),
      fullPage: true,
    });
    await testInfo.attach('application-auth-receipt', {
      body: JSON.stringify(artifact, null, 2),
      contentType: 'application/json',
    });
  } catch (error) {
    await testInfo.attach('application-auth-rpc-state', {
      body: JSON.stringify({
        transactionHashes: backend.broadcasts.map(nearTransactionHash),
        broadcastResponseHeld: backend.pendingBroadcast !== null,
        statusRequests: backend.statusRequests,
      }),
      contentType: 'application/json',
    });
    await testInfo.attach('application-auth-page.html', {
      body: await page.content(),
      contentType: 'text/html',
    });
    throw error;
  }
}

async function runButton(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click({ timeout: 15_000 });
  console.info('[application-auth] clicked', name);
  if (name === 'Create owner wallet') {
    await expect.poll(walletIdOrFailure.bind(null, page), { timeout: 90_000 }).not.toBe('');
  } else if (name === 'Link application account') {
    await expect(page.getByText('Wallet connected for reading.', { exact: true })).toBeVisible({
      timeout: 60_000,
    });
  } else {
    await expect(page.getByRole('region', { name: 'Owner transaction' })).toHaveAttribute(
      'data-state',
      'completed',
      { timeout: 90_000 },
    );
  }
}

async function readSession() {
  if (!window.ownerAuthSession) throw new Error('The application session reader is not mounted.');
  return await window.ownerAuthSession();
}

async function reusableAuthorityCount(walletId: string) {
  const Database = await loadIsolatedDatabaseSync();
  const database = new Database(await isolatedGatewayDatabasePath(), { readOnly: true });
  try {
    const sessions = database
      .prepare('SELECT COUNT(*) AS count FROM wallet_session_authorizations_v2 WHERE wallet_id = ?')
      .all(walletId)[0];
    const quotas = database
      .prepare('SELECT COUNT(*) AS count FROM authorization_wallet_session_quotas')
      .all()[0];
    return { sessions: sessions?.count, quotas: quotas?.count };
  } finally {
    database.close();
  }
}

async function configureApplicationTrust(
  publicKeyB64u: string,
): Promise<{ environmentId: string; secretApiKey: string }> {
  const root = process.env.SEAMS_INTENDED_ROUTER_AB_ROOT;
  if (!root) throw new Error('The application contract requires an isolated local root.');
  const gateway = path.join(root, '.runtime', 'wallet-gateway');
  const envPath = path.join(gateway, '.dev.vars.wallet-gateway');
  const environment = requireRecord(readEnvFile(envPath), 'local runtime environment');
  const raw = requireRecord(
    JSON.parse(
      requireCanonicalString(environment.WALLET_LOCAL_DEPLOYMENT_JSON, 'local deployment'),
    ),
    'local deployment',
  );
  const deployment = requireRecord(raw.deployment, 'deployment');
  const config = parseStaticWalletConsoleBindingConfigV1({
    ...raw,
    deployment: {
      ...deployment,
      externalAuth: {
        kind: 'application',
        issuer: 'https://getsignal.example',
        publicKeyB64u,
        revision: 1,
      },
    },
  });
  const encoded = JSON.stringify(config);
  if (encoded.includes("'"))
    throw new Error('The test deployment contains an unsupported env-file quote.');
  const current = await readFile(envPath, 'utf8');
  await writeFile(
    envPath,
    current.replace(
      /^WALLET_LOCAL_DEPLOYMENT_JSON=.*$/m,
      `WALLET_LOCAL_DEPLOYMENT_JSON='${encoded}'`,
    ),
  );
  const configPath = path.join(gateway, 'wrangler.local-hosted-wallet-gateway.toml');
  await writeFile(
    configPath,
    `${await readFile(configPath, 'utf8')}\n# Application auth contract trust\n`,
  );
  return {
    environmentId: config.deployment.environmentId,
    secretApiKey: requireCanonicalString(config.credential.secretKey, 'backend API key'),
  };
}

async function walletIdOrFailure(page: Page): Promise<string> {
  const failed = page
    .getByRole('region', { name: 'Application authentication', exact: true })
    .locator('[role="status"]');
  const region = page.getByRole('region', { name: 'Application authentication', exact: true });
  if ((await region.getAttribute('data-state')) === 'failed')
    throw new Error(await failed.innerText());
  return await page.getByLabel('Wallet ID', { exact: true }).inputValue();
}

function logApplicationResponse(response: BrowserResponse): void {
  const pathname = new URL(response.url()).pathname;
  if (response.status() >= 400)
    console.info('[application-auth] resource error', response.status(), pathname);
  if (
    response.request().method() === 'POST' &&
    (pathname.startsWith('/wallet') || pathname.startsWith('/api/wallet'))
  )
    console.info('[application-auth]', response.status(), pathname);
}

function logApplicationError(error: Error): void {
  console.info('[application-auth] page error:', error.message);
}

function logApplicationRequestFailure(request: import('@playwright/test').Request): void {
  console.info(
    '[application-auth] request failed',
    new URL(request.url()).pathname,
    request.failure()?.errorText,
  );
}

async function gatewayReady(relayerUrl: string): Promise<boolean> {
  try {
    return (await fetch(`${relayerUrl}/readyz`)).ok;
  } catch {
    return false;
  }
}

async function approveOwnerRegistration(page: Page): Promise<void> {
  await clickWalletControl(page, 'Create passkey');
}

async function clickWalletControl(page: Page, name: string): Promise<void> {
  const wallet = page.locator('iframe[allow*="publickey-credentials-get"]').last().contentFrame();
  await wallet.getByRole('button', { name, exact: true }).click({ timeout: 30_000 });
}

async function clickNearConfirmation(page: Page): Promise<void> {
  const wallet = page.locator('iframe[allow*="publickey-credentials-get"]').last().contentFrame();
  await wallet
    .locator('#seams-confirm-portal button.btn-confirm, #seams-confirm-portal button.confirm')
    .last()
    .click({ timeout: 30_000 });
}

function nearAccountEntry(account: { family: 'ed25519' | 'ecdsa' }): boolean {
  return account.family === 'ed25519';
}

async function verifyNearTransaction(
  encoded: string,
  accountId: string,
  expectedPublicKey: string,
) {
  const bytes = Buffer.from(encoded, 'base64');
  const senderLength = bytes.readUInt32LE(0);
  const publicKeyOffset = 4 + senderLength;
  const sender = bytes.subarray(4, publicKeyOffset).toString('utf8');
  expect(sender).toBe(accountId);
  expect(bytes[publicKeyOffset]).toBe(0);
  const publicKey = Uint8Array.from(bytes.subarray(publicKeyOffset + 1, publicKeyOffset + 33));
  expect(`ed25519:${base58Encode(publicKey)}`).toBe(expectedPublicKey);
  const signature = Uint8Array.from(bytes.subarray(-64));
  const unsigned = bytes.subarray(0, -65);
  const digest = Uint8Array.from(createHash('sha256').update(unsigned).digest());
  const key = await crypto.subtle.importKey('raw', publicKey, 'Ed25519', false, ['verify']);
  expect(await crypto.subtle.verify('Ed25519', key, signature, digest)).toBe(true);
  return {
    transactionHash: nearTransactionHash(encoded),
    accountId,
    publicKey: expectedPublicKey,
    signedTransactionBase64: encoded,
    signatureVerified: true,
  };
}

async function freshSigningAdmissions(walletId: string): Promise<number> {
  const Database = await loadIsolatedDatabaseSync();
  const database = new Database(await isolatedGatewayDatabasePath(), { readOnly: true });
  try {
    const row = database
      .prepare(
        `SELECT COUNT(*) AS count
      FROM authorized_operations operation
      JOIN verified_wallet_operation_evidence_sets evidence USING(namespace, tenant_id, evidence_set_digest)
      WHERE evidence.wallet_id = ? AND operation.capability_kind = 'near_ed25519_mpc_signing'
        AND operation.authorization_source_kind = 'verified_step_up' AND operation.quota_kind = 'quota_neutral'`,
      )
      .all(walletId)[0];
    return Number(row?.count);
  } finally {
    database.close();
  }
}

async function prepareApiOperation(): Promise<void> {
  if (!window.ownerAuthPrepare) throw new Error('Missing application operation fixture.');
  await window.ownerAuthPrepare();
}

function readBroadcastCount(backend: ApplicationBackend): number {
  return backend.broadcasts.length;
}

async function unavailableOwnerSettings(route: Route): Promise<void> {
  await route.fulfill({ status: 503, json: { ok: false, code: 'temporarily_unavailable' } });
}

function readApiState() {
  if (!window.ownerAuthOperation) throw new Error('Missing owner operation.');
  return window.ownerAuthOperation.getState();
}

function readApiRecovery() {
  if (!window.ownerAuthOperation) throw new Error('Missing owner operation.');
  return window.ownerAuthOperation.getState().recovery;
}

async function recoverApiOperation(recovery: import('@seams/wallet').OwnerNearRecovery) {
  const seams = window.ownerAuthApi;
  if (!seams) throw new Error('Missing application API.');
  const session = await seams.auth.getSession();
  if (session.authentication.kind !== 'external_authenticated')
    throw new Error('Missing read connection.');
  const operation = seams.near.resumeOwnerTransaction({
    authentication: session.authentication,
    recovery,
  });
  return await operation.recover();
}

async function recoverCurrentApiOperation() {
  if (!window.ownerAuthOperation) throw new Error('Missing owner operation.');
  return await window.ownerAuthOperation.recover();
}

async function approveApiTwice(): Promise<string[]> {
  const operation = window.ownerAuthOperation;
  if (!operation) throw new Error('Missing owner operation.');
  const first = operation.approve();
  const second = operation.approve();
  const results = await Promise.all([first, second]);
  return [results[0].kind, results[1].kind];
}

async function approveApiOnce(): Promise<string> {
  if (!window.ownerAuthOperation) throw new Error('Missing owner operation.');
  return (await window.ownerAuthOperation.approve()).kind;
}

async function replayApiOperation(): Promise<boolean> {
  if (!window.ownerAuthOperation) throw new Error('Missing owner operation.');
  try {
    await window.ownerAuthOperation.approve();
    return false;
  } catch {
    return true;
  }
}

async function clickNearCancellation(page: Page): Promise<void> {
  const wallet = page.locator('iframe[allow*="publickey-credentials-get"]').last().contentFrame();
  await wallet
    .locator('#seams-confirm-portal')
    .getByRole('button', { name: 'Cancel', exact: true })
    .last()
    .click({ timeout: 30_000 });
}
