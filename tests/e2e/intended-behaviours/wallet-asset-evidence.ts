import type { BrowserContext, Page, Request, TestInfo, Worker } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WalletAssetNetworkEvidence } from './wallet-asset-network-evidence';

type AssetEvidence = {
  phase: string;
  url: string;
  realm: string;
  resourceType: string;
  status: number;
  contentEncoding: string;
  encodedBodyBytes: number;
  responseHeaderBytes: number;
  decodedBodyBytes: number | null;
};

type WorkerEvidence = {
  phase: string;
  url: string;
  pageOrigin: string;
};

function publicAssetUrl(raw: string): string | null {
  const url = new URL(raw);
  if (!/\.(?:m?js|wasm|css)$/u.test(url.pathname)) return null;
  return `${url.origin}${url.pathname}`;
}

function requestRealm(request: Request): string {
  try {
    return new URL(request.frame().url()).origin;
  } catch {
    return 'worker-or-unattributed';
  }
}

export class WalletAssetEvidence {
  private phase = 'initialization';
  private phaseStart = performance.now();
  private readonly assets: AssetEvidence[] = [];
  private readonly workers: WorkerEvidence[] = [];
  private readonly phases: { name: string; durationMs: number }[] = [];
  private readonly pending = new Set<Promise<void>>();
  private readonly failures: string[] = [];
  private readonly pageListeners = new Map<Page, (worker: Worker) => void>();
  private readonly requestListener = this.onRequestFinished.bind(this);
  private readonly pageListener = this.onPage.bind(this);
  private network: WalletAssetNetworkEvidence | null = null;

  constructor(private readonly context: BrowserContext) {
    context.on('requestfinished', this.requestListener);
    context.on('page', this.pageListener);
    for (const page of context.pages()) this.onPage(page);
  }

  async observeNetwork(page: Page): Promise<void> {
    this.network = await WalletAssetNetworkEvidence.start(page, this.getPhase.bind(this));
  }

  private getPhase(): string {
    return this.phase;
  }

  setPhase(name: string): void {
    this.phases.push({ name: this.phase, durationMs: performance.now() - this.phaseStart });
    this.phase = name;
    this.phaseStart = performance.now();
  }

  private onPage(page: Page): void {
    const listener = this.onWorker.bind(this, page);
    this.pageListeners.set(page, listener);
    page.on('worker', listener);
  }

  private onWorker(page: Page, worker: Worker): void {
    const url = publicAssetUrl(worker.url());
    this.workers.push({
      phase: this.phase,
      url: url ?? new URL(worker.url()).protocol,
      pageOrigin: new URL(page.url()).origin,
    });
  }

  private onRequestFinished(request: Request): void {
    const url = publicAssetUrl(request.url());
    if (!url) return;
    const result = this.capture(request, url, this.phase);
    this.pending.add(result);
    void result.then(this.removePending.bind(this, result));
  }

  private removePending(result: Promise<void>): void {
    this.pending.delete(result);
  }

  private async capture(request: Request, url: string, phase: string): Promise<void> {
    const deadline = new AbortController();
    try {
      const asset = await Promise.race([
        readAsset(request, url, phase),
        delay(5_000, null, { signal: deadline.signal, ref: false }),
      ]);
      if (asset) this.assets.push(asset);
      else this.failures.push(url);
    } catch {
      this.failures.push(url);
    } finally {
      deadline.abort();
    }
  }

  async finish(testInfo: TestInfo): Promise<void> {
    this.context.off('requestfinished', this.requestListener);
    this.context.off('page', this.pageListener);
    for (const [page, listener] of this.pageListeners) page.off('worker', listener);
    this.phases.push({ name: this.phase, durationMs: performance.now() - this.phaseStart });
    await Promise.all(this.pending);
    const network = this.network ? await this.network.finish() : null;
    const report = {
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      productionApp: process.env.SEAMS_INTENDED_PRODUCTION === '1',
      walletDistRoot: process.env.SEAMS_INTENDED_WALLET_DIST_ROOT ?? 'packages/wallet/dist',
      accounting: {
        scope: 'BrowserContext requestfinished events and Page dedicated-worker events',
        phaseAttribution:
          'Request completion phase; concurrent requests may cross phase boundaries',
        bytes:
          'Encoded response body and HTTP response headers counted separately; decoded bodies where available',
        cache:
          'Intended harness request routing disables HTTP cache; repeat phases measure warm runtime only',
        omissions:
          'No claim of complete worker-target network coverage; no service-worker or socket accounting',
        privacy:
          'Only static asset URLs without query strings; no request headers, payloads, auth responses, or bodies retained',
      },
      phases: this.phases,
      assets: this.assets,
      workers: this.workers,
      failures: this.failures,
      network,
      totals: {
        encodedBodyBytes: this.assets.reduce(sumEncodedBytes, 0),
        responseHeaderBytes: this.assets.reduce(sumHeaderBytes, 0),
        decodedBodyBytes: this.assets.reduce(sumDecodedBytes, 0),
        unknownDecodedBodies: this.assets.filter(hasUnknownBody).length,
      },
    };
    const artifact = testInfo.outputPath('wallet-assets.json');
    await mkdir(path.dirname(artifact), { recursive: true });
    await writeFile(artifact, JSON.stringify(report, null, 2));
    await testInfo.attach('wallet-assets.json', {
      path: artifact,
      contentType: 'application/json',
    });
  }
}

async function readAsset(request: Request, url: string, phase: string): Promise<AssetEvidence> {
  const response = await request.response();
  if (!response) throw new Error('Missing response');
  const sizes = await request.sizes();
  let decodedBodyBytes: number | null = null;
  try {
    decodedBodyBytes = (await response.body()).byteLength;
  } catch {
    // Browser worker/cache responses can lack a readable decoded body.
  }
  return {
    phase,
    url,
    realm: requestRealm(request),
    resourceType: request.resourceType(),
    status: response.status(),
    contentEncoding: (await response.headerValue('content-encoding')) ?? 'identity',
    encodedBodyBytes: sizes.responseBodySize,
    responseHeaderBytes: sizes.responseHeadersSize,
    decodedBodyBytes,
  };
}

function sumEncodedBytes(total: number, asset: AssetEvidence): number {
  return total + asset.encodedBodyBytes;
}

function sumHeaderBytes(total: number, asset: AssetEvidence): number {
  return total + asset.responseHeaderBytes;
}

function sumDecodedBytes(total: number, asset: AssetEvidence): number {
  return total + (asset.decodedBodyBytes ?? 0);
}

function hasUnknownBody(asset: AssetEvidence): boolean {
  return asset.decodedBodyBytes === null;
}
