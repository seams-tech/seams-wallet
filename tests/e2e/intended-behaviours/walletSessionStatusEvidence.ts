import type { CDPSession, Page, TestInfo } from '@playwright/test';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

type CallFrame = {
  readonly functionName: string;
  readonly url: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
};

type InitiatorStack = {
  readonly callFrames: readonly CallFrame[];
  readonly parent?: InitiatorStack;
};

type StatusRequestEvent = {
  readonly requestId: string;
  readonly timestamp: number;
  readonly frameId?: string;
  readonly request: {
    readonly url: string;
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly postData?: string;
  };
  readonly initiator: { readonly type: string; readonly stack?: InitiatorStack };
};

type RequestCompletion =
  | { readonly kind: 'pending'; readonly endMs?: never }
  | { readonly kind: 'finished' | 'failed'; readonly endMs: number };

type RequestIdentity =
  | { readonly kind: 'identified'; readonly group: number }
  | { readonly kind: 'unavailable'; readonly group?: never };

type StatusRequestEvidence = {
  readonly stage: string;
  readonly initiator: string;
  readonly frames: readonly CallFrame[];
  readonly identity: RequestIdentity;
  readonly frameGroup: number | null;
  readonly startMs: number;
  completion: RequestCompletion;
};

/** Only anonymous identity groups, timings, and caller frames leave this observer. */
export class WalletSessionStatusEvidence {
  private stage = 'registration';
  private readonly identityKey = randomBytes(32);
  private readonly identityGroups = new Map<string, number>();
  private readonly frameGroups = new Map<string, number>();
  private readonly pending = new Map<string, StatusRequestEvidence>();
  private readonly requests: StatusRequestEvidence[] = [];
  private firstTimestamp: number | null = null;

  constructor(private readonly session: CDPSession) {}

  static async start(page: Page): Promise<WalletSessionStatusEvidence> {
    const session = await page.context().newCDPSession(page);
    const observer = new WalletSessionStatusEvidence(session);
    session.on('Network.requestWillBeSent', observer.record.bind(observer));
    session.on('Network.loadingFinished', observer.complete.bind(observer, 'finished'));
    session.on('Network.loadingFailed', observer.complete.bind(observer, 'failed'));
    await session.send('Network.enable');
    await session.send('Debugger.enable');
    await session.send('Debugger.setAsyncCallStackDepth', { maxDepth: 32 });
    return observer;
  }

  setStage(stage: string): void {
    this.stage = stage;
  }

  private record(event: StatusRequestEvent): void {
    if (event.request.method !== 'POST') return;
    if (new URL(event.request.url).pathname !== '/wallet/session/status') return;
    const frames: CallFrame[] = [];
    let stack = event.initiator.stack;
    while (stack) {
      for (const frame of stack.callFrames) {
        frames.push({
          functionName: frame.functionName,
          url: frame.url ? new URL(frame.url).pathname : '',
          lineNumber: frame.lineNumber + 1,
          columnNumber: frame.columnNumber + 1,
        });
      }
      stack = stack.parent;
    }
    this.firstTimestamp ??= event.timestamp;
    const request: StatusRequestEvidence = {
      stage: this.stage,
      initiator: event.initiator.type,
      frames,
      identity: this.identify(event.request),
      frameGroup: event.frameId ? groupNumber(this.frameGroups, event.frameId) : null,
      startMs: (event.timestamp - this.firstTimestamp) * 1_000,
      completion: { kind: 'pending' },
    };
    this.requests.push(request);
    this.pending.set(event.requestId, request);
  }

  private identify(request: StatusRequestEvent['request']): RequestIdentity {
    const authorization = Object.entries(request.headers).find(isAuthorizationHeader)?.[1];
    if (!authorization || !request.postData) return { kind: 'unavailable' };
    let body: unknown;
    try {
      body = JSON.parse(request.postData);
    } catch {
      return { kind: 'unavailable' };
    }
    if (
      !body ||
      typeof body !== 'object' ||
      !('walletSessionId' in body) ||
      typeof body.walletSessionId !== 'string' ||
      !('quotaId' in body) ||
      typeof body.quotaId !== 'string' ||
      Object.keys(body).length !== 2
    ) {
      return { kind: 'unavailable' };
    }
    const fingerprint = createHmac('sha256', this.identityKey)
      .update(JSON.stringify([request.url, authorization, body.walletSessionId, body.quotaId]))
      .digest('hex');
    return { kind: 'identified', group: groupNumber(this.identityGroups, fingerprint) };
  }

  private complete(
    kind: 'finished' | 'failed',
    event: { readonly requestId: string; readonly timestamp: number },
  ): void {
    const request = this.pending.get(event.requestId);
    if (!request || this.firstTimestamp === null) return;
    request.completion = { kind, endMs: (event.timestamp - this.firstTimestamp) * 1_000 };
    this.pending.delete(event.requestId);
  }

  async finish(testInfo: TestInfo): Promise<void> {
    await this.session.detach();
    if (this.requests.length === 0) throw new Error('No Wallet Session status requests observed');
    const host = process.env.SEAMS_INTENDED_WALLET_HOST ?? 'workers_local';
    const name = `wallet-session-status-owners-${host}.json`;
    const artifactPath = path.resolve(testInfo.config.rootDir, '../.artifacts/r151', name);
    const body = JSON.stringify({
      kind: 'wallet_session_status_owners_v2',
      host,
      requests: this.requests,
    }, null, 2);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, body, 'utf8');
    await testInfo.attach(name, { body, contentType: 'application/json' });
  }
}

function isAuthorizationHeader([name]: [string, string]): boolean {
  return name.toLowerCase() === 'authorization';
}

function groupNumber(groups: Map<string, number>, key: string): number {
  const existing = groups.get(key);
  if (existing !== undefined) return existing;
  const group = groups.size + 1;
  groups.set(key, group);
  return group;
}
