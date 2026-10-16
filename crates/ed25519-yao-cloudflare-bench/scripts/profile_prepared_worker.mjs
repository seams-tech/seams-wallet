import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { once, on } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { localRuntime, sample, provenance } from './run_prepared_keygen.mjs';

async function command(socket, id, method, params = {}) {
  const events = on(socket, 'message', { signal: AbortSignal.timeout(30000) });
  socket.send(JSON.stringify({ id, method, params }));
  try {
    for await (const [bytes] of events) {
      const response = JSON.parse(bytes.toString());
      if (response.id !== id) continue;
      if (response.error) throw new Error(JSON.stringify(response.error));
      return response.result;
    }
    throw new Error('Inspector closed before response');
  } finally {
    await events.return();
  }
}

function userWorker(target) {
  return new URL(target.webSocketDebuggerUrl).pathname.startsWith('/core:user:');
}
function sum(total, value) { return total + value; }
function descending(left, right) {
  return right.microseconds - left.microseconds;
}
function rows(totals, nodes) {
  const rows = [];
  for (const [id, microseconds] of totals)
    rows.push({ microseconds, frame: nodes.get(id).callFrame });
  return rows.sort(descending).slice(0, 40);
}
function summarize(profile) {
  const nodes = new Map();
  const parents = new Map();
  for (const node of profile.nodes) {
    nodes.set(node.id, node);
    for (const child of node.children ?? []) parents.set(child, node.id);
  }
  const own = new Map();
  const inclusive = new Map();
  for (let index = 0; index < profile.samples.length; index += 1) {
    let id = profile.samples[index];
    const delta = profile.timeDeltas[index];
    own.set(id, (own.get(id) ?? 0) + delta);
    while (id !== undefined) {
      inclusive.set(id, (inclusive.get(id) ?? 0) + delta);
      id = parents.get(id);
    }
  }
  return {
    window_us: profile.endTime - profile.startTime,
    sample_weight_us: profile.timeDeltas.reduce(sum, 0),
    self: rows(own, nodes),
    inclusive: rows(inclusive, nodes),
  };
}

async function main() {
  const output = process.argv[2];
  assert(output, 'Output path required');
  const token = randomBytes(32).toString('hex');
  const local = await localRuntime(token, true);
  const connections = [];
  const identities = await provenance();
  try {
    const oracle = JSON.parse(
      await readFile(new URL('../src/ml_dsa_schedules/prepared-client.json', import.meta.url)),
    );
    const fixture = { ...oracle.cases[0], index: 0 };
    await sample(local.endpoint, token, fixture, oracle.signing_schedules, 'gmw-signing');
    connections.push(...await startProfiles(local.runtime, userWorker));
    const result = await sample(
      local.endpoint,
      token,
      { ...fixture, index: 1 },
      oracle.signing_schedules,
      'gmw-signing',
    );
    const profiles = await stopProfiles(connections);
    await writeFile(
      output,
      JSON.stringify({
        scope:
          'Local workerd V8 sampling after one warmup. Whole request includes preparation, fixture key creation, activation, signing, and peer wait. Sampling is diagnostic and can perturb latency; this is not hosted CPU attribution.',
        result,
        profiles,
        provenance: identities,
      }),
    );
    for (const profile of profiles)
      console.log(
        JSON.stringify({ title: profile.title, self: profile.summary.self.slice(0, 12) }),
      );
  } finally {
    closeProfiles(connections);
    await local.runtime.dispose();
  }
}
export async function startProfiles(runtime, selectTarget, samplingIntervalMicroseconds = 2000) {
  const inspector = await runtime.getInspectorURL();
  inspector.protocol = 'http:';
  const response = await fetch(new URL('/json/list', inspector));
  const targets = (await response.json()).filter(selectTarget);
  assert.equal(targets.length, 2, 'Expected both participant inspector targets');
  const connections = [];
  try {
    for (const target of targets) {
      const socket = new WebSocket(target.webSocketDebuggerUrl, { origin: 'http://localhost' });
      connections.push({ socket, title: target.title });
      await once(socket, 'open');
      await command(socket, 1, 'Profiler.enable');
      await command(socket, 2, 'Profiler.setSamplingInterval', { interval: samplingIntervalMicroseconds });
      await command(socket, 3, 'Profiler.start');
    }
    return connections;
  } catch (error) {
    closeProfiles(connections);
    throw error;
  }
}
export async function stopProfiles(connections) {
  try {
    const stopped = await Promise.all(connections.map(stopProfile));
    return stopped.map(summarizeStoppedProfile);
  } finally {
    closeProfiles(connections);
  }
}
async function stopProfile(connection) {
  const { profile } = await command(connection.socket, 4, 'Profiler.stop');
  return { title: connection.title, profile };
}
function summarizeStoppedProfile({ title, profile }) {
  return { title, summary: summarize(profile), profile };
}
export function closeProfiles(connections) {
  for (const connection of connections) connection.socket.close();
}
if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
