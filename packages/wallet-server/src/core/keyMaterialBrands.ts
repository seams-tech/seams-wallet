import type { EcdsaThresholdKeyId } from '@shared/threshold/ecdsaDerivationRoleLocalBootstrap';
import { parseNonEmptyBrand, type Brand } from '@shared/threshold/keyMaterialBrands';

export type { EcdsaThresholdKeyId };
export {
  formatEcdsaClientVerifyingShareB64uForWire,
  formatEcdsaDerivationKeyVersionForWire,
  formatEcdsaKeyHandleForWire,
  formatEcdsaRelayerKeyIdForWire,
  formatEcdsaThresholdKeyIdForWire,
  formatEd25519RelayerKeyIdForWire,
  formatSigningSessionSealKeyVersionForWire,
  parseEcdsaClientVerifyingShareB64u,
  parseEcdsaDerivationKeyVersion,
  parseEcdsaKeyHandle,
  parseEcdsaRelayerKeyId,
  parseEd25519RelayerKeyId,
  parseSigningSessionSealKeyVersion,
  type EcdsaClientVerifyingShareB64u,
  type EcdsaDerivationKeyVersion,
  type EcdsaKeyHandle,
  type EcdsaRelayerKeyId,
  type Ed25519RelayerKeyId,
  type SigningSessionSealKeyVersion,
} from '@shared/threshold/keyMaterialBrands';

export type Ed25519ClientVerifyingShareB64u = Brand<
  string,
  'Ed25519ClientVerifyingShareB64u'
>;

export function parseEd25519ClientVerifyingShareB64u(
  value: unknown,
): Ed25519ClientVerifyingShareB64u {
  return parseNonEmptyBrand<'Ed25519ClientVerifyingShareB64u'>(
    value,
    'Ed25519 client verifying share',
  );
}

// Not shared: the wallet's parser reports a missing id with a different message.
export function parseEcdsaThresholdKeyId(value: unknown): EcdsaThresholdKeyId {
  return parseNonEmptyBrand<'EcdsaThresholdKeyId'>(value, 'ECDSA threshold key id');
}

export function formatEd25519ClientVerifyingShareB64uForWire(
  value: Ed25519ClientVerifyingShareB64u,
): string {
  return value;
}
