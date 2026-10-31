import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const evidence = JSON.parse(
  await readFile(new URL('./ml-dsa-65-mvp-gates-20261031.json', import.meta.url), 'utf8'),
);
const publicKey = createPublicKey({
  format: 'der',
  type: 'spki',
  key: Buffer.concat([
    Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex'),
    Buffer.from(evidence.lifecycle.signer.publicKeyB64u, 'base64url'),
  ]),
});
let signatures = 0;
for (const sample of Object.values(evidence.lifecycle.signatures)) {
  const transaction = Buffer.from(sample.signedTransactionBorshB64u, 'base64url');
  const signature = Buffer.from(sample.signatureB64u, 'base64url');
  assert.equal(signature.length, 3309);
  assert.equal(transaction[transaction.length - 3310], 2);
  assert.ok(transaction.subarray(-3309).equals(signature));
  const digest = createHash('sha256').update(transaction.subarray(0, -3310)).digest();
  assert.equal(verify(null, digest, publicKey, signature), true);
  assert.equal(verify(null, Buffer.concat([digest, Buffer.from([1])]), publicKey, signature), false);
  signatures += 1;
}
assert.equal(signatures, 8);
assert.equal(evidence.lifecycle.restoredSigner.publicKeyB64u, evidence.lifecycle.signer.publicKeyB64u);
assert.equal(evidence.requirements.prepared_candidates_per_job, 4);
assert.equal(evidence.requirements.consumed_candidates_per_pair, 2);
assert.equal(evidence.requirements.wallet_candidate_capacity, 32);
assert.equal(evidence.localBrowserCases.length, 4);
for (const result of evidence.localBrowserCases) assert.equal(result.passed, true);
assert.equal(evidence.sessionConsent.callerRequestedNoUi, true);
assert.equal(evidence.sessionConsent.callerRequestedAutomaticApproval, true);
assert.equal(evidence.sessionConsent.mandatoryConsentVisible, true);
assert.ok(evidence.sessionConsent.displayedMaximumSeconds >=
  Math.ceil(evidence.sessionConsent.requestedDurationMs / 1000));
assert.equal(evidence.packages.passed, true);
assert.equal(evidence.packagedWorkers.roles.length, 8);
for (const role of evidence.packagedWorkers.roles) assert.equal(role.allFilesMatchCurrentBuild, true);
assert.equal(evidence.browserWasm.modules.length, 8);
for (const module of evidence.browserWasm.modules) assert.equal(module.unchanged, true);
assert.deepEqual(evidence.modularLoading.ordinaryNear.observedOptionalMlDsaAssetUrls, []);
assert.deepEqual(evidence.modularLoading.ordinaryEcdsa.observedOptionalMlDsaAssetUrls, []);
assert.equal(evidence.hosted.newWorkersCreated, 0);
assert.equal(evidence.hosted.newCredentialUploads, 0);
console.log(JSON.stringify({
  passed: true,
  independentlyVerifiedSignatures: signatures,
  alteredMessagesRejected: signatures,
  scope: 'Offline signature verification and retained receipt invariants. Does not rerun browser, package installation, source review, or hosted qualification.',
}));
