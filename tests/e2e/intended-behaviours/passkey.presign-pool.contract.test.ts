import { expect, type Request, type Response, type Route } from '@playwright/test';
import { intendedTest as test } from './harness';
import { isPlainObject } from '../../../packages/shared-ts/src/utils/validation';
import { parseEcdsaServerTiming } from '../../../packages/shared-ts/src/utils/ecdsaServerTiming';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

type PresignRefillTag = 'background' | 'foreground' | 'unidentified';
type PresignRefillRoute = 'init' | 'step';

function presignRefillTag(request: Request): PresignRefillTag {
  const body: unknown = request.postDataJSON();
  if (!isPlainObject(body)) return 'unidentified';
  if (body.requestTag === 'background_presign_pool_refill') return 'background';
  if (body.requestTag === 'foreground_presign_pool_refill') return 'foreground';
  return 'unidentified';
}

class FirstSigningPoolFlow {
  private releaseGate: () => void = () => {};
  private readonly released = new Promise<void>(this.captureRelease.bind(this));
  private readonly gatewayOrigin = new URL(
    process.env.SEAMS_INTENDED_ROUTER_URL || 'http://127.0.0.1:4100',
  ).origin;
  private readonly gatewayRequests: { readonly path: string; readonly atMs: number }[] = [];
  private readonly presignRefillRequests: {
    readonly route: PresignRefillRoute;
    readonly tag: PresignRefillTag;
    readonly atMs: number;
  }[] = [];
  private readonly gatewayResponses: {
    readonly path: string;
    readonly atMs: number;
    readonly response: Response;
  }[] = [];
  initializations = 0;
  terminalPrepares = 0;
  ordinaryPrepares = 0;
  finalizations = 0;
  completedStepsBeforePrepare = 0;
  preparePresignatureId: string | null = null;
  readonly stepResponses: Response[] = [];

  private captureRelease(resolve: () => void): void {
    this.releaseGate = resolve;
  }

  async holdInit(route: Route): Promise<void> {
    this.initializations += 1;
    await this.released;
    await route.continue();
  }

  release(): void {
    this.releaseGate();
  }
  observed(): number {
    return this.initializations;
  }

  record(request: Request): void {
    const url = new URL(request.url());
    const path = url.pathname;
    if (url.origin === this.gatewayOrigin) {
      const atMs = performance.now();
      this.gatewayRequests.push({ path, atMs });
      if (path === '/router-ab/ecdsa-derivation/presignature-pool/fill/init') {
        this.presignRefillRequests.push({ route: 'init', tag: presignRefillTag(request), atMs });
      } else if (path === '/router-ab/ecdsa-derivation/presignature-pool/fill/step') {
        this.presignRefillRequests.push({ route: 'step', tag: presignRefillTag(request), atMs });
      }
    }
    if (path === '/router-ab/ecdsa-derivation/sign/prepare') {
      const body: unknown = request.postDataJSON();
      if (!isPlainObject(body)) throw new Error('Expected an ECDSA prepare body');
      if (isPlainObject(body.presign_source) && body.presign_source.kind === 'final_presign_batch') {
        this.terminalPrepares += 1;
      } else {
        this.ordinaryPrepares += 1;
      }
      this.completedStepsBeforePrepare = this.stepResponses.length;
      if (typeof body.client_presignature_id !== 'string') {
        throw new Error('ECDSA prepare omitted its material identity');
      }
      this.preparePresignatureId = body.client_presignature_id;
    }
    if (path === '/router-ab/ecdsa-derivation/sign') this.finalizations += 1;
  }

  recordResponse(response: Response): void {
    const url = new URL(response.url());
    if (url.origin === this.gatewayOrigin) {
      this.gatewayResponses.push({ path: url.pathname, atMs: performance.now(), response });
    }
    if (
      response.ok() &&
      url.pathname === '/router-ab/ecdsa-derivation/presignature-pool/fill/step'
    ) {
      this.stepResponses.push(response);
    }
  }

  async completedPresignatureId(): Promise<string | null> {
    for (const response of this.stepResponses.slice(0, this.completedStepsBeforePrepare)) {
      const body: unknown = await response.json();
      if (isPlainObject(body) && body.event === 'presign_done') {
        if (typeof body.presignatureId !== 'string') {
          throw new Error('Completed presign response omitted its material identity');
        }
        if (body.presignatureId === this.preparePresignatureId) return body.presignatureId;
      }
    }
    return null;
  }

  gatewayRequestCounts(startedAtMs: number, endedAtMs: number): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const request of this.gatewayRequests) {
      if (request.atMs < startedAtMs || request.atMs > endedAtMs) continue;
      counts[request.path] = (counts[request.path] ?? 0) + 1;
    }
    return counts;
  }

  presignRefillRequestCounts(startedAtMs: number, endedAtMs: number): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const request of this.presignRefillRequests) {
      if (request.atMs < startedAtMs || request.atMs > endedAtMs) continue;
      const key = `${request.tag}_${request.route}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }

  async gatewayServerTimings(startedAtMs: number, endedAtMs: number): Promise<{
    path: string;
    status: number;
    stagesMs: Record<string, number>;
  }[]> {
    const timings = [];
    for (const entry of this.gatewayResponses) {
      if (entry.atMs < startedAtMs || entry.atMs > endedAtMs) continue;
      const stages = parseEcdsaServerTiming(await entry.response.headerValue('Server-Timing'));
      if (stages.size === 0) continue;
      timings.push({
        path: entry.path,
        status: entry.response.status(),
        stagesMs: Object.fromEntries(stages),
      });
    }
    return timings;
  }
}

test('first ECDSA signing completes Gateway pool fill before available-pool prepare', async ({
  harness,
  context,
  page,
}, testInfo) => {
  const flow = new FirstSigningPoolFlow();
  const initPath = '**/router-ab/ecdsa-derivation/presignature-pool/fill/init';
  const hold = flow.holdInit.bind(flow);
  const record = flow.record.bind(flow);
  const recordResponse = flow.recordResponse.bind(flow);
  await context.route(initPath, hold);
  context.on('request', record);
  context.on('response', recordResponse);
  try {
    await harness.registerPasskeyWallet();
    await expect.poll(flow.observed.bind(flow)).toBeGreaterThan(0);
    const signingStartedAt = performance.now();
    const signing = harness.signTempoTransaction('post_registration');
    // Hold generation while the confirmed transaction reaches the empty-pool wait.
    await page.waitForTimeout(150);
    flow.release();
    await signing;
    const signingEndedAt = performance.now();
    const signingElapsedMs = signingEndedAt - signingStartedAt;
    expect(flow.terminalPrepares).toBe(0);
    expect(flow.ordinaryPrepares).toBe(1);
    expect(flow.finalizations).toBe(1);
    expect(flow.completedStepsBeforePrepare).toBeGreaterThan(0);
    const completedPresignatureId = await flow.completedPresignatureId();
    expect(completedPresignatureId).toBe(flow.preparePresignatureId);
    const gatewayRequestCounts = flow.gatewayRequestCounts(signingStartedAt, signingEndedAt);
    const gatewayServerTimings = await flow.gatewayServerTimings(signingStartedAt, signingEndedAt);
    expect(
      gatewayRequestCounts['/router-ab/ecdsa-derivation/presignature-pool/fill/step'],
    ).toBeGreaterThan(0);
    await harness.assertRegistrationOwnerSessionIsActive();
    const proof = {
      kind: 'gateway_ecdsa_pool_completion_before_signing_e2e_v1',
      reproduce:
        "node tests/scripts/run-wallet-intended-isolated.mjs -- e2e/intended-behaviours/passkey.presign-pool.contract.test.ts --grep 'first ECDSA signing completes Gateway pool fill'",
      completedPresignatureId,
      completedStepsBeforePrepare: flow.completedStepsBeforePrepare,
      signingElapsedMs,
      timingPurpose: 'correctness_diagnostic_with_forced_150_ms_gate',
      gatewayRequestScope: 'all_requests_during_signing_including_background_work',
      gatewayRequestCounts,
      gatewayServerTimings,
      ordinaryPrepares: flow.ordinaryPrepares,
      terminalPrepares: flow.terminalPrepares,
      finalizations: flow.finalizations,
      signatureVerified: true,
    };
    const artifactPath = path.resolve(
      testInfo.config.rootDir,
      '../.artifacts/r150/gateway-ecdsa-pool-completion-before-signing.json',
    );
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, JSON.stringify(proof, null, 2), 'utf8');
    await testInfo.attach('gateway-ecdsa-pool-completion-before-signing.json', {
      body: JSON.stringify(proof, null, 2),
      contentType: 'application/json',
    });
  } finally {
    flow.release();
    context.off('request', record);
    context.off('response', recordResponse);
    await context.unroute(initPath, hold);
  }
});

test('unforced ECDSA registration and repeated signing capture Gateway timing', async ({
  harness,
  context,
}, testInfo) => {
  const requestedBackendProfile = requestedEcdsaBackendProfile();
  const hostedBenchmark = process.env.SEAMS_INTENDED_EXTERNAL_GATEWAY === '1';
  const probeRegion = hostedBenchmark
    ? process.env.SEAMS_INTENDED_PROBE_REGION
    : 'local';
  if (!probeRegion || !/^[a-z0-9-]+$/u.test(probeRegion)) {
    throw new Error('Hosted benchmark probe region is missing or invalid');
  }
  const runId = hostedBenchmark ? process.env.SEAMS_INTENDED_BENCHMARK_RUN_ID : 'local';
  if (!runId || !/^[a-z0-9-]+$/u.test(runId)) {
    throw new Error('Hosted benchmark run id is missing or invalid');
  }
  const flow = new FirstSigningPoolFlow();
  const record = flow.record.bind(flow);
  const recordResponse = flow.recordResponse.bind(flow);
  context.on('request', record);
  context.on('response', recordResponse);
  try {
    const registrationStartedAt = performance.now();
    await harness.registerPasskeyWallet();
    const registrationEndedAt = performance.now();

    const firstSigningStartedAt = performance.now();
    await harness.signTempoTransaction('post_registration');
    const firstSigningEndedAt = performance.now();

    const subsequentSigningStartedAt = performance.now();
    await harness.signTempoTransaction('post_registration');
    const subsequentSigningEndedAt = performance.now();

    const proof = {
      kind: hostedBenchmark
        ? 'gateway_ecdsa_unforced_hosted_timing_pilot_v1'
        : 'gateway_ecdsa_unforced_local_timing_diagnostic_v1',
      reproduce: hostedBenchmark
        ? "pnpm -C tests exec playwright test -c playwright.wallet-intended.ci.config.ts e2e/intended-behaviours/passkey.presign-pool.contract.test.ts --grep 'unforced ECDSA registration and repeated signing'"
        : "node tests/scripts/run-wallet-intended-isolated.mjs -- e2e/intended-behaviours/passkey.presign-pool.contract.test.ts --grep 'unforced ECDSA registration and repeated signing'",
      requestedBackendProfile,
      probeRegion,
      runId,
      repeatEachIndex: testInfo.repeatEachIndex,
      gatewayOrigin: new URL(process.env.SEAMS_INTENDED_ROUTER_URL || 'http://127.0.0.1:4100')
        .origin,
      sampleCountPerStage: 1,
      timingPurpose: hostedBenchmark
        ? 'hosted_pilot_not_release_gate'
        : 'local_diagnostic_not_release_gate',
      requestScope: 'all_gateway_requests_in_each_window_including_background_work',
      registrationReturn: {
        elapsedMs: registrationEndedAt - registrationStartedAt,
        gatewayRequestCounts: flow.gatewayRequestCounts(registrationStartedAt, registrationEndedAt),
        presignRefillRequestCounts: flow.presignRefillRequestCounts(
          registrationStartedAt,
          registrationEndedAt,
        ),
        gatewayServerTimings: await flow.gatewayServerTimings(
          registrationStartedAt,
          registrationEndedAt,
        ),
      },
      firstSigning: {
        elapsedMs: firstSigningEndedAt - firstSigningStartedAt,
        gatewayRequestCounts: flow.gatewayRequestCounts(firstSigningStartedAt, firstSigningEndedAt),
        presignRefillRequestCounts: flow.presignRefillRequestCounts(
          firstSigningStartedAt,
          firstSigningEndedAt,
        ),
        gatewayServerTimings: await flow.gatewayServerTimings(
          firstSigningStartedAt,
          firstSigningEndedAt,
        ),
      },
      subsequentSigning: {
        elapsedMs: subsequentSigningEndedAt - subsequentSigningStartedAt,
        gatewayRequestCounts: flow.gatewayRequestCounts(
          subsequentSigningStartedAt,
          subsequentSigningEndedAt,
        ),
        presignRefillRequestCounts: flow.presignRefillRequestCounts(
          subsequentSigningStartedAt,
          subsequentSigningEndedAt,
        ),
        gatewayServerTimings: await flow.gatewayServerTimings(
          subsequentSigningStartedAt,
          subsequentSigningEndedAt,
        ),
      },
      signaturesVerified: 2,
    };
    const artifactName = hostedBenchmark
      ? `gateway-ecdsa-unforced-timing-${requestedBackendProfile}-${probeRegion}-${runId}-${testInfo.repeatEachIndex}.json`
      : `gateway-ecdsa-unforced-local-timing-${requestedBackendProfile}.json`;
    const artifactPath = path.resolve(testInfo.config.rootDir, '../.artifacts/r150', artifactName);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, JSON.stringify(proof, null, 2), 'utf8');
    await testInfo.attach(artifactName, {
      body: JSON.stringify(proof, null, 2),
      contentType: 'application/json',
    });
  } finally {
    context.off('request', record);
    context.off('response', recordResponse);
  }
});

function requestedEcdsaBackendProfile(): string {
  if (process.env.SEAMS_INTENDED_EXTERNAL_GATEWAY === '1') {
    const arm = process.env.SEAMS_INTENDED_BENCHMARK_ARM;
    if (arm !== 'd1' && arm !== 'do') {
      throw new Error('Hosted benchmark backend arm must be d1 or do');
    }
    return `hosted_${arm}`;
  }
  const walletDoRequested =
    process.env.ROUTER_AB_WORKER_BUILD_PROFILE === 'dev' &&
    process.env.ROUTER_AB_WALLET_DO_HARNESS === 'enabled';
  return walletDoRequested ? 'local_wallet_do_harness_requested' : 'local_default_d1';
}

async function interruptAdmittedPrepare(
  harness: import('./harness').IntendedBehaviourHarness,
  mode: 'lost_response' | 'cancelled',
  counter: { admitted: number },
  route: Route,
): Promise<void> {
  const response = await route.fetch();
  expect(response.status()).toBe(200);
  counter.admitted += 1;
  if (mode === 'cancelled') await harness.lockWallet();
  await route.abort('connectionclosed');
}

for (const mode of ['lost_response', 'cancelled'] as const) {
  test(`admitted available-pool prepare ${mode} does not restart signing`, async ({
    harness,
    context,
    page,
  }) => {
    const batch = new FirstSigningPoolFlow();
    const counter = { admitted: 0 };
    const initPath = '**/router-ab/ecdsa-derivation/presignature-pool/fill/init';
    const preparePath = '**/router-ab/ecdsa-derivation/sign/prepare';
    const hold = batch.holdInit.bind(batch);
    const interrupt = interruptAdmittedPrepare.bind(undefined, harness, mode, counter);
    const record = batch.record.bind(batch);
    await context.route(initPath, hold);
    await context.route(preparePath, interrupt);
    context.on('request', record);
    try {
      await harness.registerPasskeyWallet();
      await expect.poll(batch.observed.bind(batch)).toBeGreaterThan(0);
      const signing = harness.signTempoTransaction('post_registration');
      const rejected = expect(signing).rejects.toThrow();
      await page.waitForTimeout(150);
      batch.release();
      await rejected;
      expect(counter.admitted).toBe(1);
      expect(batch.terminalPrepares).toBe(0);
      expect(batch.ordinaryPrepares).toBe(1);
      expect(batch.finalizations).toBe(0);
      if (mode === 'cancelled') await harness.assertWalletLocked();
    } finally {
      batch.release();
      context.off('request', record);
      await context.unroute(initPath, hold);
      await context.unroute(preparePath, interrupt);
    }
  });
}

class LostFinalize {
  finalizations = 0;
  lost: { readonly request: Request; readonly status: number; readonly body: string } | null =
    null;

  /** Lets the first finalize complete, then drops its response. */
  async loseFirstResponse(route: Route): Promise<void> {
    this.finalizations += 1;
    if (this.lost) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    this.lost = { request: route.request(), status: response.status(), body: await response.text() };
    await route.abort('connectionclosed');
  }
}

/** The part of Node's `node:sqlite` this evidence reads. */
type NodeSqliteModule = {
  readonly DatabaseSync: new (
    path: string,
    options: { readonly readOnly: boolean },
  ) => {
    prepare(sql: string): { all(...parameters: string[]): Record<string, unknown>[] };
    close(): void;
  };
};

/**
 * One wallet's signing effects at the VM SigningWorker, read from its
 * role-private SQLite file. Each effect claims and consumes exactly one
 * presignature in the same transaction, so the effect count is the
 * consumed-presignature count.
 */
async function vmSigningWorkerEffects(walletId: string): Promise<
  { readonly operationKey: string; readonly terminal: unknown }[] | null
> {
  const root = process.env.SEAMS_INTENDED_ROUTER_AB_ROOT;
  if (process.env.SEAMS_INTENDED_WALLET_HOST !== 'vm' || !root) return null;
  // The suite's Node types predate `node:sqlite`; the runtime provides it.
  const sqliteModule: string = 'node:sqlite';
  const { DatabaseSync } = (await import(sqliteModule)) as NodeSqliteModule;
  const database = new DatabaseSync(
    path.join(root, '.router-ab-local', 'signing-worker', 'role-private.sqlite'),
    { readOnly: true },
  );
  try {
    return database
      .prepare(
        `SELECT operation_key, terminal_json FROM wallet_ecdsa_effects
         WHERE json_extract(owner_json, '$.wallet_id') = ? ORDER BY claimed_at_ms`,
      )
      .all(walletId)
      .map((row) => ({
        operationKey: String(row.operation_key),
        terminal: row.terminal_json === null ? null : JSON.parse(String(row.terminal_json)),
      }));
  } finally {
    database.close();
  }
}

test('admitted ECDSA finalize lost_response retry returns the stored signature', async ({
  harness,
  context,
}, testInfo) => {
  const finalizePath = '**/router-ab/ecdsa-derivation/sign';
  const lostFinalize = new LostFinalize();
  const lose = lostFinalize.loseFirstResponse.bind(lostFinalize);
  await context.route(finalizePath, lose);
  try {
    await harness.registerPasskeyWallet();
    await expect(harness.signTempoTransaction('post_registration')).rejects.toThrow();
  } finally {
    await context.unroute(finalizePath, lose);
  }
  const lost = lostFinalize.lost;
  if (!lost) throw new Error('The finalize request was never admitted');
  expect(lostFinalize.finalizations).toBe(1);
  expect(lost.status).toBe(200);
  const signature: unknown = JSON.parse(lost.body);
  if (!isPlainObject(signature) || !isPlainObject(signature.scope)) {
    throw new Error('Expected an ECDSA signing response');
  }
  const walletId = signature.scope.wallet_id;
  if (typeof walletId !== 'string') throw new Error('ECDSA signing response omitted its wallet');

  // The client's exact retry after the lost response returns the stored
  // signature rather than signing again.
  const retried = await context.request.fetch(lost.request);
  expect(retried.status()).toBe(200);
  expect(await retried.json()).toEqual(signature);
  // On the VM, the SigningWorker recorded one effect for this signing, with
  // the returned signature as its terminal response: the retry claimed and
  // consumed nothing.
  const effectsAfterRetry = await vmSigningWorkerEffects(walletId);
  if (effectsAfterRetry) {
    expect(effectsAfterRetry).toHaveLength(1);
    expect(effectsAfterRetry[0]?.terminal).toEqual(signature);
  }

  const evidence = {
    kind: 'gateway_ecdsa_finalize_lost_response_retry_v1',
    host: process.env.SEAMS_INTENDED_WALLET_HOST ?? 'workers_local',
    finalizationsAdmitted: lostFinalize.finalizations,
    lostResponseStatus: lost.status,
    retriedStatus: retried.status(),
    retriedMatchesLost: true,
    signingWorkerEffectsAfterRetry: effectsAfterRetry?.length ?? null,
    signingWorkerTerminalMatchesRetry: effectsAfterRetry ? true : null,
  };
  const artifactName = `gateway-ecdsa-finalize-lost-response-${evidence.host}.json`;
  const artifactPath = path.resolve(testInfo.config.rootDir, '../.artifacts/r150', artifactName);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, JSON.stringify(evidence, null, 2), 'utf8');
  await testInfo.attach(artifactName, {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
});
