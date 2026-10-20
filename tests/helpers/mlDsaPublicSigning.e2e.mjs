import assert from 'node:assert/strict';
import { createHash, createPublicKey, randomBytes, sign, verify } from 'node:crypto';

const origin = 'https://wallet.example.test';
const base = 'https://gateway.example.test';
function hash(bytes) {
  return createHash('sha256').update(bytes).digest();
}
export function signingAssertion(key, challenge, counter) {
  const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
  const suffix = Buffer.alloc(5);
  suffix[0] = 5;
  suffix.writeUInt32BE(counter, 1);
  const auth = Buffer.concat([hash('wallet.example.test'), suffix]);
  return {
    id: key.credentialId,
    rawId: key.credentialId,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: client.toString('base64url'),
      authenticatorData: auth.toString('base64url'),
      signature: sign('sha256', Buffer.concat([auth, hash(client)]), key.privateKey).toString(
        'base64url',
      ),
      userHandle: null,
    },
  };
}
export class GatewayTransport {
  loseReply = false;
  corruptSignature = false;
  expectedSubmission = null;
  broadcasts = 0;
  constructor(gateway) {
    this.gateway = gateway;
  }
  async fetch(url, init) {
    if (new URL(url).origin === 'https://rpc.example.test') {
      const request = JSON.parse(init.body);
      assert.equal(request.method, 'send_tx');
      assert.deepEqual(
        Buffer.from(request.params.signed_tx_base64, 'base64'),
        Buffer.from(this.expectedSubmission.signedTransactionBorshB64u, 'base64url'),
      );
      this.broadcasts += 1;
      return Response.json({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          final_execution_status: 'EXECUTED_OPTIMISTIC',
          status: { SuccessValue: '' },
          transaction: { hash: this.expectedSubmission.transactionHash },
          transaction_outcome: {
            id: this.expectedSubmission.transactionHash,
            outcome: {
              logs: [],
              receipt_ids: [],
              gas_burnt: 0,
              tokens_burnt: '0',
              executor_id: 'ml-dsa-gateway.testnet',
              status: { SuccessValue: '' },
            },
          },
          receipts_outcome: [],
        },
      });
    }
    assert.equal(new URL(url).origin, base);
    const headers = new Headers(init.headers);
    headers.set('Origin', origin);
    const response = await this.gateway.fetch(new Request(url, { ...init, headers }));
    if (this.loseReply) {
      this.loseReply = false;
      throw new TypeError('Injected lost signing reply');
    }
    if (this.corruptSignature) {
      this.corruptSignature = false;
      const body = await response.json();
      assert.equal(body.kind, 'signed');
      const sig = Buffer.from(body.transaction.signatureB64u, 'base64url');
      sig[0] ^= 1;
      body.transaction.signatureB64u = sig.toString('base64url');
      return Response.json(body);
    }
    return response;
  }
}
async function request(gateway, walletId, path, body, requestOrigin = origin) {
  const response = await gateway.fetch(
    new Request(`${base}/wallets/${walletId}/ml-dsa/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Origin: requestOrigin,
        ...gateway.protocolHeader,
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json() };
}
export async function verifyMlDsaPublicSigning({
  api,
  gateway,
  key,
  walletId,
  signingKeyId,
  publicKeyB64u,
  unsignedTransactionBorshB64u,
  database,
  claimDatabase,
  scope,
}) {
  const transport = new GatewayTransport(gateway);
  const original = globalThis.fetch;
  globalThis.fetch = transport.fetch.bind(transport);
  const checks = {};
  try {
    const signingRequest = {
      walletId,
      signingKeyId,
      operationIdB64u: randomBytes(32).toString('base64url'),
      unsignedTransactionBorshB64u,
      rpId: 'wallet.example.test',
      credentialIdB64u: key.credentialId,
    };
    const prepared = await api.prepareMlDsaNearSigning({
      relayerUrl: base,
      request: signingRequest,
      publicKeyB64u,
    });
    assert.equal(prepared.kind, 'prepared', JSON.stringify(prepared));
    const preparation = prepared.preparation;
    assert.equal(preparation.transaction.nonce, '9007199254740993');
    assert.deepEqual(
      await api.prepareMlDsaNearSigning({
        relayerUrl: base,
        request: signingRequest,
        publicKeyB64u,
      }),
      prepared,
    );
    checks.preparationReplaysWithoutChangingChallenge = true;
    checks.largeNoncePreservesExactValue = true;
    const wrong = { ...signingRequest, materialEpoch: 2 };
    assert.equal(
      (await request(gateway, walletId, 'sign/prepare', wrong)).body.code,
      'invalid_body',
    );
    checks.callerCannotSelectMaterialEpoch = true;
    const changed = structuredClone(signingRequest);
    const bytes = Buffer.from(unsignedTransactionBorshB64u, 'base64url');
    bytes[bytes.length - 1] ^= 1;
    changed.unsignedTransactionBorshB64u = bytes.toString('base64url');
    assert.equal(
      (await request(gateway, walletId, 'sign/prepare', changed)).body.code,
      'idempotency_conflict',
    );
    checks.changedTransactionCannotReuseApproval = true;
    assert.equal(
      (await request(gateway, 'other-wallet', 'sign/prepare', signingRequest)).status,
      403,
    );
    checks.wrongWalletRejected = true;
    const credential = signingAssertion(key, preparation.challengeB64u, 1);
    const execute = { walletId, operationIdB64u: signingRequest.operationIdB64u, credential };
    const invalid = structuredClone(execute);
    invalid.credential.response.signature = randomBytes(70).toString('base64url');
    assert.equal((await request(gateway, walletId, 'sign', invalid)).body.code, 'unauthorized');
    checks.invalidFreshAssertionRejected = true;
    assert.equal(
      (await request(gateway, walletId, 'sign', execute, 'https://other.wallet.example.test'))
        .status,
      403,
    );
    checks.approvalOriginBound = true;
    const disclosed = structuredClone(execute);
    disclosed.credential.clientExtensionResults = { prf: { results: { first: 'secret' } } };
    assert.equal((await request(gateway, walletId, 'sign', disclosed)).body.code, 'invalid_body');
    checks.prfOutputRejectedAtPublicBoundary = true;
    const executeInput = { relayerUrl: base, preparation, credential };
    claimDatabase.mode = 'pause';
    const firstApproval = api.executeMlDsaNearSigning(executeInput);
    await Promise.race([
      claimDatabase.paused.promise,
      firstApproval.then(approvalFinishedWithoutPause),
    ]);
    let signed;
    try {
      signed = await api.executeMlDsaNearSigning(executeInput);
    } finally {
      claimDatabase.resume.resolve();
    }
    const delayed = await firstApproval;
    assert.equal(delayed.kind, 'refused');
    assert.equal(delayed.code, 'conflict');
    checks.concurrentFirstApprovalsCommitOnce = true;
    const attempts = [];
    for (let index = 0; signed.kind === 'retry' && index < 10; index += 1) {
      attempts.push(signed);
      await waitUntil(signed.retryAtMs);
      signed = await api.executeMlDsaNearSigning(executeInput);
    }
    assert.equal(signed.kind, 'signed', JSON.stringify(signed));
    transport.loseReply = true;
    await assert.rejects(api.executeMlDsaNearSigning(executeInput), /Injected lost signing reply/);
    assert.deepEqual(await api.executeMlDsaNearSigning(executeInput), signed);
    checks.lostResponseReusesApprovedOperation = true;
    const duplicates = await Promise.all([
      api.executeMlDsaNearSigning(executeInput),
      api.executeMlDsaNearSigning(executeInput),
    ]);
    assert.deepEqual(duplicates, [signed, signed]);
    checks.concurrentDuplicatesReturnSameSignature = true;
    const altered = signingAssertion(key, preparation.challengeB64u, 2);
    assert.equal(
      (await request(gateway, walletId, 'sign', { ...execute, credential: altered })).body.code,
      'idempotency_conflict',
    );
    checks.changedAssertionCannotReplaceApproval = true;
    transport.corruptSignature = true;
    await assert.rejects(
      api.executeMlDsaNearSigning(executeInput),
      /signature verification failed/,
    );
    checks.sdkRejectsCorruptSignature = true;
    const unsigned = Buffer.from(unsignedTransactionBorshB64u, 'base64url');
    const signature = Buffer.from(signed.transaction.signatureB64u, 'base64url');
    const signedBytes = Buffer.from(signed.transaction.signedTransactionBorshB64u, 'base64url');
    assert.deepEqual(signedBytes, Buffer.concat([unsigned, Buffer.from([2]), signature]));
    const publicKey = createPublicKey({
      key: Buffer.concat([
        Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex'),
        Buffer.from(publicKeyB64u, 'base64url'),
      ]),
      format: 'der',
      type: 'spki',
    });
    assert.equal(verify(null, hash(unsigned), publicKey, signature), true);
    checks.standardNearEncodingAndIndependentVerification = true;
    transport.expectedSubmission = signed.transaction;
    const submitted = await api.submitMlDsaNearTransaction({
      rpcUrl: 'https://rpc.example.test',
      preparation,
      transaction: signed.transaction,
    });
    assert.equal(submitted.transaction.hash, signed.transaction.transactionHash);
    assert.equal(transport.broadcasts, 1);
    const corrupt = structuredClone(signed.transaction);
    const damaged = Buffer.from(corrupt.signatureB64u, 'base64url');
    damaged[0] ^= 1;
    corrupt.signatureB64u = damaged.toString('base64url');
    await assert.rejects(
      api.submitMlDsaNearTransaction({
        rpcUrl: 'https://rpc.example.test',
        preparation,
        transaction: corrupt,
      }),
    );
    assert.equal(transport.broadcasts, 1);
    checks.sdkSubmissionUsesVerifiedExactBytes = true;

    const rows = await database
      .prepare(
        `SELECT lifecycle_kind,result_kind FROM authorized_operations
      WHERE namespace=? AND tenant_id=? AND operation_id=?`,
      )
      .bind(scope.namespace, scope.orgId, `ml-dsa:${signingRequest.operationIdB64u}`)
      .all();
    assert.equal(rows.results.length, 1);
    assert.deepEqual(rows.results[0], { lifecycle_kind: 'completed', result_kind: 'succeeded' });
    checks.singleDurableClaimCompletes = true;
    const counter = await database
      .prepare(
        `SELECT counter FROM webauthn_authenticators WHERE namespace=? AND org_id=? AND project_id=? AND env_id=? AND user_id=? AND credential_id_b64u=?`,
      )
      .bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, walletId, key.credentialId)
      .first();
    assert.equal(counter.counter, 1);
    checks.counterAndClaimCommitTogether = true;
    const second = { ...signingRequest, operationIdB64u: randomBytes(32).toString('base64url') };
    const next = await api.prepareMlDsaNearSigning({
      relayerUrl: base,
      request: second,
      publicKeyB64u,
    });
    assert.equal(next.kind, 'prepared');
    const cooldown = await api.executeMlDsaNearSigning({
      relayerUrl: base,
      preparation: next.preparation,
      credential: signingAssertion(key, next.preparation.challengeB64u, 2),
    });
    assert.equal(cooldown.kind, 'retry', JSON.stringify(cooldown));
    assert.ok(cooldown.retryAtMs > Date.now());
    checks.cooldownReturnsExplicitRetryTime = true;
    return {
      lastCounter: 2,
      replay: executeInput,
      signature: {
        verified: true,
        messageHex: hash(unsigned).toString('hex'),
        signatureHex: signature.toString('hex'),
      },
      evidence: {
        checks,
        attempts,
        transaction: signed.transaction,
        operationIdB64u: signingRequest.operationIdB64u,
        scope:
          'Actual public Gateway routes and advanced SDK client, real WebAuthn, D1 claims, Worker signing, RustCrypto and Node OpenSSL verification. Submission uses a simulated NEAR RPC transport. No on-chain transaction or browser UI is performed.',
      },
    };
  } finally {
    globalThis.fetch = original;
  }
}
function timer(milliseconds, resolve) {
  setTimeout(resolve, milliseconds);
}
async function waitUntil(atMs) {
  await new Promise(timer.bind(undefined, Math.max(100, atMs - Date.now())));
}
export async function replayPublicMlDsaSigning(api, gateway, input, expectedKind) {
  const original = globalThis.fetch;
  const transport = new GatewayTransport(gateway);
  globalThis.fetch = transport.fetch.bind(transport);
  try {
    assert.equal((await api.executeMlDsaNearSigning(input)).kind, expectedKind);
  } finally {
    globalThis.fetch = original;
  }
}

function approvalFinishedWithoutPause(outcome) {
  throw new Error(`First approval completed before the claim barrier: ${JSON.stringify(outcome)}`);
}
