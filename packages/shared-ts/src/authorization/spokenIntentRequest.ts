import { sha256DigestB64u, type DigestB64u } from '../utils/canonicalPrimitives';

/**
 * The Borsh bytes and digests of a `spoken-intent/1` request, written to match
 * `crates/spoken-intent` byte for byte. The crate's golden vectors
 * (`spoken_intent_vectors_v1.json`) check this encoder. Only the vault
 * transfer kind is encoded here; the crate's renderer still decides whether a
 * request is speakable.
 */

const REQUEST_DIGEST_DOMAIN = 'seams:spoken-intent:request:v1';
const SPOKEN_TEXT_DIGEST_DOMAIN = 'seams:spoken-intent:spoken:v1';
const MAXIMUM_U64 = (1n << 64n) - 1n;
const MAXIMUM_U128 = (1n << 128n) - 1n;
const ACCOUNT_PATTERN = /^[a-z0-9._-]{2,64}$/;

export type SpokenIntentNetwork = 'testnet' | 'mainnet';

export type VoiceVaultTransferRequestV1 = Readonly<{
  kind: 'vault_transfer';
  network: SpokenIntentNetwork;
  vault: string;
  owner: string;
  receiver: string;
  amountYocto: bigint;
  nonce: bigint;
}>;

class BorshWriter {
  private readonly chunks: Uint8Array[] = [];

  u8(value: number): void {
    this.chunks.push(Uint8Array.of(value));
  }

  unsigned(value: bigint, maximum: bigint, byteLength: number, label: string): void {
    if (value < 0n || value > maximum) throw new Error(`${label} is out of range`);
    const bytes = new Uint8Array(byteLength);
    let rest = value;
    for (let index = 0; index < byteLength; index += 1) {
      bytes[index] = Number(rest & 0xffn);
      rest >>= 8n;
    }
    this.chunks.push(bytes);
  }

  account(value: string, label: string): void {
    if (!ACCOUNT_PATTERN.test(value)) throw new Error(`${label} is not a named NEAR account`);
    const bytes = new TextEncoder().encode(value);
    this.unsigned(BigInt(bytes.length), 0xffff_ffffn, 4, label);
    this.chunks.push(bytes);
  }

  finish(): Uint8Array<ArrayBuffer> {
    const length = this.chunks.reduce((total, chunk) => total + chunk.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/** `borsh(SpokenRequestV1::VaultTransfer { .. })`. */
export function voiceVaultTransferRequestBorsh(
  request: VoiceVaultTransferRequestV1,
): Uint8Array<ArrayBuffer> {
  const writer = new BorshWriter();
  writer.u8(0);
  writer.u8(request.network === 'testnet' ? 0 : 1);
  writer.account(request.vault, 'vault');
  writer.account(request.owner, 'owner');
  writer.account(request.receiver, 'receiver');
  if (request.amountYocto === 0n) throw new Error('amount must be positive');
  writer.unsigned(request.amountYocto, MAXIMUM_U128, 16, 'amount');
  writer.unsigned(request.nonce, MAXIMUM_U64, 8, 'nonce');
  return writer.finish();
}

/** `request_digest`: `sha256("seams:spoken-intent:request:v1" || borsh(request))`. */
export async function spokenIntentRequestDigestB64u(requestBorsh: Uint8Array): Promise<DigestB64u> {
  return await sha256DigestB64u(withDomain(REQUEST_DIGEST_DOMAIN, requestBorsh));
}

/** `spoken_text_digest`: `sha256("seams:spoken-intent:spoken:v1" || spoken_text)`. */
export async function spokenTextDigestB64u(spokenText: string): Promise<DigestB64u> {
  return await sha256DigestB64u(
    withDomain(SPOKEN_TEXT_DIGEST_DOMAIN, new TextEncoder().encode(spokenText)),
  );
}

function withDomain(domain: string, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const prefix = new TextEncoder().encode(domain);
  const out = new Uint8Array(prefix.length + bytes.length);
  out.set(prefix, 0);
  out.set(bytes, prefix.length);
  return out;
}
