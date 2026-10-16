import assert from 'node:assert/strict';
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

const registration = JSON.parse(await readFile(process.argv[2], 'utf8'));
const fixture = JSON.parse(await readFile(process.argv[3], 'utf8'));
const artifact = process.argv[4];
const origin = process.env.ML_DSA_REGISTRATION_ROUTER_URL;
const credential = (await readFile(process.env.ML_DSA_GATEWAY_TOKEN_FILE, 'utf8')).trim();
assert.equal(registration.hosted, true);
assert.equal(registration.registrationChecksPassed, true);
const recovered = registration.cases.at(-1);
assert.equal(recovered.canonicalKeyVerified, true);
const publicKey = Buffer.from(recovered.publicKeyHex, 'hex');
assert.equal(publicKey.length, 1952);
const key = {
  wallet: registration.wallet,
  key_id: 'near',
  epoch: recovered.epoch,
  public_key_digest: digest(publicKey),
  schedule_digest: fixture.activation.key.schedule_digest,
};
const verifier = createPublicKey({
  key: Buffer.concat([
    Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex'),
    publicKey,
  ]),
  format: 'der',
  type: 'spki',
});
const report = {
  observedAt: new Date().toISOString(),
  scope: 'Two hosted requests using an existing disposable registered key. Includes admission and settlement. Excludes registration, user authentication, and NEAR submission. Every attempt remains in this artifact.',
  key,
  registrationSourceSha256: createHash('sha256').update(await readFile(process.argv[2])).digest('hex'),
  scriptSha256: createHash('sha256').update(await readFile(import.meta.filename)).digest('hex'),
  requests: [],
  functionalPassed: false,
  latencyTargetMet: false,
};
try {
  for (let index = 0; index < 2; index += 1) {
    if (index > 0) await delay(61000);
    const message = Array.from(randomBytes(32));
    const request = {
      key,
      operation: Array.from(randomBytes(32)),
      message_digest: digest(message),
      context_digest: digest([]),
    };
    const started = performance.now();
    const entry = { operation: request.operation, state: 'pending' };
    report.requests.push(entry);
    try {
      const response = await fetch(new URL('/router-ab/ml-dsa/sign', origin), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-router-ab-internal-service-auth': credential,
        },
        body: JSON.stringify({ request, message, context: [] }),
        signal: AbortSignal.timeout(45000),
      });
      entry.httpStatus = response.status;
      const result = await response.json();
      entry.elapsedMs = performance.now() - started;
      entry.result = result;
      entry.state = 'returned';
      assert.equal(response.status, 200);
      if (result.status === 'existing' && result.operation.state === 'succeeded') {
        assert.equal(
          verify(null, Buffer.from(message), verifier, Buffer.from(result.operation.signature)),
          true,
        );
        entry.verified = true;
        entry.messageHex = Buffer.from(message).toString('hex');
      }
    } catch (error) {
      if (entry.state === 'pending') {
        entry.state = 'client_error_unknown_server_outcome';
        entry.elapsedMs = performance.now() - started;
      }
      entry.error = String(error);
      throw error;
    }
  }
  report.functionalPassed = report.requests.every(verified);
  report.latencyTargetMet = report.requests.every(underTarget);
  if (!report.functionalPassed) process.exitCode = 1;
} catch (error) {
  report.error = String(error);
  process.exitCode = 1;
} finally {
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    artifact,
    functionalPassed: report.functionalPassed,
    latencyTargetMet: report.latencyTargetMet,
  }));
}
function digest(bytes) {
  return Array.from(createHash('sha256').update(Buffer.from(bytes)).digest());
}
function verified(entry) {
  return entry.verified === true;
}
function underTarget(entry) {
  return verified(entry) && entry.elapsedMs < 5000;
}
