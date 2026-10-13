// Reproduce cancellation across service bindings while a Durable Object initializes.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';

const output = resolve('.artifacts/startup-cancellation');
await mkdir(output, { recursive: true });
const roleScript = `
function delay(ms) { return new Promise(resolveDelay.bind(null, ms)); }
function resolveDelay(ms, resolve) { setTimeout(resolve, ms); }
export class Wallet {
  events = [];
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env;
    this.events.push({ event: 'constructor', at: Date.now() });
    ctx.blockConcurrencyWhile(this.initialize.bind(this));
  }
  async initialize() {
    await delay(Number(this.env.INIT_MS));
    this.events.push({ event: 'initialized', at: Date.now() });
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    this.events.push({ event: 'entry', path, at: Date.now() });
    if (path === '/start') {
      await delay(Number(this.env.HANDLER_MS));
      this.events.push({ event: 'startup_completed', at: Date.now() });
    }
    return Response.json({ objectId: this.ctx.id.toString(), events: this.events });
  }
}
export default {
  async fetch(request, env) {
    const id = env.WALLET.idFromString(request.headers.get('x-object-id'));
    return env.WALLET.get(id).fetch(request);
  }
};`;
const routerScript = `export default { async fetch(request, env) { return env.ROLE.fetch(request); } };`;
const gatewayScript = `
export default {
  async fetch(request, env) {
    const startedAt = Date.now();
    const incoming = new URL(request.url);
    const path = incoming.pathname;
    const signal = incoming.searchParams.has('abort') ? AbortSignal.timeout(3000) : undefined;
    try {
      const response = await env.ROUTER.fetch('https://role.test' + path, {
        method: 'POST', headers: { 'x-object-id': request.headers.get('x-object-id') }, signal,
      });
      return Response.json({ kind: 'response', startedAt, endedAt: Date.now(), result: await response.json() });
    } catch (error) {
      return Response.json({ kind: 'failure', startedAt, endedAt: Date.now(), name: error.name });
    }
  }
};`;
function delay(ms) { return new Promise(resolveDelay.bind(null, ms)); }
function resolveDelay(ms, resolve) { setTimeout(resolve, ms); }

const evidence = [];
for (const scenario of [
  { name: 'initialization', init: 4500, handler: 0 },
  { name: 'entered-handler', init: 0, handler: 4500 },
]) {
  for (const abort of [true, false]) {
    const runtime = new Miniflare({
      workers: [
        { name: 'gateway', modules: true, script: gatewayScript, serviceBindings: { ROUTER: 'router' } },
        { name: 'router', modules: true, script: routerScript, serviceBindings: { ROLE: 'role' } },
        { name: 'role', modules: true, script: roleScript,
          bindings: { INIT_MS: scenario.init, HANDLER_MS: scenario.handler },
          durableObjects: { WALLET: { className: 'Wallet', useSQLite: true } } },
      ],
      compatibilityDate: '2026-07-18',
    });
    try {
      const namespace = await runtime.getDurableObjectNamespace('WALLET', 'role');
      const id = namespace.newUniqueId().toString();
      const gateway = await runtime.getWorker('gateway');
      const startedAt = Date.now();
      const startup = gateway.fetch('https://gateway.test/start' + (abort ? '?abort' : ''), {
        headers: { 'x-object-id': id },
      });
      await delay(1000);
      const execution = gateway.fetch('https://gateway.test/execute', { headers: { 'x-object-id': id } });
      const startupResult = await (await startup).json();
      const executionResult = await (await execution).json();
      await delay(Math.max(0, startedAt + 5500 - Date.now()));
      const observation = await (await gateway.fetch('https://gateway.test/observe', {
        headers: { 'x-object-id': id },
      })).json();
      assert.equal(executionResult.kind, 'response');
      assert.equal(executionResult.result.objectId, id);
      assert.equal(startupResult.kind, abort ? 'failure' : 'response');
      assert.equal(observation.result.events.filter(e => e.event === 'constructor').length, 1);
      const entries = observation.result.events.filter(e => e.event === 'entry');
      if (scenario.name === 'initialization') {
        assert.equal(entries[0].path, abort ? '/execute' : '/start');
        assert.equal(entries.some(e => e.path === '/start'), !abort);
      } else {
        assert.ok(observation.result.events.some(e => e.event === 'startup_completed'));
      }
      evidence.push({ scenario: scenario.name, abort, startedAt, startupResult, executionResult, observation });
      console.log(JSON.stringify({ scenario: scenario.name, abort,
        startup: startupResult.kind, events: observation.result.events }));
    } finally { await runtime.dispose(); }
  }
}
await writeFile(resolve(output, 'evidence.json'), JSON.stringify({
  scope: 'Local workerd transport reproduction; artificial initialization/handler delays, no cryptographic protocol or hosted placement claim.', evidence,
}, null, 2));
