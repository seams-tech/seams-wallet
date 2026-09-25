// R150 Router wallet-lane E2E.
//
// Drives the real lane lifecycle domain logic through both host adapters of
// the same store:
//   1. Cloudflare: the Router wallet-lane Durable Object in workerd
//      (Miniflare), including an object restart from persisted SQLite.
//   2. VM: two ordinary Node service processes sharing one role-private data
//      directory (one SQLite file per wallet), including a SIGKILL restart.
// It writes one JSON evidence artifact and exits non-zero on any failed check.
//
//   node_modules/.bin/tsx --tsconfig packages/wallet-server/tsconfig.json \
//     tests/r150-router-wallet-lanes/run.ts

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import {
  createRemoteWalletLaneStoresV1,
  parseWalletLaneStoreResponseV1,
  type WalletLaneStoreTransportV1,
  type WalletLaneStoresV1,
} from '../../packages/wallet-server/src/core/signingLanes/walletLanes/walletLaneStoreProtocol';
import { walletLaneStorageNameV1 } from '../../packages/wallet-server/src/core/signingLanes/walletLanes/walletLaneSchema';
import {
  createHttpRouterWalletLaneTransportV1,
  ROUTER_WALLET_LANE_SERVICE_AUTH_HEADER,
} from '../../packages/wallet-server/src/router/node/walletLaneService';
import {
  OTHER_WALLET_OWNER,
  SCENARIO_OWNER,
  runConcurrentCasRace,
  runLaneLifecycleScenario,
} from './laneScenario';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const tsx = join(repo, 'node_modules/.bin/tsx');
const serviceMain = join(repo, 'packages/wallet-server/src/router/node/walletLaneServiceMain.ts');
const tsconfig = join(repo, 'packages/wallet-server/tsconfig.json');

type Check = { readonly name: string; readonly ok: boolean; readonly detail?: unknown };
const checks: Check[] = [];

function check(name: string, ok: boolean, detail?: unknown): void {
  checks.push({ name, ok, detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}\n`);
}

async function expectRejects(name: string, run: () => Promise<unknown>, pattern: RegExp) {
  try {
    await run();
    check(name, false, 'unexpectedly succeeded');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(name, pattern.test(message), message);
  }
}

// ---------------------------------------------------------------- Cloudflare

async function bundleWorker(): Promise<string> {
  const result = await build({
    entryPoints: [join(here, 'durableObjectWorker.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    mainFields: ['module', 'main'],
    tsconfig,
    write: false,
  });
  return result.outputFiles[0].text;
}

function miniflare(script: string, persist: string): Miniflare {
  return new Miniflare({
    modules: true,
    script,
    compatibilityDate: '2026-06-12',
    durableObjects: {
      ROUTER_WALLET_LANES: { className: 'RouterWalletLaneDurableObject', useSQLite: true },
    },
    durableObjectsPersist: persist,
  });
}

function miniflareTransport(get: () => Miniflare): WalletLaneStoreTransportV1 {
  return async (request) => {
    const response = await get().dispatchFetch('http://router-lanes.test/v1/call', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    return parseWalletLaneStoreResponseV1(await response.json());
  };
}

async function runDurableObjectHost(root: string) {
  const script = await bundleWorker();
  const persist = join(root, 'durable-objects');
  let mf = miniflare(script, persist);
  const transport = miniflareTransport(() => mf);
  const stores = createRemoteWalletLaneStoresV1({ owner: SCENARIO_OWNER, transport });
  const scenario = await runLaneLifecycleScenario({ stores, label: 'durable-object', seed: 'do' });
  check('DO: lane lifecycle scenario', scenario.ok, scenario);
  // Domain timestamps behind the object's clock (a caller clock that lags)
  // must not break revocation bookkeeping.
  const laggingClock = await runLaneLifecycleScenario({
    stores,
    label: 'durable-object-lagging-clock',
    seed: 'do-lagging-clock',
    timeBaseMs: Date.UTC(2026, 0, 1),
  });
  check('DO: lifecycle with a lagging caller clock', laggingClock.ok, laggingClock);

  // Two independent callers race the same operation inside one wallet object.
  const second = createRemoteWalletLaneStoresV1({ owner: SCENARIO_OWNER, transport });
  const race = await runConcurrentCasRace({ first: stores, second, seed: 'do-race' });
  check('DO: concurrent protocol commit has one winner', race.applied === 1 && race.conflictOrReplay === 1, race);

  // Object restart: a new runtime over the same persisted SQLite returns the
  // committed records and replays instead of re-applying.
  const before = await snapshot(stores, scenario);
  await mf.dispose();
  mf = miniflare(script, persist);
  const after = await snapshot(stores, scenario);
  check('DO: committed lane state survives object restart', JSON.stringify(before) === JSON.stringify(after), { before, after });
  const replay = await runLaneLifecycleScenario({ stores, label: 'durable-object-restart-replay', seed: 'do', expectReplay: true });
  check('DO: exact retries after restart replay durable outcomes', replay.ok, replay);

  // Owner isolation at the object boundary.
  const otherStores = createRemoteWalletLaneStoresV1({ owner: OTHER_WALLET_OWNER, transport });
  check(
    'DO: another wallet sees none of this wallet\'s lanes',
    (await otherStores.lifecycle.getEnrollment(scenario.enrollmentId as never)) === null,
  );
  const misaddressed = await mf.dispatchFetch('http://router-lanes.test/misaddressed', {
    method: 'POST',
    body: JSON.stringify({
      objectName: await walletLaneStorageNameV1(SCENARIO_OWNER),
      request: {
        kind: 'wallet_lane_store_request_v1',
        owner: OTHER_WALLET_OWNER,
        call: { store: 'lifecycle', method: 'getEnrollment', args: [scenario.enrollmentId] },
      },
    }),
  });
  const misaddressedBody = await misaddressed.json();
  check(
    'DO: a request for another owner is rejected by the addressed object',
    misaddressed.status === 403 || (misaddressedBody as { ok?: boolean }).ok === false,
    { status: misaddressed.status, body: misaddressedBody },
  );
  await mf.dispose();
  return { scenario, laggingClock, race, restart: { before, after }, replay, misaddressed: { status: misaddressed.status, body: misaddressedBody } };
}

// ------------------------------------------------------------------------ VM

type Service = { readonly child: ChildProcess; readonly url: string; readonly port: number };

async function startService(input: {
  readonly dataDirectory: string;
  readonly secretFile: string;
  readonly port: number;
}): Promise<Service> {
  // Node itself runs the service (tsx only as a loader), so SIGKILL reaches
  // the process that owns the listener and the SQLite handles.
  const child = spawn(process.execPath, ['--import', 'tsx', serviceMain, 'serve'], {
    cwd: repo,
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: tsconfig,
      ROUTER_WALLET_LANE_DATA_DIR: input.dataDirectory,
      ROUTER_WALLET_LANE_SERVICE_LISTEN: `127.0.0.1:${input.port}`,
      ROUTER_WALLET_LANE_SERVICE_AUTH_SECRET_FILE: input.secretFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolveReady, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`service did not start: ${output}`)), 30_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('router_wallet_lane_service_listening_v1')) {
        clearTimeout(timer);
        resolveReady();
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', (code) => reject(new Error(`service exited ${code}: ${output}`)));
  });
  return { child, url: `http://127.0.0.1:${input.port}`, port: input.port };
}

function kill(service: Service, signal: NodeJS.Signals): Promise<void> {
  return new Promise((resolveExit) => {
    if (service.child.exitCode !== null) return resolveExit();
    service.child.once('exit', () => resolveExit());
    service.child.kill(signal);
  });
}

function runCheckCommand(dataDirectory: string): { code: number; report: unknown } {
  const result = spawnSync(tsx, ['--tsconfig', tsconfig, serviceMain, 'check'], {
    cwd: repo,
    env: { ...process.env, ROUTER_WALLET_LANE_DATA_DIR: dataDirectory },
    encoding: 'utf8',
  });
  let report: unknown = result.stdout;
  try {
    report = JSON.parse(result.stdout.trim());
  } catch {
    // keep raw output in the evidence
  }
  return { code: result.status ?? -1, report };
}

async function runVmHost(root: string) {
  const dataDirectory = join(root, 'vm-router-lanes');
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const secretFile = join(root, 'router-wallet-lane-service.secret');
  writeFileSync(secretFile, randomBytes(32).toString('base64url'), { mode: 0o600 });
  const secret = readFileSync(secretFile, 'utf8').trim();
  const basePort = 42_000 + Math.floor(Math.random() * 2_000);

  let first = await startService({ dataDirectory, secretFile, port: basePort });
  const second = await startService({ dataDirectory, secretFile, port: basePort + 1 });
  const storesFor = (service: () => Service) =>
    createRemoteWalletLaneStoresV1({
      owner: SCENARIO_OWNER,
      transport: (request) =>
        createHttpRouterWalletLaneTransportV1({ baseUrl: service().url, authSecret: secret })(request),
    });
  const firstStores = storesFor(() => first);
  const secondStores = storesFor(() => second);

  // Each step's exact retry goes to the other process.
  const scenario = await runLaneLifecycleScenario({
    stores: firstStores,
    replayStores: secondStores,
    label: 'vm',
    seed: 'vm',
  });
  check('VM: lane lifecycle scenario across two processes', scenario.ok, scenario);

  const race = await runConcurrentCasRace({ first: firstStores, second: secondStores, seed: 'vm-race' });
  check('VM: cross-process protocol commit race has one winner', race.applied === 1 && race.conflictOrReplay === 1, race);

  // Crash one process without shutdown; its replacement serves committed state.
  const before = await snapshot(firstStores, scenario);
  await kill(first, 'SIGKILL');
  first = await startService({ dataDirectory, secretFile, port: basePort });
  const after = await snapshot(firstStores, scenario);
  check('VM: committed lane state survives SIGKILL restart', JSON.stringify(before) === JSON.stringify(after), { before, after });
  const replay = await runLaneLifecycleScenario({
    stores: firstStores,
    replayStores: secondStores,
    label: 'vm-restart-replay',
    seed: 'vm',
    expectReplay: true,
  });
  check('VM: exact retries after restart replay durable outcomes', replay.ok, replay);

  // Credential and owner boundaries.
  const unauthorized = await fetch(`${first.url}/v1/call`, {
    method: 'POST',
    headers: { [ROUTER_WALLET_LANE_SERVICE_AUTH_HEADER]: 'x'.repeat(40) },
    body: '{}',
  });
  check('VM: wrong service credential is rejected', unauthorized.status === 401, unauthorized.status);
  const otherStores = createRemoteWalletLaneStoresV1({
    owner: OTHER_WALLET_OWNER,
    transport: createHttpRouterWalletLaneTransportV1({ baseUrl: first.url, authSecret: secret }),
  });
  check(
    'VM: another wallet sees none of this wallet\'s lanes',
    (await otherStores.lifecycle.getEnrollment(scenario.enrollmentId as never)) === null,
  );
  await expectRejects(
    'VM: short service credential is refused by the client',
    async () => createHttpRouterWalletLaneTransportV1({ baseUrl: first.url, authSecret: 'short' }),
    /at least 32 bytes/,
  );

  // Read-only diagnostic over the role-private directory.
  const files = readdirSync(dataDirectory).filter((name) => name.endsWith('.sqlite'));
  const diagnostic = runCheckCommand(dataDirectory);
  check('VM: read-only check accepts the data directory', diagnostic.code === 0, diagnostic.report);
  // Only the wallet that wrote lanes has storage; the other wallet only read.
  const expectedFile = `${await walletLaneStorageNameV1(SCENARIO_OWNER)}.sqlite`;
  check(
    'VM: one SQLite file per writing wallet; reads create no storage',
    files.length === 1 && files[0] === expectedFile,
    files,
  );

  await Promise.all([kill(first, 'SIGTERM'), kill(second, 'SIGTERM')]);
  return { scenario, race, restart: { before, after }, replay, diagnostic, files };
}

async function snapshot(
  stores: WalletLaneStoresV1,
  scenario: { readonly enrollmentId: string; readonly operationId: string },
) {
  const enrollment = await stores.lifecycle.getEnrollment(scenario.enrollmentId as never);
  const protocol = await stores.lifecycle.getProtocol(scenario.operationId as never);
  const products = await stores.lifecycle.listEnrollmentProductEpochs(scenario.enrollmentId as never);
  return { enrollment, protocol, products };
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'r150-router-wallet-lanes-'));
  const startedAt = new Date().toISOString();
  const durableObject = await runDurableObjectHost(root);
  const vm = await runVmHost(root);
  const ok = checks.every((entry) => entry.ok);
  const artifactDir = join(repo, 'test-results/r150-router-wallet-lanes');
  mkdirSync(artifactDir, { recursive: true });
  const artifact = join(artifactDir, `evidence-${startedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(
    artifact,
    `${JSON.stringify(
      {
        kind: 'r150_router_wallet_lane_e2e_v1',
        startedAt,
        finishedAt: new Date().toISOString(),
        node: process.version,
        ok,
        checks,
        durableObject,
        vm,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`${ok ? 'OK' : 'FAILED'} evidence: ${artifact}\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
