// Usage: node tests/e2e/celld-bindings.e2e.mjs /path/to/candidate /path/to/celld-0.6.2
// A failed capability gate writes its evidence and exits with status 1.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { closeSync, openSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtures = join(root, 'tests/e2e/celld-bindings');
assert.equal(process.argv.length, 4, 'provide candidate and original celld binary paths');
const binary = resolve(process.argv[2]);
const baselineBinary = resolve(process.argv[3]);
const compatibilityDate = '2026-06-12';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function commandVersion(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, RUST_LOG: 'error' },
  }).trim();
}

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const closed = once(server, 'close');
  server.close();
  await closed;
  return port;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function responseValue(response) {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

async function referenceScenario() {
  const runtime = new Miniflare({
    workers: [
      {
        name: 'caller',
        bindings: { OWNER_LABEL: 'caller' },
        modules: true,
        scriptPath: join(fixtures, 'caller.mjs'),
        compatibilityDate,
        serviceBindings: { ROUTER: 'owner' },
        durableObjects: {
          TENANT_ROOT: { className: 'TenantRoot', scriptName: 'owner', useSQLite: true },
        },
      },
      {
        name: 'owner',
        bindings: { OWNER_LABEL: 'router' },
        modules: true,
        scriptPath: join(fixtures, 'owner.mjs'),
        compatibilityDate,
        durableObjects: { TENANT_ROOT: { className: 'TenantRoot', useSQLite: true } },
      },
    ],
  });
  try {
    const throughService = await responseValue(
      await runtime.dispatchFetch('http://probe/service/increment'),
    );
    const throughObject = await responseValue(
      await runtime.dispatchFetch('http://probe/object/increment'),
    );
    const readThroughService = await responseValue(
      await runtime.dispatchFetch('http://probe/service/read'),
    );
    assertObject(throughService, 1);
    assertObject(throughObject, 2);
    assert.equal(throughService.id, throughObject.id);
    assert.deepEqual(readThroughService, throughObject);
    return { throughService, throughObject, readThroughService };
  } finally {
    await runtime.dispose();
  }
}

function assertObject(value, count) {
  assert.equal(value.owner, 'router');
  assert.equal(value.count, count);
  assert.match(value.id, /^[a-f0-9]{64}$/);
}

async function prepareProject(directory) {
  await copyFile(join(fixtures, 'owner.mjs'), join(directory, 'owner.mjs'));
  await copyFile(join(fixtures, 'caller.mjs'), join(directory, 'caller.mjs'));
  const owner = {
    name: 'owner',
    main: 'owner.mjs',
    no_bundle: true,
    compatibility_date: compatibilityDate,
    durable_objects: { bindings: [{ name: 'TENANT_ROOT', class_name: 'TenantRoot' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['TenantRoot'] }],
    vars: { OWNER_LABEL: 'router' },
  };
  await writeJson(join(directory, 'owner.json'), owner);
  const caller = {
    name: 'caller',
    main: 'caller.mjs',
    no_bundle: true,
    compatibility_date: compatibilityDate,
    services: [{ binding: 'ROUTER', service: 'owner' }],
    vars: { OWNER_LABEL: 'caller' },
  };
  await writeJson(join(directory, 'service.json'), caller);
  const external = {
    ...caller,
    durable_objects: {
      bindings: [
        { name: 'TENANT_ROOT', class_name: 'TenantRoot', script_name: 'owner' },
        { name: 'ALIAS', class_name: 'TenantRoot', script_name: 'owner' },
      ],
    },
  };
  await writeJson(join(directory, 'external.json'), external);
  await writeJson(join(directory, 'restart.json'), external);
  await writeJson(join(directory, 'object-only.json'), { ...external, services: [] });
  await writeJson(join(directory, 'router.json'), {
    ...owner,
    services: [{ binding: 'CONTROL_PLANE', service: 'caller' }],
  });
  await writeJson(join(directory, 'other.json'), { ...caller, name: 'other', services: [] });
  await writeJson(join(directory, 'wrong-owner.json'), {
    ...caller,
    durable_objects: {
      bindings: [{ name: 'TENANT_ROOT', class_name: 'TenantRoot', script_name: 'other' }],
    },
  });
  await writeJson(join(directory, 'missing-owner.json'), {
    ...caller,
    durable_objects: {
      bindings: [{ name: 'TENANT_ROOT', class_name: 'TenantRoot', script_name: 'missing' }],
    },
  });
}

async function startCelld(directory, config, executable) {
  const port = await freePort();
  const logPath = join(directory, `${config}.log`);
  const log = openSync(logPath, 'w');
  const child = spawn(
    executable,
    [
      'dev',
      join(directory, `${config}.json`),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--no-watch',
      '--logs',
    ],
    {
      cwd: directory,
      detached: true,
      stdio: ['ignore', log, log],
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
    },
  );
  closeSync(log);
  await once(child, 'spawn');
  return { child, url: `http://127.0.0.1:${port}`, logPath };
}

async function waitReady(runtime) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) {
      throw new Error(`celld exited before readiness: ${await readFile(runtime.logPath, 'utf8')}`);
    }
    try {
      const response = await fetch(`${runtime.url}/health`, { signal: AbortSignal.timeout(500) });
      if (response.status === 200 && (await response.text()) === 'ready') return;
    } catch {
      // Connection refusal is expected while the runtime starts.
    }
    await delay(100);
  }
  throw new Error(`celld readiness timed out: ${await readFile(runtime.logPath, 'utf8')}`);
}

async function stopCelld(runtime) {
  if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) return;
  const exited = once(runtime.child, 'exit');
  process.kill(-runtime.child.pid, 'SIGTERM');
  try {
    await Promise.race([exited, delay(10_000, null, { ref: false })]);
  } finally {
    if (runtime.child.exitCode === null && runtime.child.signalCode === null) {
      process.kill(-runtime.child.pid, 'SIGKILL');
      await exited;
    }
  }
}

async function celldScenario(directory, config, paths, executable = binary) {
  const runtime = await startCelld(directory, config, executable);
  try {
    await waitReady(runtime);
    const values = [];
    for (const path of paths) {
      values.push(
        await responseValue(
          await fetch(`${runtime.url}${path}`, {
            signal: AbortSignal.timeout(5_000),
          }),
        ),
      );
    }
    return values;
  } finally {
    await stopCelld(runtime);
  }
}

async function expectOwnerRefusal(directory, config, reason) {
  const runtime = await startCelld(directory, config, binary);
  let refusal = null;
  try {
    await waitReady(runtime);
  } catch (error) {
    refusal = String(error);
  } finally {
    await stopCelld(runtime);
  }
  assert.equal(typeof refusal, 'string', 'an invalid owner must prevent startup');
  assert.match(refusal, reason);
  return refusal;
}

async function refuseOldRuntime(directory) {
  const attempt = spawnSync(
    baselineBinary,
    [
      '--no-control-plane',
      '--bucket',
      'celld-dev',
      '--listen',
      '127.0.0.1:0',
      '--internal-listen',
      '127.0.0.1:0',
    ],
    {
      cwd: directory,
      encoding: 'utf8',
      timeout: 5_000,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        CELLD_INTERNAL_DEV_STORE: join(directory, '.celld/dev/objects.sqlite3'),
        CELLD_WATCH: join(directory, 'downgrade-runtime'),
      },
    },
  );
  const output = `${attempt.stdout ?? ''}${attempt.stderr ?? ''}`;
  await writeFile(join(directory, 'downgrade.log'), output);
  assert.equal(attempt.error, undefined);
  assert.equal(attempt.signal, null);
  assert.equal(attempt.status, 1);
  assert.match(output, /external-durable-objects-v1/);
  return { exitCode: attempt.status, output };
}

await mkdir(join(root, '.artifacts'), { recursive: true });
const directory = await mkdtemp(join(root, '.artifacts/celld-bindings-'));
const result = {
  recordedAt: new Date().toISOString(),
  sourceCommit: commandVersion('git', ['rev-parse', 'HEAD']),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  celld: commandVersion(binary, ['--version']),
  celldSha256: sha256(await readFile(binary)),
  baselineCelld: commandVersion(baselineBinary, ['--version']),
  baselineSha256: sha256(await readFile(baselineBinary)),
  miniflare: require('miniflare/package.json').version,
  workerd: require('workerd/package.json').version,
  harnessSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
  fixtureHashes: {
    owner: sha256(await readFile(join(fixtures, 'owner.mjs'))),
    caller: sha256(await readFile(join(fixtures, 'caller.mjs'))),
  },
  status: 'running',
  stage: 'reference',
};

try {
  result.reference = await referenceScenario();
  result.stage = 'celld-service-control';
  await prepareProject(directory);
  // Each config shares this dev directory. Named deployments and state survive restart.
  result.owner = await celldScenario(directory, 'owner', ['/increment'], baselineBinary);
  assertObject(result.owner[0], 1);
  result.serviceControl = await celldScenario(directory, 'service', [
    '/service/increment',
    '/service/read',
  ]);
  assertObject(result.serviceControl[0], 2);
  assert.deepEqual(result.serviceControl[0], result.serviceControl[1]);
  assert.equal(result.owner[0].id, result.serviceControl[0].id);
  result.stage = 'celld-cross-script-object';
  result.crossScript = await celldScenario(directory, 'external', [
    '/object/increment',
    '/alias/read',
    '/service/read',
  ]);
  assertObject(result.crossScript[0], 3);
  assert.deepEqual(result.crossScript[0], result.crossScript[1]);
  assert.deepEqual(result.crossScript[0], result.crossScript[2]);
  assert.equal(result.owner[0].id, result.crossScript[0].id);
  result.stage = 'celld-restart';
  result.restart = await celldScenario(directory, 'restart', ['/object/read']);
  assert.deepEqual(result.restart[0], result.crossScript[0]);
  result.stage = 'celld-object-only-dependency';
  result.objectOnly = await celldScenario(directory, 'object-only', ['/object/read']);
  assert.deepEqual(result.objectOnly[0], result.crossScript[0]);
  result.stage = 'celld-router-cycle';
  result.routerCycle = await celldScenario(directory, 'router', ['/caller/increment', '/read']);
  assertObject(result.routerCycle[0], 4);
  assert.deepEqual(result.routerCycle[0], result.routerCycle[1]);
  assert.equal(result.owner[0].id, result.routerCycle[0].id);
  result.stage = 'celld-owner-rejection';
  await celldScenario(directory, 'other', []);
  result.wrongOwner = await expectOwnerRefusal(
    directory,
    'wrong-owner',
    /not owned by script other/,
  );
  result.missingOwner = await expectOwnerRefusal(
    directory,
    'missing-owner',
    /load Worker binding target missing/,
  );
  result.stage = 'celld-recovery-after-rejection';
  result.recovery = await celldScenario(directory, 'object-only', ['/object/read']);
  assert.deepEqual(result.recovery[0], result.routerCycle[0]);
  result.stage = 'celld-downgrade-refusal';
  result.downgradeRefusal = await refuseOldRuntime(directory);
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.error = String(error);
  process.exitCode = 1;
} finally {
  await writeJson(join(directory, 'result.json'), result);
  console.log(`Workers binding gate ${result.status} at ${result.stage}. Evidence: ${directory}`);
}
