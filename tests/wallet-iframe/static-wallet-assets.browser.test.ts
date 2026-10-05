import { expect, test } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { build } from 'esbuild';
import type { WorkerRetryResult } from './worker-retry-probe';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '../..');
const PUBLIC_ROOT = path.join(REPO_ROOT, 'packages/wallet/dist/public');
const ASSETS_MANIFEST_PATH = path.join(PUBLIC_ROOT, 'wallet-assets.manifest.json');

type StaticAsset = {
  route: string;
  sourceFile: string;
  contentType: string;
  cachePolicy: string;
  requiredHeaders?: Array<{ name: string; value: string }>;
};

type WorkerLoadResult = {
  route: string;
  ok: boolean;
  message: string;
};

type WasmLoadResult = {
  route: string;
  ok: boolean;
  contentType: string | null;
  message: string;
};

function assetMapByRoute(assets: readonly StaticAsset[]): Map<string, StaticAsset> {
  return new Map(assets.map((asset) => [asset.route, asset]));
}

function normalizeRoute(pathname: string): string {
  if (pathname === '/wallet-service/') return '/wallet-service';
  return pathname;
}

function workerRoutesFromAssets(assets: readonly StaticAsset[]): string[] {
  return assets
    .map((asset) => asset.route)
    .filter((route) => route.startsWith('/sdk/workers/') && route.endsWith('.worker.js'))
    .sort();
}

function workerWasmRoutesFromAssets(assets: readonly StaticAsset[]): string[] {
  return assets
    .map((asset) => asset.route)
    .filter((route) => route.startsWith('/sdk/workers/') && route.endsWith('.wasm'))
    .sort();
}

async function readAssetsManifest(): Promise<{ assets: StaticAsset[] }> {
  const raw = await fs.readFile(ASSETS_MANIFEST_PATH, 'utf8');
  return JSON.parse(raw) as { assets: StaticAsset[] };
}

async function respondWithAsset(response: http.ServerResponse, asset: StaticAsset): Promise<void> {
  const filePath = path.join(PUBLIC_ROOT, asset.sourceFile);
  const content = await fs.readFile(filePath);
  response.statusCode = 200;
  response.setHeader('Content-Type', asset.contentType);
  response.setHeader('Cache-Control', asset.cachePolicy);
  for (const header of asset.requiredHeaders || []) {
    response.setHeader(header.name, header.value);
  }
  response.end(content);
}

function respondNotFound(response: http.ServerResponse): void {
  response.statusCode = 404;
  response.end('not found');
}

class AssetFaults {
  readonly unavailable = new Set<string>();
  readonly requests: { route: string; status: number }[] = [];
}

function handleStaticRequest(
  assetsByRoute: ReadonlyMap<string, StaticAsset>,
  faults: AssetFaults,
  request: http.IncomingMessage,
  response: http.ServerResponse,
): void {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  const route = normalizeRoute(url.pathname);
  const asset = assetsByRoute.get(route);
  if (!asset) {
    respondNotFound(response);
    return;
  }
  const status = faults.unavailable.has(route) ? 503 : 200;
  faults.requests.push({ route, status });
  if (status === 503) {
    response.statusCode = status;
    response.setHeader('Cache-Control', 'no-store');
    response.end('Temporarily unavailable');
    return;
  }
  respondWithAsset(response, asset).catch(respondServerError.bind(null, response));
}

function respondServerError(response: http.ServerResponse, error: unknown): void {
  response.statusCode = 500;
  response.end(String(error instanceof Error ? error.message : error));
}

function createStaticWalletServer(
  assetsByRoute: ReadonlyMap<string, StaticAsset>,
  faults: AssetFaults,
): http.Server {
  return http.createServer(handleStaticRequest.bind(null, assetsByRoute, faults));
}

function listen(server: http.Server): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address() as AddressInfo);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function createWalletServerFixture(): Promise<{
  server: http.Server;
  baseUrl: string;
  assets: StaticAsset[];
  faults: AssetFaults;
}> {
  const manifest = await readAssetsManifest();
  const faults = new AssetFaults();
  const server = createStaticWalletServer(assetMapByRoute(manifest.assets), faults);
  const address = await listen(server);
  return {
    server,
    baseUrl: `http://${address.address}:${address.port}`,
    assets: manifest.assets,
    faults,
  };
}

test('static wallet-service loads workers and worker WASM from dist/public', async ({ page }) => {
  const { server, baseUrl, assets } = await createWalletServerFixture();
  try {
    const response = await page.goto(`${baseUrl}/wallet-service`, {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.ok()).toBe(true);

    const workerRoutes = workerRoutesFromAssets(assets);
    const wasmRoutes = workerWasmRoutesFromAssets(assets);
    expect(workerRoutes.length).toBeGreaterThan(0);
    expect(wasmRoutes.length).toBeGreaterThan(0);

    const results = await page.evaluate(
      async ({ workerRoutes, wasmRoutes }) => {
        function workerLoadResult(route: string): Promise<WorkerLoadResult> {
          return new Promise((resolve) => {
            let settled = false;
            let worker: Worker | undefined;
            const finish = (result: WorkerLoadResult) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              if (worker) worker.terminate();
              resolve(result);
            };
            const timeout = window.setTimeout(() => {
              finish({ route, ok: true, message: 'module worker loaded' });
            }, 750);
            try {
              worker = new Worker(route, { type: 'module' });
            } catch (error) {
              finish({
                route,
                ok: false,
                message: String(error instanceof Error ? error.message : error),
              });
              return;
            }
            worker.addEventListener('message', () => {
              finish({ route, ok: true, message: 'worker posted ready message' });
            });
            worker.addEventListener('error', (event) => {
              finish({ route, ok: false, message: event.message || 'worker error' });
            });
          });
        }

        async function wasmLoadResult(route: string): Promise<WasmLoadResult> {
          try {
            const response = await fetch(route);
            const contentType = response.headers.get('content-type');
            if (!response.ok) {
              return { route, ok: false, contentType, message: `HTTP ${response.status}` };
            }
            const bytes = await response.arrayBuffer();
            await WebAssembly.compile(bytes);
            return { route, ok: true, contentType, message: 'compiled' };
          } catch (error) {
            return {
              route,
              ok: false,
              contentType: null,
              message: String(error instanceof Error ? error.message : error),
            };
          }
        }

        const workerResults = [];
        for (const route of workerRoutes) {
          workerResults.push(await workerLoadResult(route));
        }
        const wasmResults = [];
        for (const route of wasmRoutes) {
          wasmResults.push(await wasmLoadResult(route));
        }
        return { workerResults, wasmResults };
      },
      { workerRoutes, wasmRoutes },
    );

    expect(results.workerResults.filter((result) => !result.ok)).toEqual([]);
    expect(results.wasmResults.filter((result) => !result.ok)).toEqual([]);
    for (const result of results.wasmResults) {
      expect(result.contentType).toBe('application/wasm');
    }
  } finally {
    await close(server);
  }
});

const GENERATOR_PUBLIC_KEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

const RETRY_SCENARIOS = [
  {
    workerUrl: '/sdk/workers/evm-crypto.worker.js',
    wasmUrl: '/sdk/workers/evm_crypto.wasm',
    operation: 'validateSecp256k1PublicKey33',
    payload: { publicKey33: Array.from(Buffer.from(GENERATOR_PUBLIC_KEY, 'hex')) },
    expectedResult: { ok: true, hex: GENERATOR_PUBLIC_KEY },
  },
  {
    workerUrl: '/sdk/workers/tempo-signer.worker.js',
    wasmUrl: '/sdk/workers/tempo_signer.wasm',
    operation: 'computeTempoSenderHash',
    payload: {
      tx: {
        chainId: 42431,
        maxPriorityFeePerGas: '1',
        maxFeePerGas: '2',
        gasLimit: '21000',
        calls: [{ to: `0x${'11'.repeat(20)}`, value: '0', input: '0x' }],
        accessList: [],
        nonceKey: '0',
        nonce: '1',
        feeToken: `0x${'aa'.repeat(20)}`,
        feePayerSignature: { kind: 'placeholder' },
      },
    },
    // Existing signer-core Tempo vector, checked through the emitted browser worker.
    expectedResult: {
      ok: true,
      hex: '84d4731901604de2e1e4d7c9b6919f29f8f8bb7c3975d3495461b7f32768f870',
    },
  },
  {
    workerUrl: '/sdk/workers/shamir3pass.worker.js',
    wasmUrl: '/sdk/workers/shamir3pass_runtime_bg.wasm',
    operation: 'warmup',
    payload: {},
    expectedResult: { ok: true, ready: true },
  },
];

function countAssetRequests(faults: AssetFaults, route: string, status: number): number {
  let count = 0;
  for (const request of faults.requests) {
    if (request.route === route && request.status === status) count += 1;
  }
  return count;
}

test('Email OTP loaders retry delivery failure and reuse successful initialization', async function emailOtpLoaderRetry({
  page,
}, testInfo) {
  const { server, baseUrl, faults } = await createWalletServerFixture();
  const bundle = await build({
    entryPoints: [path.join(TEST_DIR, 'email-otp-loader-retry-probe.ts')],
    tsconfig: path.join(REPO_ROOT, 'packages/wallet/tsconfig.json'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
  });
  const evidence = [];
  try {
    await page.goto(`${baseUrl}/wallet-service`, { waitUntil: 'domcontentloaded' });
    await page.evaluate("globalThis.WASM_BASE_URL = new URL('/sdk/workers/', location.href).href");
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    for (const [loader, filename] of [
      ['evm', 'evm_crypto.wasm'],
      ['email', 'email_otp_runtime_bg.wasm'],
      ['custody', 'wallet_custody_ceremony_bg.wasm'],
    ]) {
      const route = `/sdk/workers/${filename}`;
      faults.unavailable.add(route);
      const failed = await page.evaluate<Array<{ ok: boolean }>>(
        `runEmailOtpLoaderRetry(${JSON.stringify(loader)}, 1)`,
      );
      expect(failed).toHaveLength(1);
      expect(failed[0]!.ok).toBe(false);
      expect(countAssetRequests(faults, route, 503)).toBeGreaterThan(0);
      faults.unavailable.delete(route);
      const concurrent = await page.evaluate(
        `runEmailOtpLoaderRetry(${JSON.stringify(loader)}, 2)`,
      );
      expect(concurrent).toEqual([{ ok: true }, { ok: true }]);
      const reused = await page.evaluate(`runEmailOtpLoaderRetry(${JSON.stringify(loader)}, 1)`);
      expect(reused).toEqual([{ ok: true }]);
      expect(countAssetRequests(faults, route, 200)).toBe(1);
      evidence.push({ loader, failed, concurrent, reused });
    }
    const artifact = testInfo.outputPath('email-otp-loader-retry.json');
    await fs.mkdir(path.dirname(artifact), { recursive: true });
    await fs.writeFile(
      artifact,
      JSON.stringify(
        {
          scope:
            'Production Email OTP loader source bundled for the browser; actual emitted WASM. This probe does not dispatch the full Email OTP worker protocol.',
          evidence,
          requests: faults.requests,
        },
        null,
        2,
      ),
    );
    await testInfo.attach('email-otp-loader-retry.json', {
      path: artifact,
      contentType: 'application/json',
    });
  } finally {
    await page.close();
    await close(server);
  }
});

test('real workers retry failed WASM initialization and coalesce concurrent operations', async function workerRetry({
  page,
}, testInfo) {
  const { server, baseUrl, faults } = await createWalletServerFixture();
  const bundle = await build({
    entryPoints: [path.join(TEST_DIR, 'worker-retry-probe.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
  });
  const evidence = [];
  try {
    await page.goto(`${baseUrl}/wallet-service`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    for (const scenario of RETRY_SCENARIOS) {
      faults.unavailable.add(scenario.wasmUrl);
      await page.evaluate(`startWorkerRetryProbe(${JSON.stringify(scenario)})`);
      const failed = await page.evaluate<WorkerRetryResult[]>('runWorkerRetryProbe(1)');
      expect(failed).toHaveLength(1);
      const failure = failed[0]!;
      expect(failure.ok).toBe(false);
      if (!failure.ok) expect(failure.error).toContain('WASM initialization failed');
      expect(countAssetRequests(faults, scenario.wasmUrl, 503)).toBeGreaterThan(0);

      faults.unavailable.delete(scenario.wasmUrl);
      const concurrent = await page.evaluate<WorkerRetryResult[]>('runWorkerRetryProbe(2)');
      expect(concurrent).toEqual([scenario.expectedResult, scenario.expectedResult]);
      const reused = await page.evaluate<WorkerRetryResult[]>('runWorkerRetryProbe(1)');
      expect(reused).toEqual([scenario.expectedResult]);
      expect(countAssetRequests(faults, scenario.wasmUrl, 200)).toBe(1);
      expect(countAssetRequests(faults, scenario.workerUrl, 200)).toBe(1);
      await page.evaluate('stopWorkerRetryProbe()');
      evidence.push({ worker: scenario.workerUrl, failed, concurrent, reused });
    }
    const artifact = testInfo.outputPath('worker-wasm-retry.json');
    await fs.mkdir(path.dirname(artifact), { recursive: true });
    await fs.writeFile(artifact, JSON.stringify({ evidence, requests: faults.requests }, null, 2));
    await testInfo.attach('worker-wasm-retry.json', {
      path: artifact,
      contentType: 'application/json',
    });
  } finally {
    await page.close();
    await close(server);
  }
});
