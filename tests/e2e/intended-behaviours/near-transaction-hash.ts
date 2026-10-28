import { createHash } from 'node:crypto';
import { base58Encode } from '@shared/utils/base58';

/** NEAR hashes the transaction Borsh bytes, excluding the tagged Ed25519 signature. */
export function nearTransactionHash(signedTransactionBase64: string): string {
  const bytes = Buffer.from(signedTransactionBase64, 'base64');
  const taggedSignatureLength = 1 + 64;
  if (bytes.length <= taggedSignatureLength || bytes.at(-taggedSignatureLength) !== 0) {
    throw new Error('Expected a signed Ed25519 NEAR transaction');
  }
  const transaction = bytes.subarray(0, -taggedSignatureLength);
  return base58Encode(createHash('sha256').update(transaction).digest());
}
