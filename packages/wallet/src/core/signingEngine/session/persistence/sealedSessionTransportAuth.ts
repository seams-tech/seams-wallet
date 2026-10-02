import type { SigningSessionSealKeyVersion } from '../keyMaterialBrands';

export type EcdsaSealTransportAuthMaterial = {
  curve: 'ecdsa';
  signingSessionSealKeyVersion?: SigningSessionSealKeyVersion;
  groupId?: string;
};
