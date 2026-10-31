import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const evidence = JSON.parse(
  await readFile(new URL('./ml-dsa-failure-causes-20261101.json', import.meta.url), 'utf8'),
);
const repository = new URL('../../', import.meta.url);
for (const circuit of evidence.circuits.circuits) {
  assert.ok(circuit.newPath.startsWith('crates/ml-dsa-threshold/circuits/'));
  assert.ok(!circuit.newPath.split('/').includes('..'));
  const bytes = await readFile(new URL(circuit.newPath, repository));
  assert.equal(bytes.length, circuit.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), circuit.sha256);
}
for (const [name, circuits] of [
  ['SIGNING', evidence.circuits.circuits.slice(0, 6)],
  ['KEY_GENERATION', evidence.circuits.circuits.slice(6)],
]) {
  const hash = createHash('sha256');
  for (const circuit of circuits) hash.update(Buffer.from(circuit.sha256, 'hex'));
  assert.equal(hash.digest('hex'), evidence.circuits.setDigests[name]);
}
assert.equal(evidence.circuits.regeneratedAllCircuits, true);
assert.equal(evidence.worker.passed, true);
assert.equal(evidence.gateway.functionalPassed, true);
assert.equal(evidence.gateway.canonicalRecoveryPassed, true);
assert.equal(evidence.requirements.candidateConsumption, 2);
assert.equal(evidence.requirements.preparationCandidates, 4);
assert.equal(evidence.requirements.walletCapacityCandidates, 32);
let verified = 0;
for (const signature of evidence.worker.signatures) {
  verifySignature(evidence.worker.publicKeyHex, signature);
  verified += 1;
}
for (const [name, reason] of [
  ['unopenedAfterFailure', 'material_unavailable'],
  ['truncatedMaterialDelivery', 'invalid_material'],
]) {
  const result = evidence.worker[name];
  assert.equal(result.failureOutcome.reason, reason);
  assert.ok(result.retainedPairs > 0);
  assert.equal(result.freshSignatureVerifiedByOpenSsl, true);
  assert.equal(result.oldTakeRejected, true);
  assert.deepEqual(result.committedTakesA, result.committedTakesB);
  assert.equal(new Set(result.committedTakesA).size, result.committedTakesA.length);
  assert.notEqual(result.failedOperation, result.freshOperation);
  verifySignature(evidence.worker.publicKeyHex, result);
  verified += 1;
}
verifySignature(
  Buffer.from(evidence.gateway.publicKeyB64u, 'base64url').toString('hex'),
  evidence.gateway.signature,
);
verified += 1;
assert.equal(evidence.worker.stalledOperationExpiredWithoutSignature, true);
assert.equal(evidence.worker.stalledPeerCloseCode, 1011);
assert.equal(evidence.worker.stalledPairRetiredBeforeClose, true);
for (const value of Object.values(evidence.durableRestart)) assert.equal(value, true);
assert.deepEqual(evidence.gateway.terminalFailures.cases.map(failureReason), [
  'candidates_exhausted',
  'transport_interrupted',
]);
for (const result of evidence.gateway.terminalFailures.cases) {
  assert.equal(result.exactReplay, true);
  assert.equal(result.publicResultAndHookPreserveCause, true);
  assert.equal(result.submissionUncertaintyPreserved, true);
}
assert.equal(evidence.native.allCanonicalKeysVerified, true);
assert.equal(evidence.native.preparedComponentChecks.all_matched_independent_oracle, true);
console.log(
  JSON.stringify({
    passed: true,
    independentlyVerifiedSignatures: verified,
    alteredMessagesRejected: verified,
    unchangedProductionCircuits: evidence.circuits.circuits.length,
    scope:
      'Offline signature and circuit verification plus retained lifecycle assertions. Does not rerun the Worker faults, authentication, or source review.',
  }),
);

function failureReason(value) {
  return value.reason;
}
function verifySignature(publicKeyHex, sample) {
  const key = createPublicKey({
    format: 'der',
    type: 'spki',
    key: Buffer.concat([
      Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex'),
      Buffer.from(publicKeyHex, 'hex'),
    ]),
  });
  const message = Buffer.from(sample.messageHex, 'hex');
  const signature = Buffer.from(sample.signatureHex, 'hex');
  assert.equal(signature.length, 3309);
  assert.equal(verify(null, message, key, signature), true);
  assert.equal(verify(null, Buffer.concat([message, Buffer.from([1])]), key, signature), false);
}
