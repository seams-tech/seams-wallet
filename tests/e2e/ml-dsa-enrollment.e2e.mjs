import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, sign, verify, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import bs58 from 'bs58';

const root = resolve(import.meta.dirname, '../..');
assert.equal(process.argv.length, 4, 'Supply a private fixture directory and evidence path');
const directory = resolve(process.argv[2]);
const artifact = resolve(process.argv[3]);
await mkdir(directory, { recursive: true, mode: 0o700 });
const report = {
  observedAt: new Date().toISOString(),
  fixtureOnly: true,
  productionEligible: false,
  scope:
    'Production enrollment orchestration and native NEAR codecs against testnet. The existing owner uses a disposable Node Ed25519 fixture, so this campaign does not qualify the Wallet Ed25519 approval UI. The added public key comes from the earlier canonical threshold-key campaign.',
  checks: {},
  result: 'incomplete',
};
let native;
function jsonValue(_key, value) {
  return typeof value === 'bigint' ? value.toString() : value;
}
async function save() {
  await mkdir(resolve(artifact, '..'), { recursive: true });
  await writeFile(artifact, JSON.stringify(report, jsonValue, 2) + '\n');
}
async function rpc(method, params) {
  const response = await fetch('https://rpc.testnet.near.org', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'ml-dsa-enrollment', method, params }),
    signal: AbortSignal.timeout(60_000),
  });
  assert.equal(response.ok, true);
  const body = await response.json();
  assert.ok(body.result, JSON.stringify(body));
  return body.result;
}
async function codec(input) {
  native.process.stdin.write(JSON.stringify(input) + '\n');
  const line = await native.lines.next();
  assert.equal(line.done, false, 'Native enrollment codec ended early');
  return JSON.parse(line.value);
}
class EnrollmentOwner {
  broadcasts = 0;
  unavailable = false;
  signed = null;
  constructor(api, publicKey, privateKey, accountId) {
    this.reader = new api.MinimalNearClient('https://rpc.testnet.near.org');
    this.publicKey = publicKey;
    this.privateKey = privateKey;
    this.accountId = accountId;
  }
  async viewAccessKeyList(account, finality) {
    assert.equal(account, this.accountId);
    assert.deepEqual(finality, { finality: 'final' });
    if (this.unavailable) throw new TypeError('Injected RPC outage');
    return this.reader.viewAccessKeyList(account, finality);
  }
  async viewProtocolConfig() {
    if (this.unavailable) throw new TypeError('Injected RPC outage');
    return this.reader.viewProtocolConfig();
  }
  async signAndSendTransaction(request) {
    this.broadcasts += 1;
    assert.equal(this.broadcasts, 1, 'Uncertain enrollment must never submit another transaction');
    assert.equal(request.nearAccount.accountId, this.accountId);
    assert.equal(request.receiverId, this.accountId);
    assert.equal(request.options.waitUntil, 'FINAL');
    assert.deepEqual(Object.keys(request.walletSession).sort(), [
      'walletId',
      'walletSessionUserId',
    ]);
    assert.deepEqual(Object.keys(request.nearAccount).sort(), ['accountId', 'kind']);
    assert.deepEqual(request.actions, [
      {
        type: 'AddKey',
        publicKey: report.mlDsaPublicKey,
        accessKey: { nonce: 0, permission: 'FullAccess' },
      },
    ]);
    const access = await rpc('query', {
      request_type: 'view_access_key',
      account_id: this.accountId,
      public_key: this.publicKey,
      finality: 'final',
    });
    assert.ok(Number.isSafeInteger(access.nonce));
    const encoded = await codec({
      kind: 'encode',
      accountId: this.accountId,
      signerPublicKey: this.publicKey,
      addedPublicKey: report.mlDsaPublicKey,
      nonce: (BigInt(access.nonce) + 1n).toString(),
      blockHash: access.block_hash,
    });
    const message = Buffer.from(encoded.transactionHashB64u, 'base64url');
    const signature = sign(null, message, this.privateKey);
    assert.equal(verify(null, message, this.publicKeyObject, signature), true);
    const signed = await codec({
      kind: 'finalize',
      unsignedTransactionBorshB64u: encoded.unsignedTransactionBorshB64u,
      signatureB64u: signature.toString('base64url'),
    });
    this.signed = signed;
    report.enrollmentTransactionHash = signed.transactionHash;
    await save();
    const outcome = await rpc('send_tx', {
      signed_tx_base64: Buffer.from(signed.signedTransactionBorshB64u, 'base64url').toString(
        'base64',
      ),
      wait_until: 'FINAL',
    });
    assert.ok('SuccessValue' in outcome.status, JSON.stringify(outcome));
    this.unavailable = true;
    throw new TypeError('Injected lost enrollment acknowledgement');
  }
}
try {
  const bundle = join(directory, 'enrollment-api.mjs');
  await build({
    entryPoints: [join(root, 'tests/helpers/mlDsaGatewayRegistration.fixtures.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    mainFields: ['module', 'main'],
    loader: { '.wasm': 'file' },
    tsconfig: join(root, 'packages/wallet/tsconfig.json'),
    outfile: bundle,
  });
  const api = await import(pathToFileURL(bundle).href);
  await api.initializeSigningCodec(
    await readFile(join(root, 'wasm/near_signer/pkg-ml-dsa/ml_dsa_signer_bg.wasm')),
  );
  const baseline = JSON.parse(
    await readFile(join(root, 'docs/evidence/ml-dsa-65-browser-hosted-20261021.json')),
  );
  assert.equal(baseline.result, 'passed');
  const published = baseline.publication.key;
  const signer = {
    kind: 'near_ml_dsa_65',
    signingKeyId: published.signingKeyId,
    publicKeyB64u: published.publicKeyB64u,
    keyManifestDigestB64u: published.keyManifestDigestB64u,
    materialEpoch: published.materialEpoch,
  };
  report.mlDsaPublicKey =
    'ml-dsa-65:' + bs58.encode(Buffer.from(signer.publicKeyB64u, 'base64url'));
  report.expectedHandle =
    'ml-dsa-65-hash:' +
    bs58.encode(
      createHash('sha3-256')
        .update('near:ml-dsa-65-pubkey-hash:v1')
        .update(Buffer.from(signer.publicKeyB64u, 'base64url'))
        .digest(),
    );
  const pair = generateKeyPairSync('ed25519');
  const edPublicKey =
    'ed25519:' + bs58.encode(pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
  const accountId = 'ml-dsa-enroll-' + randomBytes(8).toString('hex') + '.testnet';
  report.accountId = accountId;
  report.ownerPublicKey = edPublicKey;
  const faucet = await fetch('https://helper.testnet.near.org/account', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: edPublicKey }),
    signal: AbortSignal.timeout(60_000),
  });
  const enrolled = await faucet.json();
  assert.ok(faucet.ok && 'SuccessValue' in enrolled.status, JSON.stringify(enrolled));
  await rpc('tx', {
    tx_hash: enrolled.transaction.hash,
    sender_account_id: enrolled.transaction.signer_id,
    wait_until: 'FINAL',
  });
  const child = spawn(
    join(root, 'tools/ml-dsa-investigation/target/release/ml-dsa-investigation'),
    ['near-enrollment-fixture'],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  native = {
    process: child,
    lines: createInterface({ input: child.stdout })[Symbol.asyncIterator](),
  };
  const owner = new EnrollmentOwner(api, edPublicKey, pair.privateKey, accountId);
  owner.publicKeyObject = pair.publicKey;
  const target = {
    near: { signAndSendTransaction: owner.signAndSendTransaction.bind(owner) },
    nearClient: {
      viewAccessKeyList: owner.viewAccessKeyList.bind(owner),
      viewProtocolConfig: owner.viewProtocolConfig.bind(owner),
    },
    walletSession: {
      ...api.walletSessionRefFromSession({ walletId: baseline.walletId }),
      leakedFactor: 'fixture-private-field',
    },
    nearAccount: {
      ...api.nearAccountRefFromAccountId(accountId),
      leakedFactor: 'fixture-private-field',
    },
    publication: { walletId: baseline.walletId, signer },
  };
  const wrongWallet = await api.enrollMlDsaNearSigner({
    ...target,
    walletSession: api.walletSessionRefFromSession({ walletId: 'other-enrollment-wallet' }),
  });
  assert.deepEqual(wrongWallet, { kind: 'refused', reason: 'wrong_wallet' });
  assert.equal(owner.broadcasts, 0);
  report.checks.publicationCannotEnrollAnotherWallet = true;
  const unavailable = await api.enrollMlDsaNearSigner({
    ...target,
    nearClient: {
      viewAccessKeyList: target.nearClient.viewAccessKeyList,
      viewProtocolConfig: rejectProtocolRead,
    },
  });
  assert.deepEqual(unavailable, { kind: 'unavailable', reason: 'rpc_unavailable' });
  const unsupported = await api.enrollMlDsaNearSigner({
    ...target,
    nearClient: {
      viewAccessKeyList: target.nearClient.viewAccessKeyList,
      viewProtocolConfig: oldProtocol,
    },
  });
  assert.deepEqual(unsupported, { kind: 'refused', reason: 'unsupported_protocol' });
  assert.equal(owner.broadcasts, 0);
  report.checks.protocolFailureNeverRequestsOwnerApproval = true;
  report.checks.preActivationNetworkNeverRequestsOwnerApproval = true;
  report.protocolConfig = await owner.viewProtocolConfig();
  assert.ok(report.protocolConfig.protocolVersion >= 85);
  const pending = await api.enrollMlDsaNearSigner(target);
  assert.equal(pending.kind, 'pending', JSON.stringify(pending));
  assert.equal(pending.reason, 'rpc_unavailable');
  assert.equal(JSON.stringify(pending.continuation).includes('fixture-private-field'), false);
  report.checks.callerExtrasNeverReachSubmissionOrContinuation = true;
  const stillPending = await api.resumeMlDsaNearEnrollment({
    nearClient: target.nearClient,
    continuation: pending.continuation,
  });
  assert.equal(stillPending.kind, 'pending');
  assert.equal(owner.broadcasts, 1);
  report.checks.lostAcknowledgementAndOutagePreservePending = true;
  owner.unavailable = false;
  const resumed = await api.resumeMlDsaNearEnrollment({
    nearClient: target.nearClient,
    continuation: structuredClone(pending.continuation),
  });
  assert.deepEqual(resumed, { kind: 'enrolled', publicKey: report.mlDsaPublicKey });
  assert.deepEqual(await api.enrollMlDsaNearSigner(target), resumed);
  assert.equal(owner.broadcasts, 1);
  report.checks.recoveryAndExactRepeatDoNotResubmit = true;
  const keys = await owner.reader.viewAccessKeyList(accountId, { finality: 'final' });
  assert.ok(keys.keys.some(isExpectedMlDsaKey));
  report.checks.hashedAccessKeyHandleMatchesIndependentSha3 = true;
  const final = await rpc('tx', {
    tx_hash: owner.signed.transactionHash,
    sender_account_id: accountId,
    wait_until: 'FINAL',
  });
  assert.equal(final.final_execution_status, 'FINAL');
  assert.ok('SuccessValue' in final.status);
  assert.equal(final.transaction.signer_id, accountId);
  assert.equal(final.transaction.receiver_id, accountId);
  assert.equal(final.transaction.public_key, edPublicKey);
  assert.deepEqual(final.transaction.actions, [
    {
      AddKey: {
        public_key: report.mlDsaPublicKey,
        access_key: { nonce: 0, permission: 'FullAccess' },
      },
    },
  ]);
  report.checks.exactAddKeyConfirmedAtFinality = true;
  report.final = final;
  report.sources = {};
  for (const path of [
    'packages/wallet/src/core/signingEngine/walletCustody/mlDsaEnrollment.ts',
    'tests/e2e/ml-dsa-enrollment.e2e.mjs',
    'tools/ml-dsa-investigation/src/near_enrollment_fixture.rs',
    'wasm/near_signer/src/ml_dsa_transaction.rs',
  ])
    report.sources[path] = createHash('sha256')
      .update(await readFile(join(root, path)))
      .digest('hex');
  report.result = 'passed';
  await save();
  console.log(JSON.stringify({ result: report.result, accountId, checks: report.checks }));
} catch (error) {
  report.result = 'failed';
  report.error = String(error);
  await save();
  throw error;
} finally {
  native?.process.kill();
}
function isExpectedMlDsaKey(key) {
  return key.public_key === report.expectedHandle && key.access_key.permission === 'FullAccess';
}
async function rejectProtocolRead() {
  throw new TypeError('Injected protocol configuration outage');
}
async function oldProtocol() {
  return { chainId: 'pre-activation-test-network', protocolVersion: 84 };
}
