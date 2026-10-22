import assert from 'node:assert/strict';
import { calibrateHttpTiming, observeEventLoop } from './ml-dsa-http-timing.mjs';
import { createWalletHttpClient } from './ml-dsa-wallet-http-client.mjs';
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

const [durationText, artifact, ...paths] = process.argv.slice(2);
const durationMs = Number(durationText);
const intervalMs = Number(process.env.ML_DSA_TEST_WALLET_INTERVAL_MS ?? 0);
assert.ok(Number.isSafeInteger(durationMs) && durationMs >= 60000 && durationMs <= 1800000);
assert.ok(Number.isSafeInteger(intervalMs) && intervalMs >= 0 && intervalMs <= 300000);
assert.ok(paths.length >= 2 && paths.length <= 8);
const origin = process.env.ML_DSA_REGISTRATION_ROUTER_URL;
const credential = (await readFile(process.env.ML_DSA_GATEWAY_TOKEN_FILE, 'utf8')).trim();
const registrations = await Promise.all(paths.map(readRegistration));
const wallets = registrations.map(makeWallet);
assert.equal(new Set(wallets.map(walletIdentity)).size, wallets.length);
for (const registration of registrations) assert.deepEqual(registration.policy, registrations[0].policy);
const httpCalibration = await calibrateHttpTiming();
const clients = [];
const clientSetupStarted = performance.now();
try {
  for (const wallet of wallets) {
    clients.push(await createWalletHttpClient(wallet.index,
      new URL('/router-ab/ml-dsa/sign', origin).href, credential, 45000));
  }
} catch (error) {
  await Promise.allSettled(clients.map(closeClient));
  throw error;
}
const clientSetupMs = performance.now() - clientSetupStarted;
const started = performance.now();
const deadline = started + durationMs;
const report = {
  observedAt: new Date().toISOString(),
  scope: 'Concurrent independent wallets, one outstanding demand and one persistent Node HTTP client per wallet. Real hosted Router and separate participant Workers. Thirty-two prepared candidates per wallet. Durations include client dispatch and result delivery. All starting stock must be excluded from sustained throughput. Login, UI, NEAR submission, and finality are excluded.',
  policy: registrations[0].policy,
  httpCalibration,
  eventLoopGaps: [],
  requestedDurationMs: durationMs,
  intervalMs,
  minimumSuccessesPerWallet: 4,
  scriptSha256: hash(await readFile(import.meta.filename)),
  httpTimingSourceSha256: hash(await readFile(new URL('./ml-dsa-http-timing.mjs', import.meta.url))),
  clientSourceSha256: hash(await readFile(new URL('./ml-dsa-wallet-http-client.mjs', import.meta.url))),
  workerSourceSha256: hash(await readFile(new URL('./ml-dsa-wallet-http-worker.mjs', import.meta.url))),
  clientRuntimes: clients.map(clientRuntime),
  clientSetupMs,
  wallets: wallets.map(publicWallet),
  requests: [],
  demands: [],
  duplicateRequests: [],
  errors: [],
};
const eventLoopMonitor = observeEventLoop(report.eventLoopGaps, started);
try {
  await Promise.all(wallets.map(runWallet));
} finally {
  clearInterval(eventLoopMonitor);
  report.elapsedMs = performance.now() - started;
  await Promise.allSettled(clients.map(closeClient));
  const successes = report.requests.filter(verified);
  report.successfulSignatures = successes.length;
  report.successfulSignaturesUnderFiveSeconds = successes.filter(underTarget).length;
  report.allSuccessfulSignaturesUnderFiveSeconds = successes.length > 0 && successes.every(underTarget);
  report.successesPerWallet = wallets.map(successCount);
  report.functionalPassed = report.errors.length === 0 && wallets.every(walletSucceeded);
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`);
  if (!report.functionalPassed) process.exitCode = 1;
  console.log(JSON.stringify({ artifact, successful: successes.length, underFiveSeconds: report.successfulSignaturesUnderFiveSeconds, functionalPassed: report.functionalPassed }));
}

async function readRegistration(path) {
  const registration = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(registration.hosted, true);
  assert.equal(registration.registrationChecksPassed, true);
  const size = registration.policy.candidate_group_size;
  assert.ok([2, 4, 8].includes(size));
  assert.equal(registration.policy.refill_target_batches * size, 32);
  assert.equal(registration.policy.minimum_ready_batches * size, 16);
  assert.equal(registration.cases.at(-1).canonicalKeyVerified, true);
  return registration;
}

function makeWallet(registration, index) {
  const recovered = registration.cases.at(-1);
  const publicKey = Buffer.from(recovered.publicKeyHex, 'hex');
  assert.equal(publicKey.length, 1952);
  assert.deepEqual(recovered.key.wallet, registration.wallet);
  assert.deepEqual(recovered.key.public_key_digest, digest(publicKey));
  assert.equal(recovered.key.epoch, recovered.epoch);
  const scheduleDigest = recovered.key.schedule_digest;
  assert.ok(Array.isArray(scheduleDigest) && scheduleDigest.length === 32 && scheduleDigest.every(validByte));
  return {
    index,
    key: {
      wallet: registration.wallet,
      key_id: 'near',
      epoch: recovered.epoch,
      public_key_digest: digest(publicKey),
      schedule_digest: scheduleDigest,
    },
    publicKeyHex: recovered.publicKeyHex,
    verifier: createPublicKey({ key: Buffer.concat([Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex'), publicKey]), format: 'der', type: 'spki' }),
    successes: 0,
  };
}

function walletIdentity(wallet) {
  return JSON.stringify(wallet.key.wallet);
}

function publicWallet(wallet) {
  return { index: wallet.index, key: wallet.key, publicKeyHex: wallet.publicKeyHex };
}

async function runWallet(wallet) {
  let nextDemand = started;
  try {
    while (performance.now() < deadline) {
      await delay(Math.max(0, Math.min(nextDemand, deadline) - performance.now()));
      if (performance.now() >= deadline) break;
      const demand = { wallet: wallet.index, number: wallet.successes + 1, startMs: performance.now() - started, state: 'pending' };
      report.demands.push(demand);
      await runDemand(wallet, demand);
      if (demand.state !== 'succeeded') break;
      nextDemand = started + demand.startMs + intervalMs;
    }
  } catch (error) {
    report.errors.push({ wallet: wallet.index, error: String(error) });
    const pending = report.demands.filter(pendingDemand).findLast(matchesWallet.bind(null, wallet.index));
    if (pending) pending.state = 'client_error_unknown_server_outcome';
  }
}

async function runDemand(wallet, demand) {
  let operation = newOperation(wallet);
  while (performance.now() < deadline) {
    const entry = { wallet: wallet.index, demand: demand.number, operation: operation.request.operation, startMs: performance.now() - started };
    report.requests.push(entry);
    const timer = performance.now();
    entry.http = {};
    let result;
    try {
      const response = await postOperation(wallet, operation, entry.http);
      entry.httpStatus = response.status;
      assert.equal(response.status, 200);
      result = response.data;
    } catch (error) {
      entry.status = 'client_error_unknown_server_outcome';
      throw error;
    } finally {
      entry.elapsedMs = performance.now() - timer;
      entry.demandElapsedMs = performance.now() - started - demand.startMs;
    }
    entry.status = result.status;
    if (result.status === 'unavailable') {
      entry.reason = result.reason;
      entry.retryAtMs = result.retry_at_ms;
      await retryPause(result.retry_at_ms);
      continue;
    }
    assert.equal(result.status, 'existing');
    entry.state = result.operation.state;
    switch (result.operation.state) {
      case 'succeeded': {
        const signature = Buffer.from(result.operation.signature);
        assert.equal(verify(null, Buffer.from(operation.message), wallet.verifier, signature), true);
        entry.verified = true;
        entry.signatureHex = signature.toString('hex');
        entry.messageHex = Buffer.from(operation.message).toString('hex');
        wallet.successes += 1;
        if (wallet.successes === 1) await verifyDuplicate(wallet, operation, signature);
        demand.state = 'succeeded';
        demand.elapsedMs = entry.demandElapsedMs;
        return;
      }
      case 'preparing':
      case 'running':
        await retryPause(Date.now() + 1000);
        break;
      case 'failed':
      case 'declined':
        operation = newOperation(wallet);
        await retryPause(Date.now() + 1000);
        break;
      default:
        throw new Error('Unexpected ML-DSA operation state');
    }
  }
  demand.state = 'censored_at_end_of_window';
  demand.elapsedMs = performance.now() - started - demand.startMs;
}

function postOperation(wallet, operation, timing) {
  const requestId = randomBytes(16).toString('hex');
  return clients[wallet.index].post(operation, requestId, timing);
}

async function verifyDuplicate(wallet, operation, signature) {
  const measurement = { wallet: wallet.index, operation: operation.request.operation, startMs: performance.now() - started };
  report.duplicateRequests.push(measurement);
  const timer = performance.now();
  measurement.http = {};
  const response = await postOperation(wallet, operation, measurement.http);
  measurement.httpStatus = response.status;
  assert.equal(response.status, 200);
  const result = response.data;
  measurement.elapsedMs = performance.now() - timer;
  measurement.status = result.status;
  measurement.state = result.operation?.state;
  assert.equal(result.status, 'existing');
  assert.equal(result.operation.state, 'succeeded');
  assert.deepEqual(Buffer.from(result.operation.signature), signature);
  measurement.sameSignature = true;
}

async function retryPause(retryAtMs) {
  const remaining = Math.max(0, deadline - performance.now());
  await delay(Math.min(remaining, Math.max(1000, Math.min(5000, retryAtMs - Date.now()))));
}

function newOperation(wallet) {
  const message = Array.from(randomBytes(32));
  return { request: { key: wallet.key, operation: Array.from(randomBytes(32)), message_digest: digest(message), context_digest: digest([]) }, message, context: [] };
}

function digest(bytes) {
  return Array.from(createHash('sha256').update(Buffer.from(bytes)).digest());
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function verified(entry) {
  return entry.verified === true;
}

function underTarget(entry) {
  return entry.elapsedMs < 5000;
}

function walletSucceeded(wallet) {
  return wallet.successes >= report.minimumSuccessesPerWallet;
}

function validByte(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 255;
}

function successCount(wallet) {
  return { wallet: wallet.index, successfulSignatures: wallet.successes };
}

function pendingDemand(demand) {
  return demand.state === 'pending';
}

function matchesWallet(index, demand) {
  return demand.wallet === index;
}

function closeClient(client) {
  return client.close();
}

function clientRuntime(client) {
  return client.runtime;
}
