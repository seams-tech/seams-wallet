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
  page,
}) => {
  await harness.registerPasskeyWallet();
  const registration = JSON.parse(await page.getByTestId('intended-result-json').innerText());
  const expectedAddress = registration.action.result.ecdsaTargetKeys.arcEvm.thresholdOwnerAddress;
  expect(typeof expectedAddress).toBe('string');
  const result = page.getByTestId('reviewed-signing-result');
  await page.getByRole('button', { name: 'Review Arc testnet signature', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Review testnet signature', exact: true }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Review note' }).fill('Live MPC acceptance');
  await expect(result).toHaveAttribute('data-state', 'pending');
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  const confirm = wallet
    .locator('#seams-confirm-portal button.btn-confirm, #seams-confirm-portal button.confirm')
    .last();
  await expect(confirm).toBeHidden();
  await page.getByRole('button', { name: 'Continue to wallet', exact: true }).click();
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
      const request = db.transaction('ecdsa_client_presignatures', 'readonly')
        .objectStore('ecdsa_client_presignatures').getAll();
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
  await expect.poll(readDurablePresignatureCount.bind(undefined, page), { timeout: 30_000 })
    .toBeGreaterThan(0);
  await harness.signTempoTransaction('post_registration');
  await harness.awaitNearReady();
  await harness.signNearTransaction('post_registration');
  await harness.signArcEvmTransaction('post_registration');
  await harness.assertRegistrationOwnerSessionIsActive();
  await expect.poll(readDurablePresignatureCount.bind(undefined, page), { timeout: 30_000 })
    .toBe(ECDSA_CLIENT_PRESIGNATURE_CAPACITY);
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
    expect(await readDurablePresignatureIds(page))
      .not.toContain(signingRequests.presignatureIds[0]);
  } finally {
    context.off('request', collect);
    await context.unroute(presignInit, rejectPresignatureGeneration);
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
    if (!stepUpResponse)
      throw new Error('An empty pool must exercise step-up presign generation');
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
