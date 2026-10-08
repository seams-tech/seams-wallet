import { writeFile } from 'node:fs/promises';
import { expect, type BrowserContext, type Page, type Request, type Route, type TestInfo } from '@playwright/test';
import { requireNonEmptyString, requireRecord } from '@shared/utils/validation';
import { loadNodeDatabaseSync } from '@server/router/node/nodeSqlite';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';
import { isolatedGatewayDatabasePath } from './local-gateway-database';

type NearSigningReadStage = 'warm_sequence' | 'exhausted_session' | 'unlock' | 'after_refresh';

class NearSigningRequestEvidence {
  stage: NearSigningReadStage = 'warm_sequence';
  readonly requests: { stage: NearSigningReadStage; path: string }[] = [];

  record(request: Request): void {
    if (request.method() !== 'POST') return;
    const path = new URL(request.url()).pathname;
    if (
      path === '/wallet/session/status' ||
      path === '/wallet/execution-lane/owner' ||
      path === '/router-ab/ed25519/sign/prepare' ||
      path === '/router-ab/ed25519/sign'
    ) {
      this.requests.push({ stage: this.stage, path });
    }
  }

  count(stage: NearSigningReadStage, path: string): number {
    let count = 0;
    for (const request of this.requests) {
      if (request.stage === stage && request.path === path) count += 1;
    }
    return count;
  }

  async finish(testInfo: TestInfo): Promise<void> {
    const artifact = testInfo.outputPath('near-signing-session-reads.json');
    await writeFile(artifact, JSON.stringify({ requests: this.requests }, null, 2));
    await testInfo.attach('near-signing-session-reads', {
      path: artifact,
      contentType: 'application/json',
    });
  }
}

async function verifyLocalEd25519YaoRegistration(
  { harness, context }: { harness: IntendedBehaviourHarness; context: BrowserContext },
  testInfo: TestInfo,
): Promise<void> {
  await harness.registerPasskeyEd25519YaoWallet();
  await harness.signNearTransaction('post_registration');
  const evidence = new NearSigningRequestEvidence();
  const record = evidence.record.bind(evidence);
  context.on('request', record);
  try {
    await harness.signNearTransaction('post_registration');
    await harness.signNearTransaction('post_registration');
    expect(evidence.count('warm_sequence', '/wallet/session/status')).toBe(0);
    expect(evidence.count('warm_sequence', '/wallet/execution-lane/owner')).toBe(0);
    expect(evidence.count('warm_sequence', '/router-ab/ed25519/sign/prepare')).toBe(2);
    expect(evidence.count('warm_sequence', '/router-ab/ed25519/sign')).toBe(2);

    evidence.stage = 'exhausted_session';
    await harness.signNearTransaction('step_up_required');
    evidence.stage = 'unlock';
    await harness.lockWallet();
    await harness.unlockPasskeyWallet();
    evidence.stage = 'after_refresh';
    await harness.refreshPagePreservingWalletStorage();
    await harness.signNearTransactionAfterRefresh();
    await harness.signNearMessage('Approve checkout after the session observation was discarded');
    expect(evidence.count('after_refresh', '/wallet/session/status')).toBeGreaterThan(0);
    expect(evidence.count('after_refresh', '/wallet/execution-lane/owner')).toBe(0);
  } finally {
    context.off('request', record);
    await evidence.finish(testInfo);
  }
}

test(
  'NEAR reuses signing observations, enforces exhausted quota, and reloads authority after refresh',
  verifyLocalEd25519YaoRegistration,
);

async function verifyLocalEd25519YaoAddSignerAndSigning({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.registerPasskeyEd25519YaoWallet();
  await harness.addPasskeyEd25519YaoWalletSigner();
}

test(
  'public Ed25519 Yao add-signer persists a distinct signer',
  verifyLocalEd25519YaoAddSignerAndSigning,
);

async function verifyEcdsaAddSignerSignsAtOnceAndAfterUnlock({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.registerPasskeyEd25519YaoWallet();
  await harness.addPasskeyEcdsaWalletSigner({ loseFinalizeResponseOnce: true });
  await harness.signNearTransaction('post_registration');
  await harness.signTempoTransaction('post_registration');
  await harness.signArcEvmTransaction('post_registration');
  await harness.lockWallet();
  await harness.assertWalletLocked();
  await harness.unlockPasskeyWallet();
  await harness.signNearTransaction('post_unlock');
  await harness.signTempoTransaction('post_unlock');
  await harness.signArcEvmTransaction('post_unlock');
}

test(
  'public ECDSA add-signer lets an Ed25519 wallet sign NEAR, Tempo and Arc at once and after unlock, across a lost finalize response',
  verifyEcdsaAddSignerSignsAtOnceAndAfterUnlock,
);

async function verifyExactTransportRetry({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.registerPasskeyEd25519YaoWalletWithExactTransportRetry();
  await harness.signNearTransaction('post_registration');
}

test(
  'uncertain Router transport replays the registration and signs with the ready wallet',
  verifyExactTransportRetry,
);

async function verifyTerminalFailureWithoutRetry({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.assertPasskeyEd25519YaoTerminalFailureWithoutRetry();
}

test('terminal burned execution fails without retry', verifyTerminalFailureWithoutRetry);

async function verifyNearFinalizeResumesFromItsDecision({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.registerPasskeyWalletAcrossNearFinalizeStorageLoss();
  await harness.signNearTransaction('post_unlock');
}

test(
  'deferred NEAR finalize that loses storage after its decision resumes from the decision and signs',
  verifyNearFinalizeResumesFromItsDecision,
);

async function verifyInterruptedExportAuthorizationResumes({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  await harness.unlockPasskeyWallet();
  await harness.exportEd25519KeyAcrossInterruptedAuthorization();
}

test(
  'an Ed25519 export interrupted after its authorization committed is admitted by the exact retry',
  verifyInterruptedExportAuthorizationResumes,
);

async function verifyNearMessageSigningAfterRefresh(
  { harness }: { harness: IntendedBehaviourHarness },
  testInfo: TestInfo,
): Promise<void> {
  await harness.registerPasskeyEd25519YaoWallet();
  const first = await harness.signNearMessage('Approve checkout before refresh', { state: '' });
  await harness.refreshPagePreservingWalletStorage();
  const second = await harness.signNearMessage('Approve checkout after refresh', {
    callbackUrl: 'https://checkout.example/callback?request=170',
    state: 'quote-170-after-refresh',
  });
  await harness.signNearTransactionAfterRefresh();
  const artifactPath = testInfo.outputPath('near-message-signatures.json');
  await writeFile(artifactPath, JSON.stringify({ first, second }, null, 2), 'utf8');
  await testInfo.attach('near-message-signatures.json', {
    path: artifactPath,
    contentType: 'application/json',
  });
}

test(
  'public NEAR message signatures verify against the registered key across refresh',
  verifyNearMessageSigningAfterRefresh,
);

class ChangedPrepareAuthority {
  prepareResponses = 0;
  finalizeRequests = 0;

  async changeResponse(route: Route): Promise<void> {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const body = requireRecord(await response.json(), 'prepare response');
    expect(body.kind).toBe('reusable_wallet_session');
    const status = requireRecord(body.session_status, 'prepare session');
    const authorization = requireRecord(status.authorization, 'prepare authority');
    if (typeof authorization.authorityRevocationEpoch !== 'number') {
      throw new Error('Expected the admitted authority revocation epoch');
    }
    authorization.authorityRevocationEpoch += 1;
    this.prepareResponses += 1;
    await route.fulfill({ response, json: body });
  }

  countFinalize(request: Request): void {
    if (new URL(request.url()).pathname === '/router-ab/ed25519/sign') {
      this.finalizeRequests += 1;
    }
  }
}

async function verifyPrepareAuthorityReconciliation(
  { harness, context }: { harness: IntendedBehaviourHarness; context: BrowserContext },
  testInfo: TestInfo,
): Promise<void> {
  await harness.registerPasskeyEd25519YaoWallet();
  const changed = new ChangedPrepareAuthority();
  const change = changed.changeResponse.bind(changed);
  const count = changed.countFinalize.bind(changed);
  const preparePath = '**/router-ab/ed25519/sign/prepare';
  context.on('request', count);
  await context.route(preparePath, change);
  try {
    await expect(harness.signNearTransaction('post_registration')).rejects.toThrow('Wallet Session authority changed before Ed25519 client signing');
    expect(changed.prepareResponses).toBe(1);
    expect(changed.finalizeRequests).toBe(0);
  } finally {
    await context.unroute(preparePath, change);
    context.off('request', count);
  }
  await harness.refreshPagePreservingWalletStorage();
  await harness.signNearTransactionAfterRefresh();
  await harness.signNearMessage('Verify the admitted NEAR session');
  const artifact = testInfo.outputPath('near-prepare-authority.json');
  await writeFile(
    artifact,
    JSON.stringify(
      {
        changedPrepareResponses: changed.prepareResponses,
        finalizeRequestsAfterChangedAuthority: changed.finalizeRequests,
        validTransactionAndMessageVerified: true,
      },
      null,
      2,
    ),
  );
  await testInfo.attach('near-prepare-authority', {
    path: artifact,
    contentType: 'application/json',
  });
}

test(
  'NEAR rejects changed prepare authority before finalize and permits the next valid operation',
  verifyPrepareAuthorityReconciliation,
);

class RetireSessionBeforePrepare {
  prepareRequests = 0;
  reusableFinalizeRequests = 0;
  stepUpFinalizeRequests = 0;
  ownerLaneRequests = 0;
  retiredSessionHttpStatus: number | null = null;

  async retire(route: Route): Promise<void> {
    if (route.request().method() !== 'POST' || this.prepareRequests > 0) {
      await route.continue();
      return;
    }
    const body = requireRecord(route.request().postDataJSON(), 'prepare request');
    const scope = requireRecord(body.scope, 'prepare scope');
    const authorization = requireRecord(scope.authorization, 'prepare authorization');
    expect(authorization.kind).toBe('reusable_wallet_session');
    const sessionId = requireNonEmptyString(authorization.wallet_session_id, 'session ID');
    const walletId = requireNonEmptyString(scope.account_id, 'wallet ID');
    const DatabaseSync = await loadNodeDatabaseSync();
    const database = new DatabaseSync(await isolatedGatewayDatabasePath(), { readOnly: false });
    try {
      const result = database.prepare(`
        UPDATE wallet_session_authorizations_v2 SET retired_at_ms = ?
         WHERE wallet_session_id = ? AND wallet_id = ? AND retired_at_ms IS NULL
         RETURNING wallet_session_id
      `).all(Date.now(), sessionId, walletId);
      expect(result).toHaveLength(1);
    } finally {
      database.close();
    }
    this.prepareRequests += 1;
    const response = await route.fetch();
    this.retiredSessionHttpStatus = response.status();
    expect(response.ok()).toBe(false);
    await route.fulfill({ response });
  }

  record(request: Request): void {
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'POST') return;
    if (path === '/router-ab/ed25519/sign') {
      const body = requireRecord(request.postDataJSON(), 'finalize request');
      const scope = requireRecord(body.scope, 'finalize scope');
      const authorization = requireRecord(scope.authorization, 'finalize authorization');
      if (authorization.kind === 'reusable_wallet_session') this.reusableFinalizeRequests += 1;
      if (authorization.kind === 'operation_step_up') this.stepUpFinalizeRequests += 1;
    }
    if (path === '/wallet/execution-lane/owner') this.ownerLaneRequests += 1;
  }
}

async function verifyRetiredSessionRequiresUnlock(
  { harness, context }: { harness: IntendedBehaviourHarness; context: BrowserContext },
  testInfo: TestInfo,
): Promise<void> {
  await harness.registerPasskeyEd25519YaoWallet();
  await harness.signNearTransaction('post_registration');
  const retired = new RetireSessionBeforePrepare();
  const retire = retired.retire.bind(retired);
  const record = retired.record.bind(retired);
  const preparePath = '**/router-ab/ed25519/sign/prepare';
  context.on('request', record);
  await context.route(preparePath, retire);
  try {
    await expect(harness.signNearTransaction('post_registration')).rejects.toThrow(
      'Wallet Session is invalid',
    );
    expect(retired.prepareRequests).toBe(1);
    expect(retired.ownerLaneRequests).toBe(0);
    expect(retired.reusableFinalizeRequests).toBe(0);
    expect(retired.stepUpFinalizeRequests).toBe(0);
    expect(retired.retiredSessionHttpStatus).toBeGreaterThanOrEqual(400);
  } finally {
    await context.unroute(preparePath, retire);
    context.off('request', record);
  }
  await harness.lockWallet();
  await harness.unlockPasskeyWallet();
  await harness.signNearTransaction('post_unlock');
  const artifact = testInfo.outputPath('near-retired-session.json');
  await writeFile(artifact, JSON.stringify({
    retiredBeforePrepare: retired.prepareRequests,
    retiredSessionHttpStatus: retired.retiredSessionHttpStatus,
    ownerLaneRequests: retired.ownerLaneRequests,
    reusableFinalizeRequestsAfterRetirement: retired.reusableFinalizeRequests,
    stepUpFinalizeRequests: retired.stepUpFinalizeRequests,
    freshUnlockSignatureVerified: true,
  }, null, 2));
  await testInfo.attach('near-retired-session', { path: artifact, contentType: 'application/json' });
}

test(
  'NEAR prepare rejects a retired session without an owner-lane preflight and permits fresh unlock',
  verifyRetiredSessionRequiresUnlock,
);

function isAccessKeyRequest(request: Request): boolean {
  if (request.method() !== 'POST') return false;
  try {
    const body = requireRecord(request.postDataJSON(), 'RPC request');
    if (body.method !== 'query') return false;
    const params = requireRecord(body.params, 'RPC query params');
    return params.request_type === 'view_access_key';
  } catch {
    return false;
  }
}

class NonceRecoveryEvidence {
  accessKeyRequests = 0;
  failNextAccessKeyRequest = false;
  failedAccessKeyRequests = 0;
  readonly signatures: { nonce: string; atMs: number; accessKeyRequests: number }[] = [];

  record(request: Request): void {
    if (isAccessKeyRequest(request)) this.accessKeyRequests += 1;
  }

  async interruptOnce(route: Route): Promise<void> {
    if (!this.failNextAccessKeyRequest || !isAccessKeyRequest(route.request())) {
      await route.fallback();
      return;
    }
    this.failNextAccessKeyRequest = false;
    this.failedAccessKeyRequests += 1;
    await route.fulfill({ status: 503, body: 'Temporary NEAR RPC outage' });
  }

  async captureVerifiedNonce(page: Page, previousRequests: number): Promise<void> {
    const text = await page.getByTestId('intended-result-json').textContent();
    const snapshot = requireRecord(
      JSON.parse(requireNonEmptyString(text, 'page snapshot')),
      'snapshot',
    );
    const action = requireRecord(snapshot.action, 'page action');
    const result = requireRecord(action.result, 'signing result');
    expect(result.kind).toBe('near_sign_success');
    const encoded = requireNonEmptyString(result.signedTransactionB64, 'signed transaction');
    const bytes = Buffer.from(encoded, 'base64');
    const signerLength = bytes.readUInt32LE(0);
    const publicKeyOffset = 4 + signerLength;
    expect(bytes[publicKeyOffset], 'Ed25519 key type').toBe(0);
    const nonceOffset = publicKeyOffset + 1 + 32;
    const nonce = bytes.readBigUInt64LE(nonceOffset);
    this.signatures.push({
      nonce: nonce.toString(),
      atMs: Date.now(),
      accessKeyRequests: this.accessKeyRequests - previousRequests,
    });
  }

  async finish(testInfo: TestInfo): Promise<void> {
    const artifact = testInfo.outputPath('near-nonce-recovery.json');
    await writeFile(
      artifact,
      JSON.stringify(
        {
          signatures: this.signatures,
          failedAccessKeyRequests: this.failedAccessKeyRequests,
        },
        null,
        2,
      ),
    );
    await testInfo.attach('near-nonce-recovery', {
      path: artifact,
      contentType: 'application/json',
    });
  }
}

async function verifyNonceRecovery(
  {
    harness,
    context,
    page,
  }: { harness: IntendedBehaviourHarness; context: BrowserContext; page: Page },
  testInfo: TestInfo,
): Promise<void> {
  const evidence = new NonceRecoveryEvidence();
  const record = evidence.record.bind(evidence);
  const interrupt = evidence.interruptOnce.bind(evidence);
  await harness.registerPasskeyEd25519YaoWallet();
  context.on('request', record);
  await context.route('**/*', interrupt);
  try {
    let previousRequests = evidence.accessKeyRequests;
    await harness.signNearTransaction('post_registration');
    await evidence.captureVerifiedNonce(page, previousRequests);

    // A failed chain read must retain the first unconsumed reservation.
    evidence.failNextAccessKeyRequest = true;
    previousRequests = evidence.accessKeyRequests;
    await harness.signNearTransaction('post_registration');
    await evidence.captureVerifiedNonce(page, previousRequests);
    expect(evidence.failedAccessKeyRequests).toBe(1);

    await harness.refreshPagePreservingWalletStorage();
    previousRequests = evidence.accessKeyRequests;
    await harness.signNearTransactionAfterRefresh();
    await evidence.captureVerifiedNonce(page, previousRequests);
    expect(evidence.accessKeyRequests).toBeGreaterThan(previousRequests);

    const first = evidence.signatures[0];
    const last = evidence.signatures[evidence.signatures.length - 1];
    expect(
      last.atMs - first.atMs,
      'exercise reservations before their 30-second signed expiry',
    ).toBeLessThan(30_000);
    for (let index = 1; index < evidence.signatures.length; index += 1) {
      const current = evidence.signatures[index];
      const previous = evidence.signatures[index - 1];
      expect(BigInt(current.nonce), 'do not reuse an unexpired signed nonce').toBeGreaterThan(
        BigInt(previous.nonce),
      );
    }
    // Recovery needs one query; fresh transaction context can need one more.
    expect(last.accessKeyRequests).toBeGreaterThanOrEqual(1);
    expect(last.accessKeyRequests).toBeLessThanOrEqual(2);
  } finally {
    context.off('request', record);
    await context.unroute('**/*', interrupt);
    await evidence.finish(testInfo);
  }
}

test(
  'NEAR nonce recovery preserves distinct signatures across reload, RPC failure and fresh recovery',
  verifyNonceRecovery,
);

async function readNearOperationPersistence(walletId: string, operationId: string) {
  const DatabaseSync = await loadNodeDatabaseSync();
  const database = new DatabaseSync(await isolatedGatewayDatabasePath(), { readOnly: true });
  try {
    const rows = database
      .prepare(
        `
      SELECT
        (SELECT SUM(quota.remaining_uses) FROM authorization_wallet_session_quotas AS quota
          WHERE EXISTS (SELECT 1 FROM wallet_session_authorizations_v2 AS session
            WHERE session.namespace = quota.namespace AND session.tenant_id = quota.tenant_id
              AND session.quota_id = quota.quota_id AND session.wallet_id = ?)) AS remaining,
        (SELECT COUNT(*) FROM authorized_operations WHERE operation_id = ?) AS claims,
        (SELECT COUNT(*) FROM authorized_operation_audit_events WHERE audit_event_id = ?) AS audit_events
    `,
      )
      .all(walletId, operationId, `ed25519-operation-audit:${operationId}`);
    const row = requireRecord(rows[0], 'NEAR operation persistence');
    if (
      !row ||
      typeof row.remaining !== 'number' ||
      typeof row.claims !== 'number' ||
      typeof row.audit_events !== 'number'
    ) {
      throw new Error('Expected NEAR operation quota, claim and audit counts');
    }
    return { remainingUses: row.remaining, claims: row.claims, auditEvents: row.audit_events };
  } finally {
    database.close();
  }
}

class NearFinalizeReplayEvidence {
  request: Request | null = null;
  readonly statuses: { scenario: string; status: number }[] = [];
  persistence: Awaited<ReturnType<typeof readNearOperationPersistence>> | null = null;

  async discardFirstReplyAndRetry(route: Route): Promise<void> {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const request = route.request();
    const body = requireRecord(request.postDataJSON(), 'finalize request');
    const receipt = requireRecord(body.authorized_operation, 'operation receipt');
    const scope = requireRecord(body.scope, 'finalize scope');
    const authority = requireRecord(scope.authorization, 'finalize authority');
    expect(authority.kind).toBe('reusable_wallet_session');
    const walletId = requireNonEmptyString(scope.account_id, 'wallet ID');
    const operationId = requireNonEmptyString(receipt.operation_id, 'operation ID');

    const missing = structuredClone(body);
    const missingReceipt = requireRecord(missing.authorized_operation, 'missing receipt');
    missingReceipt.authorized_operation_id = `missing-operation:${crypto.randomUUID()}`;
    const absent = await route.fetch({ postData: JSON.stringify(missing) });
    this.statuses.push({ scenario: 'missing_operation', status: absent.status() });
    expect(absent.status()).toBe(409);
    expect(await absent.json()).toMatchObject({ code: 'authorized_operation_missing' });

    const changed = structuredClone(body);
    const changedReceipt = requireRecord(changed.authorized_operation, 'changed receipt');
    changedReceipt.display_digest_b64u = 'A'.repeat(43);
    const invalid = await route.fetch({ postData: JSON.stringify(changed) });
    this.statuses.push({ scenario: 'changed_receipt', status: invalid.status() });
    expect(invalid.status()).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'invalid_authorized_operation' });

    const completed = await route.fetch();
    this.statuses.push({ scenario: 'first_finalize_reply_discarded', status: completed.status() });
    expect(completed.status()).toBe(200);
    const replayed = await route.fetch();
    this.statuses.push({
      scenario: 'exact_retry_after_quota_exhaustion',
      status: replayed.status(),
    });
    expect(replayed.status()).toBe(200);
    expect(await replayed.json()).toEqual(await completed.json());
    this.persistence = await readNearOperationPersistence(walletId, operationId);
    expect(this.persistence).toEqual({ remainingUses: 0, claims: 1, auditEvents: 1 });
    this.request = request;
    // Only the exact retry's reply reaches the SDK, which verifies the resulting signature.
    await route.fulfill({ response: replayed });
  }

  async retireAndRejectReplay(context: BrowserContext): Promise<void> {
    if (!this.request || !this.persistence) throw new Error('Expected a completed NEAR finalize');
    const body = requireRecord(this.request.postDataJSON(), 'finalize request');
    const scope = requireRecord(body.scope, 'finalize scope');
    const authority = requireRecord(scope.authorization, 'finalize authority');
    const receipt = requireRecord(body.authorized_operation, 'operation receipt');
    const walletId = requireNonEmptyString(scope.account_id, 'wallet ID');
    const sessionId = requireNonEmptyString(authority.wallet_session_id, 'session ID');
    const operationId = requireNonEmptyString(receipt.operation_id, 'operation ID');
    const DatabaseSync = await loadNodeDatabaseSync();
    const database = new DatabaseSync(await isolatedGatewayDatabasePath(), { readOnly: false });
    try {
      const retired = database
        .prepare(
          `
        UPDATE wallet_session_authorizations_v2 SET retired_at_ms = ?
        WHERE wallet_id = ? AND wallet_session_id = ? AND retired_at_ms IS NULL
        RETURNING wallet_session_id
      `,
        )
        .all(Date.now(), walletId, sessionId);
      expect(retired).toHaveLength(1);
    } finally {
      database.close();
    }
    const denied = await context.request.fetch(this.request);
    this.statuses.push({ scenario: 'retired_session_retry', status: denied.status() });
    expect(denied.status()).toBeGreaterThanOrEqual(400);
    expect(denied.status()).toBeLessThan(500);
    expect(await readNearOperationPersistence(walletId, operationId)).toEqual(this.persistence);
  }

  async finish(testInfo: TestInfo): Promise<void> {
    const artifact = testInfo.outputPath('near-finalize-replay.json');
    await writeFile(
      artifact,
      JSON.stringify({ statuses: this.statuses, persistence: this.persistence }, null, 2),
    );
    await testInfo.attach('near-finalize-replay', {
      path: artifact,
      contentType: 'application/json',
    });
  }
}

async function verifyNearFinalizeReplay(
  { harness, context }: { harness: IntendedBehaviourHarness; context: BrowserContext },
  testInfo: TestInfo,
): Promise<void> {
  await harness.registerPasskeyEd25519YaoWallet();
  await harness.signNearTransaction('post_registration');
  await harness.signNearTransaction('post_registration');
  const evidence = new NearFinalizeReplayEvidence();
  const intercept = evidence.discardFirstReplyAndRetry.bind(evidence);
  const path = '**/router-ab/ed25519/sign';
  await context.route(path, intercept);
  try {
    await harness.signNearTransaction('post_registration');
    await evidence.retireAndRejectReplay(context);
  } finally {
    await context.unroute(path, intercept);
    await evidence.finish(testInfo);
  }
}

test(
  'NEAR finalize validates one stored operation, replays a discarded reply at exhausted quota, and rejects retirement',
  verifyNearFinalizeReplay,
);
