import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';

async function runBuild(command, args, cwd, logPath) {
  const descriptor = openSync(logPath, 'a');
  try {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', descriptor, descriptor],
    });
    const [code] = await once(child, 'exit');
    if (code !== 0) throw new Error(`${command} failed; inspect ${logPath}`);
  } finally {
    closeSync(descriptor);
  }
}

export async function verifyPostgresWorker({ crate, output, urlA, urlB }) {
  const directory = resolve(output, 'worker');
  await mkdir(directory, { recursive: true });
  const log = resolve(directory, 'build.log');
  await writeFile(log, '');
  await runBuild('cargo', [
    'build', '--example', 'postgres-role-store-worker', '--target', 'wasm32-unknown-unknown',
    '--features', 'postgres,workers-rs',
  ], crate, log);
  const wasm = resolve(crate, 'target/wasm32-unknown-unknown/debug/examples/postgres_role_store_worker.wasm');
  await runBuild('wasm-bindgen', [
    wasm, '--target', 'web', '--out-dir', directory, '--out-name', 'worker', '--no-typescript',
  ], crate, log);
  const entry = resolve(directory, 'entry.mjs');
  await writeFile(entry, `import { initSync, fetch } from './worker.js';
import wasm from './worker_bg.wasm';
globalThis.__worker_init_state = { criticalError: false, instanceId: 0 };
initSync({ module: wasm });
export default { fetch };
`);
  const runtime = new Miniflare({
    modules: true,
    scriptPath: entry,
    modulesRoot: directory,
    modulesRules: [
      { type: 'ESModule', include: ['**/*.js', '**/*.mjs'] },
      { type: 'CompiledWasm', include: ['**/*.wasm'] },
    ],
    compatibilityDate: '2026-06-12',
    hyperdrives: { ROLE_A: urlA, ROLE_B: urlB },
  });
  try {
    const response = await runtime.dispatchFetch('https://postgres-role-store.test/verify');
    const text = await response.text();
    assert.equal(response.status, 200, text);
    const evidence = JSON.parse(text);
    assert.equal(evidence.kind, 'postgres_role_worker_contract_v1');
    await writeFile(resolve(directory, 'result.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    return {
      ...evidence,
      wasmBytes: (await readFile(resolve(directory, 'worker_bg.wasm'))).byteLength,
    };
  } finally {
    await runtime.dispose();
  }
}
