//! Local counters only. Never read heap contents or private protocol values.
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { Miniflare } from 'miniflare';
import { openInspector } from './ml-dsa-cpu-profile.mjs';

const calibrationScript = `
let retained;
let memory;
function fetch(request) {
  switch (new URL(request.url).pathname) {
    case '/array':
      retained = new Uint8Array(8 * 1024 * 1024);
      retained.fill(1);
      break;
    case '/wasm':
      memory = new WebAssembly.Memory({initial: 128});
      new Uint8Array(memory.buffer).fill(2);
      break;
    case '/grow':
      memory.grow(128);
      new Uint8Array(memory.buffer, 8 * 1024 * 1024).fill(3);
      break;
  }
  return Response.json({arrayBytes: retained?.byteLength ?? 0, wasmBytes: memory?.buffer.byteLength ?? 0});
}
export default {fetch};
`;

async function readCounters(inspector) {
  const counters = await inspector.send('Runtime.getHeapUsage');
  const result = {};
  for (const field of ['usedSize', 'totalSize', 'embedderHeapUsedSize', 'backingStorageSize']) {
    assert.ok(Number.isSafeInteger(counters[field]) && counters[field] >= 0, `Invalid memory counter: ${field}`);
    result[field] = counters[field];
  }
  return result;
}

export async function calibrateMemoryCounters() {
  const runtime = new Miniflare({inspectorPort: 0, modules: true, script: calibrationScript});
  let inspector;
  try {
    await runtime.ready;
    inspector = await openInspector(runtime, '');
    const rows = [];
    for (const path of ['idle', 'array', 'wasm', 'grow']) {
      const response = await runtime.dispatchFetch(`http://calibration/${path}`);
      const allocated = await response.json();
      rows.push({path, allocated, counters: await readCounters(inspector)});
    }
    assert.equal(rows[1].allocated.arrayBytes, 8 * 1024 * 1024);
    assert.equal(rows[2].allocated.wasmBytes, 8 * 1024 * 1024);
    assert.equal(rows[3].allocated.wasmBytes, 16 * 1024 * 1024);
    assert.equal(rows[1].counters.backingStorageSize - rows[0].counters.backingStorageSize, 8 * 1024 * 1024, JSON.stringify(rows));
    assert.equal(rows[2].counters.backingStorageSize, rows[1].counters.backingStorageSize, JSON.stringify(rows));
    assert.equal(rows[3].counters.backingStorageSize, rows[2].counters.backingStorageSize, JSON.stringify(rows));
    await inspector.close();
    const sampler = await startMemorySampling(runtime, '');
    await setTimeout(120);
    await sampler.inspector.close();
    await setTimeout(150);
    const disconnected = await sampler.stop();
    assert.equal(disconnected.status, 'incomplete');
    assert.ok(disconnected.rows.length > 0);
    assert.deepEqual(await sampler.stop(), disconnected);
    return {passed: true, scope: 'This local runtime counts JS ArrayBuffer storage. Touched Wasm linear memory is excluded and requires the separate Wasm stage counter.', rows, disconnected};
  } finally {
    if (inspector) await inspector.close();
    await runtime.dispose();
  }
}

class MemorySampler {
  constructor(inspector, worker) {
    this.inspector = inspector;
    this.worker = worker;
    this.rows = [];
    this.stopped = false;
    this.error = null;
    this.startedAtMs = Date.now();
    this.started = performance.now();
    this.pending = this.sample();
  }
  async sample() {
    try {
      while (!this.stopped) {
        const requestedAtMs = performance.now() - this.started;
        const counters = await readCounters(this.inspector);
        this.rows.push({requestedAtMs, receivedAtMs: performance.now() - this.started, counters});
        await setTimeout(100);
      }
    } catch (error) {
      this.error = String(error);
    }
  }
  async stop() {
    this.stopped = true;
    try {
      await this.pending;
      await this.inspector.close();
    } catch (error) {
      this.error = String(error);
    }
    const record = {worker: this.worker, startedAtMs: this.startedAtMs, rows: this.rows};
    if (this.error !== null) return {...record, status: 'incomplete', error: this.error};
    return {...record, status: 'complete'};
  }
}

export async function startMemorySampling(runtime, worker) {
  return new MemorySampler(await openInspector(runtime, worker), worker);
}
