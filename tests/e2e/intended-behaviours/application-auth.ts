import {
  expect,
  type BrowserContext,
  type Response as BrowserResponse,
  type Page,
  type Route,
  type TestInfo,
} from '@playwright/test';
import { parseStaticWalletConsoleBindingConfigV1 } from '@server/router/cloudflare/runtime/staticWalletConsoleBinding';
import { ActionType } from '../../../packages/wallet/src/core/types/actions';
import type { PrepareOwnerNearTransaction } from '../../../packages/wallet/src/SeamsWeb/publicApi/ownerNearOperation';
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
import {
  addWebAuthnVirtualAuthenticator,
  fulfillNearRpcStub,
  waitForWalletIframeConfirmationSettlement,
} from './harness';
import { isolatedGatewayDatabasePath, loadIsolatedDatabaseSync } from './local-gateway-database';
import { nearTransactionHash } from './near-transaction-hash';
import {
  failOwnerReceiptWrites,
  restoreOwnerReceiptWrites,
  rewriteOwnerRecordsToLegacyBinding,
  stripOwnerReceiptEvidence,
} from './owner-receipt-storage';

const TRANSACTION_VALIDITY_PERIOD = 86_400;
// The stubbed reference block is 1, and the wallet adds a margin of 3,600 blocks.
const LAST_ACCEPTED_BLOCK = 1 + TRANSACTION_VALIDITY_PERIOD + 3_600;
const DEFAULT_NEAR_RPC_URL = 'https://rpc.testnet.fastnear.com';
const ALTERNATE_NEAR_RPC_URL = `${DEFAULT_NEAR_RPC_URL}/alternate`;

class ApplicationBackend {
  readonly session = { subject: 'getsignal-user-42', expiresAtMs: Date.now() + 3_600_000 };
  readonly broadcasts: string[] = [];
  loseNextBroadcast = false;
  lostBroadcast = false;
  pendingBroadcast: Route | null = null;
  revertNextBroadcast = false;
  statusUnavailable = false;
  statusUnknown = false;
  pendingStatus: Route | null = null;
  statusFinality: 'EXECUTED' | 'FINAL' = 'FINAL';
  statusRequests = 0;
  finalBlockHeight = 1;
  accessKeyNonce: bigint | null = null;
  /** The next broadcast fails with this InvalidTxError variant. */
  rejectNextBroadcast: Readonly<{ variant: string; fields?: Record<string, unknown> }> | null = null;
  /** When set, the account, the gas price and the gas purchase floor come from these values. */
  account: Readonly<{
    amount: bigint;
    storageUsage: number;
    gasPrice: bigint;
    minGasPurchasePrice: bigint;
  }> | null = null;
  chainId = 'testnet';
  readonly rpcUrls = new Set<string>();
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
    this.rpcUrls.add(route.request().url());
    const request = requireRecord(route.request().postDataJSON(), 'RPC request');
    if (request.method === 'send_tx') {
      const params = requireRecord(request.params, 'transaction submission params');
      expect(params.wait_until).toBe('FINAL');
      if (this.revertNextBroadcast) {
        this.revertNextBroadcast = false;
        await fulfillOwnerTransactionOutcome(
          route,
          request.id,
          nearTransactionHash(
            requireCanonicalString(params.signed_tx_base64, 'signed transaction'),
          ),
          'FINAL',
          { Failure: { error_type: 'ActionError', error_message: 'Injected contract failure' } },
        );
        return;
      }
    }
    if (request.method === 'send_tx' && this.rejectNextBroadcast) {
      const rejection = this.rejectNextBroadcast;
      this.rejectNextBroadcast = null;
      await route.fulfill({
        json: {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32000,
            name: 'HANDLER_ERROR',
            message: 'Server error',
            cause: { name: 'INVALID_TRANSACTION', info: {} },
            data: {
              TxExecutionError: {
                InvalidTxError: rejection.fields
                  ? { [rejection.variant]: rejection.fields }
                  : rejection.variant,
              },
            },
          },
        },
      });
      return;
    }
    if (request.method === 'gas_price' && this.account) {
      await route.fulfill({
        json: {
          jsonrpc: '2.0',
          id: request.id,
          result: { gas_price: this.account.gasPrice.toString() },
        },
      });
      return;
    }
    if (request.method === 'EXPERIMENTAL_protocol_config' && this.account) {
      await route.fulfill({
        json: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            runtime_config: {
              min_gas_purchase_price: this.account.minGasPurchasePrice.toString(),
            },
          },
        },
      });
      return;
    }
    if (request.method === 'send_tx' && this.loseNextBroadcast) {
      this.loseNextBroadcast = false;
      this.lostBroadcast = true;
      this.pendingBroadcast = route;
      return;
    }
    if (request.method === 'tx') {
      this.statusRequests += 1;
      const params = requireRecord(request.params, 'transaction status params');
      expect(params.wait_until).toBe('NONE');
      if (this.statusUnknown) {
        await route.fulfill({
          json: {
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: -32000,
              name: 'HANDLER_ERROR',
              message: 'Server error',
              data: `Transaction ${String(params.tx_hash)} doesn't exist`,
              cause: { name: 'UNKNOWN_TRANSACTION', info: {} },
            },
          },
        });
        return;
      }
      if (this.statusUnavailable) {
        this.pendingStatus = route;
        return;
      }
      const encoded = this.broadcasts.at(-1);
      if (!encoded) throw new Error('No transaction exists for recovery.');
      expect(params.tx_hash).toBe(nearTransactionHash(encoded));
      await fulfillOwnerTransactionOutcome(
        route,
        request.id,
        nearTransactionHash(encoded),
        this.statusFinality,
        { SuccessValue: '' },
      );
      return;
    }
    if (request.method === 'EXPERIMENTAL_genesis_config') {
      await route.fulfill({
        json: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            chain_id: this.chainId,
            transaction_validity_period: TRANSACTION_VALIDITY_PERIOD,
          },
        },
      });
      return;
    }
    if (request.method === 'block' && this.finalBlockHeight !== 1) {
      await route.fulfill({
        json: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            author: 'intended-e2e',
            chunks: [],
            header: {
              hash: '11111111111111111111111111111111',
              height: this.finalBlockHeight,
              prev_hash: '11111111111111111111111111111111',
            },
          },
        },
      });
      return;
    }
    if (request.method === 'query') {
      const params = requireRecord(request.params, 'query params');
      if (params.request_type === 'view_account' && this.account) {
        await route.fulfill({
          json: {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              amount: this.account.amount.toString(),
              locked: '0',
              code_hash: '11111111111111111111111111111111',
              storage_usage: this.account.storageUsage,
              storage_paid_at: 0,
              block_height: this.finalBlockHeight,
              block_hash: '11111111111111111111111111111111',
            },
          },
        });
        return;
      }
      if (params.request_type === 'view_access_key') {
        await route.fulfill({
          json: {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              nonce: Number(this.accessKeyNonce ?? BigInt(1 + this.broadcasts.length)),
              block_height: this.finalBlockHeight,
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

  async releaseLostStatus(): Promise<void> {
    const route = this.pendingStatus;
    if (!route) throw new Error('No transaction status request is held.');
    this.pendingStatus = null;
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

async function fulfillOwnerTransactionOutcome(
  route: Route,
  requestId: unknown,
  transactionId: string,
  finality: 'EXECUTED' | 'FINAL',
  status:
    | { SuccessValue: string; Failure?: never }
    | { Failure: { error_type: string; error_message: string }; SuccessValue?: never },
): Promise<void> {
  await route.fulfill({
    json: {
      jsonrpc: '2.0',
      id: requestId,
      result: {
        final_execution_status: finality,
        status,
        transaction: { hash: transactionId },
        transaction_outcome: {
          id: transactionId,
          outcome: {
            status,
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

    const disconnectedPage = await context.newPage();
    const walletOrigin = process.env.SEAMS_INTENDED_WALLET_ORIGIN || 'http://localhost:4202';
    let unavailableConnection;
    try {
      await disconnectedPage.route(`${walletOrigin}/wallet-service**`, unavailableWalletService);
      await disconnectedPage.goto(`${appOrigin}/application-auth`, {
        waitUntil: 'domcontentloaded',
      });
      await expect.poll(ownerApiAvailable.bind(null, disconnectedPage)).toBe(true);
      const unavailableInput: PrepareOwnerNearTransaction = {
        authentication: firstSession.authentication,
        nearAccountId: nearAccount.address,
        transaction: {
          receiverId: nearAccount.address,
          actions: [{ type: ActionType.Transfer, amount: '1' }],
        },
      };
      unavailableConnection = await disconnectedPage.evaluate(
        approveDisconnectedOperation,
        unavailableInput,
      );
      expect(unavailableConnection.kind).toBe('not_submitted');
      expect(backend.broadcasts.length).toBe(1);
    } finally {
      await disconnectedPage.close();
    }

    await page.evaluate(prepareApiOperation);
    await failOwnerReceiptWrites(page, 'approving');
    const failedPreparationWrite = await page.evaluate(approveApiOnce);
    expect(failedPreparationWrite).toBe('not_submitted');
    expect(await restoreOwnerReceiptWrites(page)).toBe(1);
    expect(backend.broadcasts.length).toBe(1);

    // A cancelled review preserves the readable connection and spends no approval.
    await page
      .getByRole('button', { name: 'Prepare one yoctoNEAR self-transfer', exact: true })
      .click();
    await page.getByRole('button', { name: 'Review and approve transfer', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Owner transaction' })).toHaveAttribute(
      'data-state',
      'approval',
    );
    await failOwnerReceiptWrites(page, 'settled');
    await clickNearCancellation(page);
    await expect(page.getByRole('region', { name: 'Owner transaction' })).toHaveAttribute(
      'data-state',
      'cancelled',
    );
    expect(await restoreOwnerReceiptWrites(page)).toBe(1);
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
    await failOwnerReceiptWrites(page, 'settled');
    await Promise.all([
      runButton(page, 'Review and approve transfer'),
      clickNearConfirmation(page),
    ]);
    expect(backend.broadcasts.length).toBe(2);
    expect(await restoreOwnerReceiptWrites(page)).toBe(1);
    expect(await freshSigningAdmissions(walletId)).toBe(2);
    await expectOwnerReceipt(page, 'Confirmed');
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
    await expect(
      page.getByRole('button', { name: 'Prepare one yoctoNEAR self-transfer', exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole('region', { name: 'Owner transaction' })).toHaveAttribute(
      'data-state',
      'unresolved',
      { timeout: 45_000 },
    );
    await backend.releaseLostBroadcast();
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
    await expect(page.getByText(`Transaction: ${unresolvedHash}`, { exact: true })).toBeVisible();
    await context.route('**/wallet/external-auth/settings', unavailableOwnerSettings);
    await page.getByRole('button', { name: 'Check existing transaction', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Owner transaction' })).toHaveAttribute(
      'data-state',
      'recovery_unavailable',
    );
    await expect(page.getByText(`Transaction: ${unresolvedHash}`, { exact: true })).toBeVisible();
    await context.unroute('**/wallet/external-auth/settings', unavailableOwnerSettings);
    backend.statusUnknown = true;
    const unknownRecovery = await page.evaluate(recoverApiOperation, blockingState.recovery);
    expect(unknownRecovery).toMatchObject({
      kind: 'unresolved',
      recovery: blockingState.recovery,
      transactionId: unresolvedHash,
    });
    expect(unknownRecovery.error).toContain(`after block ${LAST_ACCEPTED_BLOCK}`);
    expect(unknownRecovery.retirementWait?.lastAcceptedBlockHeight).toBe(LAST_ACCEPTED_BLOCK);
    await page.evaluate(prepareApiOperation);
    expect(await page.evaluate(approveApiOnce)).toBe('unresolved');
    expect((await page.evaluate(readApiState)).recovery).toEqual(blockingState.recovery);
    expect(backend.broadcasts.length).toBe(broadcastsAfterLoss);
    backend.statusUnknown = false;
    backend.statusUnavailable = true;
    const pendingRecovery = page.evaluate(recoverCurrentApiOperation);
    await expect.poll(page.evaluate.bind(page, readApiState)).toMatchObject({
      kind: 'submitting',
      recovery: blockingState.recovery,
      transactionId: unresolvedHash,
    });
    const stalledRecovery = await pendingRecovery;
    expect(stalledRecovery).toMatchObject({
      kind: 'unresolved',
      recovery: blockingState.recovery,
      transactionId: unresolvedHash,
    });
    await expect(page.getByText(`Transaction: ${unresolvedHash}`, { exact: true })).toBeVisible();
    backend.statusUnavailable = false;
    await backend.releaseLostStatus();
    backend.statusFinality = 'EXECUTED';
    const nonfinalRecovery = await page.evaluate(recoverApiOperation, blockingState.recovery);
    expect(nonfinalRecovery.kind).toBe('unresolved');
    expect(nonfinalRecovery.transactionId).toBe(unresolvedHash);
    backend.statusFinality = 'FINAL';
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
    backend.revertNextBroadcast = true;
    const statusRequestsBeforeRevert = backend.statusRequests;
    const duplicateApproval = page.evaluate(approveApiTwice);
    await clickNearConfirmation(page);
    expect(await duplicateApproval).toEqual(['reverted', 'reverted']);
    expect(backend.statusRequests).toBe(statusRequestsBeforeRevert);
    expect(backend.broadcasts.length).toBe(broadcastsAfterLoss + 1);
    expect(await page.evaluate(replayApiOperation)).toBe(true);

    console.info('[application-auth] recovery and concurrent calls complete');
    const retirementEvidence = await verifyOwnerRetirement(page, backend);
    await verifyOwnerRejectionAndCancel(page, backend);
    console.info('[application-auth] owner rejection and cancel complete');
    console.info('[application-auth] owner retirement complete');
    await verifyOwnerReview(page, backend);
    console.info('[application-auth] reviewed transaction complete');
    const broadcastsBeforeExpiry = backend.broadcasts.length;
    const admissionsBeforeExpiry = await freshSigningAdmissions(walletId);
    // An expired prepared handle cannot prompt or sign.
    await page.evaluate(prepareApiOperation);
    await page.clock.install();
    await page.clock.fastForward(121_000);
    expect(await page.evaluate(approveApiOnce)).toBe('expired');
    await page.clock.resume();
    expect(backend.broadcasts.length).toBe(broadcastsBeforeExpiry);
    expect(await freshSigningAdmissions(walletId)).toBe(admissionsBeforeExpiry);

    await page.evaluate(prepareApiOperation);
    backend.session.subject = 'getsignal-other-user';
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Application authentication', exact: true }),
    ).toHaveAttribute('data-state', 'failed');
    expect(await page.evaluate(approveApiOnce)).toBe('not_submitted');
    expect(backend.broadcasts.length).toBe(broadcastsBeforeExpiry);
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
        failedPreparationWrite,
        unavailableConnection,
        nonfinalRecovery,
        unknownRecovery,
        stalledRecovery,
        retirementEvidence,
      },
      freshSigningAdmissions: await freshSigningAdmissions(walletId),
      checks: [
        'reload',
        'known_hash_survives_reload_and_failed_recovery',
        'confirmed_revert_needs_no_extra_recovery',
        'unavailable_iframe_is_not_submitted',
        'failed_preparation_write_is_not_submitted',
        'failed_receipt_write_preserves_cancellation',
        'failed_receipt_write_preserves_completion',
        'broadcast_timeout_retains_hash',
        'recovery_timeout_retains_hash',
        'nonfinal_recovery_stays_unresolved',
        'unknown_transaction_remains_pending_without_rebroadcast',
        'recovery_queries_current_status_without_waiting',
        'unknown_transaction_within_validity_stays_pending',
        'expired_transaction_with_unused_nonce_is_retired',
        'expired_transaction_with_used_nonce_requires_owner_approval',
        'cancelled_retirement_keeps_the_operation_pending',
        'hash_only_receipt_waits_from_its_first_observation_across_reload',
        'unresolved_wait_names_its_block_and_evidence',
        'another_rpc_on_the_network_keeps_the_receipt_and_guard',
        'rpc_for_another_chain_cannot_end_an_operation',
        'legacy_url_bound_records_keep_the_guard',
        'unrelated_settled_recovery_cannot_release_a_pending_operation',
        'fresh_approval_follows_authoritative_retirement',
        'blocked_handle_recovery_progress_retains_original_operation_identity',
        'pending_recovery_cannot_be_overwritten_by_preparation',
        'review_cancel_never_opens_wallet_approval',
        'review_time_does_not_consume_the_approval_deadline',
        'back_to_review_keeps_review_state_and_one_broadcast',
        'wallet_cancel_after_review_settles_as_cancelled',
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
      .prepare('SELECT COUNT(*) AS count FROM authorization_wallet_session_quotas WHERE principal_id = ?')
      .all(walletId)[0];
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

async function unavailableWalletService(route: Route): Promise<void> {
  await route.fulfill({ status: 503, body: 'Wallet service unavailable' });
}

async function ownerApiAvailable(page: Page): Promise<boolean> {
  return await page.evaluate(hasOwnerApi);
}

function hasOwnerApi(): boolean {
  return window.ownerAuthApi !== undefined;
}

async function approveDisconnectedOperation(input: PrepareOwnerNearTransaction) {
  const seams = window.ownerAuthApi;
  if (!seams) throw new Error('Missing application API.');
  return await seams.near.prepareOwnerTransaction(input).approve();
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

async function loseOwnerBroadcast(page: Page, backend: ApplicationBackend) {
  backend.finalBlockHeight = 1;
  backend.accessKeyNonce = null;
  await page.evaluate(prepareApiOperation);
  const recovery = await page.evaluate(readApiRecovery);
  backend.loseNextBroadcast = true;
  const broadcasts = backend.broadcasts.length;
  const approval = page.evaluate(approveApiOnce);
  await confirmApproval(page, approval);
  await expect.poll(readBroadcastCount.bind(null, backend), { timeout: 90_000 }).toBe(broadcasts + 1);
  await expect.poll(backendHoldsBroadcast.bind(null, backend)).toBe(true);
  await backend.releaseLostBroadcast();
  expect(await approval).toBe('unresolved');
  const encoded = backend.broadcasts[broadcasts];
  if (!encoded) throw new Error('Missing lost broadcast.');
  return { recovery, encoded, transactionId: nearTransactionHash(encoded) };
}

function backendHoldsBroadcast(backend: ApplicationBackend): boolean {
  return backend.pendingBroadcast !== null;
}

function signedNonce(encoded: string): bigint {
  const bytes = Buffer.from(encoded, 'base64');
  return bytes.readBigUInt64LE(4 + bytes.readUInt32LE(0) + 33);
}

/** Fresh approval must succeed only after each pending operation reaches its own end. */
function clearReviewSurfaces(): void {
  window.ownerAuthReviewSurfaces = [];
}

function readReviewSurfaces(): string[] {
  return window.ownerAuthReviewSurfaces ?? [];
}

async function verifyOwnerReview(page: Page, backend: ApplicationBackend): Promise<void> {
  backend.finalBlockHeight = 1;
  backend.accessKeyNonce = null;
  const broadcasts = backend.broadcasts.length;
  const review = page.locator('.seams-transaction-review-slot');
  const wallet = page.locator('iframe[allow*="publickey-credentials-get"]').last().contentFrame();
  const reviewHeading = review.getByRole('heading', { name: 'Review deposit', exact: true });
  const openReview = async (): Promise<{ approval: Promise<string> }> => {
    await page.evaluate(clearReviewSurfaces);
    await page.evaluate(prepareReviewedApiOperation);
    expect((await page.evaluate(readApiState))?.kind).toBe('prepared');
    const approval = page.evaluate(approveApiOnce);
    await expect(reviewHeading).toBeVisible({ timeout: 30_000 });
    expect((await page.evaluate(readApiState))?.kind).toBe('reviewing');
    await expect.poll(() => page.evaluate(readReviewSurfaces)).toEqual(['review']);
    return { approval };
  };
  const continueToWallet = async (): Promise<void> => {
    await review.getByRole('button', { name: 'Continue to wallet', exact: true }).click();
    await expect(wallet.getByRole('button', { name: 'Back to review', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect.poll(() => page.evaluate(readReviewSurfaces)).toContain('wallet');
  };

  // The owner ends the review, and the application ends it. Neither reaches the wallet.
  const reviewCancelled = await openReview();
  await review.getByRole('button', { name: 'Cancel review', exact: true }).click();
  expect(await reviewCancelled.approval).toBe('cancelled');
  const applicationCancelled = await openReview();
  await page.evaluate(cancelApiOperation);
  expect(await applicationCancelled.approval).toBe('cancelled');
  await expect(reviewHeading).toBeHidden();

  // The application and the wallet can each end the approval after the review.
  const approvalCancelled = await openReview();
  await continueToWallet();
  await page.evaluate(cancelApiOperation);
  expect(await approvalCancelled.approval).toBe('cancelled');
  const walletCancelled = await openReview();
  await continueToWallet();
  await clickNearCancellation(page);
  expect(await walletCancelled.approval).toBe('cancelled');
  expect(backend.broadcasts.length).toBe(broadcasts);

  // Review time stays outside the deadline, and Back to review keeps the same pending approval.
  const reviewedAtMs = Date.now();
  const { approval } = await openReview();
  await review.getByRole('button', { name: 'Add mark', exact: true }).click();
  await page.waitForTimeout(3_000);
  await continueToWallet();
  const pending = await page.evaluate(readApiState);
  if (pending?.kind !== 'approval') throw new Error('The reviewed operation is not in approval.');
  expect(pending.expiresAtMs).toBeGreaterThan(reviewedAtMs + 120_000);
  await wallet.getByRole('button', { name: 'Back to review', exact: true }).click();
  await expect(review.getByText('Marks: 1', { exact: true })).toBeVisible();
  await continueToWallet();
  await confirmApproval(page, approval);
  expect(await approval).toBe('completed');
  await expect(reviewHeading).toBeHidden();
  expect(backend.broadcasts.length).toBe(broadcasts + 1);
  // A reviewed owner approval ends in the same receipt as an unreviewed one.
  await expectOwnerReceipt(page, 'Confirmed');
}

function prepareReviewedApiOperation(): void {
  if (!window.ownerAuthPrepareReviewed) throw new Error('Missing reviewed operation fixture.');
  window.ownerAuthPrepareReviewed();
}

function cancelApiOperation(): void {
  window.ownerAuthOperation?.cancel();
}

async function verifyFreshApproval(page: Page, backend: ApplicationBackend): Promise<void> {
  backend.finalBlockHeight = 1;
  backend.accessKeyNonce = null;
  await page.evaluate(prepareApiOperation);
  const approval = page.evaluate(approveApiOnce);
  await confirmApproval(page, approval);
  expect(await approval).toBe('completed');
  await expectOwnerReceipt(page, 'Confirmed');
}

/** The owner sees the same transaction receipt as an app-session send. */
async function expectOwnerReceipt(page: Page, ...texts: string[]): Promise<void> {
  const wallet = page.locator('iframe[allow*="publickey-credentials-get"]').last().contentFrame();
  const receipt = wallet.locator('.seams-transaction-receipt, .seams-transaction-toast');
  await expect(receipt).toBeVisible({ timeout: 30_000 });
  for (const text of texts) await expect(receipt).toContainText(text);
  // Minimised, the receipt leaves the page usable for the next step.
  await waitForWalletIframeConfirmationSettlement(page);
}

/** Report an approval that ended without a review instead of waiting for a missing button. */
async function confirmApproval(page: Page, approval: Promise<string>): Promise<void> {
  const early = await Promise.race([approval, clickNearConfirmation(page)]);
  if (early !== undefined)
    throw new Error(`Approval ended early: ${JSON.stringify(await page.evaluate(readApiState))}`);
}

/**
 * NEAR's rejection reaches the application with its fields. Invalid signed bytes end the
 * operation at once. A state-dependent rejection stays unresolved, and the owner's cancel at
 * the same key and nonce ends it without any wait. The wallet refuses to sign a transaction
 * that the account cannot pay for.
 */
async function verifyOwnerRejectionAndCancel(
  page: Page,
  backend: ApplicationBackend,
): Promise<void> {
  backend.finalBlockHeight = 1;
  backend.accessKeyNonce = null;
  backend.statusUnknown = true;

  // Invalid signed bytes can never reach a block, so nothing is left to recover.
  await page.evaluate(prepareApiOperation);
  backend.rejectNextBroadcast = { variant: 'InvalidSignature' };
  const invalid = page.evaluate(approveApiOutcome);
  await confirmApproval(page, invalid.then(readOutcomeKind));
  expect(await invalid).toMatchObject({
    kind: 'not_submitted',
    rejection: { error: 'InvalidSignature', permanence: 'permanent', fields: {} },
  });
  await verifyFreshApproval(page, backend);

  // A state-dependent rejection stays unresolved and carries NEAR's fields.
  const fields = {
    signer_id: 'intended.testnet',
    balance: '95153286115586700000000',
    cost: '100000000000000000000000',
  };
  await page.evaluate(prepareApiOperation);
  const recovery = await page.evaluate(readApiRecovery);
  const broadcasts = backend.broadcasts.length;
  backend.rejectNextBroadcast = { variant: 'NotEnoughBalance', fields };
  const poor = page.evaluate(approveApiOutcome);
  await confirmApproval(page, poor.then(readOutcomeKind));
  const rejected = await poor;
  expect(rejected).toMatchObject({
    kind: 'unresolved',
    recovery,
    rejection: { error: 'NotEnoughBalance', permanence: 'state_dependent', fields },
  });
  const encoded = backend.broadcasts[broadcasts];
  if (!encoded) throw new Error('Missing rejected broadcast.');
  if (rejected.kind !== 'unresolved') throw new Error('The rejection did not stay unresolved.');
  // The receipt tells the owner why the send did not reach NEAR.
  await expectOwnerReceipt(page, 'Rejected by NEAR', 'NotEnoughBalance');
  // A later check still explains the rejection, and the new operation stays blocked.
  expect(await page.evaluate(recoverApiOperation, recovery)).toMatchObject({
    kind: 'unresolved',
    rejection: { error: 'NotEnoughBalance' },
  });

  // A refused cancel stays unresolved and says why, so the person can add NEAR.
  // The chain has not used the rejected transaction's nonce.
  backend.accessKeyNonce = signedNonce(encoded) - 1n;
  backend.rejectNextBroadcast = { variant: 'NotEnoughBalance', fields };
  const refused = page.evaluate(cancelApiTransaction, recovery);
  await confirmOutcome(page, refused);
  expect(await refused).toMatchObject({
    kind: 'unresolved',
    transactionId: rejected.transactionId,
    cancellationRejection: { error: 'NotEnoughBalance', fields },
  });

  // The owner's cancel takes the same key and nonce. Its own final outcome proves that the
  // original can never execute, although the RPC knows neither hash.
  const cancelBroadcasts = backend.broadcasts.length;
  const cancel = page.evaluate(cancelApiTransaction, recovery);
  await confirmOutcome(page, cancel);
  const cancelled = await cancel;
  await expectOwnerReceipt(page, 'Confirmed');
  const cancelEncoded = backend.broadcasts[cancelBroadcasts];
  if (!cancelEncoded) throw new Error('Missing cancel broadcast.');
  expect(signedNonce(cancelEncoded)).toBe(signedNonce(encoded));
  expect(cancelled).toMatchObject({
    kind: 'retired',
    recovery,
    transactionId: rejected.transactionId,
    proof: {
      execution: 'not_executed',
      submission: { kind: 'signed', signedNonce: String(signedNonce(encoded)) },
      replacement: { transactionId: nearTransactionHash(cancelEncoded), status: 'succeeded' },
    },
  });
  // The settled operation needs no RPC, and a new transaction can follow at once.
  const statusRequests = backend.statusRequests;
  expect(await page.evaluate(recoverApiOperation, recovery)).toEqual(cancelled);
  expect(backend.statusRequests).toBe(statusRequests);
  backend.statusUnknown = false;
  backend.accessKeyNonce = null;
  await verifyFreshApproval(page, backend);

  // The wallet compares the maximum cost with the balance before it signs.
  backend.account = {
    amount: 95_153_286_115_586_700_000_000n,
    storageUsage: 182,
    gasPrice: 100_000_000n,
    minGasPurchasePrice: 1_000_000_000n,
  };
  await page.evaluate(prepareExpensiveApiOperation);
  const before = backend.broadcasts.length;
  const unaffordable = await page.evaluate(approveApiOutcome);
  expect(unaffordable).toMatchObject({
    kind: 'not_submitted',
    shortfall: { balance: '95153286115586700000000', storageReserve: '1820000000000000000000' },
  });
  expect(backend.broadcasts.length).toBe(before);
  backend.account = null;
}

async function approveApiOutcome() {
  if (!window.ownerAuthOperation) throw new Error('Missing owner operation.');
  return await window.ownerAuthOperation.approve();
}

/** Report an operation that ended without a review, with its own outcome. */
async function confirmOutcome(page: Page, outcome: Promise<unknown>): Promise<void> {
  const early = await Promise.race([outcome, clickNearConfirmation(page)]);
  if (early !== undefined) throw new Error(`Operation ended early: ${JSON.stringify(early)}`);
}

function readOutcomeKind(outcome: { kind: string }): string {
  return outcome.kind;
}

async function cancelApiTransaction(recovery: import('@seams/wallet').OwnerNearRecovery) {
  const seams = window.ownerAuthApi;
  if (!seams) throw new Error('Missing application API.');
  const session = await seams.auth.getSession();
  if (session.authentication.kind !== 'external_authenticated')
    throw new Error('Missing read connection.');
  const operation = seams.near.resumeOwnerTransaction({
    authentication: session.authentication,
    recovery,
  });
  const checked = await operation.recover();
  if (checked.kind !== 'unresolved' && checked.kind !== 'retirement_available') return checked;
  return await operation.cancelTransaction();
}

async function prepareExpensiveApiOperation(): Promise<void> {
  if (!window.ownerAuthPrepareExpensive) throw new Error('Missing expensive operation fixture.');
  await window.ownerAuthPrepareExpensive();
}

async function verifyOwnerRetirement(page: Page, backend: ApplicationBackend) {
  const firstBroadcasts = backend.broadcasts.length;
  backend.statusUnknown = true;

  // An expired transaction whose nonce was never used cannot have executed.
  const unused = await loseOwnerBroadcast(page, backend);
  backend.accessKeyNonce = signedNonce(unused.encoded) - 1n;
  backend.finalBlockHeight = LAST_ACCEPTED_BLOCK;
  const withinValidity = await page.evaluate(recoverApiOperation, unused.recovery);
  expect(withinValidity).toMatchObject({
    kind: 'unresolved',
    transactionId: unused.transactionId,
    error: expect.stringContaining(`cannot accept this transaction after block ${LAST_ACCEPTED_BLOCK}.`),
    retirementWait: {
      finalBlockHeight: LAST_ACCEPTED_BLOCK,
      lastAcceptedBlockHeight: LAST_ACCEPTED_BLOCK,
      submission: { kind: 'signed', referenceBlockHeight: 1 },
    },
  });
  backend.finalBlockHeight = LAST_ACCEPTED_BLOCK + 1;
  const notExecuted = await page.evaluate(recoverApiOperation, unused.recovery);
  expect(notExecuted).toMatchObject({
    kind: 'retired',
    recovery: unused.recovery,
    transactionId: unused.transactionId,
    proof: {
      execution: 'not_executed',
      finalBlockHeight: LAST_ACCEPTED_BLOCK + 1,
      lastAcceptedBlockHeight: LAST_ACCEPTED_BLOCK,
      accessKeyNonce: String(signedNonce(unused.encoded) - 1n),
      submission: {
        kind: 'signed',
        signedNonce: String(signedNonce(unused.encoded)),
        referenceBlockHeight: 1,
      },
    },
  });
  await verifyFreshApproval(page, backend);

  // A used nonce ends the transaction, but only the owner can accept the uncertain past.
  const used = await loseOwnerBroadcast(page, backend);
  backend.accessKeyNonce = signedNonce(used.encoded);
  backend.finalBlockHeight = LAST_ACCEPTED_BLOCK + 1;
  const available = await page.evaluate(recoverApiOperation, used.recovery);
  expect(available).toMatchObject({
    kind: 'retirement_available',
    recovery: used.recovery,
    transactionId: used.transactionId,
    proof: { execution: 'unverified', accessKeyNonce: String(signedNonce(used.encoded)) },
  });
  await page.evaluate(prepareApiOperation);
  expect(await page.evaluate(approveApiOnce)).toBe('unresolved');
  expect((await page.evaluate(readApiState)).recovery).toEqual(used.recovery);
  const cancelledRetirement = page.evaluate(retireApiOperation, used.recovery);
  await clickNearCancellation(page);
  expect(await cancelledRetirement).toMatchObject({
    kind: 'unresolved',
    recovery: used.recovery,
    transactionId: used.transactionId,
  });
  const retirement = page.evaluate(retireApiOperation, used.recovery);
  await clickNearConfirmation(page);
  const ownerRetired = await retirement;
  expect(ownerRetired).toMatchObject({
    kind: 'retired',
    recovery: used.recovery,
    transactionId: used.transactionId,
    proof: { execution: 'unverified', ownerApproval: {} },
  });
  const statusRequests = backend.statusRequests;
  expect(await page.evaluate(recoverApiOperation, used.recovery)).toEqual(ownerRetired);
  expect(backend.statusRequests).toBe(statusRequests);
  await verifyFreshApproval(page, backend);

  // A receipt from an earlier SDK has only its hash. Its wait starts at the first observation.
  const hashOnly = await loseOwnerBroadcast(page, backend);
  await stripOwnerReceiptEvidence(page, hashOnly.recovery.operationId);
  const firstObservation = 500_000;
  backend.finalBlockHeight = firstObservation;
  const hashOnlyWaitBlock = firstObservation + TRANSACTION_VALIDITY_PERIOD + 3_600;
  expect(await page.evaluate(recoverApiOperation, hashOnly.recovery)).toMatchObject({
    kind: 'unresolved',
    error: expect.stringContaining('safety wait'),
    retirementWait: {
      finalBlockHeight: firstObservation,
      lastAcceptedBlockHeight: hashOnlyWaitBlock,
      submission: { kind: 'hash_only', firstObservedBlockHeight: firstObservation },
    },
  });
  // Reading another operation's durable result leaves this one pending.
  expect((await page.evaluate(recoverApiOperation, used.recovery)).kind).toBe('retired');
  await page.evaluate(prepareApiOperation);
  expect(await page.evaluate(approveApiOnce)).toBe('unresolved');
  expect((await page.evaluate(readApiState)).recovery).toEqual(hashOnly.recovery);
  await page.reload();
  await expect.poll(ownerApiAvailable.bind(null, page)).toBe(true);
  const hashOnlyLastBlock = hashOnlyWaitBlock;
  backend.finalBlockHeight = hashOnlyLastBlock;
  expect((await page.evaluate(recoverApiOperation, hashOnly.recovery)).kind).toBe('unresolved');
  backend.finalBlockHeight = hashOnlyLastBlock + 1;
  expect(await page.evaluate(recoverApiOperation, hashOnly.recovery)).toMatchObject({
    kind: 'retirement_available',
    transactionId: hashOnly.transactionId,
    proof: {
      execution: 'unverified',
      accessKeyNonce: null,
      lastAcceptedBlockHeight: hashOnlyLastBlock,
      submission: { kind: 'hash_only', firstObservedBlockHeight: firstObservation },
    },
  });
  const hashOnlyRetirement = page.evaluate(retireApiOperation, hashOnly.recovery);
  await clickNearConfirmation(page);
  const hashOnlyRetired = await hashOnlyRetirement;
  expect(hashOnlyRetired.kind).toBe('retired');
  const { networkBound, legacyRetired } = await verifyOwnerBinding(page, backend);

  backend.statusUnknown = false;
  await verifyFreshApproval(page, backend);
  // Four lost broadcasts and four fresh approvals. Recovery and retirement send nothing.
  expect(backend.broadcasts.length).toBe(firstBroadcasts + 8);
  return { notExecuted, ownerRetired, hashOnlyRetired, networkBound, legacyRetired };
}

/** The receipt and the pending guard follow the network, not one RPC URL. */
async function verifyOwnerBinding(page: Page, backend: ApplicationBackend) {
  const moved = await loseOwnerBroadcast(page, backend);
  backend.accessKeyNonce = signedNonce(moved.encoded) - 1n;
  backend.finalBlockHeight = LAST_ACCEPTED_BLOCK;
  await page.goto(
    `${backend.appOrigin}/application-auth?nearRpcUrl=${encodeURIComponent(ALTERNATE_NEAR_RPC_URL)}`,
    { waitUntil: 'domcontentloaded' },
  );
  await expect.poll(ownerApiAvailable.bind(null, page)).toBe(true);
  const networkBound = await page.evaluate(recoverApiOperation, moved.recovery);
  expect(networkBound).toMatchObject({
    kind: 'unresolved',
    recovery: moved.recovery,
    transactionId: moved.transactionId,
    retirementWait: { lastAcceptedBlockHeight: LAST_ACCEPTED_BLOCK },
  });
  expect(backend.rpcUrls.has(ALTERNATE_NEAR_RPC_URL)).toBe(true);
  await page.evaluate(prepareApiOperation);
  expect(await page.evaluate(approveApiOnce)).toBe('unresolved');
  expect((await page.evaluate(readApiState)).recovery).toEqual(moved.recovery);

  // An RPC for another chain cannot supply the block heights that end an operation.
  backend.chainId = 'mainnet';
  backend.finalBlockHeight = LAST_ACCEPTED_BLOCK + 1;
  const wrongChain = await page.evaluate(recoverApiOperation, moved.recovery);
  expect(wrongChain).toMatchObject({
    kind: 'unresolved',
    error: expect.stringContaining('serves mainnet'),
  });
  expect(wrongChain).not.toHaveProperty('retirementWait');
  backend.chainId = 'testnet';

  // SDK 0.40.0 and earlier bound the RPC URL. The current URL still matches those records.
  await page.goto(`${backend.appOrigin}/application-auth`, { waitUntil: 'domcontentloaded' });
  await expect.poll(ownerApiAvailable.bind(null, page)).toBe(true);
  const { authentication } = await page.evaluate(readSession);
  if (authentication.kind !== 'external_authenticated')
    throw new Error('The read connection disappeared.');
  await rewriteOwnerRecordsToLegacyBinding(
    page,
    moved.recovery.operationId,
    createHash('sha256')
      .update(
        JSON.stringify({
          associationId: authentication.associationId,
          environmentId: authentication.environmentId,
          nearAccountId: moved.recovery.nearAccountId,
          nearRpcUrl: DEFAULT_NEAR_RPC_URL,
          parentOrigin: backend.appOrigin,
          walletId: moved.recovery.walletId,
        }),
      )
      .digest('hex'),
  );
  await page.evaluate(prepareApiOperation);
  expect(await page.evaluate(approveApiOnce)).toBe('unresolved');
  expect((await page.evaluate(readApiState)).recovery).toEqual(moved.recovery);
  const legacyRetired = await page.evaluate(recoverApiOperation, moved.recovery);
  expect(legacyRetired).toMatchObject({
    kind: 'retired',
    transactionId: moved.transactionId,
    proof: { execution: 'not_executed' },
  });
  await verifyFreshApproval(page, backend);
  return { networkBound, legacyRetired };
}

async function retireApiOperation(recovery: import('@seams/wallet').OwnerNearRecovery) {
  const seams = window.ownerAuthApi;
  if (!seams) throw new Error('Missing application API.');
  const session = await seams.auth.getSession();
  if (session.authentication.kind !== 'external_authenticated')
    throw new Error('Missing read connection.');
  const operation = seams.near.resumeOwnerTransaction({
    authentication: session.authentication,
    recovery,
  });
  const checked = await operation.recover();
  if (checked.kind !== 'retirement_available')
    throw new Error(`The transaction cannot be released: ${checked.kind}`);
  return await operation.retire();
}

async function clickNearCancellation(page: Page): Promise<void> {
  const wallet = page.locator('iframe[allow*="publickey-credentials-get"]').last().contentFrame();
  await wallet
    .locator('#seams-confirm-portal')
    .getByRole('button', { name: 'Cancel', exact: true })
    .last()
    .click({ timeout: 30_000 });
}
