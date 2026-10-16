// Usage: node tests/e2e/celld-storage.e2e.mjs <candidate> <stock-celld> <moto-python>
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { closeSync, openSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

assert.equal(process.argv.length, 5, 'provide candidate, stock runtime, and Moto Python');
const [binary, baseline, python] = process.argv.slice(2).map(resolvePath);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = join(root, 'tests/e2e/celld-storage');
await mkdir(join(root, '.artifacts'), { recursive: true });
const directory = await mkdtemp(join(root, '.artifacts/celld-storage-'));
const endpoint = `http://127.0.0.1:${await freePort()}`;
const mapping = { 'role-a': 's3://backup-a', 'role-b': 's3://backup-b' };
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  AWS_ACCESS_KEY_ID: 'local-test',
  AWS_SECRET_ACCESS_KEY: 'local-test-secret',
  AWS_DEFAULT_REGION: 'us-east-1',
  AWS_ENDPOINT_URL: endpoint,
  AWS_EC2_METADATA_DISABLED: 'true',
  AWS_PAGER: '',
  RUST_LOG: 'error',
  CELLD_R2_BUCKETS: JSON.stringify(mapping),
};

function resolvePath(value) {
  return resolve(value);
}
function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function command(command, args) {
  return execFileSync(command, args, { cwd: directory, env, encoding: 'utf8' }).trim();
}
function s3(args) {
  return JSON.parse(command('aws', ['s3api', ...args, '--output', 'json']) || '{}');
}
async function json(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const closed = once(server, 'close');
  server.close();
  await closed;
  return port;
}
function launch(executable, args, name, environment = env) {
  const logPath = join(directory, `${name}.log`);
  const log = openSync(logPath, 'w');
  const child = spawn(executable, args, {
    cwd: directory,
    env: environment,
    detached: true,
    stdio: ['ignore', log, log],
  });
  closeSync(log);
  return { child, logPath };
}
async function stop(runtime) {
  if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) return;
  const exited = once(runtime.child, 'exit');
  process.kill(-runtime.child.pid, 'SIGTERM');
  await Promise.race([exited, delay(10_000, null, { ref: false })]);
  if (runtime.child.exitCode === null && runtime.child.signalCode === null) {
    process.kill(-runtime.child.pid, 'SIGKILL');
    await exited;
  }
}
async function ready(runtime, url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (runtime.child.exitCode !== null) throw new Error(await readFile(runtime.logPath, 'utf8'));
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(300) });
      if (response.ok) return;
    } catch {
      /* The listener is not ready yet. */
    }
    await delay(100);
  }
  throw new Error(`readiness timed out: ${await readFile(runtime.logPath, 'utf8')}`);
}
async function start(config, name, environment = env) {
  const port = await freePort();
  const runtime = launch(
    binary,
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
    name,
    environment,
  );
  runtime.url = `http://127.0.0.1:${port}`;
  return runtime;
}
async function request(runtime, path) {
  const response = await fetch(`${runtime.url}${path}`, { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
async function refusal(executable, environment, reason, name) {
  const attempt = spawnSync(
    executable,
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
      timeout: 10_000,
      env: {
        ...environment,
        CELLD_INTERNAL_DEV_STORE: join(directory, '.celld/dev/objects.sqlite3'),
        CELLD_WATCH: join(directory, `${name}-runtime`),
      },
    },
  );
  const output = `${attempt.stdout ?? ''}${attempt.stderr ?? ''}`;
  await writeFile(join(directory, `${name}.log`), output);
  assert.equal(attempt.error, undefined, output);
  assert.equal(attempt.status, 1, output);
  assert.match(output, reason);
  return { exitCode: attempt.status, output };
}

const result = {
  sourceCommit: command('git', ['-C', root, 'rev-parse', 'HEAD']),
  candidateSha256: hash(await readFile(binary)),
  baselineSha256: hash(await readFile(baseline)),
  harnessSha256: hash(await readFile(fileURLToPath(import.meta.url))),
  fixtureHashes: {
    role: hash(await readFile(join(fixture, 'role.mjs'))),
    router: hash(await readFile(join(fixture, 'router.mjs'))),
  },
  runtime: command(binary, ['--version']),
  moto: command(python, [
    '-c',
    'import importlib.metadata; print(importlib.metadata.version("moto"))',
  ]),
  topology: 'one celld process; two role Workers; separate S3 emulator buckets; local fleet store',
  status: 'running',
  stage: 'prepare',
};
assert.equal(result.moto, '5.1.14');
const emulator = launch(
  python,
  ['-m', 'moto.server', '-H', '127.0.0.1', '-p', new URL(endpoint).port],
  'moto',
);
let runtime = null;
try {
  await ready(emulator, endpoint);
  await copyFile(join(fixture, 'role.mjs'), join(directory, 'role.mjs'));
  await copyFile(join(fixture, 'router.mjs'), join(directory, 'router.mjs'));
  for (const bucket of ['backup-a', 'backup-b']) s3(['create-bucket', '--bucket', bucket]);
  for (const role of ['a', 'b']) {
    await json(join(directory, `${role}.json`), {
      name: `role-${role}`,
      main: 'role.mjs',
      no_bundle: true,
      compatibility_date: '2026-06-12',
      vars: { ROLE: role },
      r2_buckets: [{ binding: 'BACKUP', bucket_name: `role-${role}` }],
    });
    runtime = await start(role, `initialize-${role}`);
    await ready(runtime, `${runtime.url}/health`);
    await stop(runtime);
    runtime = null;
  }
  await json(join(directory, 'router.json'), {
    name: 'router',
    main: 'router.mjs',
    no_bundle: true,
    compatibility_date: '2026-06-12',
    services: [
      { binding: 'A', service: 'role-a' },
      { binding: 'B', service: 'role-b' },
    ],
  });
  runtime = await start('router', 'router');
  await ready(runtime, `${runtime.url}/health`);
  result.stage = 'separate-physical-buckets';
  result.concurrentStreams = await Promise.all([
    request(runtime, '/a/stream'),
    request(runtime, '/b/stream'),
  ]);
  assert.deepEqual(result.concurrentStreams, [
    { size: 9 * 1024 * 1024 },
    { size: 9 * 1024 * 1024 },
  ]);
  result.roles = {};
  for (const role of ['a', 'b']) {
    const bindings = await request(runtime, `/${role}/bindings`);
    assert.deepEqual(bindings, { role, names: ['BACKUP', 'ROLE'] });
    await request(runtime, `/${role}/write`);
    assert.deepEqual(await request(runtime, `/${role}/read`), { value: role });
    assert.deepEqual(await request(runtime, `/${role}/cas`), { accepted: true, refused: true });
    assert.deepEqual(await request(runtime, `/${role}/multipart`), { value: role });
    assert.equal(
      s3(['head-object', '--bucket', `backup-${role}`, '--key', `r2/role-${role}/stream`])
        .ContentLength,
      9 * 1024 * 1024,
    );
    assert.equal(
      s3(['head-object', '--bucket', `backup-${role}`, '--key', `r2/role-${role}/multipart`])
        .ContentLength,
      1,
    );
    await request(runtime, `/${role}/delete`);
    assert.deepEqual(await request(runtime, `/${role}/list`), { keys: ['same-key'] });
    const objects = s3(['list-objects-v2', '--bucket', `backup-${role}`]);
    assert.equal(objects.Contents.length, 1);
    assert.equal(objects.Contents[0].Key, `r2/role-${role}/same-key`);
    const destination = join(directory, `physical-${role}.txt`);
    s3([
      'get-object',
      '--bucket',
      `backup-${role}`,
      '--key',
      `r2/role-${role}/same-key`,
      destination,
    ]);
    const stored = await readFile(destination, 'utf8');
    assert.equal(stored, `${role}-updated`);
    result.roles[role] = {
      bindings,
      physicalKey: objects.Contents[0].Key,
      stored,
      conditionalWrite: 'accepted-then-stale-refused',
      streamedBytes: 9 * 1024 * 1024,
    };
  }
  await stop(runtime);
  runtime = null;
  result.stage = 'restart-and-startup-refusals';
  const fleetReuse = spawnSync(binary, ['r2', 'list', 'role-a', '--bucket', 'backup-a'], {
    cwd: directory,
    env,
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(fleetReuse.status, 1);
  assert.match(fleetReuse.stderr, /distinct from the fleet bucket/);
  result.fleetReuse = { exitCode: fleetReuse.status, output: fleetReuse.stderr };
  result.missing = await refusal(
    binary,
    { ...env, CELLD_R2_BUCKETS: '{}' },
    /no configured physical bucket/,
    'missing',
  );
  result.mismatch = await refusal(
    binary,
    { ...env, CELLD_R2_BUCKETS: JSON.stringify({ ...mapping, 'role-a': 's3://other-backup' }) },
    /differs from deployment manifest/,
    'mismatch',
  );
  result.duplicate = await refusal(
    binary,
    {
      ...env,
      CELLD_R2_BUCKETS: JSON.stringify({ 'role-a': 's3://backup-a', 'role-b': 's3://backup-a' }),
    },
    /distinct physical buckets/,
    'duplicate',
  );
  result.downgrade = await refusal(
    baseline,
    env,
    /physical-r2-buckets-v1|workers-rs-binding-brands-v1/,
    'downgrade',
  );
  runtime = await start('router', 'restart');
  await ready(runtime, `${runtime.url}/health`);
  assert.deepEqual(await request(runtime, '/a/read'), { value: 'a-updated' });
  assert.deepEqual(await request(runtime, '/b/read'), { value: 'b-updated' });
  result.restart = 'both-roles-preserved';
  result.stage = 'missing-bucket-write-failure';
  s3(['delete-object', '--bucket', 'backup-a', '--key', 'r2/role-a/same-key']);
  s3(['delete-bucket', '--bucket', 'backup-a']);
  const failed = await fetch(`${runtime.url}/a/write`, { signal: AbortSignal.timeout(30_000) });
  assert.ok(failed.status >= 500, `missing physical bucket returned ${failed.status}`);
  assert.deepEqual(await request(runtime, '/b/read'), { value: 'b-updated' });
  result.failure = { status: failed.status, peerPreserved: true };
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.error = String(error);
  process.exitCode = 1;
} finally {
  if (runtime !== null) await stop(runtime);
  await stop(emulator);
  result.cleanup = 'runtime and temporary emulator stopped; evidence retained';
  await json(join(directory, 'result.json'), result);
  console.log(`Storage gate ${result.status} at ${result.stage}. Evidence: ${directory}`);
}
