import { createHash } from 'node:crypto';
import { expect } from '@playwright/test';
import * as ed25519 from '@noble/ed25519';
import { base58Decode } from '@shared/utils/encoders';
import type {
  SignNEP413MessageParams,
  SignNEP413MessageResult,
} from '../../../packages/wallet/src/core/types/sdkPublicResults';

function encodeBorshString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function nearMessageSigningDigest(params: SignNEP413MessageParams, nonce: Uint8Array): Buffer {
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(2 ** 31 + 413);
  // NEP-413 defines this order: message, nonce, recipient, callbackUrl.
  const callback =
    params.callbackUrl === undefined
      ? Buffer.from([0])
      : Buffer.concat([Buffer.from([1]), encodeBorshString(params.callbackUrl)]);
  return createHash('sha256')
    .update(
      Buffer.concat([
        tag,
        encodeBorshString(params.message),
        nonce,
        encodeBorshString(params.recipient),
        callback,
      ]),
    )
    .digest();
}

export async function verifyNearMessageSignature(
  params: SignNEP413MessageParams,
  result: Extract<SignNEP413MessageResult, { success: true }>,
) {
  const nonce = Buffer.from(result.nonce, 'base64');
  const signature = Buffer.from(result.signature, 'base64');
  expect(nonce.length).toBe(32);
  expect(signature.length).toBe(64);
  expect(result.publicKey.startsWith('ed25519:')).toBe(true);
  const publicKey = base58Decode(result.publicKey.slice('ed25519:'.length));
  expect(publicKey.length).toBe(32);
  const digest = nearMessageSigningDigest(params, nonce);
  expect(await ed25519.verifyAsync(signature, digest, publicKey)).toBe(true);
  const changedNonce = Buffer.from(nonce);
  changedNonce[0] ^= 1;
  const changedPayloads = [
    nearMessageSigningDigest({ ...params, message: params.message + ' altered' }, nonce),
    nearMessageSigningDigest({ ...params, recipient: 'other.example' }, nonce),
    nearMessageSigningDigest(params, changedNonce),
    nearMessageSigningDigest({ ...params, callbackUrl: 'https://other.example/callback' }, nonce),
  ];
  for (const changedDigest of changedPayloads) {
    expect(await ed25519.verifyAsync(signature, changedDigest, publicKey)).toBe(false);
  }
  const changedState = nearMessageSigningDigest({ ...params, state: 'other-state' }, nonce);
  expect(changedState).toEqual(digest);
  expect(result.state).toBe(params.state);
  return {
    ...params,
    ...result,
    digestHex: digest.toString('hex'),
    verification: {
      standardPayload: true,
      changedMessageRejected: true,
      changedRecipientRejected: true,
      changedNonceRejected: true,
      changedCallbackUrlRejected: true,
      stateExcludedFromPayload: true,
      stateReturnedUnchanged: true,
    },
  };
}
