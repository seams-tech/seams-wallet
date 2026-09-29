import { type BuildEcdsaRoleLocalSigningMaterialHandleInput } from './ecdsaDerivationSigningMaterialHandle';
import type {
  EcdsaClientVerifyingPublicKey33B64u,
  EcdsaKeyHandle,
  EcdsaRelayerKeyId,
  EcdsaThresholdKeyId,
} from '../keyMaterialBrands';

declare const keyHandle: EcdsaKeyHandle;
declare const clientVerifyingPublicKey33B64u: EcdsaClientVerifyingPublicKey33B64u;
declare const ecdsaThresholdKeyId: EcdsaThresholdKeyId;
declare const relayerKeyId: EcdsaRelayerKeyId;

const materialIdentity: BuildEcdsaRoleLocalSigningMaterialHandleInput = {
  keyHandle,
  clientVerifyingPublicKey33B64u,
  ecdsaThresholdKeyId,
  participantIds: [1, 2],
  relayerKeyId,
};

const missingParticipantIds: BuildEcdsaRoleLocalSigningMaterialHandleInput = {
  ...materialIdentity,
  // @ts-expect-error material identity requires a non-empty participant set.
  participantIds: [],
};
void missingParticipantIds;
