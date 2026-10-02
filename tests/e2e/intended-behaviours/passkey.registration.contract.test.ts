import { assertIndependentNearRegistration } from './registration-near-gate';
import { verifyWalletProtocolCutover } from './registration-protocol';
import {
  ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1,
} from '@shared/utils/routerAbEd25519Yao';
import {
  expect,
  type APIRequestContext,
  type Request,
  type Response,
  type Route,
  type Page,
} from '@playwright/test';
import { intendedTest as test, type IntendedSigningStage } from './harness';
import { parseEcdsaServerTiming } from '../../../packages/shared-ts/src/utils/ecdsaServerTiming';
import { isPlainObject } from '../../../packages/shared-ts/src/utils/validation';
import { ECDSA_CLIENT_PRESIGNATURE_CAPACITY } from '../../../packages/wallet/src/core/signingEngine/workerManager/ecdsaPresignLifecycle';
import { parseYaoServerTimingBuckets } from '../../../packages/wallet/src/SeamsWeb/operations/registration/registrationTiming';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isHex, parseTransaction, recoverTransactionAddress } from 'viem';
import { GatewayRequestEvidence } from './gateway-request-evidence';

const ECDSA_RESPOND_FAULT_HEADER = 'x-seams-intended-ecdsa-respond-fault-v1';
const ECDSA_RESPOND_FAULT_PROOF_HEADER = 'x-seams-intended-ecdsa-respond-proof-v1';

test(
  'wallet protocol rejection shows an upgrade message and reload restores registration and signing',
  verifyWalletProtocolCutover,
);

class GatewayEcdsaRespondPinProbe {
  retries = 0;
  proof: {
    readonly firstStatus: number;
    readonly firstProof: string;
    readonly retryStatus: number;
    readonly retryProof: string;
    readonly environmentKey: string;
    readonly projectEnvironmentId: string;
  } | null = null;

  async handle(route: Route): Promise<void> {
    try {
      const headers = route.request().headers();
      const first = await route.fetch({
        headers: { ...headers, [ECDSA_RESPOND_FAULT_HEADER]: 'drop_router_reply' },
      });
      const firstBody = await first.text();
      expect(first.status(), firstBody).toBe(400);
      expect(firstBody).toContain(
        'Local ECDSA fault dropped the completed Router registration reply',
      );
      expect(first.headers()[ECDSA_RESPOND_FAULT_PROOF_HEADER]).toBe('router_reply_dropped');

      const second = await route.fetch({
        headers: { ...headers, [ECDSA_RESPOND_FAULT_HEADER]: 'unavailable_lineage' },
      });
      expect(second.ok()).toBe(true);
      expect(second.headers()[ECDSA_RESPOND_FAULT_PROOF_HEADER]).toBe('lineage_lookups:0');
      const environmentKey = second.headers()['x-seams-intended-ecdsa-environment-key-v1'];
      const projectEnvironmentId = second.headers()['x-seams-intended-ecdsa-environment-id-v1'];
      expect(environmentKey).toBeTruthy();
      expect(projectEnvironmentId).toBeTruthy();
      expect(environmentKey).not.toBe(projectEnvironmentId);
      this.proof = {
        firstStatus: first.status(),
        firstProof: first.headers()[ECDSA_RESPOND_FAULT_PROOF_HEADER],
        retryStatus: second.status(),
        retryProof: second.headers()[ECDSA_RESPOND_FAULT_PROOF_HEADER],
        environmentKey,
        projectEnvironmentId,
      };
      this.retries += 1;
      await route.fulfill({ response: second });
    } catch (error) {
      await route.abort('failed');
      throw error;
    }
  }
}

test('Gateway ECDSA respond retries its pinned root after Router reply loss', async (
  { harness, context },
  testInfo,
) => {
  const probe = new GatewayEcdsaRespondPinProbe();
  const respondPath = '**/wallets/register/respond';
  const handle = probe.handle.bind(probe);
  await context.route(respondPath, handle);
  try {
    await harness.registerPasskeyEcdsaOnlyWallet();
    expect(probe.retries).toBe(1);
    expect(probe.proof).not.toBeNull();
    const artifactPath = path.resolve(
      testInfo.config.rootDir,
      '../.artifacts/r150/gateway-ecdsa-respond-pin.json',
    );
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          kind: 'gateway_ecdsa_respond_pin_e2e_v1',
          reproduce:
            "node tests/scripts/run-wallet-intended-isolated.mjs -- e2e/intended-behaviours/passkey.registration.contract.test.ts --grep 'Gateway ECDSA respond retries its pinned root'",
          ...probe.proof,
        },
        null,
        2,
      ),
      'utf8',
    );
    await testInfo.attach('gateway-ecdsa-respond-pin.json', {
      body: JSON.stringify(probe.proof, null, 2),
      contentType: 'application/json',
    });
  } finally {
    await context.unroute(respondPath, handle);
  }
});

test('mixed registration exposes gateway and finalization timings', async ({ harness, page }) => {
  const respond = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/wallets/register/respond'),
  );
  const activate = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/wallets/register/activate'),
  );
  const nearProvisioning = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/wallets/register/near-provisioning'),
  );

  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();

  const [respondResponse, activateResponse, nearProvisioningResponse] = await Promise.all([
    respond,
    activate,
    nearProvisioning,
  ]);
  const respondTiming = await respondResponse.headerValue('Server-Timing');
  const activateTiming = await activateResponse.headerValue('Server-Timing');
  expect(respondTiming).toContain('ecdsa_respond_total;dur=');
  expect(respondTiming).toContain('ecdsa_respond_router;dur=');
  expect(activateTiming).toContain('ecdsa_activate_total;dur=');
  expect(activateTiming).toContain('ecdsa_activate_router;dur=');
  expect(parseYaoServerTimingBuckets(respondTiming)).toContainEqual([
    'ecdsaRespondTotalMs',
    expect.any(Number),
  ]);
  expect(parseYaoServerTimingBuckets(activateTiming)).toContainEqual([
    'ecdsaActivateTotalMs',
    expect.any(Number),
  ]);
  expect(await respondResponse.headerValue('Access-Control-Expose-Headers')).toContain(
    'Server-Timing',
  );
  expect(await activateResponse.headerValue('Access-Control-Expose-Headers')).toContain(
    'Server-Timing',
  );
  const nearRequestBody: unknown = nearProvisioningResponse.request().postDataJSON();
  const nearResponseBody: unknown = await nearProvisioningResponse.json();
  expect(nearRequestBody).toMatchObject({
    sessionSeal: {
      thresholdSessionId: expect.any(String),
      ciphertext: expect.any(String),
    },
  });
  expect(nearResponseBody).toMatchObject({
    sessionSeal: {
      ciphertext: expect.any(String),
      keyVersion: expect.any(String),
      expiresAtMs: expect.any(Number),
      remainingUses: expect.any(Number),
    },
  });
  expect(await nearProvisioningResponse.headerValue('Server-Timing')).toContain(
    'near_finalize_session_seal;dur=',
  );
  expect(await respondResponse.json()).not.toHaveProperty('gatewayServerTiming');
  expect(await activateResponse.json()).not.toHaveProperty('gatewayServerTiming');
});

test('mixed registration starts one NEAR admission while ECDSA activate is in flight', async ({
  harness,
  context,
  page,
}) => {
  const activateGate = new RegistrationPresignGate();
  const activatePath = '**/wallets/register/activate';
  const holdActivate = activateGate.hold.bind(activateGate);
  const nearRequests: NearRegistrationRequests = { authorization: [], admission: [] };
  const collectNearRequests = collectNearRegistrationRequests.bind(
    undefined,
    nearRequests,
  );
  const nearAdmission = page.waitForRequest((request) =>
    new URL(request.url()).pathname.endsWith(
      ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1,
    ),
  );
  context.on('request', collectNearRequests);
  await context.route(activatePath, holdActivate);
  try {
    const registration = harness.registerPasskeyWallet();
    await expect.poll(activateGate.requestCount.bind(activateGate)).toBeGreaterThan(0);
    await nearAdmission;
    expect(nearRequests.authorization).toHaveLength(0);
    activateGate.release();
    await registration;
    await harness.awaitNearReady();
    expect(nearRequests.admission).toHaveLength(1);
  } finally {
    activateGate.release();
    context.off('request', collectNearRequests);
    await context.unroute(activatePath, holdActivate);
  }
});

type NearRegistrationRequests = {
  authorization: Request[];
  admission: Request[];
};

function collectNearRegistrationRequests(requests: NearRegistrationRequests, request: Request): void {
  const path = new URL(request.url()).pathname;
  if (path.endsWith('/wallets/register/near-admission')) {
    requests.authorization.push(request);
  }
  if (path.endsWith(ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1)) {
    requests.admission.push(request);
  }
}

test('custom review requires wallet approval before a live Arc signature', async ({
  harness,
  context,
  page,
}, testInfo) => {
  const gateway = new GatewayRequestEvidence();
  const nearGate = new RegistrationPresignGate();
  const nearProvisioning = '**/wallets/register/near-provisioning';
  const holdNear = nearGate.hold.bind(nearGate);
  await context.route(nearProvisioning, holdNear);
  try {
    await harness.registerPasskeyWallet();
    await expect.poll(nearGate.requestCount.bind(nearGate)).toBeGreaterThan(0);
    const pageRoot = page.getByTestId('intended-e2e-page');
    await expect(pageRoot).toHaveAttribute('data-login-near-ready', 'pending');
    const registration = JSON.parse(await page.getByTestId('intended-result-json').innerText());
    const expectedAddress = registration.action.result.ecdsaTargetKeys.arcEvm.thresholdOwnerAddress;
    expect(typeof expectedAddress).toBe('string');
    gateway.start(context);
    const signingStartedAt = performance.now();
    const result = page.getByTestId('reviewed-signing-result');
    await page.getByRole('button', { name: 'Review Arc testnet signature', exact: true }).click();
    const heading = page.getByRole('heading', { name: 'Review testnet signature', exact: true });
    await expect(heading).toBeVisible();
    nearGate.release();
    await expect(pageRoot).toHaveAttribute('data-login-near-ready', 'ready', { timeout: 30_000 });
    await expect(heading).toBeVisible();
    await page.getByRole('textbox', { name: 'Review note' }).fill('Live MPC acceptance');
    await expect(result).toHaveAttribute('data-state', 'pending');
    const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
    const confirm = wallet
      .locator('#seams-confirm-portal button.btn-confirm, #seams-confirm-portal button.confirm')
      .last();
    await expect(confirm).toBeHidden();
    await page.getByRole('button', { name: 'Continue to wallet', exact: true }).click();
    await expect(page.locator('iframe.seams-wallet-overlay-iframe')).not.toHaveAttribute(
      'inert',
      '',
    );
    await expect(confirm).toBeVisible({ timeout: 30_000 });
    await expect(result).toHaveAttribute('data-state', 'pending');
    const beforeConfirmation = await gateway.window(signingStartedAt, performance.now());
    expect(beforeConfirmation.requests.filter(isWalletSessionStatusRequest).length).toBeGreaterThan(0);
    expect(beforeConfirmation.requests.filter(isEcdsaSigningPrepare)).toHaveLength(0);
    const confirmedAt = performance.now();
    await confirm.click();
    await expect(result).toHaveAttribute('data-state', 'signed', { timeout: 60_000 });
    const signed = JSON.parse(await result.innerText());
    if (!isHex(signed.rawTxHex)) throw new Error('Expected a serialized signed transaction');
    const transaction = parseTransaction(signed.rawTxHex);
    expect(transaction.value ?? 0n).toBe(0n);
    expect(transaction).toMatchObject({
      type: 'eip1559',
      chainId: 5_042_002,
      to: '0x1111111111111111111111111111111111111111',
    });
    expect(
      (await recoverTransactionAddress({ serializedTransaction: signed.rawTxHex })).toLowerCase(),
    ).toBe(expectedAddress.toLowerCase());
    const complete = await gateway.window(signingStartedAt, performance.now());
    const prepares = complete.requests.filter(isEcdsaSigningPrepare);
    expect(prepares).toHaveLength(1);
    const afterConfirmation = await gateway.window(
      confirmedAt,
      signingStartedAt + prepares[0].requestObservedOffsetMs,
    );
    const statuses = afterConfirmation.requests.filter(isWalletSessionStatusRequest);
    expect(statuses.length).toBeGreaterThan(0);
    for (const status of statuses) {
      expect(status.startedBeforeWindow).toBe(false);
      expect(status.outcome).toBe('completed');
      if (status.completedOffsetMs === null) throw new Error('Session refresh did not complete');
      expect(status.completedOffsetMs).toBeLessThanOrEqual(
        signingStartedAt + prepares[0].requestObservedOffsetMs - confirmedAt,
      );
    }
    const artifact = `ecdsa-confirmation-session-refresh-${process.env.SEAMS_INTENDED_WALLET_HOST ?? 'workers_local'}.json`;
    const artifactPath = path.resolve(testInfo.config.rootDir, '../.artifacts/r151', artifact);
    const proof = JSON.stringify(
      {
        kind: 'ecdsa_confirmation_session_refresh_v1',
        verifiedSignatures: 1,
        confirmationOffsetMs: confirmedAt - signingStartedAt,
        beforeConfirmation,
        afterConfirmation,
        complete,
      },
      null,
      2,
    );
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, proof, 'utf8');
    await testInfo.attach(artifact, { body: proof, contentType: 'application/json' });
  } finally {
    gateway.stop(context);
    nearGate.release();
    await context.unroute(nearProvisioning, holdNear);
  }
});

function isWalletSessionStatusRequest(request: { path: string }): boolean {
  return request.path === '/wallet/session/status';
}

function isEcdsaSigningPrepare(request: { path: string }): boolean {
  return request.path === '/router-ab/ecdsa-derivation/sign/prepare';
}

type SigningRequests = {
  foregroundFills: number;
  presignatureIds: string[];
};

async function readDurablePresignatureIds(page: Page): Promise<string[]> {
  const frame = page.frames().find(isWalletServiceFrame);
  if (!frame) return [];
  return await frame.evaluate(readPresignatureStoreIds);
}

async function readDurablePresignatureCount(page: Page): Promise<number> {
  return (await readDurablePresignatureIds(page)).length;
}

function isWalletServiceFrame(frame: { url(): string }): boolean {
  return new URL(frame.url()).pathname.startsWith('/wallet-service');
}

async function readPresignatureStoreIds(): Promise<string[]> {
  return await new Promise<string[]>((resolve, reject) => {
    const open = indexedDB.open('seams_wallet');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db
        .transaction('ecdsa_client_presignatures', 'readonly')
        .objectStore('ecdsa_client_presignatures')
        .getAll();
      request.onsuccess = () => {
        db.close();
        resolve(request.result.map((row) => String(row.presignature_id)));
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    };
  });
}

async function rejectPresignatureGeneration(route: Route): Promise<void> {
  await route.fulfill({
    status: 403,
    json: { ok: false, code: 'unauthorized', message: 'Generation disabled for reload coverage' },
  });
}

function collectSigningRequests(requests: SigningRequests, request: Request): void {
  const pathname = new URL(request.url()).pathname;
  if (
    pathname !== '/router-ab/ecdsa-derivation/sign/prepare' &&
    pathname !== '/router-ab/ecdsa-derivation/presignature-pool/fill/init'
  ) {
    return;
  }
  const body: unknown = request.postDataJSON();
  if (typeof body !== 'object' || body === null) return;
  if ('client_presignature_id' in body && typeof body.client_presignature_id === 'string') {
    requests.presignatureIds.push(body.client_presignature_id);
  }
  if ('requestTag' in body && body.requestTag === 'foreground_presign_pool_refill') {
    requests.foregroundFills += 1;
  }
}

function isLastWarmSessionUse(remaining: number): boolean {
  return remaining <= 1;
}

function collectPresignResponses(responses: Response[], response: Response): void {
  const pathname = new URL(response.url()).pathname;
  if (response.ok() && pathname.startsWith('/router-ab/ecdsa-derivation/presignature-pool/fill/')) {
    responses.push(response);
  }
}

async function assertSixExchangePresignatures(
  responses: Response[],
  request: APIRequestContext,
): Promise<void> {
  const ceremonies = new Map<string, { init: Response; steps: number; complete: boolean }>();
  for (const response of responses) {
    const body: unknown = response.request().postDataJSON();
    if (!isPlainObject(body) || typeof body.presignSessionId !== 'string') continue;
    if (new URL(response.url()).pathname.endsWith('/init')) {
      expect(body.firstMessageB64u).toEqual(expect.any(String));
      const progress = await response.json();
      expect(progress.outgoingMessagesB64u).toHaveLength(2);
      ceremonies.set(body.presignSessionId, { init: response, steps: 0, complete: false });
    } else {
      const ceremony = ceremonies.get(body.presignSessionId);
      expect(ceremony).toBeDefined();
      if (!ceremony) throw new Error('Presign step arrived without initialization');
      ceremony.steps += 1;
      const progress = await response.json();
      ceremony.complete = progress.event === 'presign_done';
    }
  }
  const completed = [...ceremonies.values()].filter(isCompletePresignCeremony);
  expect(completed.length).toBeGreaterThanOrEqual(ECDSA_CLIENT_PRESIGNATURE_CAPACITY);
  for (const ceremony of completed) expect(ceremony.steps).toBe(5);
  // The live session remains authorized; rejection must come from the burned ceremony identity.
  const replay = await request.fetch(completed[completed.length - 1].init.request());
  const replayBody = await replay.json();
  expect(replayBody.ok).toBe(false);
  expect(replayBody.message).toContain('ReplayedLocalRequest');
}

function isCompletePresignCeremony(ceremony: { complete: boolean }): boolean {
  return ceremony.complete;
}

async function assertPresignResponseTiming(response: Response): Promise<void> {
  const timing = parseEcdsaServerTiming(await response.headerValue('Server-Timing'));
  for (const name of [
    'ecdsa_presign_authenticate',
    'ecdsa_presign_material',
    'ecdsa_presign_proxy',
    'ecdsa_presign_total',
    'ecdsa_presign_sw_session',
    'ecdsa_presign_sw_do_total',
    'ecdsa_presign_sw_total',
  ]) {
    expect(timing.has(name), `Missing ${name} on ${new URL(response.url()).pathname}`).toBe(true);
  }
}

function isStepUpPresignResponse(response: Response): boolean {
  const body: unknown = response.request().postDataJSON();
  return (
    isPlainObject(body) &&
    isPlainObject(body.authorization) &&
    body.authorization.kind === 'operation_step_up'
  );
}

async function rejectReusablePresignRefill(route: Route): Promise<void> {
  const body: unknown = route.request().postDataJSON();
  if (
    isPlainObject(body) &&
    isPlainObject(body.authorization) &&
    body.authorization.kind === 'reusable_wallet_session'
  ) {
    await route.fulfill({
      status: 403,
      json: { ok: false, code: 'unauthorized', message: 'Refill disabled for empty-pool coverage' },
    });
    return;
  }
  await route.continue();
}

async function assertChangedPresignOperationRejected(
  api: APIRequestContext,
  original: Request,
  change: 'key_handle' | 'expires_at_ms',
): Promise<void> {
  const body: unknown = original.postDataJSON();
  if (!isPlainObject(body) || !isPlainObject(body.operation)) {
    throw new Error('The step-up presign request must contain its operation');
  }
  if (change === 'key_handle') {
    body.operation.key_handle = 'ecdsa-key-handle:another-material';
  } else {
    body.operation.expires_at_ms = Date.now() - 1;
  }
  const response = await api.fetch(original, { data: body });
  expect(response.status()).toBe(403);
  const timing = parseEcdsaServerTiming(response.headers()['server-timing'] ?? null);
  expect(timing.has('ecdsa_presign_proxy')).toBe(false);
  if (change === 'key_handle') {
    expect(timing.has('ecdsa_presign_material')).toBe(true);
    expect(timing.has('ecdsa_presign_admit')).toBe(false);
  }
  await response.dispose();
}

class RegistrationPresignGate {
  readonly released: Promise<void>;
  private resolveRelease: (() => void) | null = null;
  requests = 0;

  constructor() {
    this.released = new Promise<void>(this.bindRelease.bind(this));
  }

  private bindRelease(resolve: () => void): void {
    this.resolveRelease = resolve;
  }

  release(): void {
    this.resolveRelease?.();
    this.resolveRelease = null;
  }

  requestCount(): number {
    return this.requests;
  }

  async hold(route: Route): Promise<void> {
    this.requests += 1;
    await this.released;
    await route.continue();
  }
}

test('passkey registration establishes an immediately usable owner session without waiting for presignatures', async ({
  harness,
  context,
  page,
}) => {
  const presignResponses: Response[] = [];
  const collectResponses = collectPresignResponses.bind(undefined, presignResponses);
  context.on('response', collectResponses);
  const gate = new RegistrationPresignGate();
  const presignInit = '**/router-ab/ecdsa-derivation/presignature-pool/fill/init';
  const hold = gate.hold.bind(gate);
  await context.route(presignInit, hold);
  try {
    await harness.registerPasskeyWallet();
    await expect.poll(gate.requestCount.bind(gate)).toBeGreaterThan(0);
  } finally {
    gate.release();
    await context.unroute(presignInit, hold);
  }
  await harness.assertRegistrationOwnerSessionIsActive();
  await expect
    .poll(readDurablePresignatureCount.bind(undefined, page), { timeout: 30_000 })
    .toBeGreaterThan(0);
  await harness.signTempoTransaction('post_registration');
  await harness.awaitNearReady();
  await harness.signNearTransaction('post_registration');
  await harness.signArcEvmTransaction('post_registration');
  await harness.assertRegistrationOwnerSessionIsActive();
  await expect
    .poll(readDurablePresignatureCount.bind(undefined, page), { timeout: 30_000 })
    .toBe(ECDSA_CLIENT_PRESIGNATURE_CAPACITY);
  context.off('response', collectResponses);
  await assertSixExchangePresignatures(presignResponses, context.request);
  const persistedIds = await readDurablePresignatureIds(page);
  const signingRequests: SigningRequests = { foregroundFills: 0, presignatureIds: [] };
  const collect = collectSigningRequests.bind(undefined, signingRequests);
  context.on('request', collect);
  await context.route(presignInit, rejectPresignatureGeneration);
  try {
    await harness.unlockPasskeyWallet();
    expect(await readDurablePresignatureIds(page)).toEqual(persistedIds);
    await harness.signTempoTransaction('post_unlock');
    expect(signingRequests.presignatureIds).toHaveLength(1);
    expect(persistedIds).toContain(signingRequests.presignatureIds[0]);
    expect(await readDurablePresignatureIds(page)).not.toContain(
      signingRequests.presignatureIds[0],
    );
  } finally {
    context.off('request', collect);
    await context.unroute(presignInit, rejectPresignatureGeneration);
  }
});

async function rejectInitialPresignAdmission(
  counter: { requests: number },
  route: Route,
): Promise<void> {
  counter.requests += 1;
  await route.fulfill({
    status: 401,
    json: { ok: false, code: 'wallet_session_invalid', message: 'Authority publication pending' },
  });
}

function readRequestCount(counter: { requests: number }): number {
  return counter.requests;
}

test('mixed registration reconciles rejected ECDSA refill after deferred authority publication', async ({
  harness,
  context,
  page,
}) => {
  const nearGate = new RegistrationPresignGate();
  const nearProvisioning = '**/wallets/register/near-provisioning';
  const holdNear = nearGate.hold.bind(nearGate);
  const presignInit = '**/router-ab/ecdsa-derivation/presignature-pool/fill/init';
  const rejected = { requests: 0 };
  const rejectInitial = rejectInitialPresignAdmission.bind(undefined, rejected);
  await context.route(nearProvisioning, holdNear);
  await context.route(presignInit, rejectInitial);
  try {
    await harness.registerPasskeyWallet();
    await expect.poll(readRequestCount.bind(undefined, rejected)).toBeGreaterThan(0);
    expect(await readDurablePresignatureCount(page)).toBe(0);
    await context.unroute(presignInit, rejectInitial);
    nearGate.release();
    await harness.awaitNearReady();
    await expect
      .poll(readDurablePresignatureCount.bind(undefined, page), { timeout: 15_000 })
      .toBe(1);
    await harness.signTempoTransaction('post_registration');
  } finally {
    nearGate.release();
    await context.unroute(nearProvisioning, holdNear);
    await context.unroute(presignInit, rejectInitial);
  }
});

const LOCAL_INTENDED_SESSION_ADMISSION_FAULT_HEADER_V1 =
  'x-seams-intended-session-admission-fault-v1';
const LOCAL_INTENDED_SESSION_ADMISSION_FAULT_TOKEN_HEADER_V1 =
  'x-seams-intended-session-admission-fault-token-v1';
const LOCAL_INTENDED_SESSION_ADMISSION_FAULT_PROOF_HEADER_V1 =
  'x-seams-intended-session-admission-fault-proof-v1';

/**
 * Sends the first ECDSA signing prepare with the local Gateway fault that
 * holds it after its Wallet Session read until another request changes the
 * wallet's authority. The response carries the Gateway's proof.
 */
class SignPrepareAdmissionHold {
  private readonly token = randomUUID();
  requests = 0;
  status: number | null = null;
  proof: string | null = null;

  requestCount(): number {
    return this.requests;
  }

  expectedProof(): string {
    return `${this.token}:held_until_authority_changed`;
  }

  async hold(route: Route): Promise<void> {
    const request = route.request();
    if (request.method() !== 'POST' || this.requests > 0) {
      await route.fallback();
      return;
    }
    this.requests += 1;
    const response = await route.fetch({
      headers: {
        ...(await request.allHeaders()),
        [LOCAL_INTENDED_SESSION_ADMISSION_FAULT_HEADER_V1]:
          'hold_after_session_read_until_authority_changes',
        [LOCAL_INTENDED_SESSION_ADMISSION_FAULT_TOKEN_HEADER_V1]: this.token,
      },
    });
    this.status = response.status();
    this.proof = response.headers()[LOCAL_INTENDED_SESSION_ADMISSION_FAULT_PROOF_HEADER_V1] ?? null;
    await route.fulfill({ response });
  }
}

// The first Tempo signature's prepare reads its Wallet Session while NEAR
// provisioning is held, and the Gateway holds it there. Provisioning then
// commits the extended authority and rebinds the session. Admission judges the
// session, authority and method it read together, so the prepare is admitted;
// reading the authority again would pair the session with the newer authority
// and refuse it as a scope mismatch.
test('a signing prepare that read its session before NEAR provisioning committed is admitted', async ({
  harness,
  context,
  page,
}) => {
  const nearGate = new RegistrationPresignGate();
  const nearProvisioning = '**/wallets/register/near-provisioning';
  const holdNear = nearGate.hold.bind(nearGate);
  const signPrepare = '**/router-ab/ecdsa-derivation/sign/prepare';
  const admission = new SignPrepareAdmissionHold();
  const holdAdmission = admission.hold.bind(admission);
  await context.route(nearProvisioning, holdNear);
  await context.route(signPrepare, holdAdmission);
  try {
    await harness.registerPasskeyWallet();
    await expect.poll(nearGate.requestCount.bind(nearGate)).toBeGreaterThan(0);
    await expect(page.getByTestId('intended-e2e-page')).toHaveAttribute(
      'data-login-near-ready',
      'pending',
    );
    const signing = harness.signTempoTransaction('post_registration');
    await expect.poll(admission.requestCount.bind(admission)).toBe(1);
    // The Gateway reads the session as the prepare arrives; only then does
    // provisioning commit.
    await page.waitForTimeout(1_000);
    nearGate.release();
    await signing;
    expect(admission.status).toBe(200);
    expect(admission.proof).toBe(admission.expectedProof());
    await harness.awaitNearReady();
    await harness.signTempoTransaction('post_registration');
  } finally {
    nearGate.release();
    await context.unroute(nearProvisioning, holdNear);
    await context.unroute(signPrepare, holdAdmission);
  }
});

class StalledPresignExchange {
  private steps = 0;
  private held: { request: Request; startedAt: number } | null = null;
  private releaseHeld: () => void = () => {};
  private readonly released = new Promise<void>(this.captureRelease.bind(this));
  private foregroundStarted = false;
  private signingComplete = false;
  private readonly identities = new Set<string>();
  private initializations = 0;
  competingBackgroundInitializations = 0;
  failedAfterMs: number | null = null;

  private captureRelease(resolve: () => void): void {
    this.releaseHeld = resolve;
  }

  async route(route: Route): Promise<void> {
    const request = route.request();
    const body: unknown = request.postDataJSON();
    if (!isPlainObject(body)) throw new Error('Expected a presign request');
    if (new URL(request.url()).pathname.endsWith('/init')) {
      if (typeof body.presignSessionId !== 'string') throw new Error('Missing ceremony identity');
      this.identities.add(body.presignSessionId);
      this.initializations += 1;
      if (body.requestTag === 'foreground_presign_pool_refill') this.foregroundStarted = true;
      else if (this.foregroundStarted && !this.signingComplete) {
        this.competingBackgroundInitializations += 1;
      }
    } else {
      this.steps += 1;
      if (this.steps === 3) {
        this.held = { request, startedAt: Date.now() };
        await this.released;
        await route.abort('aborted');
        return;
      }
    }
    await route.continue();
  }

  requestFailed(request: Request): void {
    if (this.held?.request !== request) return;
    this.failedAfterMs = Date.now() - this.held.startedAt;
    this.release();
  }

  response(response: Response): void {
    if (response.ok() && new URL(response.url()).pathname === '/router-ab/ecdsa-derivation/sign') {
      this.signingComplete = true;
    }
  }

  isHeld(): boolean {
    return this.held !== null;
  }

  usesFreshRecoveryIdentity(): boolean {
    return (
      this.foregroundStarted &&
      this.initializations >= 2 &&
      this.identities.size === this.initializations
    );
  }

  release(): void {
    this.releaseHeld();
  }
}

test('immediate signing aborts a stalled refill and recovers without competing background generation', async ({
  harness,
  context,
}) => {
  const stalled = new StalledPresignExchange();
  const route = stalled.route.bind(stalled);
  const requestFailed = stalled.requestFailed.bind(stalled);
  const response = stalled.response.bind(stalled);
  const fill = '**/router-ab/ecdsa-derivation/presignature-pool/fill/*';
  context.on('requestfailed', requestFailed);
  context.on('response', response);
  await context.route(fill, route);
  try {
    await harness.registerPasskeyWallet();
    await expect.poll(stalled.isHeld.bind(stalled), { timeout: 15_000 }).toBe(true);
    await harness.signTempoTransaction('post_registration');
    expect(stalled.failedAfterMs).not.toBeNull();
    expect(stalled.failedAfterMs).toBeLessThan(7_500);
    expect(stalled.usesFreshRecoveryIdentity()).toBe(true);
    expect(stalled.competingBackgroundInitializations).toBe(0);
  } finally {
    stalled.release();
    context.off('requestfailed', requestFailed);
    context.off('response', response);
    await context.unroute(fill, route);
  }
});

test('sustained Tempo and Arc signing uses fresh presignatures beyond pool capacity', async ({
  harness,
  context,
}) => {
  const requests: SigningRequests = { foregroundFills: 0, presignatureIds: [] };
  const collect = collectSigningRequests.bind(undefined, requests);
  const presignResponses: Response[] = [];
  const collectResponses = collectPresignResponses.bind(undefined, presignResponses);
  context.on('request', collect);
  context.on('response', collectResponses);
  try {
    await harness.registerPasskeyWallet();
    let stage: IntendedSigningStage = 'post_registration';
    for (let index = 0; index < 10; index += 1) {
      const tempo = await harness.signTempoTransaction(stage);
      if (index === 0) expect(requests.foregroundFills).toBeLessThanOrEqual(1);
      // Warm-session events report the allowance before this signature consumes a use.
      if (tempo.remainingUses.some(isLastWarmSessionUse)) stage = 'step_up_required';
      const arc = await harness.signArcEvmTransaction(stage);
      if (arc.remainingUses.some(isLastWarmSessionUse)) stage = 'step_up_required';
    }
    expect(requests.presignatureIds).toHaveLength(20);
    expect(new Set(requests.presignatureIds).size).toBe(20);
    expect(stage).toBe('step_up_required');
    expect(presignResponses.length).toBeGreaterThan(0);
    for (const response of presignResponses) await assertPresignResponseTiming(response);

    // Live-session refill can supply every step-up signature. Drain it explicitly
    // to exercise operation-bound generation and its rejection checks as well.
    const presignFill = '**/router-ab/ecdsa-derivation/presignature-pool/fill/*';
    await context.route(presignFill, rejectReusablePresignRefill);
    try {
      // Allow for the full pool and one generation already completing in flight.
      for (let index = 0; index < ECDSA_CLIENT_PRESIGNATURE_CAPACITY + 2; index += 1) {
        if (presignResponses.some(isStepUpPresignResponse)) break;
        await harness.signTempoTransaction('step_up_required');
      }
    } finally {
      await context.unroute(presignFill, rejectReusablePresignRefill);
    }
    const stepUpResponse = presignResponses.find(isStepUpPresignResponse);
    if (!stepUpResponse) throw new Error('An empty pool must exercise step-up presign generation');
    await assertChangedPresignOperationRejected(
      context.request,
      stepUpResponse.request(),
      'key_handle',
    );
    await assertChangedPresignOperationRejected(
      context.request,
      stepUpResponse.request(),
      'expires_at_ms',
    );
  } finally {
    context.off('request', collect);
    context.off('response', collectResponses);
  }
});

/**
 * A Wallet Session status the Gateway answered before deferred NEAR
 * provisioning finalized reaches the wallet while provisioning publishes the
 * extended authority and rebinds the session with it. The Workers D1 run that
 * failed "exact ECDSA Wallet Session is unavailable: wallet_session_identity_
 * mismatch (authority digest)" had that older status written over the
 * rebound session. Here the order is forced: the wallet's re-read of its
 * authority, taken for the step-up's status, waits behind a transaction on
 * its auth-method store until provisioning's publication has queued behind
 * it too, so the publication commits between the re-read and the write. The
 * older status must not replace the session: provisioning becomes ready and
 * the ECDSA step-up signs.
 */
test('a Wallet Session status answered before deferred NEAR provisioning keeps the session it rebound', async ({
  harness,
  context,
  page,
}) => {
  const nearGate = new RegistrationPresignGate();
  const nearProvisioning = '**/wallets/register/near-provisioning';
  const holdNear = nearGate.hold.bind(nearGate);
  await context.route(nearProvisioning, holdNear);
  try {
    await harness.registerPasskeyWallet();
    let stage: IntendedSigningStage = 'post_registration';
    for (let index = 0; index < 20 && stage !== 'step_up_required'; index += 1) {
      const tempo = await harness.signTempoTransaction(stage);
      // Warm-session events report the allowance before this signature consumes a use.
      if (tempo.remainingUses.some(isLastWarmSessionUse)) stage = 'step_up_required';
    }
    expect(stage).toBe('step_up_required');
    await expect.poll(nearGate.requestCount.bind(nearGate), { timeout: 30_000 }).toBe(1);
    const statusAnswers = await harness.holdWalletSessionStatusAnswers();
    let interleaving: Promise<void> = Promise.resolve();
    const interleave = async (): Promise<void> => {
      // The step-up asks for its Wallet Session's status; the Gateway answers.
      await expect.poll(statusAnswers.heldCount, { timeout: 10_000 }).toBeGreaterThan(0);
      const authMethods = await harness.holdWalletIndexedDbStore('wallet_auth_methods');
      // The answer arrives, and the wallet's re-read of its authority waits.
      statusAnswers.release();
      await page.waitForTimeout(50);
      // Provisioning finalizes, and its publication queues behind that re-read.
      nearGate.release();
      await harness.waitForTraceConsoleMessage('"stage":"server_finalize"');
      await page.waitForTimeout(50);
      await authMethods.release();
    };
    try {
      await harness.signArcEvmTransaction('step_up_required', {
        onActionStarted: () => {
          interleaving = interleave();
        },
      });
    } finally {
      await statusAnswers.dispose();
    }
    await interleaving;
    await harness.awaitNearReady();
    await harness.signTempoTransaction('step_up_required');
  } finally {
    nearGate.release();
    await context.unroute(nearProvisioning, holdNear);
  }
});

test('EVM registration and signatures complete while NEAR admission is held', async ({
  harness,
  context,
}) => {
  await assertIndependentNearRegistration({
    harness,
    context,
    factor: 'passkey',
    path: ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1,
  });
});

test('EVM registration and signatures complete while NEAR execution is held', async ({
  harness,
  context,
}) => {
  await assertIndependentNearRegistration({
    harness,
    context,
    factor: 'passkey',
    path: ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1,
  });
});
