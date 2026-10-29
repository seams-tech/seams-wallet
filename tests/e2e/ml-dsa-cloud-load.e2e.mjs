import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const [action, campaignDirectory, name, countText, durationText] = process.argv.slice(2);
assert.ok(campaignDirectory, 'Supply the campaign directory');
const base = resolve(campaignDirectory);
const scope = JSON.parse(await readFile(join(base, 'scope.json'), 'utf8'));
const root = process.cwd();
const token = (await readFile(join(base, 'gateway-token'), 'utf8')).trim();
const folder = join(base, 'cloud-driver', name ?? 'capture');

switch (action) {
  case 'start':
    await start(name, Number(countText), Number(durationText));
    break;
  case 'status':
    await status();
    break;
  case 'collect':
    await collect();
    break;
  case 'traces':
    await traces();
    break;
  case 'stock':
    await stock(Number(countText), Number(durationText ?? 0));
    break;
  default:
    throw new Error('Use start, status, collect, traces or stock');
}

async function call(path, body) {
  if (body !== undefined) return callOnce(path, body);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await callOnce(path, body);
    } catch (error) {
      if (attempt === 2) throw error;
      await delay(1000);
    }
  }
  throw new Error('Read retry limit reached');
}

async function callOnce(path, body) {
  const response = await fetch(scope.router_url + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-router-ab-internal-service-auth': token },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  assert.equal(response.status, 200, `Benchmark ${path} returned ${response.status}`);
  return response.json();
}

async function registrations(count) {
  const results = [];
  for (let i = 1; i <= count; i += 1) {
    const registration = JSON.parse(await readFile(join(base, `registration-${i}.json`), 'utf8'));
    assert.equal(registration.registrationChecksPassed, true);
    assert.equal(registration.recoveryPreservesCanonicalKey, true);
    assertRegistrationLayout(registration.policy, scope.policy);
    const latest = registration.cases.at(-1);
    assert.equal(latest.canonicalKeyVerified, true);
    results.push({
      index: i - 1,
      key: latest.key,
      publicKeyHex: latest.publicKeyHex,
      registrationPolicy: registration.policy,
    });
  }
  return results;
}

async function start(name, count, durationMs) {
  assert.match(name, /^[a-z0-9-]{1,60}$/);
  assert.ok([2, 4, 8].includes(count));
  assert.ok(durationMs >= 60000 && durationMs <= 1800000);
  await mkdir(folder);
  const wallets = await registrations(count);
  assert.equal(scope.policy.wallet_cooldown.mode, 'enabled', 'Require an explicit benchmark cooldown');
  const intervalMs = scope.policy.wallet_cooldown.interval_ms;
  assert.ok(Number.isSafeInteger(intervalMs) && intervalMs >= 1000 && intervalMs <= 300000);
  const startAtMs = Date.now() + 15000;
  const input = {
    name,
    wallets,
    startAtMs,
    endAtMs: startAtMs + durationMs,
    intervalMs,
    nominalDemandsPerMinute: count * 60000 / intervalMs,
    minimumSuccessesPerWallet: durationMs === 60000 ? 1 : 4,
    policy: scope.policy,
    versions: JSON.parse(await readFile(join(base, 'cloud-driver/versions.json'), 'utf8')),
  };
  await writeFile(join(folder, 'start.json'), JSON.stringify(input, null, 2) + '\n');
  for (const wallet of wallets) {
    const receipt = await call(`/__benchmark/wallet/${name}-${wallet.index}`, {
      index: wallet.index,
      key: wallet.key,
      startAtMs: input.startAtMs,
      endAtMs: input.endAtMs,
      intervalMs: input.intervalMs,
    });
    assert.equal(receipt.started, true);
  }
  console.log(JSON.stringify({ started: name, wallets: count, startAtMs, endAtMs: input.endAtMs }));
}

async function snapshots() {
  const input = JSON.parse(await readFile(join(folder, 'start.json'), 'utf8'));
  const results = [];
  for (const wallet of input.wallets)
    results.push(await call(`/__benchmark/wallet/${input.name}-${wallet.index}`));
  return { input, results };
}

async function status() {
  const { input, results } = await snapshots();
  const rows = results.map(statusRow);
  await writeFile(join(folder, 'progress.json'), JSON.stringify(rows, null, 2) + '\n');
  console.log(JSON.stringify({ name: input.name, rows }));
}

function statusRow(result) {
  const state = result.state;
  const empty = result.requests.filter(isEmpty);
  return {
    wallet: state.config.index,
    state: state.state,
    signatures: state.successes,
    requests: result.requests.length,
    emptyPoolResponses: empty.length,
    error: state.error ?? null,
  };
}
function isEmpty(row) {
  return row.reason === 'empty_pool';
}

async function collect() {
  const { input, results } = await snapshots();
  await writeFile(join(folder, 'driver-snapshots.json'), JSON.stringify(results, null, 2) + '\n');
  const requests = [];
  const demands = [];
  const errors = [];
  const successCounts = [];
  const duplicateRequests = [];
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    assert.equal(
      result.requests.length,
      result.state.sequence,
      'Incomplete durable request history',
    );
    assert.equal(result.demands.length, result.state.demands, 'Incomplete durable demand history');
    assert.equal(
      result.demands.filter(succeededDemand).length,
      result.state.successes,
      'Durable demand counter differs from outcomes',
    );
    assert.equal(
      result.requests.filter(succeededRequest).length,
      result.state.successes,
      'Durable success counter differs from request outcomes',
    );
    validateHistory(result, input);
    const wallet = input.wallets[i];
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex'),
        Buffer.from(wallet.publicKeyHex, 'hex'),
      ]),
      format: 'der',
      type: 'spki',
    });
    assert.deepEqual(result.state.config.key, wallet.key);
    for (const row of result.requests) {
      if (row.state === 'succeeded') {
        assert.equal(
          verify(
            null,
            Buffer.from(row.messageHex, 'hex'),
            key,
            Buffer.from(row.signatureHex, 'hex'),
          ),
          true,
        );
        row.verified = true;
      }
      requests.push(row);
    }
    const first = result.requests.find(isVerified);
    if (result.state.state === 'complete' && first)
      duplicateRequests.push(await verifyDuplicate(wallet, first));
    for (const demand of result.demands) demands.push(demandAtCutoff(demand, input.endAtMs));
    if (result.state.state !== 'complete')
      errors.push({ wallet: i, error: result.state.error ?? 'Cloud driver still active' });
    successCounts.push({
      wallet: i,
      successfulSignatures: result.requests.filter(isVerified).length,
    });
  }
  const successful = requests.filter(isVerified);
  const completedAtMs = Math.max(input.endAtMs, ...results.map(completedAt));
  const client = {
    observedAt: new Date(input.startAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    scope:
      'Cloudflare durable test drivers call the ordinary forwarding Router through a service binding. One outstanding demand per wallet and the recorded benchmark cooldown as the demand interval. Backpressure reduces the actual demand rate. Failed-operation retries can create additional operation IDs within one demand. Signatures independently verified by Node/OpenSSL after collection. Client network, SDK, login, UI and NEAR finality are excluded. Initial stock must be excluded from refill throughput.',
    timingBoundary:
      'Durable test driver through ordinary front Router service binding and full Router A/B path',
    requestedDurationMs: input.endAtMs - input.startAtMs,
    elapsedMs: input.endAtMs - input.startAtMs,
    intervalMs: input.intervalMs,
    nominalDemandsPerMinute: input.nominalDemandsPerMinute,
    policy: input.policy,
    deploymentVersions: input.versions,
    retryPolling: { minimumMs: 100, serviceCapacityMaximumMs: 500, otherReasons: 'server_retry_at' },
    scriptSha256: createHash('sha256')
      .update(await readFile(new URL('./ml-dsa-cloud-load-worker.mjs', import.meta.url)))
      .digest('hex'),
    wallets: input.wallets,
    requests,
    demands,
    errors,
    duplicateRequests,
    successesPerWallet: successCounts,
    successfulSignatures: successful.length,
    successfulSignaturesWithinRequestedWindow: successful.filter(
      completedWithin.bind(null, input.endAtMs),
    ).length,
    trailingSuccessfulSignatures: successful.filter(completedAfter.bind(null, input.endAtMs))
      .length,
    completionDrainMs: completedAtMs - input.endAtMs,
    minimumSuccessesPerWallet: input.minimumSuccessesPerWallet,
    successfulSignaturesUnderFiveSeconds: successful.filter(isUnderTarget).length,
    functionalPassed:
      errors.length === 0 &&
      successCounts.every(hasSuccess.bind(null, input.minimumSuccessesPerWallet)),
  };
  await writeFile(join(folder, 'client.json'), JSON.stringify(client, null, 2) + '\n');
  await writeFile(join(folder, 'driver-snapshots.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(
    JSON.stringify({
      collected: input.name,
      successfulSignatures: successful.length,
      independentVerificationPassed: true,
      functionalPassed: client.functionalPassed,
      errors,
    }),
  );
  if (!client.functionalPassed) process.exitCode = 1;
}
function demandAtCutoff(demand, endAtMs) {
  if (demand.state !== 'censored_at_end_of_window') return demand;
  return {
    wallet: demand.wallet,
    number: demand.number,
    startAtMs: demand.startAtMs,
    startMs: demand.startMs,
    state: demand.state,
    elapsedMs: Math.min(demand.elapsedMs, endAtMs - demand.startAtMs),
    observedClosureElapsedMs: demand.elapsedMs,
  };
}

function completedAt(result) {
  return result.state.completedAtMs ?? 0;
}
function isVerified(row) {
  return row.verified === true;
}
function isUnderTarget(row) {
  return row.elapsedMs < 5000;
}
function hasSuccess(minimum, row) {
  return row.successfulSignatures >= minimum;
}
function completedWithin(end, row) {
  return row.completedAtMs <= end;
}
function completedAfter(end, row) {
  return row.completedAtMs > end;
}
function succeededDemand(row) {
  return row.state === 'succeeded';
}
function succeededRequest(row) {
  return row.state === 'succeeded';
}

async function traces() {
  await mkdir(folder, { recursive: true });
  let count = 0;
  const roles = scope.workers.map(workerRole).filter(capturedRole);
  for (const role of roles) {
    let cursor = null;
    const rows = [];
    do {
      const path = `/__benchmark/traces/${role}${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`;
      const response = await call(path);
      rows.push(...response.rows);
      cursor = response.cursor;
    } while (cursor !== null);
    await writeFile(join(folder, role + '-raw.jsonl'), rows.map(JSON.stringify).join('\n') + '\n');
    count += rows.length;
  }
  const args = [
    'tools/ml-dsa-investigation/research/collect_worker_traces.py',
    join(folder, 'a-raw.jsonl'),
    join(folder, 'b-raw.jsonl'),
    join(folder, 'traces.json'),
    '--router',
    join(folder, 'router-raw.jsonl'),
    '--preparer-a',
    join(folder, 'preparer-a-raw.jsonl'),
    '--preparer-b',
    join(folder, 'preparer-b-raw.jsonl'),
  ];
  for (const role of ['preparer-a-secondary', 'preparer-b-secondary']) {
    if (roles.includes(role)) args.push('--' + role, join(folder, role + '-raw.jsonl'));
  }
  const result = spawnSync('python3', args, { cwd: root, encoding: 'utf8' });
  await writeFile(join(folder, 'collection.log'), result.stdout + result.stderr);
  assert.equal(result.status, 0, 'Public trace collection failed; inspect collection.log');
  console.log(JSON.stringify({ traces: name, archivedInvocations: count }));
}

async function stock(count, threshold) {
  assert.ok(
    Number.isSafeInteger(threshold) && threshold > 0 && threshold <= Date.now(),
    'Require a real inventory observation threshold',
  );
  const wallets = await registrations(count);
  const scopes = new Set(wallets.map(walletScope));
  const deadline = Date.now() + 900000;
  const started = Date.now();
  while (Date.now() < deadline) {
    await traces();
    const rows = JSON.parse(await readFile(join(folder, 'traces.json'), 'utf8')).records;
    const latest = new Map();
    for (const row of rows) {
      for (const inventory of row.inventories) {
        const key = `${inventory.key}:${inventory.epoch}`;
        if (!scopes.has(key)) continue;
        const at = inventory.log_timestamp_ms ?? row.event_timestamp_ms;
        if (at < threshold) continue;
        if (!latest.has(key) || at > latest.get(key).log_timestamp_ms)
          latest.set(key, { ...inventory, log_timestamp_ms: at });
      }
    }
    const snapshots = Array.from(latest.values());
    if (snapshots.length === count && snapshots.every(fullFreshStock)) {
      await writeFile(
        join(folder, 'stock.json'),
        JSON.stringify(
          { observations: snapshots, observationWaitMs: Date.now() - started, threshold },
          null,
          2,
        ) + '\n',
      );
      console.log(JSON.stringify({ fullStock: count, observationWaitMs: Date.now() - started }));
      return;
    }
    console.log(
      JSON.stringify({ waitingForFullStock: count, observed: snapshots.map(stockCount) }),
    );
    await delay(15000);
  }
  throw new Error('Full reserves not observed before deadline');
}
function walletScope(wallet) {
  return `${Buffer.from(wallet.key.public_key_digest).toString('hex')}:${wallet.key.epoch}`;
}
function stockCount(value) {
  let ready = 0;
  for (const batch of value.ready_a) {
    if (value.ready_b.includes(batch)) ready += 1;
  }
  return { key: value.key.slice(0, 8), ready };
}
function fullStock(value) {
  return (
    value.ready_a.length === 16 &&
    value.ready_b.length === 16 &&
    new Set(value.ready_a).size === 16 &&
    new Set(value.ready_b).size === 16 &&
    stockCount(value).ready === 16 &&
    value.reserved_a.length === 0 &&
    value.reserved_b.length === 0
  );
}

async function verifyDuplicate(wallet, row) {
  const message = Array.from(Buffer.from(row.messageHex, 'hex'));
  const request = {
    key: wallet.key,
    operation: row.operation,
    message_digest: Array.from(createHash('sha256').update(Buffer.from(message)).digest()),
    context_digest: Array.from(createHash('sha256').update(Buffer.alloc(0)).digest()),
  };
  const started = Date.now();
  const result = await call('/router-ab/ml-dsa/sign', { request, message, context: [] });
  assert.equal(result.status, 'existing');
  assert.equal(result.operation.state, 'succeeded');
  assert.equal(Buffer.from(result.operation.signature).toString('hex'), row.signatureHex);
  return {
    wallet: wallet.index,
    operation: row.operation,
    sameSignature: true,
    elapsedMs: Date.now() - started,
  };
}

function fullFreshStock(value) {
  return fullStock(value) && Date.now() - value.log_timestamp_ms <= 45000;
}

function validateHistory(result, input) {
  const demandNumbers = result.demands.map(demandNumber).sort(numeric);
  assert.equal(new Set(demandNumbers).size, result.state.demands, 'Duplicate demand rows');
  for (let i = 0; i < demandNumbers.length; i += 1) assert.equal(demandNumbers[i], i + 1);
  const demandSet = new Set(demandNumbers);
  for (const row of result.requests) {
    assert.equal(row.wallet, result.state.config.index);
    assert.ok(demandSet.has(row.demand), 'Request has no durable demand');
    assert.equal(row.startMs, row.startAtMs - input.startAtMs);
    assert.ok(
      row.startAtMs >= input.startAtMs && row.startAtMs < input.endAtMs,
      'Request started outside its window',
    );
    assert.match(row.requestId, /^[0-9a-f]{32}$/);
    if (row.completedAtMs !== undefined) assert.ok(row.completedAtMs >= row.startAtMs);
  }
  const identities = result.requests.map(requestIdentity);
  assert.equal(new Set(identities).size, identities.length, 'Duplicate request ID');
}
function demandNumber(row) {
  return row.number;
}
function requestIdentity(row) {
  return row.requestId;
}
function numeric(left, right) {
  return left - right;
}

function workerRole(worker) {
  return worker.role;
}

function capturedRole(role) {
  return role !== 'front';
}

function assertRegistrationLayout(registered, current) {
  for (const key of [
    'max_active_operations', 'operation_timeout_ms',
    'candidate_group_size', 'preparation_group_size', 'minimum_ready_batches', 'refill_target_batches',
  ]) {
    assert.deepEqual(registered[key], current[key], `Wallet policy changed: ${key}`);
  }
  assert.ok([1, 2].includes(current.max_active_preparations ?? 1));
}
