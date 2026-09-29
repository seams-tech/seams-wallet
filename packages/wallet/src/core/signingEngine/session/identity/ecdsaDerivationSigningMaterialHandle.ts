import {
  type EcdsaClientVerifyingPublicKey33B64u,
  type EcdsaKeyHandle,
  type EcdsaRelayerKeyId,
  type EcdsaThresholdKeyId,
} from '../keyMaterialBrands';

export type BuildEcdsaRoleLocalSigningMaterialHandleInput = {
  keyHandle: EcdsaKeyHandle;
  clientVerifyingPublicKey33B64u: EcdsaClientVerifyingPublicKey33B64u;
  ecdsaThresholdKeyId: EcdsaThresholdKeyId;
  participantIds: readonly [number, ...number[]];
  relayerKeyId: EcdsaRelayerKeyId;
  evmFamilySigningKeySlotId?: never;
  chainTarget?: never;
  walletId?: never;
  thresholdSessionId?: never;
  activeStateId?: never;
  capabilityGrantId?: never;
  mpcWalletSigningQuotaId?: never;
  remainingUses?: never;
  expiresAtMs?: never;
};
