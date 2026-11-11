import { openGatewayDatabase, type NodeSqliteModule } from './local-gateway-database';
import { SigningTimingEvidence } from './signing-timing-evidence';
import { GatewayRequestEvidence } from './gateway-request-evidence';
import {
  expect,
  type APIResponse,
  type BrowserContext,
  type Page,
  type Request,
  type Response,
  type Route,
  type TestInfo,
} from '@playwright/test';
import {
  intendedTest as test,
  enableSigningSessionDebugInFrame,
  type IntendedBehaviourHarness,
} from './harness';
import { normalizeRuntimePolicyScope } from '../../../packages/shared-ts/src/threshold/signingRootScope';
import { isPlainObject } from '../../../packages/shared-ts/src/utils/validation';
import { parseEcdsaServerTiming } from '../../../packages/shared-ts/src/utils/ecdsaServerTiming';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, access, rename } from 'node:fs/promises';
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
  private readonly gatewayRequests: {
    readonly request: Request;
    readonly path: string;
    readonly atMs: number;
  }[] = [];
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

  readonly failedRequests: { path: string; elapsedMs: number; error: string | null }[] = [];

  recordFailure(request: Request): void {
    for (const observed of this.gatewayRequests) {
      if (observed.request !== request) continue;
      this.failedRequests.push({
        path: observed.path,
        elapsedMs: performance.now() - observed.atMs,
        error: request.failure()?.errorText ?? null,
      });
      return;
    }
  }

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
      this.gatewayRequests.push({ request, path, atMs });
      if (path === '/router-ab/ecdsa-derivation/presignature-pool/fill/init') {
        this.presignRefillRequests.push({ route: 'init', tag: presignRefillTag(request), atMs });
      } else if (path === '/router-ab/ecdsa-derivation/presignature-pool/fill/step') {
        this.presignRefillRequests.push({ route: 'step', tag: presignRefillTag(request), atMs });
      }
    }
    if (path === '/router-ab/ecdsa-derivation/sign/prepare') {
      const body: unknown = request.postDataJSON();
      if (!isPlainObject(body)) throw new Error('Expected an ECDSA prepare body');
      if (
        isPlainObject(body.presign_source) &&
        body.presign_source.kind === 'final_presign_batch'
      ) {
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

  async gatewayServerTimings(
    startedAtMs: number,
    endedAtMs: number,
  ): Promise<
    {
      path: string;
      status: number;
      stagesMs: Record<string, number>;
      requestObservedOffsetMs: number | null;
      responseHeadersObservedOffsetMs: number;
      browserRequestElapsedMs: number | null;
      gatewayPlacement: string | null;
      d1: unknown;
    }[]
  > {
    const timings = [];
    for (const entry of this.gatewayResponses) {
      if (entry.atMs < startedAtMs || entry.atMs > endedAtMs) continue;
      const request = entry.response.request();
      let requestObservedOffsetMs: number | null = null;
      for (const recorded of this.gatewayRequests) {
        if (recorded.request === request) requestObservedOffsetMs = recorded.atMs - startedAtMs;
      }
      await entry.response.finished();
      const browserTiming = request.timing();
      const stages = parseEcdsaServerTiming(await entry.response.headerValue('Server-Timing'));
      const d1Header = await entry.response.headerValue('X-Benchmark-D1');
      if (stages.size === 0 && d1Header === null) continue;
      timings.push({
        path: entry.path,
        status: entry.response.status(),
        requestObservedOffsetMs,
        responseHeadersObservedOffsetMs: entry.atMs - startedAtMs,
        browserRequestElapsedMs: browserTiming.responseEnd < 0 ? null : browserTiming.responseEnd,
        gatewayPlacement: await entry.response.headerValue('X-Benchmark-Placement'),
        stagesMs: Object.fromEntries(stages),
        d1: d1Header === null ? null : JSON.parse(d1Header),
      });
    }
    return timings;
  }
}

class FailedBackgroundRefill {
  failures = 0;

  constructor(private readonly timing: SigningTimingEvidence) {}

  async intercept(route: Route): Promise<void> {
    // A signature schedules a refill when it starts. The signer that waits for it
    // promotes its requests to the foreground tag, so the tag does not identify
    // that refill. Fail every refill until a signer has stopped waiting; the first
    // refill to pass is then the signer's own.
    if (
      presignRefillTag(route.request()) === 'background' ||
      !this.timing.reported('refill_wait')
    ) {
      this.failures += 1;
      await route.abort('connectionclosed');
      return;
    }
    await route.continue();
  }
}

test('failed background refill falls back to timed foreground refill and preserves signing quota', async ({
  harness,
  context,
  page,
}, testInfo) => {
  await context.addInitScript(enableSigningSessionDebugInFrame);
  await page.evaluate(enableSigningSessionDebugInFrame);
  const timing = new SigningTimingEvidence();
  page.on('console', timing.record.bind(timing));
  const fault = new FailedBackgroundRefill(timing);
  const intercept = fault.intercept.bind(fault);
  const initPath = '**/router-ab/ecdsa-derivation/presignature-pool/fill/init';
  await context.route(initPath, intercept);
  const signatures = [];
  try {
    await harness.registerPasskeyEcdsaOnlyWallet();
    for (let index = 0; index < 2; index += 1) {
      const startedAt = performance.now();
      await harness.signTempoTransaction('post_registration');
      signatures.push(timing.window(startedAt, performance.now()));
    }
    expect(fault.failures).toBeGreaterThan(0);
    expect(signatures[0].stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'foreground_refill', durationMs: expect.any(Number) }),
      ]),
    );
    const persistence = await signingOperationPersistence(
      harness.walletId,
      'unclaimed-evidence-probe',
    );
    expect(persistence.remainingUses).toBe(1);
    const evidence = {
      kind: 'ecdsa_failed_background_refill_timing_v1',
      host: process.env.SEAMS_INTENDED_WALLET_HOST ?? 'workers_local',
      backgroundFailures: fault.failures,
      verifiedSignatures: 2,
      remainingUses: persistence.remainingUses,
      signatures,
    };
    const name = `foreground-refill-timing-${evidence.host}.json`;
    const file = path.resolve(testInfo.config.rootDir, '../.artifacts/r151', name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(evidence, null, 2));
    await testInfo.attach(name, { path: file, contentType: 'application/json' });
  } finally {
    await context.unroute(initPath, intercept);
  }
});

test('unforced ECDSA registration and repeated signing capture Gateway timing', async ({
  harness,
  context,
  page,
}, testInfo) => {
  const requestedBackendProfile = requestedEcdsaBackendProfile();
  const hostedBenchmark = process.env.SEAMS_INTENDED_EXTERNAL_GATEWAY === '1';
  const probeRegion = hostedBenchmark ? process.env.SEAMS_INTENDED_PROBE_REGION : 'local';
  if (!probeRegion || !/^[a-z0-9-]+$/u.test(probeRegion)) {
    throw new Error('Hosted benchmark probe region is missing or invalid');
  }
  const runId = hostedBenchmark ? process.env.SEAMS_INTENDED_BENCHMARK_RUN_ID : 'local';
  if (!runId || !/^[a-z0-9-]+$/u.test(runId)) {
    throw new Error('Hosted benchmark run id is missing or invalid');
  }
  await context.addInitScript(enableSigningSessionDebugInFrame);
  await page.evaluate(enableSigningSessionDebugInFrame);
  const clientTiming = new SigningTimingEvidence();
  const observeTiming = clientTiming.record.bind(clientTiming);
  page.on('console', observeTiming);
  const flow = new FirstSigningPoolFlow();
  const record = flow.record.bind(flow);
  const recordResponse = flow.recordResponse.bind(flow);
  const recordFailure = flow.recordFailure.bind(flow);
  context.on('requestfailed', recordFailure);
  context.on('request', record);
  context.on('response', recordResponse);
  try {
    const registrationStartedAt = performance.now();
    await harness.registerPasskeyWallet();
    const registrationEndedAt = performance.now();

    const firstSigningStartedAt = performance.now();
    await harness.signTempoTransaction('post_registration');
    const firstSigningEndedAt = performance.now();
    const firstActionTiming = harness.signingActionTimingEvidence();

    const subsequentSigningStartedAt = performance.now();
    await harness.signTempoTransaction('post_registration');
    const subsequentSigningEndedAt = performance.now();
    const subsequentActionTiming = harness.signingActionTimingEvidence();

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
        clientTiming: clientTiming.window(firstSigningStartedAt, firstSigningEndedAt),
        harnessTiming: firstActionTiming,
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
        clientTiming: clientTiming.window(subsequentSigningStartedAt, subsequentSigningEndedAt),
        harnessTiming: subsequentActionTiming,
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
      backgroundRefills: clientTiming.refillResults,
      failedRequests: flow.failedRequests,
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
    context.off('requestfailed', recordFailure);
    page.off('console', observeTiming);
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
  return 'local_wallet_objects';
}

async function measureFirstWarmAndBurstSigning(
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
  const gatewayEvidence = new GatewayRequestEvidence();
  gatewayEvidence.start(context);
  await context.addInitScript(enableSigningSessionDebugInFrame);
  await page.evaluate(enableSigningSessionDebugInFrame);
  const clientTiming = new SigningTimingEvidence();
  const observeTiming = clientTiming.record.bind(clientTiming);
  page.on('console', observeTiming);
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

    await expect
      .poll(flow.unusedServerPresignatureCount.bind(flow), {
        timeout: 60_000,
      })
      .toBeGreaterThan(0);
    const readyBeforeWarm = await flow.unusedServerPresignatures();
    const warmStartedAt = performance.now();
    await harness.signTempoTransaction('post_registration');
    const warmEndedAt = performance.now();
    expect(readyBeforeWarm).toContain(flow.preparePresignatureId);
    const warmSigning = await flow.timingWindow(warmStartedAt, warmEndedAt);

    // A fresh three-use session leaves exactly two uses for the concurrent burst.
    await harness.awaitNearReady();
    const unlockStartedAt = performance.now();
    await harness.unlockPasskeyWallet();
    const unlockEndedAt = performance.now();
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
      reproduce:
        "node tests/scripts/run-wallet-intended-isolated.mjs -- e2e/intended-behaviours/passkey.presign-pool.contract.test.ts --grep 'first, warm, and concurrent burst'",
      requestedBackendProfile: requestedEcdsaBackendProfile(),
      timingScope: 'browser_harness_including_automatic_confirmation_and_signature_verification',
      requestScope: 'gateway_POSTs_during_each_window_including_background_work',
      timingPurpose: 'bounded_diagnostic_not_complete_system_controlled_latency_or_release_gate',
      coldUnlock: {
        elapsedMs: unlockEndedAt - unlockStartedAt,
        gateway: await gatewayEvidence.window(unlockStartedAt, unlockEndedAt),
      },
      firstSigning: {
        ...firstSigning,
        clientTiming: clientTiming.window(firstStartedAt, firstEndedAt),
      },
      warmSigning: {
        ...warmSigning,
        clientTiming: clientTiming.window(warmStartedAt, warmEndedAt),
        selectedServerMaterialCompletedBeforeStart: true,
      },
      concurrentBurst: {
        ...(await flow.timingWindow(burstStartedAt, burstEndedAt)),
        clientTiming: clientTiming.concurrentWindow(burstStartedAt, burstEndedAt),
        signatures: 2,
        selectedServerMaterialsCompletedBeforeStart: burstMaterialReadyAtStart,
        sharedBudgetExhausted: true,
      },
      signaturesVerified: 5,
      untimedSetupSignatures: 1,
      backgroundRefills: clientTiming.refillResults,
    };
    const hosted = process.env.SEAMS_INTENDED_EXTERNAL_GATEWAY === '1';
    const probeRegion = process.env.SEAMS_INTENDED_PROBE_REGION;
    const runId = process.env.SEAMS_INTENDED_BENCHMARK_RUN_ID;
    if (
      hosted &&
      (!probeRegion || !runId || !/^[a-z0-9-]+$/u.test(probeRegion) || !/^[a-z0-9-]+$/u.test(runId))
    ) {
      throw new Error('Hosted workload requires a probe region and run identity');
    }
    const suffix = hosted ? `-${probeRegion}-${runId}-${testInfo.repeatEachIndex}` : '';
    const artifactName = `gateway-ecdsa-first-warm-burst-${proof.requestedBackendProfile}${suffix}.json`;
    const artifactPath = path.resolve(testInfo.config.rootDir, '../.artifacts/r151', artifactName);
    const body = JSON.stringify(proof, null, 2);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, body, 'utf8');
    await testInfo.attach(artifactName, { body, contentType: 'application/json' });
  } finally {
    gatewayEvidence.stop(context);
    page.off('console', observeTiming);
    context.off('request', record);
    context.off('response', recordResponse);
  }
}

test(
  'first, warm, and concurrent burst ECDSA signing preserve verified results and shared quota',
  measureFirstWarmAndBurstSigning,
);

async function placementReleased(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function waitForHostedPlacement(placement: 'default' | 'tokyo'): Promise<void> {
  const directory = process.env.SEAMS_INTENDED_PLACEMENT_DIRECTORY;
  if (!directory) throw new Error('Hosted placement control directory is required');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'requested.tmp'), JSON.stringify({ placement }));
  await rename(path.join(directory, 'requested.tmp'), path.join(directory, 'requested.json'));
  await expect
    .poll(placementReleased.bind(undefined, path.join(directory, `${placement}.ready`)), {
      timeout: 120_000,
      intervals: [500],
    })
    .toBe(true);
}

async function measureSameWalletPlacement(
  {
    harness,
    context,
    page,
  }: { harness: IntendedBehaviourHarness; context: BrowserContext; page: Page },
  testInfo: TestInfo,
): Promise<void> {
  test.skip(
    process.env.SEAMS_INTENDED_EXTERNAL_GATEWAY !== '1',
    'Requires the hosted placement controller',
  );
  await context.addInitScript(enableSigningSessionDebugInFrame);
  await page.evaluate(enableSigningSessionDebugInFrame);
  const flow = new FirstSigningPoolFlow();
  const timing = new SigningTimingEvidence();
  const record = flow.record.bind(flow);
  const recordResponse = flow.recordResponse.bind(flow);
  const recordTiming = timing.record.bind(timing);
  context.on('request', record);
  context.on('response', recordResponse);
  page.on('console', recordTiming);
  try {
    await harness.registerPasskeyEcdsaOnlyWallet();
    await harness.signTempoTransaction('post_registration');
    const measurements = [];
    for (const placement of ['default', 'tokyo'] as const) {
      await waitForHostedPlacement(placement);
      await expect
        .poll(flow.unusedServerPresignatureCount.bind(flow), { timeout: 60_000 })
        .toBeGreaterThan(0);
      const ready = await flow.unusedServerPresignatures();
      const startedAt = performance.now();
      await harness.signTempoTransaction('post_registration');
      const endedAt = performance.now();
      expect(ready).toContain(flow.preparePresignatureId);
      measurements.push({
        placement,
        selectedServerMaterialCompletedBeforeStart: true,
        ...(await flow.timingWindow(startedAt, endedAt)),
        clientTiming: timing.window(startedAt, endedAt),
      });
    }
    expect(flow.ordinaryPrepares).toBe(3);
    expect(flow.finalizations).toBe(3);
    const region = process.env.SEAMS_INTENDED_PROBE_REGION;
    const runId = process.env.SEAMS_INTENDED_BENCHMARK_RUN_ID;
    const arm = process.env.SEAMS_INTENDED_BENCHMARK_ARM;
    if (
      !region ||
      !runId ||
      !/^[a-z0-9-]+$/u.test(region) ||
      !/^[a-z0-9-]+$/u.test(runId) ||
      (arm !== 'do' && arm !== 'd1')
    ) {
      throw new Error('Hosted placement requires region, run identity, and backend arm');
    }
    const evidence = {
      kind: 'gateway_ecdsa_same_wallet_placement_v1',
      verifiedSignatures: 3,
      untimedSetupSignatures: 1,
      measurements,
      accounting:
        'Same wallet, authority, session, and persistent custody ownership; distinct one-use material per signature. Default then Tokyo. SDK time includes automatic confirmation. Deployment waits are outside timing windows.',
    };
    const artifactName = `gateway-ecdsa-placement-pair-hosted_${arm}-${region}-${runId}-${testInfo.repeatEachIndex}.json`;
    const artifactPath = path.resolve(testInfo.config.rootDir, '../.artifacts/r151', artifactName);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    const body = JSON.stringify(evidence, null, 2);
    await writeFile(artifactPath, body, 'utf8');
    await testInfo.attach(artifactName, { body, contentType: 'application/json' });
  } finally {
    context.off('request', record);
    context.off('response', recordResponse);
    page.off('console', recordTiming);
  }
}

test('same wallet warm signing across controlled Gateway placements', measureSameWalletPlacement);

class ConcurrentPrepare {
  statuses: number[] = [];
  d1: unknown[] = [];

  async duplicate(route: Route): Promise<void> {
    const responses = await Promise.all([route.fetch(), route.fetch()]);
    for (const response of responses) {
      this.statuses.push(response.status());
      this.d1.push(gatewayD1Evidence(response));
    }
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
  d1: { readonly stage: 'prepare' | 'retry'; readonly status: number; readonly trace: unknown }[] =
    [];
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
    const responses = await Promise.all([route.fetch(), route.fetch({ postData: contender })]);
    for (const response of responses) {
      this.statuses.push(response.status());
      this.d1.push({
        stage: 'prepare',
        status: response.status(),
        trace: gatewayD1Evidence(response),
      });
    }
    this.statuses.sort();
    expect(this.statuses).toEqual([200, 409]);
    for (const response of responses) {
      if (response.status() === 409) {
        expect(await response.json()).toMatchObject({ code: 'wallet_session_quota_exhausted' });
      }
    }
    // Retry both identities after the winner consumed the last use.
    const retries = await Promise.all([route.fetch(), route.fetch({ postData: contender })]);
    for (const response of retries) {
      this.d1.push({
        stage: 'retry',
        status: response.status(),
        trace: gatewayD1Evidence(response),
      });
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

async function signingOperationPersistence(
  walletId: string,
  operationId: string,
): Promise<{
  readonly remainingUses: number;
  readonly claims: number;
  readonly auditEvents: number;
}> {
  const database = await openGatewayDatabase('read');
  try {
    const [row] = database
      .prepare(
        `SELECT
         (SELECT SUM(quota.remaining_uses) FROM authorization_wallet_session_quotas AS quota
          WHERE EXISTS (SELECT 1 FROM wallet_session_authorizations_v2 AS session
            WHERE session.namespace = quota.namespace AND session.tenant_id = quota.tenant_id
              AND session.quota_id = quota.quota_id AND session.wallet_id = ?)) AS remaining,
         (SELECT COUNT(*) FROM authorized_operations WHERE operation_id = ?) AS claims,
         (SELECT COUNT(*) FROM authorized_operation_audit_events WHERE audit_event_id = ?) AS audit_events`,
      )
      .all(walletId, operationId, `ecdsa-operation-audit:${operationId}`);
    if (
      !row ||
      typeof row.remaining !== 'number' ||
      typeof row.claims !== 'number' ||
      typeof row.audit_events !== 'number'
    ) {
      throw new Error('Expected Gateway quota, claim, and audit evidence');
    }
    return { remainingUses: row.remaining, claims: row.claims, auditEvents: row.audit_events };
  } finally {
    database.close();
  }
}

type SigningPolicy = 'project_and_abuse' | 'abuse' | 'rate_limited' | 'unrelated';

/** Namespace, org, project, environment and signing root version of a policy record. */
type SigningPolicyTenant = readonly [string, string, string, string, string];

type SigningPolicyInsert = ReturnType<InstanceType<NodeSqliteModule['DatabaseSync']>['prepare']>;

// The Gateway table requires a record key to start with the record's own scope.
function insertProjectRejection(insert: SigningPolicyInsert, tenant: SigningPolicyTenant): void {
  const key = tenant.slice(1).join('\x1f');
  insert.run(...tenant, 'project_policy', key, null, 'rejected', 1000, Date.now());
}

// An abuse record also names its wallet, in its own column and in its key.
function insertAbuseDecision(
  insert: SigningPolicyInsert,
  tenant: SigningPolicyTenant,
  walletId: string,
  activationId: string,
  decision: 'rejected' | 'rate_limited',
): void {
  const key = [...tenant.slice(1), walletId, `material_activation:${activationId}`, 'ecdsa'].join(
    '\x1f',
  );
  insert.run(...tenant, 'abuse', key, walletId, decision, 1000, Date.now());
}

async function setIsolatedSigningPolicy(request: Request, policy: SigningPolicy): Promise<void> {
  const body: unknown = request.postDataJSON();
  if (
    !isPlainObject(body) ||
    !isPlainObject(body.scope) ||
    typeof body.scope.wallet_id !== 'string' ||
    !isPlainObject(body.material_activation) ||
    typeof body.material_activation.activation_id !== 'string'
  ) {
    throw new Error('Expected an ECDSA signing request');
  }
  const walletId = body.scope.wallet_id;
  const activationId = body.material_activation.activation_id;
  const database = await openGatewayDatabase('write');
  try {
    const rows = database
      .prepare(
        `SELECT DISTINCT namespace, json_extract(record_json, '$.runtimePolicyScope') AS scope_json
       FROM wallet_signers WHERE wallet_id = ? AND signer_family = 'ecdsa'`,
      )
      .all(walletId);
    if (
      rows.length !== 1 ||
      typeof rows[0].namespace !== 'string' ||
      typeof rows[0].scope_json !== 'string'
    ) {
      throw new Error('Expected one isolated ECDSA material policy scope');
    }
    const scope = normalizeRuntimePolicyScope(JSON.parse(rows[0].scope_json));
    // This database belongs to this single-wallet scenario; policy rows are test-owned.
    database.prepare('DELETE FROM router_ab_normal_signing_admission_records').run();
    const insert = database.prepare(
      `INSERT INTO router_ab_normal_signing_admission_records
       (namespace, org_id, project_id, env_id, signing_root_version,
        record_kind, record_key, wallet_id, decision, retry_after_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tenant: SigningPolicyTenant = [
      rows[0].namespace,
      scope.orgId,
      scope.projectId,
      scope.envId,
      scope.signingRootVersion,
    ];
    if (policy === 'unrelated') {
      const otherScopes: SigningPolicyTenant[] = [
        [
          rows[0].namespace + ':other',
          scope.orgId,
          scope.projectId,
          scope.envId,
          scope.signingRootVersion,
        ],
        [
          rows[0].namespace,
          scope.orgId + ':other',
          scope.projectId,
          scope.envId,
          scope.signingRootVersion,
        ],
        [
          rows[0].namespace,
          scope.orgId,
          scope.projectId + ':other',
          scope.envId,
          scope.signingRootVersion,
        ],
        [
          rows[0].namespace,
          scope.orgId,
          scope.projectId,
          scope.envId + ':other',
          scope.signingRootVersion,
        ],
        [
          rows[0].namespace,
          scope.orgId,
          scope.projectId,
          scope.envId,
          scope.signingRootVersion + ':other',
        ],
      ];
      for (const other of otherScopes) {
        insertProjectRejection(insert, other);
        insertAbuseDecision(insert, other, walletId, activationId, 'rejected');
      }
      insertAbuseDecision(insert, tenant, walletId + ':other', activationId, 'rejected');
      insertAbuseDecision(insert, tenant, walletId, activationId + ':other', 'rejected');
      return;
    }
    const abuseDecision = policy === 'rate_limited' ? 'rate_limited' : 'rejected';
    insertAbuseDecision(insert, tenant, walletId, activationId, abuseDecision);
    if (policy === 'project_and_abuse') insertProjectRejection(insert, tenant);
  } finally {
    database.close();
  }
}

class SigningPolicyProbe {
  readonly evidence: { phase: string; code: string; status: number; remainingUses: number }[] = [];
  completed: { request: Request; body: unknown } | null = null;

  constructor(private readonly context: BrowserContext) {}

  async verifyDenials(request: Request, phase: string): Promise<void> {
    const body: unknown = request.postDataJSON();
    if (
      !isPlainObject(body) ||
      typeof body.operation_id !== 'string' ||
      !isPlainObject(body.scope) ||
      typeof body.scope.wallet_id !== 'string'
    ) {
      throw new Error('Expected a signing operation identity');
    }
    const before = await signingOperationPersistence(body.scope.wallet_id, body.operation_id);
    const cases: readonly { policy: SigningPolicy; code: string; status: number }[] = [
      { policy: 'project_and_abuse', code: 'project_policy_rejected', status: 403 },
      { policy: 'abuse', code: 'abuse_rejected', status: 403 },
      { policy: 'rate_limited', code: 'rate_limited', status: 429 },
    ];
    try {
      for (const scenario of cases) {
        await setIsolatedSigningPolicy(request, scenario.policy);
        const response = await this.context.request.fetch(request);
        expect(response.status()).toBe(scenario.status);
        expect(await response.json()).toMatchObject({ code: scenario.code });
        expect(await signingOperationPersistence(body.scope.wallet_id, body.operation_id)).toEqual(
          before,
        );
        this.evidence.push({
          phase,
          code: scenario.code,
          status: response.status(),
          remainingUses: before.remainingUses,
        });
      }
    } finally {
      await setIsolatedSigningPolicy(request, 'unrelated');
    }
  }

  async intercept(route: Route): Promise<void> {
    const request = route.request();
    const phase = request.url().endsWith('/prepare') ? 'prepare' : 'finalize';
    await this.verifyDenials(request, phase);
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (phase === 'finalize') this.completed = { request, body: await response.json() };
    await route.fulfill({ response });
  }
}

async function verifyLiveSigningPolicy(
  harness: IntendedBehaviourHarness,
  context: BrowserContext,
  stage: 'post_registration' | 'post_device_link',
  testInfo: TestInfo,
): Promise<void> {
  const probe = new SigningPolicyProbe(context);
  const intercept = probe.intercept.bind(probe);
  const signingPath = /\/router-ab\/ecdsa-derivation\/sign(?:\/prepare)?$/;
  await context.route(signingPath, intercept);
  try {
    await harness.signTempoTransaction(stage);
  } finally {
    await context.unroute(signingPath, intercept);
  }
  if (!probe.completed) throw new Error('Expected a verified completed signature');
  await probe.verifyDenials(probe.completed.request, 'completed_replay');
  const replay = await context.request.fetch(probe.completed.request);
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toEqual(probe.completed.body);
  expect(probe.evidence).toHaveLength(9);
  // A finalize for an operation that was never prepared is refused without
  // quota, claim, or audit effects.
  const missing: unknown = probe.completed.request.postDataJSON();
  if (!isPlainObject(missing)) throw new Error('Expected a finalize request body');
  const missingOperationId = `missing-prepare-${randomUUID()}`;
  missing.operation_id = missingOperationId;
  missing.request_id = randomUUID();
  const beforeMissing = await signingOperationPersistence(harness.walletId, missingOperationId);
  expect(beforeMissing).toMatchObject({ claims: 0, auditEvents: 0 });
  const missingFinalize = await context.request.fetch(probe.completed.request, { data: missing });
  expect(missingFinalize.status()).toBe(409);
  expect(await missingFinalize.json()).toMatchObject({ code: 'authorized_operation_missing' });
  expect(await signingOperationPersistence(harness.walletId, missingOperationId)).toEqual(
    beforeMissing,
  );
  await harness.signTempoTransaction(stage);
  await harness.signTempoTransaction(stage);
  const body: unknown = probe.completed.request.postDataJSON();
  if (!isPlainObject(body) || typeof body.operation_id !== 'string') {
    throw new Error('Expected operation identity');
  }
  const after = await signingOperationPersistence(harness.walletId, body.operation_id);
  expect(after).toMatchObject({ claims: 1, auditEvents: 1 });
  if (stage === 'post_registration') expect(after.remainingUses).toBe(0);
  const evidence = {
    kind: 'gateway_ecdsa_live_policy_v1',
    host: process.env.SEAMS_INTENDED_WALLET_HOST ?? 'workers_local',
    stage,
    unrelatedPolicyRowsIgnored: 12,
    denials: probe.evidence,
    after,
    verifiedSignatures: 3,
    exactReplayMatches: true,
  };
  const artifactName = `gateway-ecdsa-live-policy-${stage}-${evidence.host}.json`;
  const artifactPath = path.resolve(testInfo.config.rootDir, '../.artifacts/r151', artifactName);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, JSON.stringify(evidence, null, 2), 'utf8');
  await testInfo.attach(artifactName, {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
}

test('live signing policy denies prepare finalize and completed replay without consuming quota', async ({
  harness,
  context,
}, testInfo) => {
  await harness.registerPasskeyEcdsaOnlyWallet();
  await verifyLiveSigningPolicy(harness, context, 'post_registration', testInfo);
});

const executeRuntimeFailure = promisify(execFile);

async function interruptOwnedRuntimeAfterCommittedReply(
  request: Request,
  committedReply: string,
): Promise<void> {
  const script = process.env.SEAMS_INTENDED_COMMITTED_REPLY_RUNTIME_FAILURE_SCRIPT;
  if (!script) return;
  if (!path.isAbsolute(script))
    throw new Error('The owned runtime failure script must be absolute');
  const requestBody = request.postData();
  if (requestBody === null) throw new Error('The committed finalize request requires a body');
  await executeRuntimeFailure(
    'python3',
    [
      script,
      createHash('sha256').update(requestBody).digest('hex'),
      createHash('sha256').update(committedReply).digest('hex'),
    ],
    { timeout: 120_000 },
  );
}

class LostFinalize {
  finalizations = 0;
  lost: {
    readonly request: Request;
    readonly status: number;
    readonly body: string;
    readonly d1: unknown;
  } | null = null;

  /** Lets the first finalize complete, then drops its response. */
  async loseFirstResponse(route: Route): Promise<void> {
    this.finalizations += 1;
    if (this.lost) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    this.lost = {
      request: route.request(),
      status: response.status(),
      body: await response.text(),
      d1: gatewayD1Evidence(response),
    };
    if (this.lost.status === 200) {
      await interruptOwnedRuntimeAfterCommittedReply(this.lost.request, this.lost.body);
    }
    await route.abort('connectionclosed');
  }
}

function gatewayD1Evidence(response: APIResponse): unknown {
  const header = response.headers()['x-benchmark-d1'];
  return header === undefined ? null : JSON.parse(header);
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
  await harness.signTempoTransaction('post_registration');
  await harness.signTempoTransaction('post_registration');
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
  const evidence = {
    kind: 'gateway_ecdsa_finalize_lost_response_retry_v1',
    d1: {
      concurrentPrepare: concurrentPrepare.d1,
      finalize: lost.d1,
      replay: gatewayD1Evidence(retried),
      wrongWallet: gatewayD1Evidence(denied),
      replayAfterDenial: gatewayD1Evidence(retriedAfterDenial),
    },
    host: process.env.SEAMS_INTENDED_WALLET_HOST ?? 'workers_local',
    concurrentPrepareStatuses: concurrentPrepare.statuses,
    verifiedSignaturesBeforeResponseLoss: 2,
    finalizationsAdmitted: lostFinalize.finalizations,
    lostResponseStatus: lost.status,
    retriedStatus: retried.status(),
    retriedMatchesLost: true,
    wrongWalletStatus: denied.status(),
    exactRetryAfterWrongWalletMatches: true,
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
  const evidence = {
    kind: 'gateway_ecdsa_last_quota_contention_v1',
    d1: race.d1,
    host: process.env.SEAMS_INTENDED_WALLET_HOST ?? 'workers_local',
    distinctOperationCount: 2,
    prepareStatuses: race.statuses,
    replayCodes: race.replayCodes,
    verifiedSignaturesBeforeRace: 2,
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
