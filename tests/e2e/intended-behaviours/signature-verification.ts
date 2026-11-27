import * as ed25519 from '@noble/ed25519';
import { base58Decode } from '@shared/utils/encoders';
import type {
  IntendedEcdsaTargetKeysSummary,
  IntendedEcdsaTargetKeySummary,
  IntendedResult,
} from '../../intended-app/src/intendedContract';
import { createHash } from 'node:crypto';
import {
  getAddress,
  parseTransaction,
  recoverAddress,
  recoverTransactionAddress,
  serializeTransaction,
} from 'viem';
import { assertNever } from './harness-validation';
import type {
  NearReadyRegisteredWalletSnapshot,
  RegisteredWalletSnapshot,
} from './registered-wallet';

type NearSignedTransactionParts = {
  unsignedTransactionBytes: Uint8Array;
  signatureKeyType: number;
  signatureBytes64: Uint8Array;
};

type NearUnsignedTransactionSubject = {
  signerId: string;
  publicKey: {
    keyType: number;
    keyData32: Uint8Array;
  };
};

type BorshReadResult<T> = {
  value: T;
  nextOffset: number;
};

type RlpValue =
  | {
      kind: 'bytes';
      bytes: Uint8Array;
    }
  | {
      kind: 'list';
      items: RlpValue[];
    };

type RlpReadResult = {
  value: RlpValue;
  nextOffset: number;
};

type TempoSignedTransactionParts = {
  chainId: number;
  senderSignatureHex: `0x${string}`;
};
const TEMPO_TRANSACTION_TYPE = 0x76;

export async function verifyNearEd25519Signature(args: {
  registration: Pick<NearReadyRegisteredWalletSnapshot, 'operationalPublicKey'>;
  result: IntendedResult<'near_sign_success'>;
}): Promise<void> {
  const registeredPublicKey = parseNearEd25519PublicKey(args.registration.operationalPublicKey);
  const signedTransaction = decodeNearSignedTransactionB64(args.result.signedTransactionB64);
  const decodedLength = signedTransaction.unsignedTransactionBytes.length + 65;
  if (decodedLength !== args.result.signedTransactionByteLength) {
    throw new Error(
      `NEAR signed transaction length mismatch: decoded=${decodedLength} reported=${args.result.signedTransactionByteLength}`,
    );
  }
  if (signedTransaction.signatureKeyType !== 0) {
    throw new Error(
      `NEAR signature key type must be Ed25519, received ${signedTransaction.signatureKeyType}`,
    );
  }
  const subject = parseNearUnsignedTransactionSubject(signedTransaction.unsignedTransactionBytes);
  if (subject.signerId !== args.result.nearAccountId) {
    throw new Error(`NEAR transaction signer mismatch: ${subject.signerId}`);
  }
  if (subject.publicKey.keyType !== 0) {
    throw new Error(
      `NEAR transaction public key type must be Ed25519, received ${subject.publicKey.keyType}`,
    );
  }
  assertEqualBytes(
    subject.publicKey.keyData32,
    registeredPublicKey.keyData32,
    'NEAR transaction public key does not match registered wallet key',
  );
  const signedMessageHash = sha256Bytes(signedTransaction.unsignedTransactionBytes);
  const verified = await ed25519.verifyAsync(
    signedTransaction.signatureBytes64,
    signedMessageHash,
    registeredPublicKey.keyData32,
  );
  if (!verified) {
    throw new Error('NEAR Ed25519 signature verification failed');
  }
}

export async function verifyTempoEcdsaSignature(args: {
  registration: RegisteredWalletSnapshot;
  result: IntendedResult<'tempo_sign_success'>;
}): Promise<void> {
  const targetKey = requireTempoEcdsaTargetKey(args.registration.ecdsaTargetKeys);
  const parts = decodeTempoSignedTransaction(args.result.rawTxHex);
  if (parts.chainId !== args.result.chainId) {
    throw new Error(`Tempo raw transaction chainId mismatch: ${parts.chainId}`);
  }
  const recovered = await recoverAddress({
    hash: args.result.senderHashHex,
    signature: parts.senderSignatureHex,
  });
  assertSameEcdsaAddress({
    actual: recovered,
    expected: targetKey.thresholdOwnerAddress,
    label: 'Tempo recovered signer',
  });
}

export async function verifyArcEvmSignature(args: {
  registration: RegisteredWalletSnapshot;
  result: IntendedResult<'arc_evm_sign_success'>;
}): Promise<void> {
  const targetKey = requireArcEvmEcdsaTargetKey(args.registration.ecdsaTargetKeys);
  const transaction = parseTransaction(args.result.rawTxHex);
  if (Number(transaction.chainId) !== args.result.chainId) {
    throw new Error(`Arc/EVM raw transaction chainId mismatch: ${String(transaction.chainId)}`);
  }
  const recovered = await recoverTransactionAddress({
    serializedTransaction: serializeTransaction(transaction),
  });
  assertSameEcdsaAddress({
    actual: recovered,
    expected: targetKey.thresholdOwnerAddress,
    label: 'Arc/EVM recovered signer',
  });
}

function requireTempoEcdsaTargetKey(
  keys: IntendedEcdsaTargetKeysSummary,
): IntendedEcdsaTargetKeySummary {
  switch (keys.kind) {
    case 'tempo':
    case 'tempo_arc':
      return keys.tempo;
    case 'none':
      throw new Error('Tempo signing requires a Tempo ECDSA target key');
    default:
      return assertNever(keys);
  }
}

function requireArcEvmEcdsaTargetKey(
  keys: IntendedEcdsaTargetKeysSummary,
): IntendedEcdsaTargetKeySummary {
  switch (keys.kind) {
    case 'tempo_arc':
      return keys.arcEvm;
    case 'none':
    case 'tempo':
      throw new Error('Arc/EVM signing requires an Arc/EVM ECDSA target key');
    default:
      return assertNever(keys);
  }
}

function parseNearEd25519PublicKey(publicKey: string): { keyData32: Uint8Array } {
  const value = publicKey.trim();
  const prefix = 'ed25519:';
  if (!value.startsWith(prefix)) {
    throw new Error(`NEAR operational public key must use ed25519 prefix: ${value}`);
  }
  const keyData32 = base58Decode(value.slice(prefix.length));
  if (keyData32.length !== 32) {
    throw new Error(
      `NEAR operational public key must decode to 32 bytes, received ${keyData32.length}`,
    );
  }
  return { keyData32 };
}

function decodeNearSignedTransactionB64(base64: string): NearSignedTransactionParts {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length <= 65) {
    throw new Error(`NEAR signed transaction is too short: ${bytes.length} bytes`);
  }
  const signatureStart = bytes.length - 65;
  return {
    unsignedTransactionBytes: bytes.slice(0, signatureStart),
    signatureKeyType: bytes[signatureStart],
    signatureBytes64: bytes.slice(signatureStart + 1),
  };
}

function parseNearUnsignedTransactionSubject(bytes: Uint8Array): NearUnsignedTransactionSubject {
  const signer = readBorshString(bytes, 0, 'NEAR transaction signerId');
  const publicKey = readNearPublicKey(bytes, signer.nextOffset);
  return {
    signerId: signer.value,
    publicKey: publicKey.value,
  };
}

function readNearPublicKey(
  bytes: Uint8Array,
  offset: number,
): BorshReadResult<NearUnsignedTransactionSubject['publicKey']> {
  requireByteRange(bytes, offset, 33, 'NEAR transaction publicKey');
  return {
    value: {
      keyType: bytes[offset],
      keyData32: bytes.slice(offset + 1, offset + 33),
    },
    nextOffset: offset + 33,
  };
}

function readBorshString(
  bytes: Uint8Array,
  offset: number,
  label: string,
): BorshReadResult<string> {
  const length = readBorshU32(bytes, offset, `${label} length`);
  const valueStart = offset + 4;
  requireByteRange(bytes, valueStart, length, label);
  return {
    value: new TextDecoder().decode(bytes.slice(valueStart, valueStart + length)),
    nextOffset: valueStart + length,
  };
}

function readBorshU32(bytes: Uint8Array, offset: number, label: string): number {
  requireByteRange(bytes, offset, 4, label);
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
  return view.getUint32(0, true);
}

function requireByteRange(bytes: Uint8Array, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new Error(`${label} exceeds byte length ${bytes.length}`);
  }
}

function sha256Bytes(bytes: Uint8Array): Uint8Array {
  return createHash('sha256').update(bytes).digest();
}

function assertEqualBytes(actual: Uint8Array, expected: Uint8Array, message: string): void {
  if (actual.length !== expected.length) {
    throw new Error(`${message}: length ${actual.length} !== ${expected.length}`);
  }
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] === expected[index]) continue;
    throw new Error(`${message}: byte ${index} differs`);
  }
}

export function assertSameEcdsaAddress(args: {
  actual: string;
  expected: string;
  label: string;
}): void {
  const actual = getAddress(args.actual);
  const expected = getAddress(args.expected);
  if (actual !== expected) {
    throw new Error(`${args.label} mismatch: ${actual} !== ${expected}`);
  }
}

function decodeTempoSignedTransaction(rawTxHex: `0x${string}`): TempoSignedTransactionParts {
  const bytes = hexToBytes(rawTxHex);
  if (bytes[0] !== TEMPO_TRANSACTION_TYPE) {
    throw new Error(`Tempo raw transaction must start with type 0x76, received ${bytes[0]}`);
  }
  const decoded = readRlpValue(bytes, 1);
  if (decoded.nextOffset !== bytes.length) {
    throw new Error('Tempo raw transaction has trailing bytes after RLP payload');
  }
  if (decoded.value.kind !== 'list') {
    throw new Error('Tempo raw transaction payload must be an RLP list');
  }
  const fields = decoded.value.items;
  if (fields.length !== 14) {
    throw new Error(`Tempo raw transaction must contain 14 fields, received ${fields.length}`);
  }
  const chainId = rlpBytesToSafeInteger(requireRlpBytes(fields[0], 'Tempo chainId'));
  requireEmptyRlpList(fields[12], 'Tempo AA authorization list');
  const signatureBytes = requireRlpBytes(fields[13], 'Tempo sender signature');
  if (signatureBytes.length !== 65) {
    throw new Error(`Tempo sender signature must be 65 bytes, received ${signatureBytes.length}`);
  }
  return {
    chainId,
    senderSignatureHex: bytesToHex(signatureBytes),
  };
}

function readRlpValue(bytes: Uint8Array, offset: number): RlpReadResult {
  requireByteRange(bytes, offset, 1, 'RLP prefix');
  const prefix = bytes[offset];
  if (prefix <= 0x7f) {
    return {
      value: { kind: 'bytes', bytes: bytes.slice(offset, offset + 1) },
      nextOffset: offset + 1,
    };
  }
  if (prefix <= 0xb7) {
    const length = prefix - 0x80;
    return readRlpShortBytes(bytes, offset + 1, length);
  }
  if (prefix <= 0xbf) {
    const lengthOfLength = prefix - 0xb7;
    const length = readRlpLength(bytes, offset + 1, lengthOfLength, 'RLP long bytes');
    return readRlpShortBytes(bytes, offset + 1 + lengthOfLength, length);
  }
  if (prefix <= 0xf7) {
    const length = prefix - 0xc0;
    return readRlpList(bytes, offset + 1, length);
  }
  const lengthOfLength = prefix - 0xf7;
  const length = readRlpLength(bytes, offset + 1, lengthOfLength, 'RLP long list');
  return readRlpList(bytes, offset + 1 + lengthOfLength, length);
}

function readRlpShortBytes(bytes: Uint8Array, offset: number, length: number): RlpReadResult {
  requireByteRange(bytes, offset, length, 'RLP bytes');
  return {
    value: { kind: 'bytes', bytes: bytes.slice(offset, offset + length) },
    nextOffset: offset + length,
  };
}

function readRlpList(bytes: Uint8Array, offset: number, length: number): RlpReadResult {
  requireByteRange(bytes, offset, length, 'RLP list');
  const endOffset = offset + length;
  const items: RlpValue[] = [];
  let cursor = offset;
  while (cursor < endOffset) {
    const item = readRlpValue(bytes, cursor);
    items.push(item.value);
    cursor = item.nextOffset;
  }
  if (cursor !== endOffset) {
    throw new Error('RLP list item exceeded declared length');
  }
  return {
    value: { kind: 'list', items },
    nextOffset: endOffset,
  };
}

function readRlpLength(
  bytes: Uint8Array,
  offset: number,
  lengthOfLength: number,
  label: string,
): number {
  requireByteRange(bytes, offset, lengthOfLength, label);
  let value = 0;
  for (let index = 0; index < lengthOfLength; index += 1) {
    value = value * 256 + bytes[offset + index];
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} is too large`);
  }
  return value;
}

function requireRlpBytes(value: RlpValue | undefined, label: string): Uint8Array {
  if (!value || value.kind !== 'bytes') {
    throw new Error(`${label} must be RLP bytes`);
  }
  return value.bytes;
}

function requireEmptyRlpList(value: RlpValue | undefined, label: string): void {
  if (!value || value.kind !== 'list' || value.items.length !== 0) {
    throw new Error(`${label} must be an empty RLP list`);
  }
}

function rlpBytesToSafeInteger(bytes: Uint8Array): number {
  let value = 0;
  for (const byte of bytes) {
    value = value * 256 + byte;
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error('RLP integer is too large');
  }
  return value;
}

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const raw = hex.slice(2);
  if (raw.length % 2 !== 0) {
    throw new Error('hex string must have even length');
  }
  const bytes = new Uint8Array(raw.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const value = Number.parseInt(raw.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isFinite(value)) {
      throw new Error('hex string contains invalid bytes');
    }
    bytes[index] = value;
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}
