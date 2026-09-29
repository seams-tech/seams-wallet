import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const built = await build({
  stdin: {
    contents: `
      import { TracedD1Database } from './tests/r150-hosted/gateway/d1Trace';
      export default { async fetch(request, env) {
        const db = new TracedD1Database(env.DB);
        const key = new URL(request.url).pathname;
        if (key === '/setup') {
          await db.exec('CREATE TABLE measurements (id TEXT PRIMARY KEY, value INTEGER)');
          return db.response(Response.json({ ready: true }));
        }
        await db.prepare('INSERT INTO measurements VALUES (?, ?)').bind(key, 1).run();
        let rolledBack = false;
        try {
          await db.batch([
            db.prepare('UPDATE measurements SET value = value + 1 WHERE id = ?').bind(key),
            db.prepare('INSERT INTO measurements VALUES (?, ?)').bind(key, 999),
          ]);
        } catch { rolledBack = true; }
        const value = await db.prepare('SELECT value FROM measurements WHERE id = ?').bind(key).first('value');
        const row = await db.prepare('SELECT * FROM measurements WHERE id = ?').bind(key).first();
        const absent = await db.prepare('SELECT * FROM measurements WHERE id = ?').bind('missing').first();
        let missingColumn = false;
        try {
          await db.prepare('SELECT value FROM measurements WHERE id = ?').bind(key).first('missing');
        } catch { missingColumn = true; }
        const batch = await db.batch([
          db.prepare('UPDATE measurements SET value = value + 1 WHERE id = ?').bind(key),
          db.prepare('SELECT value FROM measurements WHERE id = ?').bind(key),
        ]);
        const all = await db.prepare('SELECT value FROM measurements WHERE id = ?').bind(key).all();
        return db.response(Response.json({ value, row, absent, rolledBack, missingColumn, batch, all }));
      }};
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  external: ['node:crypto'],
  write: false,
});
const worker = new Miniflare({
  modules: true,
  script: built.outputFiles[0].text,
  compatibilityDate: '2026-04-17',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'],
});
try {
  const setup = await worker.dispatchFetch('http://localhost/setup');
  assert.equal(setup.status, 200);
  const responses = await Promise.all([
    worker.dispatchFetch('http://localhost/private-bound-value-one'),
    worker.dispatchFetch('http://localhost/private-bound-value-two'),
  ]);
  const traces = [];
  for (const response of responses) {
    const body = await response.json();
    assert.equal(body.value, 1);
    assert.equal(body.row.value, 1);
    assert.equal(body.absent, null);
    assert.equal(body.rolledBack, true);
    assert.equal(body.missingColumn, true);
    assert.equal(body.batch[1].results[0].value, 2);
    assert.equal(body.all.results[0].value, 2);
    const header = response.headers.get('X-Benchmark-D1');
    assert.ok(header);
    assert.doesNotMatch(header, /private-bound-value|999|UNIQUE constraint/u);
    const trace = JSON.parse(header);
    assert.equal(trace.pending, 0);
    assert.equal(trace.dropped, 0);
    assert.equal(trace.calls.length, 8);
    assert.deepEqual(trace.calls.map(sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(trace.calls[1].outcome, 'error');
    assert.equal(trace.calls[1].statements.length, 2);
    assert.equal(trace.calls[6].statements.length, 2);
    assert.equal(trace.calls[6].statements[0].rowsWritten, 1);
    assert.equal(trace.calls[2].statements[0].query.id, trace.calls[5].statements[0].query.id);
    traces.push(trace);
  }
  await mkdir('.artifacts/r150', { recursive: true });
  await writeFile('.artifacts/r150/d1-trace.e2e.json', JSON.stringify({
    kind: 'benchmark_d1_trace_e2e_v1',
    reproduce: 'node tests/r150-hosted/gateway/d1Trace.e2e.mjs',
    rollbackVerified: true,
    concurrentRequestIsolationVerified: true,
    firstRowAndColumnVerified: true,
    traces,
  }, null, 2));
  const timingArtifact = {
    registrationReturn: { gatewayServerTimings: [] },
    firstSigning: { gatewayServerTimings: traces.map(asResponse) },
    subsequentSigning: { gatewayServerTimings: [] },
  };
  const timingPath = '.artifacts/r150/d1-trace.e2e-timing.json';
  await writeFile(timingPath, JSON.stringify(timingArtifact));
  const analysis = JSON.parse(execFileSync(process.execPath, [
    'tests/r150-hosted/analyze-d1.mjs', timingPath,
  ], { encoding: 'utf8' }));
  assert.equal(analysis.requests.length, 2);
  for (const request of analysis.requests) {
    assert.equal(request.calls, 8);
    assert.equal(request.statements, 10);
    assert.equal(request.writeCalls, 2);
    assert.ok(request.rowsWritten >= 2);
    assert.equal(request.unknownRows, 2);
    assert.equal(request.sqlMs, null);
    assert.ok(request.coveredD1WallMs <= request.summedCallWallMs + 0.01);
  }
  await writeFile('.artifacts/r150/d1-trace.e2e-analysis.json', JSON.stringify(analysis, null, 2));
  console.log('D1 trace E2E passed; artifact: .artifacts/r150/d1-trace.e2e.json');
} finally {
  await worker.dispose();
}

function sequence(call) { return call.sequence; }

function asResponse(d1) {
  return { path: '/measurement', status: 200, stagesMs: {}, d1 };
}
