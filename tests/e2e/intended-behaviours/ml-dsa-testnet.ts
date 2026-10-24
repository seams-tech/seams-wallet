import { expect } from '@playwright/test';
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { base58Encode } from '@shared/utils/base58';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import { decodeNearAccessKeyView } from '@shared/utils/nearRpcResults';
import initialize, {
  threshold_ed25519_build_near_tx_unsigned_borsh,
  threshold_ed25519_finalize_near_tx_from_signature,
} from '../../../wasm/near_signer/pkg/wasm_signer_worker.js';

export async function testnetRpc(method: string, params: unknown) {
  const response = await fetch('https://rpc.testnet.near.org', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'ml-dsa-wallet-lifecycle', method, params }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`Testnet RPC ${method} returned ${response.status}: ${text.slice(0, 240)}`);
  const body = requireRecord(JSON.parse(text), 'NEAR RPC response');
  if (!body.result) throw new Error(`Testnet RPC failed: ${JSON.stringify(body.error)}`);
  return requireRecord(body.result, 'NEAR RPC result');
}

let sponsor: ReturnType<typeof createSponsor> | null = null;

async function createSponsor() {
  const path = process.env.SEAMS_INTENDED_TESTNET_SPONSOR_FILE;
  if (path) return readSponsor(path);
  const pair = generateKeyPairSync('ed25519');
  const publicKey =
    'ed25519:' + base58Encode(pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
  const sponsorId = 'ml-dsa-browser-' + randomBytes(8).toString('hex') + '.testnet';
  const response = await fetch('https://helper.testnet.near.org/account', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ newAccountId: sponsorId, newAccountPublicKey: publicKey }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`Testnet faucet returned ${response.status}: ${text.slice(0, 240)}`);
  const funded = requireRecord(JSON.parse(text), 'faucet result');
  expect(requireRecord(funded.status, 'faucet status')).toHaveProperty('SuccessValue');
  const creation = requireRecord(funded.transaction, 'faucet transaction');
  const created = await testnetRpc('tx', {
    tx_hash: creation.hash,
    sender_account_id: creation.signer_id,
    wait_until: 'FINAL',
  });
  expect(created.final_execution_status).toBe('FINAL');
  return { pair, publicKey, sponsorId };
}

async function readSponsor(path: string) {
  const record = requireRecord(JSON.parse(await readFile(path, 'utf8')), 'testnet sponsor');
  const jwk = requireRecord(record.privateJwk, 'testnet sponsor key');
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519')
    throw new Error('Expected an Ed25519 test sponsor');
  const privateKey = createPrivateKey({
    key: {
      kty: 'OKP',
      crv: 'Ed25519',
      x: requireCanonicalString(jwk.x, 'sponsor public key'),
      d: requireCanonicalString(jwk.d, 'sponsor private key'),
    },
    format: 'jwk',
  });
  const publicKey = createPublicKey(privateKey);
  const bytes = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const sponsorId = requireCanonicalString(record.accountId, 'sponsor account');
  if (sponsorId !== bytes.toString('hex'))
    throw new Error('Test sponsor key differs from its implicit account');
  return {
    pair: { publicKey, privateKey },
    sponsorId,
    publicKey: 'ed25519:' + base58Encode(bytes),
  };
}

/** Each test process uses one disposable sponsor. Funding calls are sequential. */
export async function fundImplicitWallet(accountId: string) {
  if (!/^[0-9a-f]{64}$/.test(accountId)) throw new Error('Expected an implicit Ed25519 account');
  const { pair, publicKey, sponsorId } = await (sponsor ??= createSponsor());
  const access = decodeNearAccessKeyView(
    await testnetRpc('query', {
      request_type: 'view_access_key',
      account_id: sponsorId,
      public_key: publicKey,
      finality: 'final',
    }),
  );
  await initialize({
    module_or_path: await readFile(
      new URL('../../../wasm/near_signer/pkg/wasm_signer_worker_bg.wasm', import.meta.url),
    ),
  });
  const unsigned = threshold_ed25519_build_near_tx_unsigned_borsh({
    txSigningRequests: [
      {
        nearAccountId: sponsorId,
        receiverId: accountId,
        actions: [{ action_type: 'Transfer', deposit: '100000000000000000000000' }],
      },
    ],
    transactionContext: {
      nearPublicKeyStr: publicKey,
      nextNonce: (access.nonce + 1n).toString(),
      txBlockHash: access.block_hash,
    },
  });
  if (!Array.isArray(unsigned) || unsigned.length !== 1)
    throw new Error('Expected one funding transaction');
  const encoded = requireRecord(unsigned[0], 'funding transaction');
  const digest = requireCanonicalString(encoded.signingDigestB64u, 'funding digest');
  const signed = requireRecord(
    threshold_ed25519_finalize_near_tx_from_signature({
      unsignedTransactionBorshB64u: encoded.unsignedTransactionBorshB64u,
      signingDigestB64u: digest,
      signatureB64u: sign(null, Buffer.from(digest, 'base64url'), pair.privateKey).toString(
        'base64url',
      ),
      expectedNearAccountId: sponsorId,
      expectedSignerPublicKey: publicKey,
    }),
    'signed funding transaction',
  );
  const outcome = await testnetRpc('send_tx', {
    signed_tx_base64: Buffer.from(
      requireCanonicalString(signed.signedTransactionBorshB64u, 'funding bytes'),
      'base64url',
    ).toString('base64'),
    wait_until: 'FINAL',
  });
  expect(outcome.final_execution_status).toBe('FINAL');
  expect(requireRecord(outcome.status, 'funding status')).toHaveProperty('SuccessValue');
  const accessKey = await testnetRpc('query', {
    request_type: 'view_access_key',
    account_id: accountId,
    public_key: 'ed25519:' + base58Encode(Buffer.from(accountId, 'hex')),
    finality: 'final',
  });
  expect(accessKey.permission).toBe('FullAccess');
  return {
    sponsorId,
    fundingTransactionHash: signed.transactionHash,
    finalBlockHash: accessKey.block_hash,
  };
}
