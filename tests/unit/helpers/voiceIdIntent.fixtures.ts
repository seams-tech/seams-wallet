import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  buildVoiceIdIntentStatement,
  parseVoiceIdDevicePublicKeyB64u,
  voiceIdIntentStatementBytes,
  type VoiceIdIntentAssertion,
  type VoiceIdIntentStatement,
} from '@shared/authorization/voiceIdDeviceAssertion';
import type { VoiceVaultTransferRequestV1 } from '@shared/authorization/spokenIntentRequest';
import { base64UrlEncode } from '@shared/utils/base64';
import { sha256DigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  parseWalletId,
} from '@shared/utils/domainIds';
import type {
  RegisteredVoiceIdDeviceKey,
  SpokenIntentRendererV1,
} from '../../../packages/wallet-server/src/authorization/voiceIdDeviceProof';

type RequestVector = Readonly<{
  name: string;
  borsh_hex: string;
  request_digest_hex: string;
  spoken_text: string;
  spoken_text_digest_hex: string;
}>;

type VectorFile = Readonly<{
  requests: readonly RequestVector[];
  normalize: readonly Readonly<{ transcript: string; tokens: string | null }>[];
}>;

const VECTORS: VectorFile = JSON.parse(
  readFileSync(
    new URL('../../../crates/spoken-intent/fixtures/spoken_intent_vectors_v1.json', import.meta.url),
    'utf8',
  ),
);

export const VOICE_INTENT_REQUEST_ORIGIN = 'https://app.example.test';

/** The golden `spoken-intent/1` vault transfer vectors that the Rust crate wrote. */
export function vaultTransferVectors(): readonly RequestVector[] {
  return VECTORS.requests.filter((vector) => vector.borsh_hex.startsWith('00'));
}

export function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

export function digestFromHex(hex: string): DigestB64u {
  return base64UrlEncode(hexBytes(hex)) as DigestB64u;
}

/** Reads a vault transfer vector's Borsh bytes back into request fields. */
export function decodeVaultTransferVector(vector: RequestVector): VoiceVaultTransferRequestV1 {
  const bytes = hexBytes(vector.borsh_hex);
  const view = new DataView(bytes.buffer);
  let offset = 2;
  const account = (): string => {
    const length = view.getUint32(offset, true);
    offset += 4;
    const value = new TextDecoder().decode(bytes.subarray(offset, offset + length));
    offset += length;
    return value;
  };
  const unsigned = (byteLength: number): bigint => {
    let value = 0n;
    for (let index = byteLength - 1; index >= 0; index -= 1) {
      value = (value << 8n) | BigInt(bytes[offset + index] ?? 0);
    }
    offset += byteLength;
    return value;
  };
  const network = bytes[1] === 0 ? 'testnet' : 'mainnet';
  const vault = account();
  const owner = account();
  const receiver = account();
  const amountYocto = unsigned(16);
  const nonce = unsigned(8);
  return { kind: 'vault_transfer', network, vault, owner, receiver, amountYocto, nonce };
}

/**
 * Stands in for the wasm build of `crates/spoken-intent`: it renders and
 * normalizes only what the golden vectors list.
 */
export function vectorRenderer(): SpokenIntentRendererV1 {
  return {
    render(requestBorsh) {
      const hex = Array.from(requestBorsh, (byte) => byte.toString(16).padStart(2, '0')).join('');
      const vector = VECTORS.requests.find((entry) => entry.borsh_hex === hex);
      return vector ? { kind: 'rendered', spokenText: vector.spoken_text } : { kind: 'unsupported' };
    },
    normalize(transcript) {
      const known = VECTORS.normalize.find((entry) => entry.transcript === transcript);
      if (known) return known.tokens?.split(' ') ?? null;
      return /^[a-z]+( [a-z]+)*$/.test(transcript) ? transcript.split(' ') : null;
    },
  };
}

function requireParsed<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) throw new Error('Test identity was invalid');
  return result.value;
}

export type VoiceIdIntentDeviceFixture = Readonly<{
  registered: RegisteredVoiceIdDeviceKey;
  privateKey: CryptoKey;
}>;

/** An active VoiceID device key with a fresh Ed25519 pair. */
export async function buildVoiceIdIntentDeviceFixture(): Promise<VoiceIdIntentDeviceFixture> {
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  if (!('privateKey' in keys)) throw new Error('Ed25519 key pair was unavailable');
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  return {
    registered: {
      walletId: requireParsed(parseWalletId('owner.testnet')),
      walletAuthMethodId: requireParsed(parseWalletAuthMethodId(`wallet-auth-method:${randomUUID()}`)),
      walletAuthorityId: requireParsed(parseWalletAuthorityId('owner-authority')),
      deviceKeyId: await sha256DigestB64u(publicKey),
      publicKeyB64u: parseVoiceIdDevicePublicKeyB64u(base64UrlEncode(publicKey)),
      status: 'active',
    },
    privateKey: keys.privateKey,
  };
}

/** A statement for one vector, signed by the device; `overrides` change fields before signing. */
export async function buildVoiceIdIntentAssertionFixture(input: {
  device: VoiceIdIntentDeviceFixture;
  vector: RequestVector;
  audioDigest: DigestB64u;
  nowMs: number;
  overrides?: Partial<Omit<VoiceIdIntentStatement, 'kind'>>;
}): Promise<VoiceIdIntentAssertion> {
  const registered = input.device.registered;
  const statement = buildVoiceIdIntentStatement({
    walletId: registered.walletId,
    walletAuthMethodId: registered.walletAuthMethodId,
    walletAuthorityId: registered.walletAuthorityId,
    deviceKeyId: registered.deviceKeyId,
    operationKind: 'near.voice_vault_transfer',
    operationChallenge: digestFromHex(input.vector.request_digest_hex),
    rendererVersion: 'spoken-intent/1',
    spokenTextDigest: digestFromHex(input.vector.spoken_text_digest_hex),
    heardText: input.vector.spoken_text,
    audioDigest: input.audioDigest,
    requestOrigin: VOICE_INTENT_REQUEST_ORIGIN,
    issuedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + 60_000,
    ...input.overrides,
  });
  const signature = await crypto.subtle.sign(
    'Ed25519',
    input.device.privateKey,
    voiceIdIntentStatementBytes(statement),
  );
  return {
    kind: 'voiceid_intent_assertion_v1',
    statement,
    signatureB64u: base64UrlEncode(new Uint8Array(signature)),
  };
}
