import { assertIndependentNearRegistration } from './registration-near-gate';
import { ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1, ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1 } from '@shared/utils/routerAbEd25519Yao';
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
import { isHex, parseTransaction, recoverTransactionAddress } from 'viem';

test('custom review requires wallet approval before a live Arc signature', async ({
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
    await expect.poll(nearGate.requestCount.bind(nearGate)).toBeGreaterThan(0);
    const pageRoot = page.getByTestId('intended-e2e-page');
    await expect(pageRoot).toHaveAttribute('data-login-near-ready', 'pending');
    const registration = JSON.parse(await page.getByTestId('intended-result-json').innerText());
    const expectedAddress =
      registration.action.result.ecdsaTargetKeys.arcEvm.thresholdOwnerAddress;
    expect(typeof expectedAddress).toBe('string');
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
  } finally {
    nearGate.release();
    await context.unroute(nearProvisioning, holdNear);
  }
});

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
    'ecdsa_presign_queue',
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

async function rejectInitialPresignAdmission(counter: { requests: number }, route: Route): Promise<void> {
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
    await expect.poll(readDurablePresignatureCount.bind(undefined, page), { timeout: 15_000 })
      .toBe(1);
    await harness.signTempoTransaction('post_registration');
  } finally {
    nearGate.release();
    await context.unroute(nearProvisioning, holdNear);
    await context.unroute(presignInit, rejectInitial);
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
    return this.foregroundStarted && this.initializations >= 2 &&
      this.identities.size === this.initializations;
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

test('EVM registration and signatures complete while NEAR admission is held', async ({ harness, context }) => {
  await assertIndependentNearRegistration({ harness, context, factor: 'passkey', path: ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1 });
});

test('EVM registration and signatures complete while NEAR execution is held', async ({ harness, context }) => {
  await assertIndependentNearRegistration({ harness, context, factor: 'passkey', path: ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1 });
});
