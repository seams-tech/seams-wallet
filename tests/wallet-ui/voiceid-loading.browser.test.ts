import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type {} from '../fixtures/ui/VoiceIdLoadingProbe';

const sdk = path.resolve(import.meta.dirname, '../../packages/voiceid/dist/public/sdk');
const assetPaths = [
  '/sdk/voiceid/ort-wasm-simd-threaded.wasm',
  '/sdk/voiceid/redimnet-b1.onnx',
  '/sdk/voiceid/aurora-int8.onnx',
  '/sdk/voiceid/silero-vad.onnx',
];

class LoadingServer {
  readonly requests: string[] = [];
  private readonly server = createServer();
  private readonly chunks: { fileName: string; code: string }[] = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve(import.meta.dirname, '../scripts/build-preact-probe.mjs'),
        'VoiceIdLoadingProbe.ts',
      ],
      { encoding: 'utf8' },
    ),
  );
  private failEngine = true;

  async start(): Promise<string> {
    this.server.on('request', this.handle);
    this.server.listen(0, '127.0.0.1');
    await new Promise<void>(this.listening);
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Missing loading server port');
    return `http://localhost:${address.port}`;
  }

  private readonly listening = (resolve: () => void, reject: (error: Error) => void): void => {
    this.server.once('listening', resolve);
    this.server.once('error', reject);
  };

  close(): void {
    this.server.closeAllConnections();
    this.server.close();
  }

  private readonly handle = (request: IncomingMessage, response: ServerResponse): void => {
    void this.respond(request, response).catch(this.failed.bind(this, response));
  };

  private failed(response: ServerResponse, error: Error): void {
    response.destroy(error);
  }

  private async respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const pathname = url.pathname;
    this.requests.push(pathname);
    response.setHeader('Cache-Control', 'no-store');
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><html lang="en"><link rel="stylesheet" href="/sdk/wallet-ui.css"><script type="module" src="/probe/probe.js"></script></html>',
      );
      return;
    }
    if (pathname.startsWith('/probe/')) {
      const chunk = this.chunks.find(matchesChunk.bind(null, path.basename(pathname)));
      response.statusCode = chunk ? 200 : 404;
      response.setHeader('Content-Type', 'text/javascript');
      // Hold the real runtime module so the preparation stage is observable.
      if (pathname.includes('ort.wasm')) await delay(900);
      response.end(chunk?.code ?? '');
      return;
    }
    if (pathname === assetPaths[0] && this.failEngine) {
      this.failEngine = false;
      response.writeHead(503).end();
      return;
    }
    const permitted = [...assetPaths, '/sdk/voiceid/ort-wasm-simd-threaded.mjs', '/sdk/wallet-ui.css'];
    if (!permitted.includes(pathname) && pathname !== '/speech.wav') {
      response.writeHead(404).end();
      return;
    }
    const bytes = readFileSync(assetFile(pathname));
    response.setHeader('Content-Type', assetContentType(pathname));
    response.setHeader('Content-Length', bytes.length);
    for (let offset = 0; offset < bytes.length; offset += 131_072) {
      if (response.destroyed) return;
      response.write(bytes.subarray(offset, offset + 131_072));
      if (assetPaths.includes(pathname)) await delay(12);
    }
    response.end();
  }
}

function assetFile(pathname: string): string {
  if (pathname === '/speech.wav') {
    return path.resolve(import.meta.dirname, '../fixtures/audio/aurora/natural/0.wav');
  }
  if (pathname === '/sdk/wallet-ui.css') {
    return path.resolve(import.meta.dirname, '../../packages/wallet/dist/public/sdk/wallet-ui.css');
  }
  return path.join(sdk, pathname.slice('/sdk/'.length));
}

function assetContentType(pathname: string): string {
  if (pathname.endsWith('.mjs')) return 'text/javascript';
  if (pathname.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}

function matchesChunk(name: string, chunk: { fileName: string }): boolean {
  return chunk.fileName === name;
}

function observedProgress() {
  return window.voiceLoadingObservations;
}

async function cacheSummary() {
  const cache = await caches.open('seams-voiceid-models-v1');
  const keys = await cache.keys();
  const entries = [];
  for (const key of keys) {
    const response = await cache.match(key);
    const bytes = await response?.arrayBuffer();
    let sha256 = '';
    if (bytes) {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      for (const byte of digest) sha256 += byte.toString(16).padStart(2, '0');
    }
    entries.push({ url: key.url, bytes: bytes?.byteLength, sha256 });
  }
  return entries;
}

async function corruptCachedPhrase(): Promise<boolean> {
  const cache = await caches.open('seams-voiceid-models-v1');
  for (const key of await cache.keys()) {
    if (new URL(key.url).pathname.endsWith('/aurora-int8.onnx')) {
      await cache.put(key, new Response(new Uint8Array([1, 2, 3])));
      const corrupted = await cache.match(key);
      if ((await corrupted?.arrayBuffer())?.byteLength !== 3) {
        throw new Error('The cache did not retain the corrupted control');
      }
      return true;
    }
  }
  return false;
}

function requiredDownloads(entries: Awaited<ReturnType<typeof cacheSummary>>): string[] {
  const required = [];
  for (const asset of assetPaths) {
    const entry = entries.find(cachePathMatches.bind(null, asset));
    if (
      !entry ||
      entry.bytes !== readFileSync(path.join(sdk, asset.slice('/sdk/'.length))).length ||
      entry.sha256 !== new URL(entry.url).searchParams.get('sha256')
    ) {
      required.push(asset);
    }
  }
  return required;
}

function cachePathMatches(
  asset: string,
  entry: Awaited<ReturnType<typeof cacheSummary>>[number],
): boolean {
  return new URL(entry.url).pathname === asset;
}

test('one VoiceID download survives failure, prepares real models, and reuses a verified cache', async ({
  page,
  browserName,
}, testInfo) => {
  test.setTimeout(120_000);
  const server = new LoadingServer();
  try {
    const origin = await server.start();
    await page.goto(origin);
    expect(server.requests.filter(isAsset)).toEqual([]);
    await page.getByRole('button', { name: 'Load VoiceID' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-result', 'failed');
    await expect(page.getByText('VoiceID engine is unavailable from this Wallet.')).toBeVisible();
    server.requests.length = 0;

    await page.getByRole('button', { name: 'Load VoiceID' }).click();
    const meter = page.getByRole('progressbar', { name: 'VoiceID download' });
    await expect(meter).toHaveCount(1);
    await expect(page.getByText(/Downloading VoiceID: .*%/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('downloading.png') });
    await expect(page.getByText('Preparing VoiceID…', { exact: true })).toBeVisible();
    await expect(meter).not.toHaveAttribute('value');
    await page.screenshot({ path: testInfo.outputPath('preparing.png') });
    await expect(page.locator('body')).toHaveAttribute('data-result', 'ready', { timeout: 60_000 });
    const cold = await page.evaluate(observedProgress);
    const downloaded = cold.filter(isDownloading);
    expect(downloaded.length).toBeGreaterThan(5);
    expect(new Set(downloaded.map(progressTotal)).size).toBe(1);
    for (let index = 1; index < downloaded.length; index += 1) {
      expect(downloaded[index].value).toBeGreaterThanOrEqual(downloaded[index - 1].value);
    }
    expect(downloaded.at(-1)?.value).toBe(downloaded.at(-1)?.total);
    expect(server.requests.filter(isAsset).sort()).toEqual([...assetPaths].sort());
    const coldRequests = [...server.requests];
    const coldCache = await page.evaluate(cacheSummary);
    if (browserName !== 'webkit') expect(requiredDownloads(coldCache)).toEqual([]);

    const corrupted = await page.evaluate(corruptCachedPhrase);
    if (browserName !== 'webkit') expect(corrupted).toBe(true);
    await page.reload();
    const repairCache = await page.evaluate(cacheSummary);
    if (browserName !== 'webkit') {
      expect(requiredDownloads(repairCache)).toEqual(['/sdk/voiceid/aurora-int8.onnx']);
    }
    server.requests.length = 0;
    await page.getByRole('button', { name: 'Load VoiceID' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-result', 'ready', { timeout: 60_000 });
    // WebKit can discard Cache Storage on navigation. Only absent or invalid bytes may refetch.
    expect(server.requests.filter(isAsset)).toEqual(requiredDownloads(repairCache));
    const repairedRequests = [...server.requests];

    await page.reload();
    const warmCache = await page.evaluate(cacheSummary);
    if (browserName !== 'webkit') expect(requiredDownloads(warmCache)).toEqual([]);
    server.requests.length = 0;
    await page.getByRole('button', { name: 'Load VoiceID' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-result', 'ready', { timeout: 60_000 });
    expect(server.requests.filter(isAsset)).toEqual(requiredDownloads(warmCache));
    writeFileSync(
      testInfo.outputPath('voiceid-loading.json'),
      JSON.stringify(
        {
          status: 'passed',
          realModels: true,
          cold,
          coldRequests,
          coldCache,
          corrupted,
          repairCache,
          repairedRequests,
          warmCache,
          warmRequests: server.requests,
        },
        null,
        2,
      ),
    );
  } finally {
    server.close();
  }
});

function isAsset(request: string): boolean {
  return assetPaths.includes(request);
}

function isDownloading(progress: Window['voiceLoadingObservations'][number]): boolean {
  return progress.state === 'downloading';
}

function progressTotal(progress: Window['voiceLoadingObservations'][number]): number {
  return progress.total;
}
