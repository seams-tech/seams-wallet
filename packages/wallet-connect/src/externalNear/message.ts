import { serialize, type Schema } from 'borsh';
import { base58Decode } from '@shared/utils/base58';
import { base64Decode, base64Encode } from '@shared/utils/base64';
import { isPlainObject } from '@shared/utils/validation';
import type {
  ExternalNearConnection,
  ExternalNearMessageParams,
  ExternalNearSignedMessage,
} from './types';

const messageBrand: unique symbol = Symbol('validated NEP-413 message');

export type ValidatedNearMessage = Readonly<{
  [messageBrand]: true;
  message: string;
  recipient: string;
  nonce: Uint8Array<ArrayBuffer>;
  callbackUrl: string | null;
  state: string | null;
}>;

// Borsh 1.0 truncates string code units. A UTF-8 byte vector uses the standard string layout.
const utf8StringSchema: Schema = { array: { type: 'u8' } };
const messageSchema: Schema = {
  struct: {
    tag: 'u32',
    message: utf8StringSchema,
    nonce: { array: { type: 'u8', len: 32 } },
    recipient: utf8StringSchema,
    callbackUrl: { option: utf8StringSchema },
  },
};

export function validateMessage(input: ExternalNearMessageParams): ValidatedNearMessage {
  if (
    !isPlainObject(input) ||
    typeof input.message !== 'string' ||
    typeof input.recipient !== 'string' ||
    !input.recipient.trim() ||
    !(input.nonce instanceof Uint8Array) ||
    input.nonce.length !== 32 ||
    (input.callbackUrl !== undefined && typeof input.callbackUrl !== 'string') ||
    (input.state !== undefined && typeof input.state !== 'string')
  ) {
    throw new Error('Provide a message, recipient, and 32-byte nonce.');
  }
  return Object.freeze<ValidatedNearMessage>({
    [messageBrand]: true,
    message: input.message,
    recipient: input.recipient,
    nonce: new Uint8Array(input.nonce),
    callbackUrl: input.callbackUrl ?? null,
    state: input.state ?? null,
  });
}

export async function parseSignedMessage(
  raw: unknown,
  connection: ExternalNearConnection,
  message: ValidatedNearMessage,
): Promise<ExternalNearSignedMessage> {
  if (
    !isPlainObject(raw) ||
    raw.accountId !== connection.accountId ||
    typeof raw.publicKey !== 'string' ||
    !raw.publicKey.startsWith('ed25519:') ||
    typeof raw.signature !== 'string' ||
    (raw.state !== undefined && raw.state !== message.state)
  ) {
    throw new Error('Message identity does not match the request.');
  }
  const publicKey = base58Decode(raw.publicKey.slice('ed25519:'.length));
  const signature = base64Decode(raw.signature);
  if (
    publicKey.length !== 32 ||
    signature.length !== 64 ||
    base64Encode(signature) !== raw.signature
  ) {
    throw new Error('Invalid NEP-413 key or signature.');
  }
  const encoder = new TextEncoder();
  const payload = serialize(messageSchema, {
    tag: 2 ** 31 + 413,
    message: encoder.encode(message.message),
    nonce: message.nonce,
    recipient: encoder.encode(message.recipient),
    callbackUrl: message.callbackUrl === null ? null : encoder.encode(message.callbackUrl),
  });
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(payload));
  const key = await crypto.subtle.importKey('raw', new Uint8Array(publicKey), 'Ed25519', false, [
    'verify',
  ]);
  if (!(await crypto.subtle.verify('Ed25519', key, signature, digest))) {
    throw new Error('The signature does not match the requested NEP-413 message.');
  }
  if (message.state !== null) {
    return Object.freeze({
      accountId: connection.accountId,
      publicKey: raw.publicKey,
      signature: raw.signature,
      state: message.state,
    });
  }
  return Object.freeze({
    accountId: connection.accountId,
    publicKey: raw.publicKey,
    signature: raw.signature,
  });
}
