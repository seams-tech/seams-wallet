import type { CDPSession, Page, TestInfo } from '@playwright/test';
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
  readonly request: { readonly url: string; readonly method: string };
  readonly initiator: { readonly type: string; readonly stack?: InitiatorStack };
};

/** Browser initiators identify callers without recording credentials or request bodies. */
export class WalletSessionStatusEvidence {
  private stage = 'registration';
  private readonly requests: {
    readonly stage: string;
    readonly initiator: string;
    readonly frames: readonly CallFrame[];
  }[] = [];

  constructor(private readonly session: CDPSession) {}

  static async start(page: Page): Promise<WalletSessionStatusEvidence> {
    const session = await page.context().newCDPSession(page);
    const observer = new WalletSessionStatusEvidence(session);
    session.on('Network.requestWillBeSent', observer.record.bind(observer));
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
    this.requests.push({ stage: this.stage, initiator: event.initiator.type, frames });
  }

  async finish(testInfo: TestInfo): Promise<void> {
    await this.session.detach();
    if (this.requests.length === 0) throw new Error('No Wallet Session status requests observed');
    const host = process.env.SEAMS_INTENDED_WALLET_HOST ?? 'workers_local';
    const name = `wallet-session-status-owners-${host}.json`;
    const artifactPath = path.resolve(testInfo.config.rootDir, '../.artifacts/r151', name);
    const body = JSON.stringify({
      kind: 'wallet_session_status_owners_v1',
      host,
      requests: this.requests,
    }, null, 2);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, body, 'utf8');
    await testInfo.attach(name, { body, contentType: 'application/json' });
  }
}
