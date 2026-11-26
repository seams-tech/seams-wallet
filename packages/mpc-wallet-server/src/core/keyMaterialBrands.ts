import type { EcdsaThresholdKeyId } from '@shared/threshold/ecdsaDerivationRoleLocalBootstrap';

export type { EcdsaThresholdKeyId };
export {
  formatEcdsaKeyHandleForWire,
  formatSigningSessionSealKeyVersionForWire,
  parseEcdsaClientVerifyingShareB64u,
  parseEcdsaKeyHandle,
  parseEcdsaRelayerKeyId,
  parseSigningSessionSealKeyVersion,
  type EcdsaClientVerifyingShareB64u,
  type EcdsaKeyHandle,
  type EcdsaRelayerKeyId,
  type SigningSessionSealKeyVersion,
} from '@shared/threshold/keyMaterialBrands';
