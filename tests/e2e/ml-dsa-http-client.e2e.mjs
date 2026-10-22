//! TLS transport E2E: concurrent wallets, failed responses, timeout, and client closure.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { createSecureServer } from 'node:http2';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { timedJson } from './ml-dsa-http-timing.mjs';
import { createWalletHttpClient } from './ml-dsa-wallet-http-client.mjs';

const [certificateDirectory, artifact] = process.argv.slice(2);
assert.ok(certificateDirectory && artifact);
const certificate = await readFile(join(certificateDirectory, 'control-cert.pem'));
assert.equal(resolve(process.env.NODE_EXTRA_CA_CERTS), resolve(certificateDirectory, 'control-cert.pem'));
const server = createSecureServer({
  key: await readFile(join(certificateDirectory, 'control-key.pem')),
  cert: certificate,
  settings: { maxConcurrentStreams: 100 },
});
const sessions = new Set();
let measurement = newMeasurement();
const clients = [];
server.on('session', retainSession);
server.on('request', respond);
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const endpoint = `https://localhost:${server.address().port}/router-ab/ml-dsa/sign`;
const report = {
  scope: 'Local TLS HTTP/2 with the same Node fetch client as the hosted driver. Measures client isolation and failure handling. This is not browser or hosted signing latency.',
  node: process.version,
  undici: process.versions.undici,
  sourceSha256: digest(await readFile(import.meta.filename)),
  clientSourceSha256: digest(await readFile(new URL('./ml-dsa-wallet-http-client.mjs', import.meta.url))),
  workerSourceSha256: digest(await readFile(new URL('./ml-dsa-wallet-http-worker.mjs', import.meta.url))),
};
try {
  await sharedPost('shared-warm', 0);
  measurement = newMeasurement();
  report.shared = await Promise.all([sharedPost('shared-a', 300), sharedPost('shared-b', 300)]);
  report.sharedServer = structuredClone(measurement);
  report.sharedSerializationReproduced = measurement.peak === 1;

  clients.push(await createWalletHttpClient(0, endpoint, 'test-only', 5000));
  clients.push(await createWalletHttpClient(1, endpoint, 'test-only', 5000));
  await Promise.all([clientPost(clients[0], 'a-warm', 0), clientPost(clients[1], 'b-warm', 0)]);
  measurement = newMeasurement();
  report.isolated = await Promise.all([clientPost(clients[0], 'isolated-a', 300), clientPost(clients[1], 'isolated-b', 300)]);
  report.isolatedServer = structuredClone(measurement);
  assert.equal(measurement.peak, 2, 'Independent wallet requests did not overlap');
  assert.deepEqual(report.isolated.map(clientIdentity), [0, 1]);
  for (const row of report.isolated) {
    assert.equal(row.timing.socket.protocol, 'h2');
    assert.ok(row.timing.responseHeadersMs - row.timing.sentMs >= 250);
    assert.ok(row.elapsedMs >= row.timing.totalMs);
  }

  const failedTiming = {};
  await assert.rejects(clients[0].post({ invalidJson: true, delayMs: 0 }, 'invalid-json', failedTiming));
  report.invalidJson = { rejected: true, timing: failedTiming };
  report.afterInvalidJson = await clientPost(clients[0], 'after-invalid-json', 0);

  const impatient = await createWalletHttpClient(2, endpoint, 'test-only', 100);
  clients.push(impatient);
  await clientPost(impatient, 'timeout-warm', 0);
  const timeoutTiming = {};
  await assert.rejects(impatient.post({ delayMs: 500 }, 'timeout', timeoutTiming), /TimeoutError/);
  report.timeout = { rejected: true, timing: timeoutTiming };
  report.afterTimeout = await clientPost(impatient, 'after-timeout', 0);

  const closingTiming = {};
  const pending = clients[1].post({ delayMs: 1000 }, 'closing', closingTiming);
  const rejected = assert.rejects(pending, /server outcome is unknown/);
  await delay(50);
  await clients[1].close();
  await rejected;
  await clients[1].close();
  assert.equal(closingTiming.requestId, 'closing');
  assert.equal(closingTiming.clientId, 1);
  assert.equal(closingTiming.workerTimingReceived, false);
  assert.ok(closingTiming.parentElapsedMs >= 40);
  assert.equal(Object.hasOwn(closingTiming, 'sentMs'), false);
  report.closeDuringRequest = { rejected: true, repeatedCloseCompleted: true, timing: closingTiming };
  const closedTiming = {};
  await assert.rejects(clients[1].post({ delayMs: 0 }, 'after-close', closedTiming), /not dispatched/);
  assert.equal(closedTiming.requestId, 'after-close');
  assert.equal(closedTiming.clientId, 1);
  assert.equal(closedTiming.workerTimingReceived, false);
  assert.equal(Object.hasOwn(closedTiming, 'sentMs'), false);
  report.requestAfterClosure = { rejected: true, timing: closedTiming };
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = String(error);
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map(closeClient));
  const closed = once(server, 'close', { signal: AbortSignal.timeout(5000) });
  server.close();
  for (const session of sessions) session.destroy();
  await closed;
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ artifact, passed: report.passed, sharedSerializationReproduced: report.sharedSerializationReproduced }));
}

function newMeasurement() {
  return { active: 0, peak: 0, requests: [] };
}

function retainSession(session) {
  sessions.add(session);
}

async function respond(request, response) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const current = measurement;
  current.active += 1;
  current.peak = Math.max(current.peak, current.active);
  const entry = { id: request.headers['x-ml-dsa-request-id'], startedMs: performance.now() };
  current.requests.push(entry);
  await delay(body.delayMs);
  current.active -= 1;
  entry.completedMs = performance.now();
  if (response.destroyed) return;
  response.writeHead(200, {
    'content-type': 'application/json',
    'x-ml-dsa-request-id': entry.id,
  });
  response.end(body.invalidJson ? 'invalid JSON' : '{"checked":true}');
}

async function sharedPost(id, delayMs) {
  const timing = {};
  const response = await timedJson(endpoint, {
    method: 'POST',
    headers: { 'x-ml-dsa-request-id': id },
    body: JSON.stringify({ delayMs }),
    signal: AbortSignal.timeout(5000),
  }, id, timing);
  assert.equal(response.data.checked, true);
  return timing;
}

async function clientPost(client, id, delayMs) {
  const timing = {};
  const started = performance.now();
  const response = await client.post({ delayMs }, id, timing);
  const elapsedMs = performance.now() - started;
  assert.equal(response.data.checked, true);
  return { elapsedMs, timing };
}

function clientIdentity(row) {
  return row.timing.clientId;
}

function closeClient(client) {
  return client.close();
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
