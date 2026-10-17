import assert from 'node:assert/strict';
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

const registration = JSON.parse(await readFile(process.argv[2], 'utf8'));
const artifact = process.argv[3];
const successTarget = Number(process.env.ML_DSA_TEST_SUCCESS_TARGET ?? 12);
assert.ok(Number.isSafeInteger(successTarget) && successTarget >= 12 && successTarget <= 48);
const origin = process.env.ML_DSA_REGISTRATION_ROUTER_URL;
const credential = (await readFile(process.env.ML_DSA_GATEWAY_TOKEN_FILE, 'utf8')).trim();
assert.equal(registration.hosted, true);
assert.equal(registration.registrationChecksPassed, true);
const candidateGroupSize = registration.policy.candidate_group_size;
assert.ok([2, 4, 8].includes(candidateGroupSize));
assert.equal(registration.policy.refill_target_batches * candidateGroupSize, 32);
assert.equal(registration.policy.minimum_ready_batches * candidateGroupSize, 16);
assert.equal(registration.policy.wallet_cooldown.interval_ms, 1000);
const recovered = registration.cases.at(-1);
assert.equal(recovered.canonicalKeyVerified, true);
const publicKey = Buffer.from(recovered.publicKeyHex, 'hex');
const verifier = createPublicKey({
  key: Buffer.concat([Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex'), publicKey]),
  format: 'der',
  type: 'spki',
});
assert.deepEqual(recovered.key.wallet, registration.wallet);
assert.deepEqual(recovered.key.public_key_digest, digest(publicKey));
assert.equal(recovered.key.epoch, recovered.epoch);
const key = {
  wallet: registration.wallet,
  key_id: 'near',
  epoch: recovered.epoch,
  public_key_digest: digest(publicKey),
  schedule_digest: recovered.key.schedule_digest,
};
const report = {
  schema: 'seams.ml-dsa-sustained-worker.v1',
  observedAt: new Date().toISOString(),
  scope: 'One-wallet saturation at a one-second test cooldown, one active operation, and thirty-two prepared candidates in independently consumed groups. Every request is retained. Includes empty-pool retries. Production default cooldown remains 60 seconds. Public login and NEAR submission are excluded.',
  policy: registration.policy,
  successTarget,
  key,
  registrationSha256: hash(await readFile(process.argv[2])),
  scriptSha256: hash(await readFile(import.meta.filename)),
  publicKeyHex: publicKey.toString('hex'),
  requests: [],
  functionalPassed: false,
  latencyTargetMet: false,
};
const started = performance.now();
let successful = 0;
let operation = newOperation();
let demandStarted = performance.now();
const operationStarts = new Map();
try {
  while (successful < successTarget && performance.now() - started < 900000) {
    const operationId = Buffer.from(operation.request.operation).toString('hex');
    if (!operationStarts.has(operationId)) operationStarts.set(operationId, performance.now());
    const entry = { operation: operation.request.operation, demand: successful + 1, startMs: performance.now() - started };
    report.requests.push(entry);
    const timer = performance.now();
    let result;
    try {
      const response = await fetch(new URL('/router-ab/ml-dsa/sign', origin), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-router-ab-internal-service-auth': credential },
        body: JSON.stringify(operation),
        signal: AbortSignal.timeout(45000),
      });
      entry.httpStatus = response.status;
      result = await response.json();
      assert.equal(response.status, 200);
    } catch (error) {
      entry.status = 'client_error_unknown_server_outcome';
      entry.error = String(error);
      throw error;
    } finally {
      entry.elapsedMs = performance.now() - timer;
      entry.operationElapsedMs = performance.now() - operationStarts.get(operationId);
      entry.demandElapsedMs = performance.now() - demandStarted;
    }
    entry.status = result.status;
    if (result.status === 'unavailable') {
      entry.reason = result.reason;
      entry.retryAtMs = result.retry_at_ms;
      // Bound polling, and retain the same request identity until admission.
      await delay(Math.max(1000, Math.min(5000, result.retry_at_ms - Date.now())));
      continue;
    }
    assert.equal(result.status, 'existing');
    entry.state = result.operation.state;
    if (result.operation.state === 'succeeded') {
      const signature = Buffer.from(result.operation.signature);
      assert.equal(verify(null, Buffer.from(operation.message), verifier, signature), true);
      entry.signatureHex = signature.toString('hex');
      entry.messageHex = Buffer.from(operation.message).toString('hex');
      entry.verified = true;
      successful += 1;
    } else {
      assert.ok(['failed', 'declined'].includes(result.operation.state));
    }
    operation = newOperation();
    await delay(1100);
    if (entry.verified) demandStarted = performance.now();
  }
  report.functionalPassed = successful === successTarget;
  report.latencyTargetMet = report.functionalPassed && report.requests.every(underTarget);
  if (!report.functionalPassed) process.exitCode = 1;
} catch (error) {
  report.error = String(error);
  process.exitCode = 1;
} finally {
  report.elapsedMs = performance.now() - started;
  report.successfulSignatures = successful;
  report.successfulDemandLatenciesMsIncludingEmptyPool = report.requests.filter(verified).map(demandElapsed);
  report.successfulSignatureLatenciesMs = report.requests.filter(verified).map(elapsed);
  report.successfulSignaturesUnderFiveSeconds = report.requests.filter(underTarget).length;
  report.successfulSignaturesPerMinuteIncludingWaits = successful * 60000 / report.elapsedMs;
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ artifact, successful, elapsedMs: report.elapsedMs, functionalPassed: report.functionalPassed }));
}
function newOperation() {
  const message = Array.from(randomBytes(32));
  return {
    request: { key, operation: Array.from(randomBytes(32)), message_digest: digest(message), context_digest: digest([]) },
    message,
    context: [],
  };
}
function digest(bytes) {
  return Array.from(createHash('sha256').update(Buffer.from(bytes)).digest());
}
function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function underTarget(entry) {
  return entry.verified === true && entry.elapsedMs < 5000;
}

function verified(entry) {
  return entry.verified === true;
}
function elapsed(entry) {
  return entry.elapsedMs;
}

function demandElapsed(entry) {
  return entry.demandElapsedMs;
}
