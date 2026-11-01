import type { SignTransactionResult } from '@/core/types/seams';
import { base58Encode } from '@shared/utils/base58';
import type { Variant } from '@shared/utils/variant';
import type { OwnerNearSubmissionEvidence } from '../shared/ownerNearOperation';

const ED25519_KEY_TYPE = 0;
const ED25519_PUBLIC_KEY_BYTES = 32;
const NONCE_BYTES = 8;
const BLOCK_HASH_BYTES = 32;
// A borsh `Signature` is one key type byte followed by a 64-byte Ed25519 signature.
const ED25519_SIGNATURE_BYTES = 65;

/**
 * Read the retirement evidence from the signed bytes that the wallet broadcasts.
 * The unsigned bytes must hash to the transaction ID, so the fields cannot describe
 * a different transaction.
 */
export async function ownerNearSignedEvidence(
  session: SignTransactionResult,
): Promise<Variant<OwnerNearSubmissionEvidence, 'kind', 'signed'>> {
  const bytes = Uint8Array.from(session.signedTransaction.borsh_bytes);
  const unsigned = bytes.subarray(0, bytes.length - ED25519_SIGNATURE_BYTES);
  const digest = await crypto.subtle.digest('SHA-256', unsigned);
  if (base58Encode(digest) !== session.signedTransaction.transactionHash)
    throw new Error('The signed transaction does not match its hash.');
  const view = new DataView(unsigned.buffer, unsigned.byteOffset, unsigned.byteLength);
  let offset = 0;
  const skipString = (): void => {
    offset += 4 + view.getUint32(offset, true);
  };
  const take = (length: number): Uint8Array => {
    if (offset + length > unsigned.length) throw new Error('Invalid signed transaction bytes.');
    const value = unsigned.subarray(offset, offset + length);
    offset += length;
    return value;
  };
  skipString();
  if (take(1)[0] !== ED25519_KEY_TYPE) throw new Error('The owner key must use Ed25519.');
  const publicKey = take(ED25519_PUBLIC_KEY_BYTES);
  const nonceOffset = offset;
  take(NONCE_BYTES);
  const nonce = view.getBigUint64(nonceOffset, true);
  skipString();
  const referenceBlockHash = base58Encode(take(BLOCK_HASH_BYTES));
  if (referenceBlockHash !== session.referenceBlock.hash)
    throw new Error('The signed transaction names another reference block.');
  return {
    kind: 'signed',
    signerPublicKey: `ed25519:${base58Encode(publicKey)}`,
    signedNonce: nonce.toString(),
    referenceBlockHash,
    referenceBlockHeight: session.referenceBlock.height,
  };
}
