// The rotation's server-side records: receipts, the enrollment manifest, revocations,
// product epochs and lifecycles.
import {
  parseEcdsaCapabilityManifestId,
  parseEcdsaCapabilityManifestRevision,
  parseEcdsaLifecycleId,
  parseEcdsaServerGeneration,
} from '../utils/ecdsaCapabilityActivation';
import { parseCorrelationId, parseIsoTimestamp } from '../utils/canonicalPrimitives';
import {
  wireLabeled,
  wireLiteral,
  wireNonEmptyArray,
  wireObject,
  wireUnion,
  type AllTrue,
  type ParsesExactly,
} from '../utils/wireSchema';
import {
  parseLaneHolderParticipantRecordV1,
  parseSigningWorkerParticipantRecordV1,
} from './participants';
import type {
  AggregateLaneActivationChildReceiptV1,
  AggregateLaneActivationReceiptV1,
  AggregateLaneRevocationChildReceiptV1,
  AggregateLaneRevocationReceiptV1,
  CommitLaneEnrollmentRevocationV1,
  CompleteSigningLaneRevocationV1,
  EcdsaServerRetirementReceiptV1,
  Ed25519ServerRetirementReceiptV1,
  LaneEnrollmentLifecycleV1,
  LaneEnrollmentManifestChildV1,
  LaneEnrollmentManifestV1,
  LaneHolderDeliveryReceiptV1,
  LaneProductEpochPendingVisibilityV1,
  LaneProductEpochRecordV1,
  LaneProductEpochRevokedV1,
  LaneProtocolCommitReceiptV1,
  LaneProtocolLifecycle,
  LaneProtocolRecordV1,
  LaneRefreshPredecessorRetirementV1,
  LaneServerActivationReceiptV1,
  LaneServerRetirementReceiptV1,
  SigningWorkerLaneMaterialIdentityV1,
  RevokeLaneEnrollmentV1,
  RevokeSigningLaneV1,
  RotatableSigningLaneJobV1,
} from './rotation';
import {
  digest,
  digestString,
  laneEnrollmentId,
  laneOperationId,
  laneParticipantBindingDigest,
  laneShareEpoch,
  materialActivation,
  materialActivationId,
  parseAuthorization,
  parseLaneKind,
  requiredInteger,
  requiredString,
  signingLaneId,
  walletId,
  walletKeyId,
} from './rotationWireFields';

function parseKeyFamily(raw: unknown, label: string): 'ed25519' | 'ecdsa_secp256k1' {
  if (raw === 'ed25519' || raw === 'ecdsa_secp256k1') return raw;
  throw new Error(`${label} must be ed25519 or ecdsa_secp256k1`);
}

const isoTimestamp = /* @__PURE__ */ wireLabeled(parseIsoTimestamp);

function laneProtocolCommitReceiptV1() {
  return wireObject({
    kind: wireLiteral('lane_protocol_commit_receipt_v1'),
    operationId: laneOperationId,
    enrollmentId: laneEnrollmentId,
    walletId,
    walletKeyId,
    sourceLaneId: signingLaneId,
    sourceLaneShareEpoch: laneShareEpoch,
    sourceRevocationEpoch: requiredInteger,
    sourceMaterialActivation: materialActivation,
    targetLaneId: signingLaneId,
    targetLaneShareEpoch: laneShareEpoch,
    targetMaterialActivationId: materialActivationId,
    keyFamily: parseKeyFamily,
    publicIdentityDigestB64u: digestString,
    targetHolderPublicCommitmentB64u: requiredString,
    targetServerPublicCommitmentB64u: requiredString,
    targetHolderCiphertextDigestSetB64u: digestString,
    targetServerCiphertextDigestSetB64u: digestString,
    holderRecipientKeyDigestB64u: digestString,
    serverRecipientKeyDigestB64u: digestString,
    transcriptHashB64u: digestString,
    committedAtMs: requiredInteger,
  });
}

export function parseLaneProtocolCommitReceiptV1(
  raw: unknown,
  label = 'protocolCommitReceipt',
): LaneProtocolCommitReceiptV1 {
  return laneProtocolCommitReceiptV1()(raw, label);
}

function laneHolderDeliveryReceiptV1() {
  return wireObject({
    kind: wireLiteral('lane_holder_delivery_receipt_v1'),
    operationId: laneOperationId,
    enrollmentId: laneEnrollmentId,
    targetLaneId: signingLaneId,
    targetLaneShareEpoch: laneShareEpoch,
    targetMaterialActivationId: materialActivationId,
    holderParticipantBindingDigestB64u: digestString,
    holderRecipientKeyDigestB64u: digestString,
    holderCiphertextDigestSetB64u: digestString,
    sealedHolderRecordDigestB64u: digestString,
    transcriptHashB64u: digestString,
    acknowledgedAtMs: requiredInteger,
  });
}

export function parseLaneHolderDeliveryReceiptV1(
  raw: unknown,
  label = 'holderDeliveryReceipt',
): LaneHolderDeliveryReceiptV1 {
  return laneHolderDeliveryReceiptV1()(raw, label);
}

function laneServerActivationReceiptV1() {
  return wireObject({
    kind: wireLiteral('lane_server_activation_receipt_v1'),
    operationId: laneOperationId,
    enrollmentId: laneEnrollmentId,
    targetLaneId: signingLaneId,
    targetLaneShareEpoch: laneShareEpoch,
    targetMaterialActivation: materialActivation,
    signingWorkerParticipantBindingDigestB64u: digestString,
    serverCiphertextDigestSetB64u: digestString,
    transcriptHashB64u: digestString,
    activatedAtMs: requiredInteger,
  });
}

export function parseLaneServerActivationReceiptV1(
  raw: unknown,
  label = 'serverActivationReceipt',
): LaneServerActivationReceiptV1 {
  return laneServerActivationReceiptV1()(raw, label);
}

function laneEnrollmentManifestChildV1() {
  return wireObject({
    operationId: laneOperationId,
    walletKeyId,
    keyFamily: parseKeyFamily,
    sourceLaneId: signingLaneId,
    sourceLaneShareEpoch: laneShareEpoch,
    sourceRevocationEpoch: requiredInteger,
    sourceMaterialActivation: materialActivation,
    targetLaneId: signingLaneId,
    targetLaneShareEpoch: laneShareEpoch,
    targetMaterialActivationId: materialActivationId,
    holderParticipantBindingDigestB64u: digestString,
    signingWorkerParticipantBindingDigestB64u: digestString,
  });
}

function assertUniqueChildren(
  children: readonly LaneEnrollmentManifestChildV1[],
  label: string,
): void {
  const fields: Array<keyof LaneEnrollmentManifestChildV1> = [
    'operationId',
    'walletKeyId',
    'targetLaneId',
    'targetMaterialActivationId',
  ];
  for (const field of fields) {
    const values = children.map((child) => String(child[field]));
    if (new Set(values).size !== values.length)
      throw new Error(`${label} contains duplicate ${field}`);
  }
}

function assertUniqueAggregateActivationChildren(
  children: readonly AggregateLaneActivationChildReceiptV1[],
  label: string,
): void {
  const values = [
    children.map((child) => String(child.operationId)),
    children.map((child) => String(child.walletKeyId)),
    children.map((child) => String(child.targetLaneId)),
    children.map((child) => String(child.targetMaterialActivation.activationId)),
  ];
  for (const entries of values) {
    if (new Set(entries).size !== entries.length)
      throw new Error(`${label} contains duplicate child identity`);
  }
}

function laneEnrollmentManifestV1() {
  return wireObject(
    {
      kind: wireLiteral('lane_enrollment_manifest_v1'),
      enrollmentId: laneEnrollmentId,
      walletId,
      authorization: parseAuthorization,
      orderedChildren: wireNonEmptyArray(laneEnrollmentManifestChildV1(), assertUniqueChildren),
      createdAtMs: requiredInteger,
      expiresAtMs: requiredInteger,
    },
    (manifest, label) => {
      if (manifest.expiresAtMs <= manifest.createdAtMs) {
        throw new Error(`${label}.expiresAtMs must be after createdAtMs`);
      }
    },
  );
}

export function parseLaneEnrollmentManifestV1(
  raw: unknown,
  label = 'laneEnrollmentManifest',
): LaneEnrollmentManifestV1 {
  return laneEnrollmentManifestV1()(raw, label);
}

function aggregateLaneActivationChildReceiptV1() {
  return wireObject({
    operationId: laneOperationId,
    walletKeyId,
    targetLaneId: signingLaneId,
    targetLaneShareEpoch: laneShareEpoch,
    targetMaterialActivation: materialActivation,
    protocolCommitReceiptDigestB64u: digestString,
    holderDeliveryReceiptDigestB64u: digestString,
    serverActivationReceiptDigestB64u: digestString,
  });
}

function aggregateLaneActivationReceiptV1() {
  return wireObject({
    kind: wireLiteral('aggregate_lane_activation_receipt_v1'),
    enrollmentId: laneEnrollmentId,
    walletId,
    manifestDigestB64u: digestString,
    orderedChildReceipts: wireNonEmptyArray(
      aggregateLaneActivationChildReceiptV1(),
      assertUniqueAggregateActivationChildren,
    ),
    activatedAtMs: requiredInteger,
  });
}

export function parseAggregateLaneActivationReceiptV1(
  raw: unknown,
  label = 'aggregateActivationReceipt',
): AggregateLaneActivationReceiptV1 {
  return aggregateLaneActivationReceiptV1()(raw, label);
}

function laneRefreshPredecessorRetirementV1() {
  return wireObject({
    refreshOperationId: laneOperationId,
    sourceLaneId: signingLaneId,
    sourceLaneShareEpoch: laneShareEpoch,
    sourceMaterialActivation: materialActivation,
    retirementEffectBindingDigestB64u: digest,
    retirementReceipt: parseLaneServerRetirementReceiptV1,
  });
}

export function parseLaneRefreshPredecessorRetirementV1(
  raw: unknown,
  label = 'laneRefreshPredecessorRetirement',
): LaneRefreshPredecessorRetirementV1 {
  return laneRefreshPredecessorRetirementV1()(raw, label);
}

function aggregateLaneRevocationChildReceiptV1() {
  return wireObject({
    operationId: laneOperationId,
    walletKeyId,
    targetLaneId: signingLaneId,
    targetLaneShareEpoch: laneShareEpoch,
    targetMaterialActivation: materialActivation,
    revocationEpoch: requiredInteger,
    retirementReceiptDigestB64u: digestString,
  });
}

function aggregateLaneRevocationReceiptV1() {
  return wireObject({
    kind: wireLiteral('aggregate_lane_revocation_receipt_v1'),
    enrollmentId: laneEnrollmentId,
    walletId,
    manifestDigestB64u: digestString,
    orderedChildReceipts: wireNonEmptyArray(aggregateLaneRevocationChildReceiptV1()),
    revokedAtMs: requiredInteger,
  });
}

export function parseAggregateLaneRevocationReceiptV1(
  raw: unknown,
  label = 'aggregateRevocationReceipt',
): AggregateLaneRevocationReceiptV1 {
  return aggregateLaneRevocationReceiptV1()(raw, label);
}

function revokeLaneEnrollmentV1() {
  return wireObject({
    kind: wireLiteral('revoke_lane_enrollment_v1'),
    enrollmentId: laneEnrollmentId,
    walletId,
    manifestDigestB64u: digestString,
    reason: wireLiteral(
      'cancelled_after_commit',
      'expired_after_commit',
      'revoked_during_activation',
      'user_revoked',
      'device_compromise',
      'agent_compromise',
    ),
    requestedAtMs: requiredInteger,
  });
}

export function parseRevokeLaneEnrollmentV1(
  raw: unknown,
  label = 'revokeLaneEnrollment',
): RevokeLaneEnrollmentV1 {
  return revokeLaneEnrollmentV1()(raw, label);
}

function revokeSigningLaneV1() {
  return wireObject({
    kind: wireLiteral('revoke_signing_lane_v1'),
    walletId,
    walletKeyId,
    laneId: signingLaneId,
    laneShareEpoch,
    expectedRevocationEpoch: requiredInteger,
    reason: wireLiteral(
      'user_revoked',
      'policy_revoked',
      'device_compromise',
      'agent_compromise',
      'rotation',
    ),
    retirementCorrelationId: parseCorrelationId,
    retirementRequestDigestB64u: digestString,
    retirementEffectBindingDigestB64u: digestString,
    requestedAtMs: requiredInteger,
  });
}

export function parseRevokeSigningLaneV1(
  raw: unknown,
  label = 'revokeSigningLane',
): RevokeSigningLaneV1 {
  return revokeSigningLaneV1()(raw, label);
}

function completeSigningLaneRevocationV1() {
  return wireObject({
    kind: wireLiteral('complete_signing_lane_revocation_v1'),
    command: parseRevokeSigningLaneV1,
    expectedVersion: requiredInteger,
    commandDigestB64u: digestString,
    retirementReceipt: parseLaneServerRetirementReceiptV1,
    revokedAtMs: requiredInteger,
  });
}

export function parseCompleteSigningLaneRevocationV1(
  raw: unknown,
  label = 'completeSigningLaneRevocation',
): CompleteSigningLaneRevocationV1 {
  return completeSigningLaneRevocationV1()(raw, label);
}

function commitLaneEnrollmentRevocationV1() {
  return wireObject(
    {
      kind: wireLiteral('commit_lane_enrollment_revocation_v1'),
      enrollmentId: laneEnrollmentId,
      walletId,
      manifestDigestB64u: digestString,
      receipt: parseAggregateLaneRevocationReceiptV1,
      revokedAtMs: requiredInteger,
    },
    (command, label) => {
      if (
        String(command.receipt.enrollmentId) !== String(command.enrollmentId) ||
        String(command.receipt.walletId) !== String(command.walletId)
      ) {
        throw new Error(`${label}.receipt identity does not match command`);
      }
    },
  );
}

function laneProductEpochRecordV1() {
  const common = {
    kind: wireLiteral('lane_product_epoch_record_v1'),
    walletId,
    walletKeyId,
    laneId: signingLaneId,
    laneKind: parseLaneKind,
    laneShareEpoch,
    keyFamily: parseKeyFamily,
    enrollmentId: laneEnrollmentId,
    operationId: laneOperationId,
    targetMaterialActivationId: materialActivationId,
    materialActivation,
    publicIdentityDigestB64u: digestString,
    holderParticipant: parseLaneHolderParticipantRecordV1,
    signingWorkerParticipant: parseSigningWorkerParticipantRecordV1,
    participantSetBindingDigestB64u: laneParticipantBindingDigest,
    revocationEpoch: requiredInteger,
    createdAtMs: requiredInteger,
  };
  const revocationReason = wireLiteral(
    'user_revoked',
    'policy_revoked',
    'device_compromise',
    'agent_compromise',
    'rotation',
  );
  return wireUnion('state', [
    wireObject({
      ...common,
      state: wireLiteral('pending_visibility'),
      aggregateManifestDigestB64u: digestString,
      protocolCommitReceiptDigestB64u: digestString,
      holderDeliveryReceiptDigestB64u: digestString,
      serverActivationReceiptDigestB64u: digestString,
      pendingSinceMs: requiredInteger,
    }),
    wireObject({
      ...common,
      state: wireLiteral('active'),
      aggregateManifestDigestB64u: digestString,
      aggregateActivationReceiptDigestB64u: digestString,
      activatedAtMs: requiredInteger,
    }),
    wireObject({
      ...common,
      state: wireLiteral('retired'),
      retirementReason: wireLiteral('rotation', 'device_compromise', 'agent_compromise'),
      retirementReceiptDigestB64u: digestString,
      retiredAtMs: requiredInteger,
    }),
    wireObject({
      ...common,
      state: wireLiteral('revocation_pending'),
      revocationReason,
      retirementEffectBindingDigestB64u: digestString,
      revocationRequestedAtMs: requiredInteger,
    }),
    wireObject({
      ...common,
      state: wireLiteral('revoked'),
      revocationReason,
      retirementEffectBindingDigestB64u: digestString,
      revocationReceiptDigestB64u: digestString,
      revokedAtMs: requiredInteger,
    }),
  ]);
}

export function parseLaneProductEpochRecordV1(
  raw: unknown,
  label = 'laneProductEpochRecord',
): LaneProductEpochRecordV1 {
  return laneProductEpochRecordV1()(raw, label);
}

function laneProtocolLifecycle() {
  return wireUnion('state', [
    wireObject({ state: wireLiteral('preparing'), startedAtMs: requiredInteger }),
    wireObject({
      state: wireLiteral('awaiting_protocol_commitment'),
      startedAtMs: requiredInteger,
    }),
    wireObject({
      state: wireLiteral('committed_awaiting_holder_delivery'),
      startedAtMs: requiredInteger,
      committedAtMs: requiredInteger,
      transcriptHashB64u: digestString,
      protocolCommitReceiptDigestB64u: digestString,
    }),
    wireObject({
      state: wireLiteral('awaiting_server_activation'),
      startedAtMs: requiredInteger,
      committedAtMs: requiredInteger,
      transcriptHashB64u: digestString,
      protocolCommitReceiptDigestB64u: digestString,
      holderDeliveryReceiptDigestB64u: digestString,
      holderReceiptAtMs: requiredInteger,
    }),
    wireObject({
      state: wireLiteral('ready_for_parent_visibility'),
      startedAtMs: requiredInteger,
      committedAtMs: requiredInteger,
      transcriptHashB64u: digestString,
      protocolCommitReceiptDigestB64u: digestString,
      holderDeliveryReceiptDigestB64u: digestString,
      holderReceiptAtMs: requiredInteger,
      serverActivationReceiptDigestB64u: digestString,
      serverActivatedAtMs: requiredInteger,
    }),
    wireObject({
      state: wireLiteral('active'),
      transcriptHashB64u: digestString,
      protocolCommitReceiptDigestB64u: digestString,
      holderDeliveryReceiptDigestB64u: digestString,
      serverActivationReceiptDigestB64u: digestString,
      aggregateActivationReceiptDigestB64u: digestString,
      activatedAtMs: requiredInteger,
    }),
    wireObject({
      state: wireLiteral('aborted_precommit'),
      startedAtMs: requiredInteger,
      abortedAtMs: requiredInteger,
      abortReason: wireLiteral('cancelled', 'expired', 'revoked_before_commit'),
    }),
    wireObject({
      state: wireLiteral('committed_completion_required'),
      startedAtMs: requiredInteger,
      committedAtMs: requiredInteger,
      transcriptHashB64u: digestString,
      protocolCommitReceiptDigestB64u: digestString,
      recoveryReason: wireLiteral('exact_redelivery_required', 'recovery_required'),
    }),
  ]);
}

export function parseLaneProtocolLifecycleV1(
  raw: unknown,
  label = 'laneProtocolLifecycle',
): LaneProtocolLifecycle {
  return laneProtocolLifecycle()(raw, label);
}

function laneEnrollmentLifecycleV1() {
  return wireUnion('state', [
    wireObject({
      state: wireLiteral('preparing'),
      manifestDigestB64u: digestString,
      startedAtMs: requiredInteger,
    }),
    wireObject({
      state: wireLiteral('committed_completion_required'),
      manifestDigestB64u: digestString,
      committedChildOperationIds: wireNonEmptyArray(laneOperationId),
      markedAtMs: requiredInteger,
    }),
    wireObject({
      state: wireLiteral('ready_for_visibility'),
      manifestDigestB64u: digestString,
      aggregateReceiptDigestB64u: digestString,
      readyAtMs: requiredInteger,
    }),
    wireObject({
      state: wireLiteral('active'),
      manifestDigestB64u: digestString,
      aggregateReceiptDigestB64u: digestString,
      activatedAtMs: requiredInteger,
    }),
    wireObject({ state: wireLiteral('cancelled_precommit'), cancelledAtMs: requiredInteger }),
    wireObject({
      state: wireLiteral('revoking_committed_targets'),
      manifestDigestB64u: digestString,
      reason: wireLiteral(
        'cancelled_after_commit',
        'expired_after_commit',
        'revoked_during_activation',
      ),
      markedAtMs: requiredInteger,
    }),
    wireObject({
      state: wireLiteral('revoked'),
      manifestDigestB64u: digestString,
      aggregateRevocationReceiptDigestB64u: digestString,
      revokedAtMs: requiredInteger,
    }),
  ]);
}

export function parseLaneEnrollmentLifecycleV1(
  raw: unknown,
  label = 'laneEnrollmentLifecycle',
): LaneEnrollmentLifecycleV1 {
  return laneEnrollmentLifecycleV1()(raw, label);
}

export function buildLaneProtocolRecordV1(args: {
  readonly job: RotatableSigningLaneJobV1;
  readonly lifecycle: LaneProtocolLifecycle;
}): LaneProtocolRecordV1 {
  return { job: args.job, lifecycle: args.lifecycle };
}

export function buildAggregateLaneRevocationReceiptV1(
  args: Omit<AggregateLaneRevocationReceiptV1, 'kind'>,
): AggregateLaneRevocationReceiptV1 {
  return parseAggregateLaneRevocationReceiptV1({
    kind: 'aggregate_lane_revocation_receipt_v1',
    ...args,
  });
}

export function buildRevokeSigningLaneV1(
  args: Omit<RevokeSigningLaneV1, 'kind'>,
): RevokeSigningLaneV1 {
  return parseRevokeSigningLaneV1({ kind: 'revoke_signing_lane_v1', ...args });
}

export function buildCommitLaneEnrollmentRevocationV1(
  args: Omit<CommitLaneEnrollmentRevocationV1, 'kind'>,
): CommitLaneEnrollmentRevocationV1 {
  return commitLaneEnrollmentRevocationV1()(
    { kind: 'commit_lane_enrollment_revocation_v1', ...args },
    'commitLaneEnrollmentRevocation',
  );
}

export function buildLaneProductEpochPendingVisibilityV1(
  args: Omit<LaneProductEpochPendingVisibilityV1, 'kind' | 'state'>,
): LaneProductEpochPendingVisibilityV1 {
  const value = parseLaneProductEpochRecordV1({
    kind: 'lane_product_epoch_record_v1',
    state: 'pending_visibility',
    ...args,
  });
  if (value.state !== 'pending_visibility') throw new Error('product epoch state changed');
  return value;
}

export function buildLaneProductEpochRevokedV1(
  args: Omit<LaneProductEpochRevokedV1, 'kind' | 'state'>,
): LaneProductEpochRevokedV1 {
  const value = parseLaneProductEpochRecordV1({
    kind: 'lane_product_epoch_record_v1',
    state: 'revoked',
    ...args,
  });
  if (value.state !== 'revoked') throw new Error('product epoch state changed');
  return value;
}

const serverRetirementReason = /* @__PURE__ */ wireLiteral(
  'lane_revoked',
  'device_compromise',
  'agent_compromise',
  'rotation',
);

function ecdsaServerRetirementReceiptV1() {
  return wireObject({
    kind: wireLiteral('ecdsa_server_retirement_receipt_v1'),
    manifest: wireObject({
      manifestId: parseEcdsaCapabilityManifestId,
      manifestRevision: parseEcdsaCapabilityManifestRevision,
    }),
    materialActivation,
    walletKeyId,
    laneId: signingLaneId,
    laneShareEpoch,
    revocationEpoch: requiredInteger,
    retirementReason: serverRetirementReason,
    retirementCorrelationId: parseCorrelationId,
    retirementRequestDigestB64u: digestString,
    serverGeneration: parseEcdsaServerGeneration,
    lifecycleId: parseEcdsaLifecycleId,
    receiptDigestB64u: digestString,
    retiredAt: isoTimestamp,
  });
}

export function parseEcdsaServerRetirementReceiptV1(
  raw: unknown,
  label = 'ecdsaRetirementReceipt',
): EcdsaServerRetirementReceiptV1 {
  return ecdsaServerRetirementReceiptV1()(raw, label);
}

function ed25519LaneMaterialIdentityV1() {
  return wireObject({
    operationId: laneOperationId,
    enrollmentId: laneEnrollmentId,
    walletId,
    walletKeyId,
    targetLaneId: signingLaneId,
    targetLaneShareEpoch: laneShareEpoch,
    targetMaterialActivationId: materialActivationId,
    keyFamily: wireLiteral('ed25519'),
    holderParticipantBindingDigestB64u: digest,
    signingWorkerParticipantBindingDigestB64u: digest,
    holderRecipientKeyDigestB64u: digest,
    serverRecipientKeyDigestB64u: digest,
    transcriptHashB64u: digest,
    protocolCommitReceiptDigestB64u: digest,
  });
}

function ed25519ServerRetirementReceiptV1() {
  return wireObject({
    kind: wireLiteral('ed25519_server_retirement_receipt_v1'),
    identity: ed25519LaneMaterialIdentityV1(),
    revocationEpoch: requiredInteger,
    retirementReason: serverRetirementReason,
    retirementCorrelationId: parseCorrelationId,
    retirementRequestDigestB64u: digest,
    receiptDigestB64u: digest,
    retiredAtMs: requiredInteger,
  });
}

export function parseEd25519ServerRetirementReceiptV1(
  raw: unknown,
  label = 'ed25519RetirementReceipt',
): Ed25519ServerRetirementReceiptV1 {
  return ed25519ServerRetirementReceiptV1()(raw, label);
}

function laneServerRetirementReceiptV1() {
  return wireUnion('kind', [ecdsaServerRetirementReceiptV1(), ed25519ServerRetirementReceiptV1()]);
}

export function parseLaneServerRetirementReceiptV1(
  raw: unknown,
  label = 'laneServerRetirementReceipt',
): LaneServerRetirementReceiptV1 {
  return laneServerRetirementReceiptV1()(raw, label);
}

// Each schema parses exactly the declared wire type it serves. Ambient, so it costs nothing.
declare const schemasParseTheirDeclaredTypes: AllTrue<
  [
    ParsesExactly<typeof laneProtocolCommitReceiptV1, LaneProtocolCommitReceiptV1>,
    ParsesExactly<typeof laneHolderDeliveryReceiptV1, LaneHolderDeliveryReceiptV1>,
    ParsesExactly<typeof laneServerActivationReceiptV1, LaneServerActivationReceiptV1>,
    ParsesExactly<typeof laneEnrollmentManifestChildV1, LaneEnrollmentManifestChildV1>,
    ParsesExactly<typeof laneEnrollmentManifestV1, LaneEnrollmentManifestV1>,
    ParsesExactly<
      typeof aggregateLaneActivationChildReceiptV1,
      AggregateLaneActivationChildReceiptV1
    >,
    ParsesExactly<typeof aggregateLaneActivationReceiptV1, AggregateLaneActivationReceiptV1>,
    ParsesExactly<typeof laneRefreshPredecessorRetirementV1, LaneRefreshPredecessorRetirementV1>,
    ParsesExactly<
      typeof aggregateLaneRevocationChildReceiptV1,
      AggregateLaneRevocationChildReceiptV1
    >,
    ParsesExactly<typeof aggregateLaneRevocationReceiptV1, AggregateLaneRevocationReceiptV1>,
    ParsesExactly<typeof revokeLaneEnrollmentV1, RevokeLaneEnrollmentV1>,
    ParsesExactly<typeof revokeSigningLaneV1, RevokeSigningLaneV1>,
    ParsesExactly<typeof completeSigningLaneRevocationV1, CompleteSigningLaneRevocationV1>,
    ParsesExactly<typeof commitLaneEnrollmentRevocationV1, CommitLaneEnrollmentRevocationV1>,
    ParsesExactly<typeof laneProductEpochRecordV1, LaneProductEpochRecordV1>,
    ParsesExactly<typeof laneProtocolLifecycle, LaneProtocolLifecycle>,
    ParsesExactly<typeof laneEnrollmentLifecycleV1, LaneEnrollmentLifecycleV1>,
    ParsesExactly<typeof ecdsaServerRetirementReceiptV1, EcdsaServerRetirementReceiptV1>,
    ParsesExactly<
      typeof ed25519LaneMaterialIdentityV1,
      SigningWorkerLaneMaterialIdentityV1<'ed25519'>
    >,
    ParsesExactly<typeof ed25519ServerRetirementReceiptV1, Ed25519ServerRetirementReceiptV1>,
    ParsesExactly<typeof laneServerRetirementReceiptV1, LaneServerRetirementReceiptV1>,
  ]
>;
