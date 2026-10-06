import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { evictTransferredWallet } from './linked-presign-transfer-evidence.mjs';

const preparePath = '/router-ab/ed25519/sign/prepare';
const finalizePath = '/router-ab/ed25519/sign';
const destinationName = 'fixture-signing-worker-after-refresh';

function signingFixture(repoRoot, input) {
  const output = execFileSync('cargo', [
    'run', '--quiet', '--manifest-path', join(repoRoot, 'crates/router-ab-dev/Cargo.toml'),
    '--example', 'cloudflare_private_d1_fixture', '--', '--ed25519-signing',
  ], { cwd: repoRoot, encoding: 'utf8', input: JSON.stringify(input) });
  return JSON.parse(output);
}

async function post(router, path, body, credential) {
  return router.fetch(`https://router.test${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-router-ab-internal-service-auth': credential,
    },
    body: JSON.stringify(body),
  });
}

async function accepted(router, path, body, credential) {
  const response = await post(router, path, body, credential);
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

export async function verifyEd25519DestinationSigning({
  topology, activation, identity, clientRecipientSeed, credential, repoRoot, scope,
}) {
  const router = await topology.getWorker('router');
  const fixture = signingFixture(repoRoot, {
    command: 'prepare', activation, identity,
    ownership_generation: 2, expires_at_ms: Date.now() + 120_000,
  });
  const prepareBody = {
    ...fixture.prepare,
    authorized_operation: fixture.authorized_operation,
  };
  const stale = structuredClone(prepareBody);
  stale.authorized_operation.binding.ownership_generation = 1;
  const staleResponse = await post(router, preparePath, stale, credential);
  const staleText = await staleResponse.text();
  assert.notEqual(staleResponse.status, 200, staleText);
  assert.match(staleText, /execution ownership generation differs/);
  const prepared = await accepted(router, preparePath, prepareBody, credential);
  await evictTransferredWallet(topology, destinationName, scope);
  assert.deepEqual(await accepted(router, preparePath, prepareBody, credential), prepared);
  const finalizeBody = signingFixture(repoRoot, {
    command: 'finalize', activation, client_recipient_seed: clientRecipientSeed,
    prepare: fixture.prepare, prepared, authorized_operation: fixture.authorized_operation,
  });
  const response = await accepted(router, finalizePath, finalizeBody, credential);
  const signature = Buffer.from(response.signature.bytes);
  assert.equal(signature.length, 64);
  assert.equal(ed25519.verify(
    signature,
    Buffer.from(fixture.signing_digest_b64u, 'base64url'),
    Buffer.from(activation.public_receipt.registered_public_key),
  ), true);
  await evictTransferredWallet(topology, destinationName, scope);
  assert.deepEqual(await accepted(router, finalizePath, finalizeBody, credential), response);
  return {
    response,
    signatureSha256Hex: createHash('sha256').update(signature).digest('hex'),
    staleGenerationRejected: true,
    prepareReplayAfterEviction: true,
    finalizeReplayAfterEviction: true,
  };
}
