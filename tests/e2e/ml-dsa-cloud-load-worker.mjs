import { DurableObject } from 'cloudflare:workers';

const AUTH_HEADER = 'x-router-ab-internal-service-auth';
const PUBLIC_LOG_FIELDS = {
  ml_dsa_registration_job_v1: ['http_request', 'job', 'operation'],
  ml_dsa_registration_call_v1: ['job', 'operation', 'phase', 'call_id'],
  ml_dsa_registration_preparation_v1: ['role', 'written_frames', 'write_transactions', 'peak_pending_frames'],
  ml_dsa_registration_execution_v1: [
    'operation', 'role', 'wasm_linear_memory_bytes', 'loaded_frames', 'loaded_bytes',
    'table_read_transactions', 'peak_cached_frames',
  ],
  ml_dsa_registration_retirement_v1: ['job', 'stage', 'at_ms'],
  ml_dsa_stage_trace_v1: ['operation', 'role', 'context', 'module_instance', 'completed', 'marks', 'table_reads'],
  ml_dsa_wait_scope_v1: ['call_id', 'job', 'operation', 'role'],
  ml_dsa_wait_boundary_v1: [
    'call_id', 'sequence', 'kind', 'state', 'pending', 'at_ms',
    'peer_ready', 'peer_pending', 'peer_boundary_ms',
  ],
  ml_dsa_wait_summary_v1: [
    'call_id', 'observations', 'emitted_events', 'event_limit_reached',
    'peer_ready', 'peer_pending', 'peer_boundary_ms',
  ],
  ml_dsa_commitment_batch_v1: [
    'operation', 'role', 'start', 'pairs', 'candidates_per_pair', 'and_exchanges', 'and_gates',
    'sent_bytes', 'received_bytes', 'maximum_message_bytes', 'wasm_linear_memory_bytes',
  ],
  router_ab_yao_transport_v1: ['duration_ms', 'request_bytes', 'service', 'stage', 'status'],
  ml_dsa_router_trace_v1: ['http_request', 'operation', 'module_instance', 'status', 'milestones'],
  ml_dsa_benchmark_request_v1: ['wallet', 'request', 'operation', 'stage', 'at_ms', 'http_status'],
  ml_dsa_preparation_cache_v1: [
    'job', 'role', 'producer_slot', 'stage', 'topology_builds', 'topology_hits',
    'public_topology_bytes', 'active_crypto', 'module_instance', 'at_ms',
  ],
  ml_dsa_expired_reservation_v1: ['operation', 'settlement', 'batches'],
  ml_dsa_durable_boundary_v1: ['call_id', 'command', 'job', 'operation', 'stage', 'state', 'sequence', 'observation', 'at_ms'],
  ml_dsa_admission_stock_v1: ['operation', 'paired', 'minimum', 'stage'],
  ml_dsa_inventory_v1: ['key', 'epoch', 'ready_a', 'ready_b', 'reserved_a', 'reserved_b'],
  ml_dsa_signing_outcome_v1: ['operation', 'outcome'],
  ml_dsa_material_stage_v1: ['operation', 'role', 'value'],
  ml_dsa_refill_claim_v1: ['key', 'epoch', 'claim'],
  ml_dsa_refill_completed_v1: ['batch', 'batches', 'published', 'outcome', 'elapsed_ms', 'candidates'],
  ml_dsa_refill_recovery_v1: ['batch', 'stage', 'expires_at_ms'],
  ml_dsa_refill_controller_v1: ['key', 'epoch', 'at_ms'],
  ml_dsa_refill_settled_v1: ['batch', 'outcome', 'wake_count', 'at_ms'],
  ml_dsa_refill_woken_v1: ['batch', 'key', 'epoch', 'at_ms'],
  ml_dsa_refill_alarm_v1: ['actor', 'key', 'epoch', 'call_id', 'before_ms', 'requested_ms', 'after_ms', 'at_ms', 'module_instance'],
  ml_dsa_producer_job_v1: ['producer', 'batch', 'batches', 'key', 'epoch', 'stage'],
  ml_dsa_producer_entered_v1: ['producer'],
  ml_dsa_producer_entry_v1: [
    'producer',
    'module_instance',
    'construction',
    'invocation',
    'created_at_ms',
    'at_ms',
    'schedule_cache_hit',
    'stage',
  ],
  ml_dsa_preparation_stage_v1: [
    'job',
    'batch',
    'role',
    'stage',
    'at_ms',
    'module_instance',
    'wasm_linear_memory_bytes',
    'resource_observed_at_ms',
  ],
  ml_dsa_preparation_transport_v1: [
    'job',
    'role',
    'sent_bytes',
    'received_bytes',
    'pending_events',
  ],
  ml_dsa_signing_trace_v1: [
    'operation',
    'role',
    'milestones',
    'module_instance',
    'signing_call',
    'schedule_cache_hit',
    'completed',
    'transport',
    'batches',
  ],
};

export async function routeLoadRequest(request, env) {
  if (request.headers.get(AUTH_HEADER) !== env.ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }
  const url = new URL(request.url);
  if (url.pathname === '/__benchmark/calibrate') {
    const start = Date.now();
    await new Promise(delayCalibration);
    return Response.json({ elapsedMs: Date.now() - start, configuredDelayMs: 200 });
  }
  const route = url.pathname.split('/');
  if (route[2] === 'wallet' && /^[a-z0-9-]{1,80}$/.test(route[3] ?? '')) {
    return env.TEST_WALLET.get(env.TEST_WALLET.idFromName(route[3])).fetch(request);
  }
  if (route[2] === 'traces' && /^[a-z-]{1,20}$/.test(route[3] ?? '')) {
    return env.TEST_TRACES.get(env.TEST_TRACES.idFromName(route[3])).fetch(request);
  }
  return new Response('Unknown test route', { status: 404 });
}

export async function archiveTail(events, env) {
  for (const event of events) {
    const role = event.scriptName?.slice(env.TEST_WORKER_PREFIX.length + 1);
    if (![
      'router', 'a', 'b', 'preparer-a', 'preparer-b',
      'preparer-a-secondary', 'preparer-b-secondary',
    ].includes(role)) continue;
    const clean = sanitizeTrace(event);
    await env.TEST_TRACES.get(env.TEST_TRACES.idFromName(role)).append(clean);
  }
}

export class LoadTraceArchive extends DurableObject {
  async append(event) {
    const serialized = JSON.stringify(event);
    const identity = hex(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized)),
    );
    await this.ctx.storage.put(
      `trace/${String(event.eventTimestamp).padStart(16, '0')}/${identity}`,
      event,
    );
  }

  async fetch(request) {
    const cursor = new URL(request.url).searchParams.get('cursor');
    const options = cursor
      ? { prefix: 'trace/', startAfter: cursor, limit: 100 }
      : { prefix: 'trace/', limit: 100 };
    const entries = await this.ctx.storage.list(options);
    return Response.json({
      rows: Array.from(entries.values()),
      cursor: entries.size === 100 ? Array.from(entries.keys()).at(-1) : null,
    });
  }
}

export class LoadWallet extends DurableObject {
  async fetch(request) {
    const state = await this.ctx.storage.get('wallet');
    if (request.method === 'GET') {
      const rows = await this.ctx.storage.list({ prefix: 'request/' });
      const demands = await this.ctx.storage.list({ prefix: 'demand/' });
      return Response.json({
        state: state ?? null,
        requests: Array.from(rows.values()),
        demands: Array.from(demands.values()),
      });
    }
    if (request.method !== 'POST') return new Response('POST required', { status: 405 });
    if (state) return new Response('Test identity already used', { status: 409 });
    const input = await request.json();
    validateStart(input);
    const initial = {
      state: 'waiting',
      config: input,
      sequence: 0,
      successes: 0,
      demands: 0,
      nextAt: input.startAtMs,
      lastRequest: null,
    };
    await this.ctx.storage.put('wallet', initial);
    await this.ctx.storage.setAlarm(input.startAtMs);
    return Response.json({ started: true, startAtMs: input.startAtMs });
  }

  async alarm() {
    let state = await this.ctx.storage.get('wallet');
    if (!state || state.state === 'complete' || state.state === 'failed') return;
    const now = Date.now();
    if (state.state === 'in_flight') {
      const interrupted = await this.ctx.storage.get(requestKey(state.sequence));
      logDriverRequest(interrupted, 'watchdog_interrupted');
      interrupted.status = 'client_error_unknown_server_outcome';
      interrupted.error = 'Interrupted request has an unknown server outcome';
      interrupted.completedAtMs = now;
      interrupted.elapsedMs = now - interrupted.startAtMs;
      interrupted.demandElapsedMs = now - state.demandStartAtMs;
      await this.ctx.storage.put({
        wallet: {
          state: 'failed',
          config: state.config,
          sequence: state.sequence,
          successes: state.successes,
          demands: state.demands,
          error: interrupted.error,
          operation: state.operation,
          completedAtMs: now,
        },
        [requestKey(state.sequence)]: interrupted,
        [demandKey(state.demands)]: {
          wallet: state.config.index,
          number: state.demands,
          startAtMs: state.demandStartAtMs,
          startMs: state.demandStartAtMs - state.config.startAtMs,
          state: 'client_error_unknown_server_outcome',
          elapsedMs: interrupted.demandElapsedMs,
        },
      });
      return;
    }
    if (state.lastRequest !== null) {
      const previous = await this.ctx.storage.get(requestKey(state.lastRequest));
      previous.retryDelayMs = now - previous.completedAtMs;
      await this.ctx.storage.put(requestKey(state.lastRequest), previous);
    }
    if (now >= state.config.endAtMs) {
      if (state.state === 'retry') {
        await this.ctx.storage.put(demandKey(state.demands), {
          wallet: state.config.index,
          number: state.demands,
          startAtMs: state.demandStartAtMs,
          startMs: state.demandStartAtMs - state.config.startAtMs,
          state: 'censored_at_end_of_window',
          elapsedMs: now - state.demandStartAtMs,
        });
      }
      await this.ctx.storage.put('wallet', {
        state: 'complete',
        config: state.config,
        sequence: state.sequence,
        successes: state.successes,
        demands: state.demands,
        completedAtMs: now,
      });
      return;
    }
    if (now < state.nextAt) {
      await this.ctx.storage.setAlarm(state.nextAt);
      return;
    }
    let operation;
    let demandStartAtMs;
    let demands;
    if (state.state === 'waiting') {
      operation = await newOperation(state.config.key);
      demandStartAtMs = Date.now();
      demands = state.demands + 1;
    } else if (state.state === 'retry') {
      operation = state.operation;
      demandStartAtMs = state.demandStartAtMs;
      demands = state.demands;
    } else {
      throw new Error('Unknown test lifecycle state');
    }
    const sequence = state.sequence + 1;
    const startedAtMs = Date.now();
    const requestId = randomHex(16);
    const row = {
      wallet: state.config.index,
      demand: demands,
      operation: operation.request.operation,
      signingRequest: operation.request,
      messageHex: hex(operation.message),
      contextHex: hex(operation.context),
      requestId,
      status: 'in_flight',
      startAtMs: startedAtMs,
      startMs: startedAtMs - state.config.startAtMs,
      alarmLatenessMs: Math.max(0, now - state.nextAt),
      retryDelayMs: 0,
    };
    logDriverRequest(row, 'created');
    await this.ctx.storage.put({
      wallet: {
        state: 'in_flight',
        config: state.config,
        sequence,
        successes: state.successes,
        demands,
        operation,
        demandStartAtMs,
      },
      [requestKey(sequence)]: row,
      [demandKey(demands)]: {
        wallet: state.config.index,
        number: demands,
        startAtMs: demandStartAtMs,
        startMs: demandStartAtMs - state.config.startAtMs,
        state: 'pending',
      },
    });
    await this.ctx.storage.setAlarm(startedAtMs + 60000);
    try {
      row.forwardAtMs = Date.now();
      logDriverRequest(row, 'dispatch_started');
      const response = await this.env.TEST_FRONT.fetch('https://test/router-ab/ml-dsa/sign', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [AUTH_HEADER]: this.env.ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET,
          'x-ml-dsa-request-id': requestId,
        },
        body: JSON.stringify(operation),
        signal: AbortSignal.timeout(45000),
      });
      row.httpStatus = response.status;
      row.responseHeadersAtMs = Date.now();
      logDriverRequest(row, 'response_headers');
      const result = await response.json();
      logDriverRequest(row, 'response_decoded');
      row.completedAtMs = Date.now();
      row.elapsedMs = row.completedAtMs - startedAtMs;
      row.demandElapsedMs = row.completedAtMs - demandStartAtMs;
      if (response.status !== 200) throw new Error(`Signing returned HTTP ${response.status}`);
      row.status = result.status;
      let nextAt;
      if (result.status === 'unavailable') {
        if (
          !['empty_pool', 'wallet_cooldown', 'service_capacity'].includes(result.reason) ||
          !Number.isSafeInteger(result.retry_at_ms)
        )
          throw new Error('Invalid admission response');
        row.reason = result.reason;
        row.retryAtMs = result.retry_at_ms;
        nextAt = Date.now() + Math.max(1000, Math.min(5000, result.retry_at_ms - Date.now()));
      } else if (result.status === 'existing') {
        row.state = result.operation.state;
        switch (result.operation.state) {
          case 'succeeded': {
            const signature = result.operation.signature;
            if (!byteArray(signature, 3309)) throw new Error('Invalid ML-DSA-65 signature length');
            row.signatureHex = hex(signature);
            row.requiresIndependentVerification = true;
            await this.ctx.storage.put(requestKey(sequence), row);
            await this.ctx.storage.put(demandKey(demands), {
              wallet: state.config.index,
              number: demands,
              startAtMs: demandStartAtMs,
              startMs: demandStartAtMs - state.config.startAtMs,
              state: 'succeeded',
              elapsedMs: row.demandElapsedMs,
            });
            await this.ctx.storage.put('wallet', {
              state: 'waiting',
              config: state.config,
              sequence,
              successes: state.successes + 1,
              demands,
              nextAt: demandStartAtMs + state.config.intervalMs,
              lastRequest: null,
            });
            await this.ctx.storage.setAlarm(
              Math.min(
                state.config.endAtMs,
                Math.max(Date.now() + 1, demandStartAtMs + state.config.intervalMs),
              ),
            );
            return;
          }
          case 'awaiting_stock':
          case 'preparing':
          case 'running':
            nextAt = Date.now() + 1000;
            break;
          case 'failed':
          case 'declined':
            operation = await newOperation(state.config.key);
            nextAt = Date.now() + 1000;
            break;
          default:
            throw new Error('Unknown signing state');
        }
      } else {
        throw new Error('Unknown signing decision');
      }
      await this.ctx.storage.put(requestKey(sequence), row);
      await this.ctx.storage.put('wallet', {
        state: 'retry',
        config: state.config,
        sequence,
        successes: state.successes,
        demands,
        operation,
        demandStartAtMs,
        nextAt,
        lastRequest: sequence,
      });
      await this.ctx.storage.setAlarm(Math.min(state.config.endAtMs, nextAt));
    } catch (error) {
      row.completedAtMs = Date.now();
      row.elapsedMs = row.completedAtMs - startedAtMs;
      row.demandElapsedMs = row.completedAtMs - demandStartAtMs;
      row.status = 'client_error_unknown_server_outcome';
      row.error = String(error);
      logDriverRequest(row, 'failed');
      await this.ctx.storage.put(requestKey(sequence), row);
      await this.ctx.storage.put(demandKey(demands), {
        wallet: state.config.index,
        number: demands,
        startAtMs: demandStartAtMs,
        startMs: demandStartAtMs - state.config.startAtMs,
        state: 'client_error_unknown_server_outcome',
        elapsedMs: row.demandElapsedMs,
      });
      await this.ctx.storage.put('wallet', {
        state: 'failed',
        config: state.config,
        sequence,
        successes: state.successes,
        demands,
        error: String(error),
        operation,
        completedAtMs: Date.now(),
      });
      await this.ctx.storage.deleteAlarm();
    }
  }
}

function validateStart(value) {
  if (!value || !Number.isSafeInteger(value.index) || value.index < 0 || value.index > 7)
    throw new Error('Invalid wallet index');
  if (
    !Number.isSafeInteger(value.startAtMs) ||
    !Number.isSafeInteger(value.endAtMs) ||
    value.startAtMs < Date.now() ||
    value.endAtMs - value.startAtMs < 60000 ||
    value.endAtMs - value.startAtMs > 1800000 ||
    value.intervalMs !== 60000
  )
    throw new Error('Invalid test window');
  const key = value.key;
  if (
    !key ||
    key.key_id !== 'near' ||
    !Number.isSafeInteger(key.epoch) ||
    key.epoch < 1 ||
    !byteArray(key.public_key_digest, 32) ||
    !byteArray(key.schedule_digest, 32) ||
    !key.wallet
  )
    throw new Error('Invalid registered key');
}

function sanitizeTrace(event) {
  const logs = [];
  for (const log of event.logs ?? []) {
    const messages = [];
    for (const text of log.message ?? []) {
      let value;
      try {
        value = typeof text === 'string' ? JSON.parse(text) : text;
      } catch {
        continue;
      }
      const fields = PUBLIC_LOG_FIELDS[value?.event];
      if (!fields) continue;
      const clean = { event: value.event };
      for (const field of fields) if (value[field] !== undefined) clean[field] = value[field];
      messages.push(JSON.stringify(clean));
    }
    if (messages.length)
      logs.push({ message: messages, timestamp: log.timestamp, level: log.level });
  }
  const headers = {};
  const request = event.event?.request;
  for (const name of ['x-ml-dsa-request-id', 'x-seams-trace-id']) {
    const value = request?.headers?.[name];
    if (typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(value)) headers[name] = value;
  }
  for (const name of ['x-ml-dsa-job-id', 'x-ml-dsa-operation-id']) {
    const value = request?.headers?.[name];
    if (typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)) headers[name] = value;
  }
  const command = request?.headers?.['x-ml-dsa-command'];
  if (['prepare', 'prepare_peer', 'execute', 'execute_peer', 'install', 'result'].includes(command)) {
    headers['x-ml-dsa-command'] = command;
  }
  const signingOperation = publicSigningOperation(request);
  if (signingOperation !== null) headers['x-ml-dsa-operation'] = signingOperation;
  const refill = publicRefillHeader(request);
  if (refill !== null) headers['x-ml-dsa-input'] = refill;
  const traceEvent =
    event.event?.scheduledTime !== undefined
      ? { scheduledTime: event.event.scheduledTime }
      : request
        ? {
            request: {
              url: new URL(request.url).origin + new URL(request.url).pathname,
              headers,
              cf: typeof request.cf?.colo === 'string' && /^[A-Z]{3}$/.test(request.cf.colo)
                ? { colo: request.cf.colo }
                : {},
            },
          }
        : {};
  return {
    scriptName: event.scriptName,
    scriptVersion: event.scriptVersion ?? {},
    entrypoint: event.entrypoint ?? null,
    event: traceEvent,
    eventTimestamp: event.eventTimestamp,
    cpuTime: event.cpuTime ?? null,
    wallTime: event.wallTime ?? null,
    outcome: event.outcome,
    truncated: event.truncated ?? null,
    logs,
    exceptions: (event.exceptions ?? []).map(publicException),
  };
}

function publicException(error) {
  return {
    name: typeof error.name === 'string' ? error.name : 'UnknownError',
    message: 'Benchmark exception; inspect private provider logs for details',
  };
}

function byteArray(value, size) {
  return Array.isArray(value) && value.length === size && value.every(isByte);
}
function isByte(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 255;
}
function hex(value) {
  return Array.from(new Uint8Array(value)).map(hexByte).join('');
}
function hexByte(value) {
  return value.toString(16).padStart(2, '0');
}
function randomHex(size) {
  return hex(crypto.getRandomValues(new Uint8Array(size)));
}
function requestKey(sequence) {
  return `request/${String(sequence).padStart(8, '0')}`;
}
function demandKey(sequence) {
  return `demand/${String(sequence).padStart(8, '0')}`;
}
async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(value))));
}
async function newOperation(key) {
  const message = Array.from(crypto.getRandomValues(new Uint8Array(32)));
  return {
    request: {
      key,
      operation: Array.from(crypto.getRandomValues(new Uint8Array(32))),
      message_digest: await digest(message),
      context_digest: await digest([]),
    },
    message,
    context: [],
  };
}

function delayCalibration(resolve) {
  setTimeout(resolve, 200);
}

function publicRefillHeader(request) {
  if (!request || new URL(request.url).pathname !== '/router-ab/ml-dsa/prepare-connect')
    return null;
  const encoded = request.headers?.['x-ml-dsa-input'];
  if (typeof encoded !== 'string' || encoded.length > 16384) return null;
  try {
    const decoded = JSON.parse(atob(encoded.replaceAll('-', '+').replaceAll('_', '/')));
    if (
      !byteArray(decoded.batch, 32) ||
      !byteArray(decoded.key?.public_key_digest, 32) ||
      !Number.isSafeInteger(decoded.key.epoch) ||
      !Number.isSafeInteger(decoded.expires_at_ms) ||
      !Number.isSafeInteger(decoded.material_expires_at_ms) ||
      !['one', 'two'].includes(decoded.groups) ||
      !['primary', 'secondary'].includes(decoded.producer_slot ?? 'primary')
    )
      return null;
    return btoa(
      JSON.stringify({
        batch: decoded.batch,
        key: { public_key_digest: decoded.key.public_key_digest, epoch: decoded.key.epoch },
        groups: decoded.groups,
        producer_slot: decoded.producer_slot ?? 'primary',
        expires_at_ms: decoded.expires_at_ms,
        material_expires_at_ms: decoded.material_expires_at_ms,
      }),
    );
  } catch {
    return null;
  }
}

function logDriverRequest(row, stage) {
  console.log(JSON.stringify({
    event: 'ml_dsa_benchmark_request_v1', wallet: row.wallet, request: row.requestId,
    operation: hex(row.operation), stage, at_ms: Date.now(), http_status: row.httpStatus ?? null,
  }));
}

function publicSigningOperation(request) {
  if (!request || new URL(request.url).pathname !== '/router-ab/ml-dsa/connect') return null;
  const encoded = request.headers?.['x-ml-dsa-input'];
  if (typeof encoded !== 'string' || encoded.length > 32768) return null;
  try {
    const decoded = JSON.parse(atob(encoded.replaceAll('-', '+').replaceAll('_', '/')));
    const operation = decoded.permit?.request?.operation;
    return byteArray(operation, 32) ? hex(operation) : null;
  } catch {
    return null;
  }
}
