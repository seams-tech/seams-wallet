//! Public request timing only. Never retain bodies, credentials, or socket addresses.
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

const context = new AsyncLocalStorage();
const requests = new WeakMap();
const sockets = new WeakMap();
let socketSequence = 0;
channel('undici:request:create').subscribe(created);
channel('net.client.socket').subscribe(socketCreated);
channel('undici:client:connected').subscribe(connected);
channel('undici:client:sendHeaders').subscribe(sent);
channel('undici:request:headers').subscribe(headers);
channel('undici:request:trailers').subscribe(completed);

function created({ request }) {
  const timing = context.getStore();
  if (timing) {
    mark(timing, 'created');
    timing.createdMs = performance.now() - timing.started;
    requests.set(request, timing);
  }
}
function socketCreated({ socket }) {
  const record = { id: ++socketSequence, uses: 0, createdAt: performance.now(), connectionMs: null,
    dnsMs: null, tcpMs: null, tlsMs: null };
  sockets.set(socket, record);
  socket.once('lookup', socketLookup.bind(null, record));
  socket.once('connect', socketConnect.bind(null, record));
  socket.once('secureConnect', socketSecure.bind(null, record));
}
function socketLookup(record) { record.dnsMs = performance.now() - record.createdAt; }
function socketConnect(record) { record.tcpMs = performance.now() - record.createdAt; }
function socketSecure(record) { record.tlsMs = performance.now() - record.createdAt; }
function connected({ socket }) {
  const record = sockets.get(socket);
  if (record) record.connectionMs = performance.now() - record.createdAt;
}
function sent({ request, socket }) {
  const connection = sockets.get(socket);
  const timing = requests.get(request);
  if (timing) {
    mark(timing, 'sent');
    timing.sentMs = performance.now() - timing.started;
    timing.socket = connection ? { id: connection.id, priorRequests: connection.uses, connectionMs: connection.connectionMs, dnsMs: connection.dnsMs, tcpMs: connection.tcpMs, tlsMs: connection.tlsMs } : null;
  }
  if (connection) connection.uses += 1;
}
function headers({ request }) {
  const timing = requests.get(request);
  if (timing) {
    mark(timing, 'headers');
    timing.responseHeadersMs = performance.now() - timing.started;
  }
}
function completed({ request }) {
  const timing = requests.get(request);
  if (timing) {
    mark(timing, 'complete');
    timing.responseCompleteMs = performance.now() - timing.started;
  }
}
function mark(timing, stage) {
  if (!Number.isFinite(timing.started)) return;
  if (timing.events.length < 64) timing.events.push({ stage, atMs: performance.now() - timing.started });
  else timing.eventsTruncated = true;
}
async function fetchJson(url, init) {
  const timing = context.getStore();
  const response = await fetch(url, init);
  timing.fetchHeadersMs = performance.now() - timing.started;
  const text = await response.text();
  timing.bodyReadMs = performance.now() - timing.started;
  const data = JSON.parse(text);
  timing.parsedMs = performance.now() - timing.started;
  timing.status = response.status;
  timing.echo = response.headers.get('x-ml-dsa-request-id');
  timing.cfRay = response.headers.get('cf-ray');
  return { status: response.status, data };
}
export async function timedJson(url, init, requestId, timing) {
  Object.assign(timing, { requestId, started: performance.now(), createdMs: null, sentMs: null,
    responseHeadersMs: null, responseCompleteMs: null, fetchHeadersMs: null, bodyReadMs: null,
    parsedMs: null, socket: null, status: null, echo: null, cfRay: null, events: [], eventsTruncated: false });
  try {
    const result = await context.run(timing, fetchJson, url, init);
    if (timing.echo !== null) assert.equal(timing.echo, requestId);
    return result;
  } finally {
    timing.totalMs = performance.now() - timing.started;
    delete timing.started;
  }
}

async function calibrationResponse(request, response) {
  await delay(80);
  response.writeHead(200, { 'content-type': 'application/json',
    'x-ml-dsa-request-id': request.headers['x-ml-dsa-request-id'] ?? '' });
  response.write('{"checked":');
  await delay(80);
  response.end('true}');
}
export async function calibrateHttpTiming() {
  const server = createServer(calibrationResponse);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/calibration`;
  const observations = [];
  try {
    for (let index = 0; index < 3; index += 1) {
      const timing = {};
      const result = await timedJson(url, { headers: { 'x-ml-dsa-request-id': String(index) } }, String(index), timing);
      assert.equal(result.data.checked, true);
      assert.ok(timing.sentMs !== null && timing.responseHeadersMs !== null && timing.responseCompleteMs !== null);
      assert.ok(timing.responseHeadersMs - timing.sentMs >= 60);
      assert.ok(timing.responseCompleteMs - timing.responseHeadersMs >= 60);
      assert.ok(timing.bodyReadMs >= timing.fetchHeadersMs);
      assert.ok(timing.parsedMs >= timing.bodyReadMs);
      observations.push(timing);
      await delay(10);
    }
    assert.ok(observations.some(reusedSocket), 'No calibrated socket reuse observed');
    assert.ok(observations.every(observedConnection), 'No calibrated connection timing observed');
    const concurrent = [{}, {}];
    const ids = ['a'.repeat(32), 'b'.repeat(32)];
    await Promise.all([
      timedJson(url, { headers: { 'x-ml-dsa-request-id': ids[0] } }, ids[0], concurrent[0]),
      timedJson(url, { headers: { 'x-ml-dsa-request-id': ids[1] } }, ids[1], concurrent[1]),
    ]);
    for (const row of concurrent) {
      assert.equal(row.events.filter(isCreated).length, 1);
      assert.equal(row.events.filter(isSent).length, 1);
      assert.equal(row.requestId, row.echo);
    }
    const gaps = [];
    const monitor = observeEventLoop(gaps, performance.now());
    await delay(70);
    const until = performance.now() + 150;
    while (performance.now() < until) { /* Deliberate local observer calibration. */ }
    await delay(70);
    clearInterval(monitor);
    assert.ok(gaps.some(isKnownStall));
    return { passed: true, headerDelayMs: 80, bodyDelayMs: 80, observations, concurrent, eventLoopCalibration: { blockedMs: 150, gaps } };
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
}
function reusedSocket(row) { return row.socket !== null && row.socket.priorRequests > 0; }

function observedConnection(row) { return row.socket !== null && row.socket.connectionMs !== null && row.socket.tcpMs !== null; }

function isCreated(event) { return event.stage === 'created'; }
function isSent(event) { return event.stage === 'sent'; }
function isKnownStall(event) { return event.gapMs >= 140; }
export function observeEventLoop(gaps, origin) {
  const state = { gaps, origin, previous: performance.now() };
  return setInterval(eventLoopTick, 50, state);
}
function eventLoopTick(state) {
  const now = performance.now();
  const gap = now - state.previous;
  if (gap > 100) state.gaps.push({ previousMs: state.previous - state.origin, observedMs: now - state.origin, gapMs: gap });
  state.previous = now;
}
