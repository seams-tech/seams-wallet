import type {
  EcdsaCapabilityManifestId,
  EcdsaCapabilityManifestRevision,
} from '../utils/ecdsaCapabilityActivation';

export type {
  LaneShareEpoch,
  LaneEnrollmentId,
  LaneOperationId,
  LaneOperationIdempotencyKey,
  LinkedDeviceId,
  LinkedDeviceEnrollmentId,
  LinkDeviceSessionId,
  SigningLaneId,
  WalletKeyId,
  Ed25519YaoSuiteId,
  EcdsaRelayerKeyId,
} from '../utils/domainIds';
export type EcdsaManifestIdentity = {
  manifestId: EcdsaCapabilityManifestId;
  manifestRevision: EcdsaCapabilityManifestRevision;
};

export type { ThresholdEcdsaChainTarget } from '../utils/thresholdEcdsaChainTarget';

export {
  parseLaneShareEpoch,
  parseLaneEnrollmentId,
  parseLaneOperationId,
  parseLaneOperationIdempotencyKey,
  parseLinkedDeviceId,
  parseLinkedDeviceEnrollmentId,
  parseLinkDeviceSessionId,
  parseSigningLaneId,
  parseWalletKeyId,
  parseEd25519YaoSuiteId,
  parseEcdsaRelayerKeyId,
} from '../utils/domainIds';
