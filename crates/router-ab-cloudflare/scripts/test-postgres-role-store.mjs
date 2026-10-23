import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPostgresWorker } from './postgres-worker-evidence.mjs';
import { setTimeout } from 'node:timers/promises';

const crate = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(crate, '../..');
const output = resolve(root, '.artifacts/postgres-role-store');
const image = 'postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';

function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

async function ready(container) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres');
      return;
    } catch {
      await setTimeout(100);
    }
  }
  throw new Error('Local PostgreSQL did not become ready');
}

function identity(path) {
  const bytes = readFileSync(resolve(root, path));
  return { path, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function main() {
  await mkdir(output, { recursive: true });
  const adminPassword = randomBytes(24).toString('hex');
  const passwordA = randomBytes(24).toString('hex');
  const passwordB = randomBytes(24).toString('hex');
  const container = docker('run', '--detach', '--rm', '--publish', '127.0.0.1::5432',
    '--env', `POSTGRES_PASSWORD=${adminPassword}`, image);
  try {
    await ready(container);
    const binding = docker('port', container, '5432/tcp');
    const port = binding.split(':').at(-1);
    execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
      input: `CREATE ROLE runtime_a LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${passwordA}';
CREATE ROLE runtime_b LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${passwordB}';
CREATE DATABASE role_a;
CREATE DATABASE role_b;
REVOKE CONNECT ON DATABASE role_a FROM PUBLIC;
REVOKE CONNECT ON DATABASE role_b FROM PUBLIC;
GRANT CONNECT ON DATABASE role_a TO runtime_a;
GRANT CONNECT ON DATABASE role_b TO runtime_b;
`,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const evidencePath = resolve(output, 'result.json');
    const logPath = resolve(output, 'run.log');
    const descriptor = openSync(logPath, 'w');
    const args = ['test', '--features', 'postgres', '--lib', 'postgres_role_store_e2e', '--', '--nocapture'];
    let exitCode;
    try {
      const child = spawn('cargo', args, {
        cwd: crate,
        env: {
          ...process.env,
          POSTGRES_ROLE_E2E_ADMIN_A_URL: `postgresql://postgres:${adminPassword}@127.0.0.1:${port}/role_a`,
          POSTGRES_ROLE_E2E_ADMIN_B_URL: `postgresql://postgres:${adminPassword}@127.0.0.1:${port}/role_b`,
          POSTGRES_ROLE_E2E_A_URL: `postgresql://runtime_a:${passwordA}@127.0.0.1:${port}/role_a`,
          POSTGRES_ROLE_E2E_B_URL: `postgresql://runtime_b:${passwordB}@127.0.0.1:${port}/role_b`,
          POSTGRES_ROLE_E2E_EVIDENCE_PATH: evidencePath,
        },
        stdio: ['ignore', descriptor, descriptor],
      });
      [exitCode] = await once(child, 'exit');
    } finally {
      closeSync(descriptor);
    }
    if (exitCode !== 0) {
      process.stderr.write(readFileSync(logPath, 'utf8'));
      throw new Error(`PostgreSQL role-store E2E exited ${exitCode}`);
    }
    const result = JSON.parse(readFileSync(evidencePath, 'utf8'));
    for (const database of ['role_a', 'role_b']) {
      const runtimeRole = database === 'role_a' ? 'runtime_a' : 'runtime_b';
      execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'], {
        input: `CREATE TABLE worker_role_probe (id TEXT PRIMARY KEY, value BIGINT NOT NULL, note TEXT NOT NULL, state TEXT NOT NULL);
CREATE SEQUENCE worker_role_probe_attempts;
CREATE FUNCTION worker_role_probe_retry_once() RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE attempt BIGINT;
BEGIN
  attempt := nextval('worker_role_probe_attempts');
  IF attempt = 1 THEN RAISE EXCEPTION 'worker serialization probe' USING ERRCODE = '40001'; END IF;
  RETURN attempt;
END;
$$;
GRANT SELECT, INSERT, UPDATE, DELETE ON worker_role_probe TO ${runtimeRole};
GRANT USAGE, SELECT ON worker_role_probe_attempts TO ${runtimeRole};
`,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
    const worker = await verifyPostgresWorker({
      crate,
      output,
      urlA: `postgresql://runtime_a:${passwordA}@127.0.0.1:${port}/role_a`,
      urlB: `postgresql://runtime_b:${passwordB}@127.0.0.1:${port}/role_b`,
    });
    const evidence = {
      ...result,
      worker,
      recordedAt: new Date().toISOString(),
      reproduce: 'pnpm -C crates/router-ab-cloudflare test:postgres-role-store',
      image,
      imageId: docker('inspect', '--format', '{{.Image}}', container),
      cargo: ['cargo', ...args].join(' '),
      log: identity('.artifacts/postgres-role-store/run.log'),
      sources: [
        'crates/router-ab-cloudflare/Cargo.toml',
        'crates/router-ab-cloudflare/src/lib.rs',
        'crates/router-ab-cloudflare/src/tenant_root_role_sql/postgres.rs',
        'crates/router-ab-cloudflare/src/tenant_root_role_sql.rs',
        'crates/router-ab-cloudflare/src/tenant_root_role_sql/d1.rs',
        'crates/router-ab-cloudflare/src/tenant_root_role_d1.rs',
        'crates/router-ab-cloudflare/tests/postgres_role_store/mod.rs',
        'crates/router-ab-cloudflare/tests/postgres_role_store/protocol_proxy.rs',
        'crates/router-ab-cloudflare/tests/postgres_role_store/lifecycle.rs',
        'crates/router-ab-cloudflare/tests/postgres_role_store/worker.rs',
        'crates/router-ab-cloudflare/src/tenant_root_role_d1/bound_share.rs',
        'crates/router-ab-cloudflare/src/tenant_root_role_d1/recovery.rs',
        'crates/router-ab-cloudflare/src/tenant_root_role_d1/source_retirement.rs',
        'crates/router-ab-cloudflare/scripts/test-postgres-role-store.mjs',
        'crates/router-ab-cloudflare/scripts/postgres-worker-evidence.mjs',
        'crates/router-ab-cloudflare/migrations/postgres/0001_role_store.sql',
        'crates/router-ab-cloudflare/Cargo.lock',
      ].map(identity),
    };
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`PostgreSQL role-store E2E passed. Evidence: ${evidencePath}`);
  } finally {
    docker('stop', '--time', '1', container);
  }
}

await main();
