import { alphabetizeStringify, sha256Bytes, sha256BytesUtf8 } from '../utils/digests';
import { base64UrlDecode, base64UrlEncode } from '../utils/encoders';
import type { WalletId } from '../utils/domainIds';
import { deriveEvmFamilySigningKeySlotId } from '../signing-lanes/evmFamilySigningKeySlotId';

const THRESHOLD_SECP256K1_ECDSA_2P_V1_SCHEME_ID = 'threshold-secp256k1-ecdsa-2p-v1';
const SDK_ECDSA_DERIVATION_APPLICATION_BINDING_DOMAIN_V1 =
  'seams-sdk:ecdsa-derivation:application-binding:v1';


export type EcdsaClientRootPublicKey33B64u = string & {
  readonly __brand: 'EcdsaClientRootPublicKey33B64u';
};

export function ecdsaClientRootPublicKey33B64uFromString(
  value: string,
): EcdsaClientRootPublicKey33B64u {
  const normalized = value.trim();
  const bytes = base64UrlDecode(normalized);
  if (bytes.length !== 33 || base64UrlEncode(bytes) !== normalized) {
    throw new Error('ECDSA client root public key must be canonical base64url for 33 bytes');
  }
  return normalized as EcdsaClientRootPublicKey33B64u;
}

export type DerivationClientSharePublicKey33B64u = string & {
  readonly __brand: 'DerivationClientSharePublicKey33B64u';
};

export function derivationClientSharePublicKey33B64uFromString(
  value: string,
): DerivationClientSharePublicKey33B64u {
  const normalized = value.trim();
  const bytes = base64UrlDecode(normalized);
  if (bytes.length !== 33 || base64UrlEncode(bytes) !== normalized) {
    throw new Error('derivation client share public key must be canonical base64url for 33 bytes');
  }
  return normalized as DerivationClientSharePublicKey33B64u;
}

export type EcdsaDerivationRelayerPublicKey33B64u = string & {
  readonly __brand: 'EcdsaDerivationRelayerPublicKey33B64u';
};

export type EcdsaDerivationRoleLocalPublicIdentity = {
  derivationClientSharePublicKey33B64u: DerivationClientSharePublicKey33B64u;
  relayerPublicKey33B64u: EcdsaDerivationRelayerPublicKey33B64u;
  groupPublicKey33B64u: string;
  ethereumAddress: string;
};

export type EcdsaThresholdKeyId = string & {
  readonly __brand: 'EcdsaThresholdKeyId';
};

export type SigningRootId = string & {
  readonly __brand: 'SigningRootId';
};

export type SigningRootVersion = string & {
  readonly __brand: 'SigningRootVersion';
};




type SdkEcdsaDerivationBindingFacts = {
  walletId: WalletId;
  ecdsaThresholdKeyId: EcdsaThresholdKeyId;
  signingRootId: SigningRootId;
  signingRootVersion: SigningRootVersion;
};

function requireSdkBindingFactString(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

export function parseSdkEcdsaDerivationThresholdKeyId(value: unknown): EcdsaThresholdKeyId {
  return requireSdkBindingFactString(value, 'ecdsaThresholdKeyId') as EcdsaThresholdKeyId;
}

export function parseSdkEcdsaDerivationSigningRootId(value: unknown): SigningRootId {
  return requireSdkBindingFactString(value, 'signingRootId') as SigningRootId;
}

export function parseSdkEcdsaDerivationSigningRootVersion(value: unknown): SigningRootVersion {
  return requireSdkBindingFactString(value, 'signingRootVersion') as SigningRootVersion;
}

function pushU32(out: number[], value: number): void {
  out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function pushLengthDelimitedField(out: number[], label: string, value: unknown): void {
  const labelBytes = new TextEncoder().encode(label);
  const valueBytes = new TextEncoder().encode(requireSdkBindingFactString(value, label));
  pushU32(out, labelBytes.length);
  out.push(...labelBytes);
  pushU32(out, valueBytes.length);
  out.push(...valueBytes);
}

function encodeSdkEcdsaDerivationBindingFactsV1(input: SdkEcdsaDerivationBindingFacts): Uint8Array {
  const out: number[] = [];
  const domainBytes = new TextEncoder().encode(SDK_ECDSA_DERIVATION_APPLICATION_BINDING_DOMAIN_V1);
  pushU32(out, domainBytes.length);
  out.push(...domainBytes);
  pushLengthDelimitedField(out, 'walletId', input.walletId);
  pushLengthDelimitedField(out, 'ecdsaThresholdKeyId', input.ecdsaThresholdKeyId);
  pushLengthDelimitedField(out, 'signingRootId', input.signingRootId);
  pushLengthDelimitedField(out, 'signingRootVersion', input.signingRootVersion);
  return new Uint8Array(out);
}

async function computeSdkEcdsaDerivationApplicationBindingDigest32(
  input: SdkEcdsaDerivationBindingFacts,
): Promise<Uint8Array> {
  return await sha256Bytes(encodeSdkEcdsaDerivationBindingFactsV1(input));
}

export async function computeSdkEcdsaDerivationApplicationBindingDigestB64u(
  input: SdkEcdsaDerivationBindingFacts,
): Promise<string> {
  return base64UrlEncode(await computeSdkEcdsaDerivationApplicationBindingDigest32(input));
}

export async function computeEcdsaDerivationRoleLocalThresholdKeyId(input: {
  walletId: string;
  evmFamilySigningKeySlotId: string;
  signingRootId: string;
  signingRootVersion: string;
}): Promise<string> {
  const digest32 = await sha256BytesUtf8(
    alphabetizeStringify({
      version: 'threshold_ecdsa_derivation_key_id_v7',
      schemeId: THRESHOLD_SECP256K1_ECDSA_2P_V1_SCHEME_ID,
      walletId: input.walletId,
      evmFamilySigningKeySlotId: input.evmFamilySigningKeySlotId,
      signingRootId: input.signingRootId,
      signingRootVersion: input.signingRootVersion,
    }),
  );
  return `ederivation-${base64UrlEncode(digest32)}`;
}

export async function computeEcdsaDerivationRoleLocalRelayerKeyId(input: {
  walletId: string;
  signingRootId: string;
  signingRootVersion: string;
}): Promise<string> {
  const evmFamilySigningKeySlotId = deriveEvmFamilySigningKeySlotId(input);
  const digest32 = await sha256BytesUtf8(
    alphabetizeStringify({
      version: 'threshold_ecdsa_derivation_relayer_key_id_v1',
      schemeId: THRESHOLD_SECP256K1_ECDSA_2P_V1_SCHEME_ID,
      walletId: input.walletId,
      evmFamilySigningKeySlotId,
    }),
  );
  return `ederivation-relayer-${base64UrlEncode(digest32)}`;
}





