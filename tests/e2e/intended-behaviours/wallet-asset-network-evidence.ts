import type { CDPSession, Page } from '@playwright/test';
import { isObject } from '../../../packages/shared-ts/src/utils/validation';

type Target = {
  sessions: string[];
  kind: string;
  url: string | null;
};

type AssetRequest = {
  phase: string;
  url: string;
  target: { kind: string; url: string | null };
  documentOrigin: string;
  frameId: string | null;
  initiatorType: string;
  resourceType: string;
  decodedDataBytes: number;
  encodedDataBytes: number;
  response: {
    status: number;
    contentEncoding: string;
    fromDiskCache: boolean;
    fromServiceWorker: boolean;
  } | null;
  completion:
    | { kind: 'pending' }
    | { kind: 'finished'; encodedTransferBytes: number }
    | { kind: 'failed'; error: string };
};

const NETWORK_EVENTS = [
  'Network.requestWillBeSent',
  'Network.responseReceived',
  'Network.dataReceived',
  'Network.loadingFinished',
  'Network.loadingFailed',
  'Target.attachedToTarget',
  'Target.receivedMessageFromTarget',
] as const;

function assetUrl(raw: string): string | null {
  if (!raw) return null;
  const url = new URL(raw);
  if (!/\.(?:m?js|wasm|css)$/u.test(url.pathname)) return null;
  return `${url.origin}${url.pathname}`;
}

function contentEncoding(headers: unknown): string {
  if (!isObject(headers)) return 'identity';
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'content-encoding' && typeof value === 'string') return value;
  }
  return 'identity';
}

/** Collect byte counters without reading response bodies or retaining auth traffic. */
export class WalletAssetNetworkEvidence {
  private readonly requests = new Map<string, AssetRequest>();
  private readonly assets: AssetRequest[] = [];
  private readonly targets = new Map<string, Target>();
  private readonly failures: string[] = [];
  private readonly pending = new Set<Promise<void>>();
  private commandId = 0;

  private constructor(
    private readonly session: CDPSession,
    private readonly getPhase: () => string,
  ) {}

  static async start(page: Page, getPhase: () => string): Promise<WalletAssetNetworkEvidence> {
    const session = await page.context().newCDPSession(page);
    const evidence = new WalletAssetNetworkEvidence(session, getPhase);
    const target: Target = { sessions: [], kind: 'page', url: null };
    for (const event of NETWORK_EVENTS) {
      session.on(event, evidence.event.bind(evidence, target, event));
    }
    await session.send('Network.enable');
    await session.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: false,
    });
    return evidence;
  }

  getRequestedAssetUrlsForPhase(phase: string): readonly string[] {
    const urls: string[] = [];
    for (const asset of this.assets) {
      if (asset.phase === phase) urls.push(asset.url);
    }
    return urls;
  }

  private event(target: Target, method: string, raw: unknown): void {
    if (!isObject(raw)) return;
    if (method === 'Target.attachedToTarget') {
      this.attach(target, raw);
      return;
    }
    if (method === 'Target.receivedMessageFromTarget') {
      this.receive(raw);
      return;
    }
    if (typeof raw.requestId !== 'string') return;
    const key = `${target.sessions.join('/')}:${raw.requestId}`;
    if (method === 'Network.requestWillBeSent') {
      this.request(target, key, raw);
      return;
    }
    const request = this.requests.get(key);
    if (!request) return;
    switch (method) {
      case 'Network.responseReceived': {
        const response = raw.response;
        if (!isObject(response) || typeof response.status !== 'number') return;
        request.resourceType = typeof raw.type === 'string' ? raw.type : request.resourceType;
        request.response = {
          status: response.status,
          contentEncoding: contentEncoding(response.headers),
          fromDiskCache: response.fromDiskCache === true,
          fromServiceWorker: response.fromServiceWorker === true,
        };
        break;
      }
      case 'Network.dataReceived':
        if (typeof raw.dataLength !== 'number' || typeof raw.encodedDataLength !== 'number') return;
        request.decodedDataBytes += raw.dataLength;
        request.encodedDataBytes += raw.encodedDataLength;
        break;
      case 'Network.loadingFinished':
        if (typeof raw.encodedDataLength !== 'number') return;
        request.completion = { kind: 'finished', encodedTransferBytes: raw.encodedDataLength };
        this.requests.delete(key);
        break;
      case 'Network.loadingFailed':
        if (typeof raw.errorText !== 'string') return;
        request.completion = { kind: 'failed', error: raw.errorText };
        this.requests.delete(key);
        break;
    }
  }

  private request(target: Target, key: string, event: Record<string, unknown>): void {
    if (!isObject(event.request) || typeof event.request.url !== 'string') return;
    const url = assetUrl(event.request.url);
    if (!url) return;
    const request: AssetRequest = {
      phase: this.getPhase(),
      url,
      target: { kind: target.kind, url: target.url },
      documentOrigin: new URL(
        typeof event.documentURL === 'string' && event.documentURL ? event.documentURL : url,
      ).origin,
      frameId: typeof event.frameId === 'string' ? event.frameId : null,
      initiatorType:
        isObject(event.initiator) && typeof event.initiator.type === 'string'
          ? event.initiator.type
          : 'unknown',
      resourceType: typeof event.type === 'string' ? event.type : 'Other',
      decodedDataBytes: 0,
      encodedDataBytes: 0,
      response: null,
      completion: { kind: 'pending' },
    };
    this.requests.set(key, request);
    this.assets.push(request);
  }

  private attach(parent: Target, event: Record<string, unknown>): void {
    if (
      typeof event.sessionId !== 'string' ||
      !isObject(event.targetInfo) ||
      typeof event.targetInfo.type !== 'string' ||
      typeof event.targetInfo.url !== 'string'
    )
      return;
    const target: Target = {
      sessions: [...parent.sessions, event.sessionId],
      kind: event.targetInfo.type,
      url: assetUrl(event.targetInfo.url),
    };
    this.targets.set(event.sessionId, target);
    const setup = this.enableTarget(target);
    this.pending.add(setup);
    void setup.then(this.removePending.bind(this, setup));
  }

  private removePending(setup: Promise<void>): void {
    this.pending.delete(setup);
  }

  private async enableTarget(target: Target): Promise<void> {
    try {
      await this.send(target, 'Network.enable', {});
      await this.send(target, 'Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: false,
      });
    } catch {
      this.failures.push(`Could not enable network observation for ${target.kind}`);
    } finally {
      try {
        await this.send(target, 'Runtime.runIfWaitingForDebugger', {});
      } catch {
        this.failures.push(`Could not resume observed ${target.kind}`);
      }
    }
  }

  private async send(
    target: Target,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    let message = JSON.stringify({ id: ++this.commandId, method, params });
    // Tunnel nested worker/iframe sessions through the owning page's CDP session.
    for (let index = target.sessions.length - 1; index > 0; index -= 1) {
      message = JSON.stringify({
        id: ++this.commandId,
        method: 'Target.sendMessageToTarget',
        params: { sessionId: target.sessions[index], message },
      });
    }
    await this.session.send('Target.sendMessageToTarget', {
      sessionId: target.sessions[0],
      message,
    });
  }

  private receive(event: Record<string, unknown>): void {
    if (typeof event.sessionId !== 'string' || typeof event.message !== 'string') return;
    const target = this.targets.get(event.sessionId);
    if (!target) return;
    const message: unknown = JSON.parse(event.message);
    if (!isObject(message)) return;
    if (isObject(message.error)) {
      this.failures.push(`Observer command failed for ${target.kind}`);
      return;
    }
    if (typeof message.method === 'string') this.event(target, message.method, message.params);
  }

  async finish(): Promise<{
    scope: string;
    accounting: string;
    failures: string[];
    assets: AssetRequest[];
  }> {
    await Promise.all(this.pending);
    await this.session.detach();
    return {
      scope: 'Page CDP target, in-process frames, and recursively attached iframe/worker targets',
      accounting:
        'Independent observation: do not add to BrowserContext totals. Request-start phase. ' +
        'loadingFinished reports encoded transfer including response overhead; dataReceived counters ' +
        'report observed decoded/encoded data chunks, which can be incomplete for cache/worker scripts. ' +
        'Pending and failed requests remain explicit. No response bodies are read. ' +
        'New targets are briefly paused to enable network observation before execution.',
      failures: this.failures,
      assets: this.assets,
    };
  }
}
