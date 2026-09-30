import type { BrowserContext, Request, Response } from '@playwright/test';
import { isPlainObject } from '../../../packages/shared-ts/src/utils/validation';
import { parseEcdsaServerTiming } from '../../../packages/shared-ts/src/utils/ecdsaServerTiming';

type RequestOutcome =
  | { kind: 'pending' }
  | { kind: 'completed'; atMs: number }
  | { kind: 'failed'; atMs: number; error: string };

type ObservedGatewayRequest = {
  readonly request: Request;
  readonly path: string;
  readonly startedAtMs: number;
  readonly activity: 'background_refill' | 'foreground_refill' | 'unclassified';
  response: { value: Response; atMs: number } | null;
  outcome: RequestOutcome;
};

/** Request identity keeps late responses attached to their original window. */
export class GatewayRequestEvidence {
  private readonly gatewayOrigin = new URL(
    process.env.SEAMS_INTENDED_ROUTER_URL || 'http://127.0.0.1:4100',
  ).origin;
  private readonly requests = new Map<Request, ObservedGatewayRequest>();
  private readonly listeners = {
    request: this.record.bind(this),
    response: this.recordResponse.bind(this),
    finished: this.recordFinished.bind(this),
    failed: this.recordFailure.bind(this),
  };

  start(context: BrowserContext): void {
    context.on('request', this.listeners.request);
    context.on('response', this.listeners.response);
    context.on('requestfinished', this.listeners.finished);
    context.on('requestfailed', this.listeners.failed);
  }

  stop(context: BrowserContext): void {
    context.off('request', this.listeners.request);
    context.off('response', this.listeners.response);
    context.off('requestfinished', this.listeners.finished);
    context.off('requestfailed', this.listeners.failed);
  }

  record(request: Request): void {
    const url = new URL(request.url());
    if (url.origin !== this.gatewayOrigin || request.method() !== 'POST') return;
    this.requests.set(request, {
      request,
      path: url.pathname,
      startedAtMs: performance.now(),
      activity: requestActivity(request, url.pathname),
      response: null,
      outcome: { kind: 'pending' },
    });
  }

  recordResponse(response: Response): void {
    const observed = this.requests.get(response.request());
    if (observed) observed.response = { value: response, atMs: performance.now() };
  }

  recordFinished(request: Request): void {
    const observed = this.requests.get(request);
    if (observed) observed.outcome = { kind: 'completed', atMs: performance.now() };
  }

  recordFailure(request: Request): void {
    const observed = this.requests.get(request);
    if (observed) {
      observed.outcome = {
        kind: 'failed',
        atMs: performance.now(),
        error: request.failure()?.errorText ?? 'Unknown network failure',
      };
    }
  }

  async window(startedAtMs: number, endedAtMs: number) {
    const requests = [];
    for (const observed of this.requests.values()) {
      if (observed.startedAtMs > endedAtMs) continue;
      if (observed.outcome.kind !== 'pending' && observed.outcome.atMs < startedAtMs) continue;
      const response = observed.response?.value;
      const header = response ? await response.headerValue('X-Benchmark-D1') : null;
      const timing = observed.request.timing();
      requests.push({
        path: observed.path,
        preparedPresignatureId: preparedPresignatureId(observed.request, observed.path),
        activity: observed.activity,
        startedBeforeWindow: observed.startedAtMs < startedAtMs,
        requestObservedOffsetMs: observed.startedAtMs - startedAtMs,
        responseHeadersObservedOffsetMs: observed.response
          ? observed.response.atMs - startedAtMs
          : null,
        completedOffsetMs:
          observed.outcome.kind === 'pending' ? null : observed.outcome.atMs - startedAtMs,
        outcome: observed.outcome.kind,
        error: observed.outcome.kind === 'failed' ? observed.outcome.error : null,
        status: response?.status() ?? null,
        browserRequestElapsedMs: timing.responseEnd < 0 ? null : timing.responseEnd,
        gatewayPlacement: response ? await response.headerValue('X-Benchmark-Placement') : null,
        stagesMs: Object.fromEntries(
          parseEcdsaServerTiming(response ? await response.headerValue('Server-Timing') : null),
        ),
        d1: header === null ? null : JSON.parse(header),
      });
    }
    return {
      scope: 'Gateway POST requests overlapping the harness window in this browser context',
      accounting:
        'Includes background work and requests crossing window boundaries. Unclassified activity is not proof of a foreground dependency. Observer offsets and browser durations use different clocks; do not sum overlapping intervals.',
      requests,
    };
  }
}

function preparedPresignatureId(request: Request, pathname: string): string | null {
  if (pathname !== '/router-ab/ecdsa-derivation/sign/prepare') return null;
  const body: unknown = request.postDataJSON();
  if (!isPlainObject(body) || typeof body.client_presignature_id !== 'string') {
    throw new Error('Signing prepare omitted its presignature identity');
  }
  return body.client_presignature_id;
}

function requestActivity(request: Request, pathname: string): ObservedGatewayRequest['activity'] {
  if (!pathname.startsWith('/router-ab/ecdsa-derivation/presignature-pool/fill/')) {
    return 'unclassified';
  }
  const body: unknown = request.postDataJSON();
  if (!isPlainObject(body)) return 'unclassified';
  if (body.requestTag === 'background_presign_pool_refill') return 'background_refill';
  if (body.requestTag === 'foreground_presign_pool_refill') return 'foreground_refill';
  return 'unclassified';
}
