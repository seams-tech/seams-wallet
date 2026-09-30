import {
  expect,
  type BrowserContext,
  type Request,
  type Response,
  type Route,
  type TestInfo,
} from '@playwright/test';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';
import { isPlainObject } from '../../../packages/shared-ts/src/utils/validation';
import { parseEcdsaServerTiming } from '../../../packages/shared-ts/src/utils/ecdsaServerTiming';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

type PresignRefillTag = 'background' | 'foreground' | 'unidentified';
type PresignRefillRoute = 'init' | 'step';
type PresignCompletion =
  | { kind: 'observed'; presignatureId: string | null }
  | { kind: 'unavailable'; message: string };

async function readPresignCompletion(response: Response): Promise<PresignCompletion> {
  try {
    const body: unknown = await response.json();
    if (!isPlainObject(body)) throw new Error('Expected a presign step response');
    if (body.event !== 'presign_done') return { kind: 'observed', presignatureId: null };
    if (typeof body.presignatureId !== 'string') {
      throw new Error('Completed presign response omitted its material identity');
    }
    return { kind: 'observed', presignatureId: body.presignatureId };
  } catch (error) {
    return { kind: 'unavailable', message: error instanceof Error ? error.message : String(error) };
  }
}

function observedPresignatureId(completion: PresignCompletion): string | null {
  if (completion.kind === 'unavailable') throw new Error(completion.message);
  return completion.presignatureId;
}

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
  readonly stepResponses: Promise<PresignCompletion>[] = [];
  readonly preparedPresignatures: string[] = [];

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
    if (request.method() !== 'POST') return;
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
      this.preparedPresignatures.push(body.client_presignature_id);
    }
    if (path === '/router-ab/ecdsa-derivation/sign') this.finalizations += 1;
  }

  recordResponse(response: Response): void {
    if (response.request().method() !== 'POST') return;
    const url = new URL(response.url());
    if (url.origin === this.gatewayOrigin) {
      this.gatewayResponses.push({ path: url.pathname, atMs: performance.now(), response });
    }
    if (
      response.ok() &&
      url.pathname === '/router-ab/ecdsa-derivation/presignature-pool/fill/step'
    ) {
      this.stepResponses.push(readPresignCompletion(response));
    }
  }

  async completedPresignatureId(): Promise<string | null> {
    for (const completion of this.stepResponses.slice(0, this.completedStepsBeforePrepare)) {
      const id = observedPresignatureId(await completion);
      if (id && id === this.preparePresignatureId) return id;
    }
    return null;
  }

  async unusedServerPresignatures(): Promise<string[]> {
    const consumed = new Set(this.preparedPresignatures);
    const available = [];
    for (const completion of this.stepResponses) {
      const id = observedPresignatureId(await completion);
      if (id && !consumed.has(id)) available.push(id);
    }
    return available;
  }

  async unusedServerPresignatureCount(): Promise<number> {
    return (await this.unusedServerPresignatures()).length;
  }

  async timingWindow(startedAtMs: number, endedAtMs: number) {
    return {
      elapsedMs: endedAtMs - startedAtMs,
      gatewayRequestCounts: this.gatewayRequestCounts(startedAtMs, endedAtMs),
      presignRefillRequestCounts: this.presignRefillRequestCounts(startedAtMs, endedAtMs),
      gatewayServerTimings: await this.gatewayServerTimings(startedAtMs, endedAtMs),
    };
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
    d1: unknown;
  }[]> {
    const timings = [];
    for (const entry of this.gatewayResponses) {
      if (entry.atMs < startedAtMs || entry.atMs > endedAtMs) continue;
      const stages = parseEcdsaServerTiming(await entry.response.headerValue('Server-Timing'));
      const d1Header = await entry.response.headerValue('X-Benchmark-D1');
      if (stages.size === 0 && d1Header === null) continue;
      timings.push({
        path: entry.path,
        status: entry.response.status(),
        stagesMs: Object.fromEntries(stages),
        d1: d1Header === null ? null : JSON.parse(d1Header),
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
  if (process.env.SEAMS_INTENDED_WALLET_HOST === 'vm') return 'local_vm';
  const walletDoRequested =
    process.env.ROUTER_AB_WORKER_BUILD_PROFILE === 'dev' &&
    process.env.ROUTER_AB_WALLET_DO_HARNESS === 'enabled';
  return walletDoRequested ? 'local_wallet_do_harness_requested' : 'local_default_d1';
}

async function measureFirstWarmAndBurstSigning({
  harness,
  context,
}: {
  harness: IntendedBehaviourHarness;
  context: BrowserContext;
}, testInfo: TestInfo): Promise<void> {
  const flow = new FirstSigningPoolFlow();
  const record = flow.record.bind(flow);
  const recordResponse = flow.recordResponse.bind(flow);
  context.on('request', record);
  context.on('response', recordResponse);
  try {
    await harness.registerPasskeyWallet();
    const firstStartedAt = performance.now();
    await harness.signTempoTransaction('post_registration');
    const firstEndedAt = performance.now();
    const firstSigning = await flow.timingWindow(firstStartedAt, firstEndedAt);

    await expect.poll(flow.unusedServerPresignatureCount.bind(flow), {
      timeout: 60_000,
    }).toBeGreaterThan(0);
    const readyBeforeWarm = await flow.unusedServerPresignatures();
    const warmStartedAt = performance.now();
    await harness.signTempoTransaction('post_registration');
    const warmEndedAt = performance.now();
    expect(readyBeforeWarm).toContain(flow.preparePresignatureId);
    const warmSigning = await flow.timingWindow(warmStartedAt, warmEndedAt);

    // A fresh three-use session leaves exactly two uses for the concurrent burst.
    await harness.awaitNearReady();
    await harness.unlockPasskeyWallet();
    await harness.signTempoTransaction('post_unlock');
    const readyBeforeBurst = new Set(await flow.unusedServerPresignatures());
    const burstPrepareStart = flow.preparedPresignatures.length;
    const burstStartedAt = performance.now();
    await harness.signTempoAndArcEvmConcurrently('post_unlock');
    const burstEndedAt = performance.now();
    const burstPresignatures = flow.preparedPresignatures.slice(burstPrepareStart);
    expect(burstPresignatures).toHaveLength(2);
    let burstMaterialReadyAtStart = 0;
    for (const id of burstPresignatures) {
      if (readyBeforeBurst.has(id)) burstMaterialReadyAtStart += 1;
    }
    expect(flow.ordinaryPrepares).toBe(5);
    expect(flow.finalizations).toBe(5);
    expect(flow.terminalPrepares).toBe(0);
    const proof = {
      kind: 'gateway_ecdsa_first_warm_burst_diagnostic_v1',
      reproduce: "node tests/scripts/run-wallet-intended-isolated.mjs -- e2e/intended-behaviours/passkey.presign-pool.contract.test.ts --grep 'first, warm, and concurrent burst'",
      requestedBackendProfile: requestedEcdsaBackendProfile(),
      timingScope: 'browser_harness_including_automatic_confirmation_and_signature_verification',
      requestScope: 'gateway_POSTs_during_each_window_including_background_work',
      timingPurpose: 'bounded_diagnostic_not_complete_system_controlled_latency_or_release_gate',
      firstSigning,
      warmSigning: {
        ...warmSigning,
        selectedServerMaterialCompletedBeforeStart: true,
      },
      concurrentBurst: {
        ...(await flow.timingWindow(burstStartedAt, burstEndedAt)),
        signatures: 2,
        selectedServerMaterialsCompletedBeforeStart: burstMaterialReadyAtStart,
        sharedBudgetExhausted: true,
      },
      signaturesVerified: 5,
      untimedSetupSignatures: 1,
    };
    const artifactName = `gateway-ecdsa-first-warm-burst-${proof.requestedBackendProfile}.json`;
    const artifactPath = path.resolve(testInfo.config.rootDir, '../.artifacts/r151', artifactName);
    const body = JSON.stringify(proof, null, 2);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, body, 'utf8');
    await testInfo.attach(artifactName, { body, contentType: 'application/json' });
  } finally {
    context.off('request', record);
    context.off('response', recordResponse);
  }
}

test(
  'first, warm, and concurrent burst ECDSA signing preserve verified results and shared quota',
  measureFirstWarmAndBurstSigning,
);

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

class ConcurrentPrepare {
  statuses: number[] = [];

  async duplicate(route: Route): Promise<void> {
    const responses = await Promise.all([route.fetch(), route.fetch()]);
    for (const response of responses) this.statuses.push(response.status());
    this.statuses.sort();
    expect(this.statuses).toEqual([200, 409]);
    const [first, second] = responses;
    const admitted = first.status() === 200 ? first : second;
    const rejected = first.status() === 409 ? first : second;
    expect(await rejected.json()).toMatchObject({ code: 'operation_in_progress' });
    await route.fulfill({ response: admitted });
  }
}

class LastQuotaPrepareRace {
  statuses: number[] = [];
  replayCodes: string[] = [];
  walletId: string | null = null;

  async compete(route: Route): Promise<void> {
    const original: unknown = route.request().postDataJSON();
    if (!isPlainObject(original) || !isPlainObject(original.scope)) {
      throw new Error('Expected a scoped ECDSA prepare request');
    }
    if (typeof original.operation_id !== 'string' || typeof original.scope.wallet_id !== 'string') {
      throw new Error('ECDSA prepare omitted its operation or wallet identity');
    }
    this.walletId = original.scope.wallet_id;
    const contender = {
      ...original,
      operation_id: `${original.operation_id}-contender`,
      request_id: randomUUID(),
    };
    const responses = await Promise.all([
      route.fetch(),
      route.fetch({ postData: contender }),
    ]);
    for (const response of responses) {
      this.statuses.push(response.status());
    }
    this.statuses.sort();
    expect(this.statuses).toEqual([200, 409]);
    for (const response of responses) {
      if (response.status() === 409) {
        expect(await response.json()).toMatchObject({ code: 'wallet_session_quota_exhausted' });
      }
    }
    // Retry both identities after the winner consumed the last use.
    const retries = await Promise.all([
      route.fetch(),
      route.fetch({ postData: contender }),
    ]);
    for (const response of retries) {
      expect(response.status()).toBe(409);
      const payload: unknown = await response.json();
      if (!isPlainObject(payload) || typeof payload.code !== 'string') {
        throw new Error('Expected a denied prepare response');
      }
      this.replayCodes.push(payload.code);
    }
    this.replayCodes.sort();
    expect(this.replayCodes).toEqual(['operation_in_progress', 'wallet_session_quota_exhausted']);
    await route.abort('connectionclosed');
  }
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

async function vmRemainingSigningUses(): Promise<number | null> {
  const root = process.env.SEAMS_INTENDED_ROUTER_AB_ROOT;
  if (process.env.SEAMS_INTENDED_WALLET_HOST !== 'vm' || !root) return null;
  const sqliteModule: string = 'node:sqlite';
  const { DatabaseSync } = (await import(sqliteModule)) as NodeSqliteModule;
  const database = new DatabaseSync(
    path.join(root, '.runtime', 'wallet-gateway', 'gateway.sqlite'),
    { readOnly: true },
  );
  try {
    // The isolated runner creates a fresh database for this single-wallet scenario.
    const [row] = database.prepare(
      'SELECT SUM(remaining_uses) AS remaining FROM authorization_wallet_session_quotas',
    ).all();
    if (!row || typeof row.remaining !== 'number') throw new Error('Expected a signing quota');
    return row.remaining;
  } finally {
    database.close();
  }
}

test('concurrent prepare and admitted ECDSA finalize lost_response retry preserve one signing effect', async ({
  harness,
  context,
}, testInfo) => {
  const finalizePath = '**/router-ab/ecdsa-derivation/sign';
  const preparePath = '**/router-ab/ecdsa-derivation/sign/prepare';
  const concurrentPrepare = new ConcurrentPrepare();
  const duplicate = concurrentPrepare.duplicate.bind(concurrentPrepare);
  const lostFinalize = new LostFinalize();
  const lose = lostFinalize.loseFirstResponse.bind(lostFinalize);
  await harness.registerPasskeyEcdsaOnlyWallet();
  const remainingUsesBefore = await vmRemainingSigningUses();
  await context.route(preparePath, duplicate);
  await context.route(finalizePath, lose);
  try {
    await expect(harness.signTempoTransaction('post_registration')).rejects.toThrow();
  } finally {
    await context.unroute(preparePath, duplicate);
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
  const wrongWallet: unknown = lost.request.postDataJSON();
  if (!isPlainObject(wrongWallet) || !isPlainObject(wrongWallet.scope)) {
    throw new Error('Expected a scoped ECDSA finalize request');
  }
  wrongWallet.scope.wallet_id = `${walletId}-other`;
  const denied = await context.request.fetch(lost.request, { data: wrongWallet });
  expect(denied.status()).toBeGreaterThanOrEqual(400);
  expect(denied.status()).toBeLessThan(500);
  const retriedAfterDenial = await context.request.fetch(lost.request);
  expect(retriedAfterDenial.status()).toBe(200);
  expect(await retriedAfterDenial.json()).toEqual(signature);
  // On the VM, the SigningWorker recorded one effect for this signing, with
  // the returned signature as its terminal response: the retry claimed and
  // consumed nothing.
  const effectsAfterRetry = await vmSigningWorkerEffects(walletId);
  const remainingUsesAfter = await vmRemainingSigningUses();
  if (remainingUsesBefore !== null) {
    expect(remainingUsesAfter).toBe(remainingUsesBefore - 1);
  }
  if (effectsAfterRetry) {
    expect(effectsAfterRetry).toHaveLength(1);
    expect(effectsAfterRetry[0]?.terminal).toEqual(signature);
  }

  const evidence = {
    kind: 'gateway_ecdsa_finalize_lost_response_retry_v1',
    host: process.env.SEAMS_INTENDED_WALLET_HOST ?? 'workers_local',
    concurrentPrepareStatuses: concurrentPrepare.statuses,
    remainingUsesBefore,
    remainingUsesAfter,
    finalizationsAdmitted: lostFinalize.finalizations,
    lostResponseStatus: lost.status,
    retriedStatus: retried.status(),
    retriedMatchesLost: true,
    wrongWalletStatus: denied.status(),
    exactRetryAfterWrongWalletMatches: true,
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

test('distinct concurrent prepares consume the last quota use once and preserve the winning claim', async ({
  harness,
  context,
}, testInfo) => {
  await harness.registerPasskeyEcdsaOnlyWallet();
  await harness.signTempoTransaction('post_registration');
  await harness.signTempoTransaction('post_registration');
  const remainingUsesBefore = await vmRemainingSigningUses();
  if (remainingUsesBefore !== null) expect(remainingUsesBefore).toBe(1);
  const race = new LastQuotaPrepareRace();
  const compete = race.compete.bind(race);
  const preparePath = '**/router-ab/ecdsa-derivation/sign/prepare';
  await context.route(preparePath, compete);
  try {
    await expect(harness.signTempoTransaction('post_registration')).rejects.toThrow();
  } finally {
    await context.unroute(preparePath, compete);
  }
  if (!race.walletId) throw new Error('The final-quota prepare race was never reached');
  expect(race.statuses).toEqual([200, 409]);
  expect(race.replayCodes).toEqual(['operation_in_progress', 'wallet_session_quota_exhausted']);
  const remainingUsesAfter = await vmRemainingSigningUses();
  const effects = await vmSigningWorkerEffects(race.walletId);
  if (remainingUsesAfter !== null) expect(remainingUsesAfter).toBe(0);
  if (effects) expect(effects).toHaveLength(2);
  const evidence = {
    kind: 'gateway_ecdsa_last_quota_contention_v1',
    host: process.env.SEAMS_INTENDED_WALLET_HOST ?? 'workers_local',
    distinctOperationCount: 2,
    prepareStatuses: race.statuses,
    replayCodes: race.replayCodes,
    remainingUsesBefore,
    remainingUsesAfter,
    verifiedSignaturesBeforeRace: 2,
    signingWorkerEffectsAfterRace: effects?.length ?? null,
  };
  const artifactName = `gateway-ecdsa-last-quota-${evidence.host}.json`;
  const artifactPath = path.resolve(testInfo.config.rootDir, '../.artifacts/r150', artifactName);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, JSON.stringify(evidence, null, 2), 'utf8');
  await testInfo.attach(artifactName, {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
});

const ECDSA_FINALIZE_FAULT_HEADER = 'x-seams-intended-ecdsa-finalize-fault-v1';
const ECDSA_FINALIZE_FAULT_TOKEN_HEADER = 'x-seams-intended-ecdsa-finalize-fault-token-v1';
const ECDSA_FINALIZE_FAULT_PROOF_HEADER = 'x-seams-intended-ecdsa-finalize-fault-proof-v1';

class RouterFinalizeRetry {
  readonly token = randomUUID();
  proof: string | null = null;
  body: string | null = null;

  /** Arms the local Gateway to lose the Router's first finalize response. */
  async armFirstFinalize(route: Route): Promise<void> {
    if (this.body !== null) {
      await route.continue();
      return;
    }
    const response = await route.fetch({
      headers: {
        ...route.request().headers(),
        [ECDSA_FINALIZE_FAULT_HEADER]: 'drop_router_response_once',
        [ECDSA_FINALIZE_FAULT_TOKEN_HEADER]: this.token,
      },
    });
    this.proof = response.headers()[ECDSA_FINALIZE_FAULT_PROOF_HEADER] ?? null;
    this.body = await response.text();
    await route.fulfill({ response });
  }
}

test('exact finalize retry at the Router returns the SigningWorker stored signature', async ({
  harness,
  context,
}, testInfo) => {
  const finalizePath = '**/router-ab/ecdsa-derivation/sign';
  const retry = new RouterFinalizeRetry();
  const arm = retry.armFirstFinalize.bind(retry);
  await context.route(finalizePath, arm);
  try {
    await harness.registerPasskeyWallet();
    await harness.signTempoTransaction('post_registration');
  } finally {
    await context.unroute(finalizePath, arm);
  }
  // The Router's first response was lost after the SigningWorker signed. The
  // identical retry reached the SigningWorker before the Gateway recorded
  // anything, and returned the same signature.
  expect(retry.proof).toBe(`${retry.token}:stored_signature_replayed`);
  if (retry.body === null) throw new Error('The finalize request was never admitted');
  const signature: unknown = JSON.parse(retry.body);
  if (!isPlainObject(signature) || !isPlainObject(signature.scope)) {
    throw new Error('Expected an ECDSA signing response');
  }
  const walletId = signature.scope.wallet_id;
  if (typeof walletId !== 'string') throw new Error('ECDSA signing response omitted its wallet');
  // On the VM, the SigningWorker holds one effect for this signing: the retry
  // was answered from it and consumed no second presignature.
  const effects = await vmSigningWorkerEffects(walletId);
  if (effects) {
    expect(effects).toHaveLength(1);
    expect(effects[0]?.terminal).toEqual(signature);
  }

  const evidence = {
    kind: 'router_ecdsa_finalize_exact_retry_v1',
    host: process.env.SEAMS_INTENDED_WALLET_HOST ?? 'workers_local',
    gatewayProof: 'stored_signature_replayed',
    signingWorkerEffects: effects?.length ?? null,
    signingWorkerTerminalMatchesSignature: effects ? true : null,
  };
  const artifactName = `router-ecdsa-finalize-exact-retry-${evidence.host}.json`;
  const artifactPath = path.resolve(testInfo.config.rootDir, '../.artifacts/r150', artifactName);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, JSON.stringify(evidence, null, 2), 'utf8');
  await testInfo.attach(artifactName, {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
});
