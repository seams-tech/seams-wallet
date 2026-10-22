//! Local inspector access. Profiles contain stacks and counts, never heap contents.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { Miniflare } from 'miniflare';

class Inspector {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    socket.addEventListener('message', this.receive.bind(this));
    socket.addEventListener('close', this.closed.bind(this));
  }
  receive(event) {
    const message = JSON.parse(event.data);
    const request = this.pending.get(message.id);
    if (!request) return;
    this.pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  }
  closed() {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Inspector closed'));
    }
    this.pending.clear();
  }
  timeout(id) {
    const request = this.pending.get(id);
    if (!request) return;
    this.pending.delete(id);
    request.reject(new Error('Inspector command timed out'));
  }
  send(method, params = {}) {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Inspector is closed'));
    const id = ++this.sequence;
    const request = Promise.withResolvers();
    request.timer = globalThis.setTimeout(this.timeout.bind(this, id), 5000);
    this.pending.set(id, request);
    this.socket.send(JSON.stringify({ id, method, params }));
    return request.promise;
  }
  async stop(path) {
    const { profile } = await this.send('Profiler.stop');
    await this.send('Profiler.disable');
    await this.close();
    await writeFile(path, `${JSON.stringify(profile)}\n`);
    return profile;
  }
  async close() {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.closeSocket();
    return this.closePromise;
  }
  async closeSocket() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = once(this.socket, 'close', {signal: AbortSignal.timeout(5000)});
    this.socket.close();
    await closed;
  }
}

export async function startCpuProfile(runtime, worker) {
  const inspector = await openInspector(runtime, worker);
  await inspector.send('Profiler.enable');
  await inspector.send('Profiler.setSamplingInterval', { interval: 1000 });
  await inspector.send('Profiler.start');
  return inspector;
}

export async function openInspector(runtime, worker) {
  const url = await runtime.getInspectorURL();
  assert.equal(url.hostname, '127.0.0.1');
  url.protocol = 'http:';
  url.pathname = '/json/list';
  const targets = await (await fetch(url, {signal: AbortSignal.timeout(5000)})).json();
  const target = targets.find(matchesWorker, worker);
  assert.ok(target, `Inspector target absent: ${worker}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  try {
    await once(socket, 'open', {signal: AbortSignal.timeout(5000)});
  } catch (error) {
    socket.close();
    throw error;
  }
  return new Inspector(socket);
}
function matchesWorker(target) {
  return target.id === `core:user:${this}`;
}

const calibrationScript = `
function calibrationBurn(iterations) {
  let value = 1;
  for (let index = 0; index < iterations; index++) {
    value = Math.imul(value ^ index, 1664525) + 1013904223;
  }
  return value;
}
function fetch(request) {
  return new Response(String(calibrationBurn(Number(new URL(request.url).pathname.slice(1)))));
}
export default { fetch };
`;

export async function calibrateCpuProfiler(prefix) {
  const runtime = new Miniflare({
    inspectorPort: 0,
    modules: true,
    script: calibrationScript,
  });
  const cases = [];
  try {
    await runtime.ready;
    await (await runtime.dispatchFetch('http://calibration/5000000')).text();
    for (const iterations of [0, 50000000, 150000000]) {
      const inspector = await startCpuProfile(runtime, '');
      if (iterations === 0) await setTimeout(200);
      else await (await runtime.dispatchFetch(`http://calibration/${iterations}`)).text();
      const path = `${prefix}-calibration-${iterations}.cpuprofile`;
      const profile = await inspector.stop(path);
      const burnSamples = profile.nodes.filter(isCalibration).reduce(sumHits, 0);
      cases.push({ iterations, burnSamples, samples: profile.samples?.length ?? 0, path });
    }
    assert.equal(cases[0].burnSamples, 0);
    assert.ok(cases[1].burnSamples >= 20, 'Profiler did not detect known CPU work');
    assert.ok(cases[2].burnSamples > cases[1].burnSamples * 1.5, 'Samples did not scale with work');
    return { passed: true, samplingIntervalMicroseconds: 1000, cases };
  } finally {
    await runtime.dispose();
  }
}
function isCalibration(node) {
  return (
    node.callFrame.functionName === 'calibrationBurn' || node.callFrame.functionName === 'fetch'
  );
}
function sumHits(total, node) {
  return total + (node.hitCount ?? 0);
}
