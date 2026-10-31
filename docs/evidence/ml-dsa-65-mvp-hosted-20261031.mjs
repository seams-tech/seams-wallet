import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const name = 'ml-dsa-65-mvp-hosted-20261031';
const evidence = JSON.parse(await readFile(path.join(directory, name + '.json'), 'utf8'));
const archive = path.join(directory, evidence.archive.file);
const bytes = await readFile(archive);
assert.equal(createHash('sha256').update(bytes).digest('hex'), evidence.archive.sha256);
assert.equal(bytes.length, evidence.archive.bytes);
assert.equal(evidence.requirements.walletCandidateCapacity, 32);
assert.equal(evidence.requirements.minimumAdmittedCandidates, 16);
assert.equal(evidence.requirements.preparedCandidatesPerJob, 4);
assert.equal(evidence.requirements.consumedCandidatesPerPair, 2);
assert.equal(evidence.requirements.walletSeedRecovery, true);
assert.equal(evidence.requirements.canonicalFipsSeedAndKeyExport, true);
assert.equal(evidence.packages.passed, true);
assert.equal(evidence.packagedWorkers.roles.length, 8);
for (const role of evidence.packagedWorkers.roles) assert.equal(role.allFilesMatchCurrentBuild, true);
for (const result of evidence.baselineBrowserResults) assert.equal(result.passed, true);
for (const result of evidence.candidateBrowserResults) assert.equal(result.passed, true);
for (const consent of [evidence.baselineSessionConsent, evidence.candidateSessionConsent]) {
  assert.equal(consent.mandatoryConsentVisible, true);
  assert.equal(consent.callerTextCannotReplaceConsent, true);
}
let signatures = verifyLifecycle(evidence.baselineLifecycle);
signatures += verifyLifecycle(evidence.candidateLifecycle);
for (const value of Object.values(evidence.baselineOwnerParity.checks)) assert.equal(value, true);
assert.equal(evidence.localWorkerLifecycle.functionalPassed, true);
assert.equal(evidence.localWorkerLifecycle.recoveryPreservesCanonicalKey, true);
for (const value of Object.values(evidence.durableLifecycle.generic_registration)) assert.equal(value, true);
assert.equal(evidence.coldCreation.fixturePreparationCalled, false);
assert.equal(evidence.coldCreation.signerPersistsAfterReload, true);
assert.equal(evidence.coldCreation.defaultSignerUnchanged, true);
const coldOperation = Buffer.from(evidence.coldCreation.signer.operationIdB64u, 'base64url').toString('hex');
const execution = evidence.coldCreationCorrelations.find(isColdExecution);
assert.ok(execution);
assert.equal(execution.operation, coldOperation);
const preparation = evidence.coldCreationCorrelations.find(isColdPreparation);
const settlement = evidence.coldCreationCorrelations.find(isColdSettlement);
assert.ok(preparation && settlement);
assert.equal(preparation.job, execution.job);
assert.equal(settlement.job, execution.job);
assert.equal(settlement.transport_succeeded, true);
assert.ok(evidence.coldCreation.createClickedAtMs < preparation.logTimestamp);
assert.ok(preparation.logTimestamp < settlement.logTimestamp);
assert.ok(settlement.logTimestamp < execution.logTimestamp);
assert.ok(execution.logTimestamp < evidence.coldCreation.publishedAtMs);
assert.equal(evidence.routingRollout.balancedQualificationPassed, false);
assert.deepEqual(evidence.routingRollout.observedPlacements, { 0: 5, 1: 3 });
assert.equal(evidence.cleanup.passed, true);
assert.equal(evidence.cleanup.authenticatedListsSucceeded, true);
for (const key of ['remainingWorkers', 'remainingDurableNamespaces', 'remainingDatabases', 'remainingBuckets']) {
  assert.deepEqual(evidence.cleanup[key], []);
}

const extracted = await mkdtemp(path.join(tmpdir(), 'ml-dsa-hosted-replay-'));
try {
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  for (const entry of entries) {
    assert.ok(!path.isAbsolute(entry));
    assert.ok(!entry.split('/').includes('..'));
  }
  execFileSync('tar', ['-xzf', archive, '-C', extracted]);
  for (const [group, label, expected] of [
    ['one-group', 'capacity', 54],
    ['two-groups', 'capacity-eight', 97],
    ['idle-return', 'idle-return', 5],
  ]) {
    const report = JSON.parse(await readFile(
      path.join(extracted, 'capacity', group, 'cloud-driver', label, 'client.json'), 'utf8',
    ));
    let count = 0;
    const operations = new Set();
    for (const request of report.requests) {
      if (request.state !== 'succeeded') continue;
      const wallet = report.wallets.find(matchesRequestWallet.bind(undefined, request));
      assert.ok(wallet);
      const operation = Buffer.from(request.operation).toString('hex');
      assert.ok(!operations.has(operation));
      operations.add(operation);
      const publicBytes = Buffer.from(wallet.publicKeyHex, 'hex');
      assert.equal(publicBytes.length, 1952);
      assert.equal(createHash('sha256').update(publicBytes).digest('hex'),
        Buffer.from(wallet.key.public_key_digest).toString('hex'));
      assert.equal(request.contextHex, '');
      verifySignature(publicBytes, Buffer.from(request.messageHex, 'hex'),
        Buffer.from(request.signatureHex, 'hex'));
      count += 1;
    }
    assert.equal(count, expected);
    signatures += count;
  }
  const result = execFileSync('python3', [path.join(extracted, 'replay-capacity.py')], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(JSON.parse(result).passed, true);
} finally {
  await rm(extracted, { recursive: true, force: true });
}
console.log(JSON.stringify({
  passed: true,
  independentlyVerifiedSignatures: signatures,
  alteredMessagesRejected: signatures,
  fullMaterialLedgersReproduced: 3,
  balancedEightWalletQualification: 'failed_5_3_distribution',
  scope: 'Offline verification of signatures, retained lifecycle receipts, and exact material/capacity calculations. Does not rerun Cloudflare, browser authentication, NEAR finality, cleanup API calls, or source review.',
}));

function matchesRequestWallet(request, wallet) {
  return wallet.index === request.wallet;
}
function isColdExecution(event) {
  return event.event === 'ml_dsa_registration_call_v1' && event.phase === 'execute';
}
function isColdPreparation(event) {
  return event.event === 'ml_dsa_generic_preparation_v1' && event.stage === 'started';
}
function isColdSettlement(event) {
  return event.event === 'ml_dsa_generic_preparation_v1' && event.stage === 'settled';
}
function verifySignature(publicBytes, message, signature) {
  const key = createPublicKey({
    format: 'der', type: 'spki',
    key: Buffer.concat([Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex'), publicBytes]),
  });
  assert.equal(signature.length, 3309);
  assert.equal(verify(null, message, key, signature), true);
  assert.equal(verify(null, Buffer.concat([message, Buffer.from([1])]), key, signature), false);
}
function verifyLifecycle(lifecycle) {
  assert.equal(lifecycle.restoredSigner.publicKeyB64u, lifecycle.signer.publicKeyB64u);
  assert.equal(lifecycle.checks.samePublicKeyAfterRecovery, true);
  assert.equal(lifecycle.checks.samePublicKeyAfterQrLink, true);
  assert.equal(lifecycle.checks.thresholdTransactionBroadcast, true);
  assert.equal(lifecycle.checks.independentCanonicalSeedImport, true);
  assert.equal(lifecycle.checks.publicRestorationFromRecoveredFactor, true);
  assert.equal(lifecycle.checks.ordinaryFlowsSkipOptionalMlDsaCryptography, true);
  let count = 0;
  for (const sample of Object.values(lifecycle.signatures)) {
    const transaction = Buffer.from(sample.signedTransactionBorshB64u, 'base64url');
    const signature = Buffer.from(sample.signatureB64u, 'base64url');
    assert.equal(transaction[transaction.length - 3310], 2);
    assert.ok(transaction.subarray(-3309).equals(signature));
    const digest = createHash('sha256').update(transaction.subarray(0, -3310)).digest();
    verifySignature(Buffer.from(lifecycle.signer.publicKeyB64u, 'base64url'), digest, signature);
    count += 1;
  }
  assert.equal(count, 8);
  return count;
}
