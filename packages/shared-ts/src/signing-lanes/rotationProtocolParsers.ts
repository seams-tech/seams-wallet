// The rotation protocol's messages: the lane jobs, the holder package and the holder round.
// Client workers import this module, so it holds no stored-record schemas.
import {
  parseEcdsaCapabilityManifestId,
  parseEcdsaCapabilityManifestRevision,
  parseEcdsaServerGeneration,
} from '../utils/ecdsaCapabilityActivation';
import { parseThresholdEcdsaSessionId, type MpcMaterialActivationRef } from '../utils/domainIds';
import {
  parseEd25519PublicKeyB64u,
  parseKeyCreationSignerSlot,
  parseSecp256k1CompressedPublicKeyB64u,
} from '../passkey-custody/primitives';
import { requireRecord } from '../utils/validation';
import { exactRecord } from '../utils/exactRecord';
import {
  wireLiteral,
  wireNonEmptyArray,
  wireObject,
  wireResult,
  wireUnion,
  type AllTrue,
  type ParsesExactly,
  type WireParser,
} from '../utils/wireSchema';
import { parseNearEd25519SigningKeyId } from '../utils/registrationIds';
import { parseSdkEcdsaDerivationThresholdKeyId } from '../threshold/ecdsaDerivationRoleLocalBootstrap';
import { parseEvmFamilySigningKeySlotId } from './evmFamilySigningKeySlotId';
import {
  parseHpkePublicKeyB64u,
  parseLaneCustodyBindingDigestB64u,
  parseLaneHolderCustodyBindingId,
  parseLaneHolderParticipantId,
  parseSigningWorkerParticipantId,
  parseSigningWorkerRecipientKeyDigestB64u,
  parseSigningWorkerRecipientKeyId,
} from './participants';
import {
  parseLaneOperationIdempotencyKey,
  parseEd25519YaoSuiteId,
  parseEcdsaRelayerKeyId,
  type SigningLaneId,
  type ThresholdEcdsaChainTarget,
  type LaneShareEpoch,
} from './ids';
import type { SigningLaneKind } from './records';
import type {
  ActiveLaneProtocolSourceV1,
  EcdsaAdditiveLaneHolderRoundV1,
  EcdsaAdditiveLaneJobV1,
  EcdsaSourceCapabilityBindingV1,
  EcdsaTargetCapabilityBindingV1,
  Ed25519YaoLaneJobV1,
  LaneCreationTargetV1,
  LaneHolderPackageWireV1,
  LaneRefreshTargetV1,
  LaneTargetSigningWorkerV1,
  RotatableSigningLaneJobV1,
  OwnerLaneRefreshAuthorizationBindingV1,
  LinkedDeviceLaneAuthorizationBindingV1,
  OwnerLaneProtocolSourceV1,
  ProvisionedLaneProtocolSourceV1,
} from './rotation';
import { parseOwnerLaneParticipantContinuityV1 } from './ownerContinuity';
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

type UnknownRecord = Record<string, unknown>;

function opaqueJson(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(`${label} must be a non-empty JSON string`);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('top-level value must be an object');
    }
  } catch (error) {
    throw new Error(
      `${label} must contain valid object JSON: ${error instanceof Error ? error.message : 'invalid JSON'}`,
    );
  }
  return raw;
}

const hpkePublicKey = /* @__PURE__ */ wireResult(parseHpkePublicKeyB64u);
const hpkePublicKeyDigest = /* @__PURE__ */ wireResult(parseSigningWorkerRecipientKeyDigestB64u);
const signingWorkerRecipientKeyId = /* @__PURE__ */ wireResult(parseSigningWorkerRecipientKeyId);
const laneHolderParticipantId = /* @__PURE__ */ wireResult(parseLaneHolderParticipantId);
const signingWorkerParticipantId = /* @__PURE__ */ wireResult(parseSigningWorkerParticipantId);
const laneOperationIdempotencyKey = /* @__PURE__ */ wireResult(parseLaneOperationIdempotencyKey);
const ed25519YaoSuiteId = /* @__PURE__ */ wireResult(parseEd25519YaoSuiteId);
// These points are parsed under the parser's own label, as they always have been.
const compressedPointString: WireParser<string> = (raw) =>
  parseSecp256k1CompressedPublicKeyB64u(raw);

// A source names the kind it expected, unlike a tag.
function sourceKind<V extends string>(expected: V): WireParser<V> {
  return (raw, label) => {
    if (raw !== expected) throw new Error(`${label} must be ${expected}`);
    return expected;
  };
}

// Sources carry their participant binding digest as a plain string.
const participantBindingDigestString: WireParser<string> = laneParticipantBindingDigest;

function ownerLaneProtocolSourceV1() {
  return wireObject({
    sourceKind: sourceKind('owner_registration'),
    laneId: signingLaneId,
    laneKind: wireLiteral('owner_passkey', 'owner_email_otp'),
    laneShareEpoch,
    revocationEpoch: requiredInteger,
    ownerParticipantContinuity: parseOwnerLaneParticipantContinuityV1,
    participantBindingDigestB64u: participantBindingDigestString,
    materialActivation,
  });
}

function provisionedLaneProtocolSourceV1() {
  return wireObject({
    sourceKind: sourceKind('provisioned_lane'),
    laneId: signingLaneId,
    laneKind: wireLiteral('linked_device', 'delegated_execution', 'recovery', 'break_glass'),
    laneShareEpoch,
    revocationEpoch: requiredInteger,
    holderParticipantId: laneHolderParticipantId,
    signingWorkerParticipantId,
    signingWorkerRecipientKeyId,
    participantBindingDigestB64u: participantBindingDigestString,
    materialActivation,
  });
}

// The lane kind is checked first and chooses the source's shape.
function parseSource(raw: unknown, label: string): ActiveLaneProtocolSourceV1 {
  const record = requireRecord(raw, label);
  const laneKind = parseLaneKind(record.laneKind, `${label}.laneKind`);
  return laneKind === 'owner_passkey' || laneKind === 'owner_email_otp'
    ? ownerLaneProtocolSourceV1()(record, label)
    : provisionedLaneProtocolSourceV1()(record, label);
}

function laneTargetHolderV1() {
  return wireObject({
    participantId: laneHolderParticipantId,
    participantBindingDigestB64u: laneParticipantBindingDigest,
    custodyBindingId: wireResult(parseLaneHolderCustodyBindingId),
    custodyBindingDigestB64u: wireResult(parseLaneCustodyBindingDigestB64u),
    hpkePublicKeyB64u: hpkePublicKey,
    hpkePublicKeyDigestB64u: hpkePublicKeyDigest,
  });
}

function laneTargetSigningWorkerV1() {
  return wireObject({
    participantId: signingWorkerParticipantId,
    participantBindingDigestB64u: laneParticipantBindingDigest,
    recipientKeyId: signingWorkerRecipientKeyId,
    hpkePublicKeyB64u: hpkePublicKey,
    hpkePublicKeyDigestB64u: hpkePublicKeyDigest,
  });
}

function buildLaneCreationTargetV1(args: {
  readonly laneId: SigningLaneId;
  readonly laneShareEpoch: LaneShareEpoch;
}): LaneCreationTargetV1 {
  return {
    operation: 'create_lane',
    laneId: args.laneId,
    laneKind: 'linked_device',
    laneShareEpoch: args.laneShareEpoch,
    expectedTargetState: 'absent',
  };
}

function buildLaneRefreshTargetV1(args: {
  readonly laneId: SigningLaneId;
  readonly laneKind: Exclude<SigningLaneKind, 'delegated_execution'>;
  readonly laneShareEpoch: LaneShareEpoch;
  readonly priorMaterialActivation: MpcMaterialActivationRef;
}): LaneRefreshTargetV1 {
  return {
    operation: 'refresh_lane',
    laneId: args.laneId,
    laneKind: args.laneKind,
    laneShareEpoch: args.laneShareEpoch,
    expectedTargetState: 'active_previous_epoch',
    priorMaterialActivation: args.priorMaterialActivation,
  };
}

function parseTarget(
  raw: unknown,
  source: ActiveLaneProtocolSourceV1,
  label: string,
): LaneCreationTargetV1 | LaneRefreshTargetV1 {
  const record = requireRecord(raw, label);
  if (record.operation === 'create_lane') {
    const value = exactRecord(
      record,
      ['operation', 'laneId', 'laneKind', 'laneShareEpoch', 'expectedTargetState'],
      label,
    );
    if (value.laneKind !== 'linked_device' || value.expectedTargetState !== 'absent') {
      throw new Error(`${label} create branch has invalid target state`);
    }
    const target = buildLaneCreationTargetV1({
      laneId: signingLaneId(value.laneId, `${label}.laneId`),
      laneShareEpoch: laneShareEpoch(value.laneShareEpoch, `${label}.laneShareEpoch`),
    });
    if (source.laneKind === 'linked_device' || source.laneKind === 'delegated_execution') {
      throw new Error(`${label} creation requires an owner-controlled source lane`);
    }
    if (String(target.laneId) === String(source.laneId)) {
      throw new Error(`${label}.laneId must differ from source.laneId for creation`);
    }
    return target;
  }
  if (record.operation === 'refresh_lane') {
    const value = exactRecord(
      record,
      [
        'operation',
        'laneId',
        'laneKind',
        'laneShareEpoch',
        'expectedTargetState',
        'priorMaterialActivation',
      ],
      label,
    );
    if (value.expectedTargetState !== 'active_previous_epoch') {
      throw new Error(`${label} refresh branch has invalid target state`);
    }
    const laneId = signingLaneId(value.laneId, `${label}.laneId`);
    if (String(laneId) !== String(source.laneId)) {
      throw new Error(`${label}.laneId must match source.laneId for refresh`);
    }
    const shareEpoch = laneShareEpoch(value.laneShareEpoch, `${label}.laneShareEpoch`);
    if (String(shareEpoch) === String(source.laneShareEpoch)) {
      throw new Error(`${label}.laneShareEpoch must advance source.laneShareEpoch`);
    }
    const laneKind = parseLaneKind(value.laneKind, `${label}.laneKind`);
    if (laneKind !== source.laneKind) {
      throw new Error(`${label}.laneKind must match source.laneKind for refresh`);
    }
    if (laneKind !== 'delegated_execution') {
      return buildLaneRefreshTargetV1({
        laneId,
        laneKind,
        laneShareEpoch: shareEpoch,
        priorMaterialActivation: materialActivation(
          value.priorMaterialActivation,
          `${label}.priorMaterialActivation`,
        ),
      });
    }
  }
  throw new Error(`${label}.operation is invalid`);
}

function parseOperation(
  rawTarget: unknown,
  rawAuthorization: unknown,
  source: ActiveLaneProtocolSourceV1,
  label: string,
):
  | { target: LaneCreationTargetV1; authorization: LinkedDeviceLaneAuthorizationBindingV1 }
  | { target: LaneRefreshTargetV1; authorization: OwnerLaneRefreshAuthorizationBindingV1 } {
  const target = parseTarget(rawTarget, source, `${label}.target`);
  const authorization = parseAuthorization(rawAuthorization, `${label}.authorization`);
  if (target.operation === 'create_lane') {
    if (authorization.kind !== 'linked_device_enrollment') {
      throw new Error(`${label}.authorization must be linked-device enrollment for creation`);
    }
    return { target, authorization };
  }
  if (authorization.kind !== 'owner_lane_refresh') {
    throw new Error(`${label}.authorization must be owner refresh for refresh`);
  }
  return { target, authorization };
}

type ParsedCreationOperation = Extract<
  ReturnType<typeof parseOperation>,
  { target: { operation: 'create_lane' } }
>;

function isParsedCreationOperation(
  value: ReturnType<typeof parseOperation>,
): value is ParsedCreationOperation {
  return value.target.operation === 'create_lane';
}

// The caller has already checked the job's exact fields.
function parseCommonJob(record: UnknownRecord, label: string) {
  const source = parseSource(record.source, `${label}.source`);
  const targetHolder = laneTargetHolderV1()(record.targetHolder, `${label}.targetHolder`);
  const targetSigningWorker = laneTargetSigningWorkerV1()(
    record.targetSigningWorker,
    `${label}.targetSigningWorker`,
  );
  const targetMaterialActivationId = materialActivationId(
    record.targetMaterialActivationId,
    `${label}.targetMaterialActivationId`,
  );
  if (String(targetMaterialActivationId) === String(source.materialActivation.activationId)) {
    throw new Error(`${label}.targetMaterialActivationId must be fresh`);
  }
  if (record.protocolVersion !== 'rotatable_signing_lane_protocol_v1') {
    throw new Error(`${label}.protocolVersion is invalid`);
  }
  return {
    operationId: laneOperationId(record.operationId, `${label}.operationId`),
    enrollmentId: laneEnrollmentId(record.enrollmentId, `${label}.enrollmentId`),
    idempotencyKey: laneOperationIdempotencyKey(record.idempotencyKey, `${label}.idempotencyKey`),
    walletId: walletId(record.walletId, `${label}.walletId`),
    walletKeyId: walletKeyId(record.walletKeyId, `${label}.walletKeyId`),
    source,
    targetHolder,
    targetSigningWorker,
    targetMaterialActivationId,
    protocolVersion: 'rotatable_signing_lane_protocol_v1' as const,
    expiresAtMs: requiredInteger(record.expiresAtMs, `${label}.expiresAtMs`),
  };
}

function ecdsaSourceCapabilityBindingV1() {
  return wireObject({
    manifestId: parseEcdsaCapabilityManifestId,
    manifestRevision: parseEcdsaCapabilityManifestRevision,
    serverGeneration: parseEcdsaServerGeneration,
    ecdsaThresholdKeyId: parseSdkEcdsaDerivationThresholdKeyId,
    relayerKeyId: wireResult(parseEcdsaRelayerKeyId),
  });
}

function thresholdEcdsaChainTarget() {
  return wireUnion('kind', [
    wireObject({
      kind: wireLiteral('evm'),
      namespace: wireLiteral('eip155'),
      chainId: requiredInteger,
      networkSlug: requiredString,
    }),
    wireObject({
      kind: wireLiteral('tempo'),
      chainId: requiredInteger,
      networkSlug: requiredString,
    }),
  ]);
}

function ecdsaTargetCapabilityBindingV1() {
  return wireObject({
    manifestId: parseEcdsaCapabilityManifestId,
    manifestRevision: parseEcdsaCapabilityManifestRevision,
    ecdsaThresholdKeyId: parseSdkEcdsaDerivationThresholdKeyId,
    orderedThresholdSessions: wireNonEmptyArray(
      wireObject({
        chainTarget: thresholdEcdsaChainTarget(),
        thresholdSessionId: wireResult(parseThresholdEcdsaSessionId),
        participantBindingDigestB64u: digestString,
      }),
    ),
  });
}

// The fields both curves' jobs carry, in the order they are checked.
const LANE_JOB_FIELDS = [
  'kind',
  'keyFamily',
  'operationId',
  'enrollmentId',
  'idempotencyKey',
  'walletId',
  'walletKeyId',
  'source',
  'targetHolder',
  'targetSigningWorker',
  'targetMaterialActivationId',
  'protocolVersion',
  'expiresAtMs',
  'target',
  'authorization',
] as const;

function parseEcdsaJob(record: UnknownRecord, label: string): EcdsaAdditiveLaneJobV1 {
  const value = exactRecord(
    record,
    [
      ...LANE_JOB_FIELDS,
      'evmFamilySigningKeySlotId',
      'thresholdPublicKey33B64u',
      'evmAddress',
      'sourceCapability',
      'targetCapability',
      'sourceHolderVerifyingShare33B64u',
      'sourceServerVerifyingShare33B64u',
      'reshareChannelBindingDigestB64u',
      'transcriptEncoding',
    ],
    label,
  );
  if (value.kind !== 'ecdsa_additive_lane_job_v1' || value.keyFamily !== 'ecdsa_secp256k1') {
    throw new Error(`${label} kind/keyFamily is invalid`);
  }
  if (value.transcriptEncoding !== 'ecdsa_additive_lane_transcript_v1') {
    throw new Error(`${label}.transcriptEncoding is invalid`);
  }
  const common = parseCommonJob(value, label);
  const operation = parseOperation(
    value.target,
    value.authorization,
    common.source,
    `${label}.operation`,
  );
  const curve = {
    kind: 'ecdsa_additive_lane_job_v1' as const,
    keyFamily: 'ecdsa_secp256k1' as const,
    evmFamilySigningKeySlotId: (() => {
      const parsed = parseEvmFamilySigningKeySlotId(value.evmFamilySigningKeySlotId);
      if (parsed.ok) return parsed.value;
      throw new Error(`${label}.evmFamilySigningKeySlotId is invalid`);
    })(),
    thresholdPublicKey33B64u: parseSecp256k1CompressedPublicKeyB64u(value.thresholdPublicKey33B64u),
    evmAddress: requiredString(value.evmAddress, `${label}.evmAddress`),
    sourceCapability: ecdsaSourceCapabilityBindingV1()(
      value.sourceCapability,
      `${label}.sourceCapability`,
    ),
    targetCapability: ecdsaTargetCapabilityBindingV1()(
      value.targetCapability,
      `${label}.targetCapability`,
    ),
    sourceHolderVerifyingShare33B64u: parseSecp256k1CompressedPublicKeyB64u(
      value.sourceHolderVerifyingShare33B64u,
      `${label}.sourceHolderVerifyingShare33B64u`,
    ),
    sourceServerVerifyingShare33B64u: parseSecp256k1CompressedPublicKeyB64u(
      value.sourceServerVerifyingShare33B64u,
      `${label}.sourceServerVerifyingShare33B64u`,
    ),
    reshareChannelBindingDigestB64u: digest(
      value.reshareChannelBindingDigestB64u,
      `${label}.reshareChannelBindingDigestB64u`,
    ),
    transcriptEncoding: 'ecdsa_additive_lane_transcript_v1' as const,
  };
  return { ...common, ...operation, ...curve };
}

function parseEdJob(record: UnknownRecord, label: string): Ed25519YaoLaneJobV1 {
  const value = exactRecord(
    record,
    [
      ...LANE_JOB_FIELDS,
      'yaoRequestKind',
      'registeredPublicKeyB64u',
      'nearEd25519SigningKeyId',
      'keyCreationSignerSlot',
      'stableContextBindingB64u',
      'yaoSuiteId',
      'circuitDigestB64u',
    ],
    label,
  );
  if (value.kind !== 'ed25519_yao_lane_job_v1' || value.keyFamily !== 'ed25519') {
    throw new Error(`${label} kind/keyFamily is invalid`);
  }
  const common = parseCommonJob(value, label);
  const operation = parseOperation(
    value.target,
    value.authorization,
    common.source,
    `${label}.operation`,
  );
  const yaoRequestKind = requiredString(value.yaoRequestKind, `${label}.yaoRequestKind`);
  const curve = {
    kind: 'ed25519_yao_lane_job_v1' as const,
    keyFamily: 'ed25519' as const,
    registeredPublicKeyB64u: parseEd25519PublicKeyB64u(value.registeredPublicKeyB64u),
    nearEd25519SigningKeyId: parseNearEd25519SigningKeyId(value.nearEd25519SigningKeyId),
    keyCreationSignerSlot: parseKeyCreationSignerSlot(value.keyCreationSignerSlot),
    stableContextBindingB64u: digest(
      value.stableContextBindingB64u,
      `${label}.stableContextBindingB64u`,
    ),
    yaoSuiteId: ed25519YaoSuiteId(value.yaoSuiteId, `${label}.yaoSuiteId`),
    circuitDigestB64u: digest(value.circuitDigestB64u, `${label}.circuitDigestB64u`),
  };
  if (isParsedCreationOperation(operation)) {
    if (yaoRequestKind !== 'lane_provisioning')
      throw new Error(`${label}.yaoRequestKind must be lane_provisioning for creation`);
    return { ...common, ...operation, yaoRequestKind, ...curve };
  }
  if (yaoRequestKind !== 'lane_refresh')
    throw new Error(`${label}.yaoRequestKind must be lane_refresh for refresh`);
  return { ...common, ...operation, yaoRequestKind, ...curve };
}

export function parseRotatableSigningLaneJobV1(
  raw: unknown,
  label = 'laneProtocolJob',
): RotatableSigningLaneJobV1 {
  const record = requireRecord(raw, label);
  if (record.kind === 'ed25519_yao_lane_job_v1') return parseEdJob(record, label);
  if (record.kind === 'ecdsa_additive_lane_job_v1') return parseEcdsaJob(record, label);
  throw new Error(`${label}.kind is invalid`);
}

export const parseLaneProtocolJobV1 = parseRotatableSigningLaneJobV1;

function laneHolderPackageWireV1() {
  return wireUnion('kind', [
    wireObject({
      kind: wireLiteral('ed25519_yao_lane_holder_package_set_v1'),
      deriverAEncryptedPackageJson: opaqueJson,
      deriverBEncryptedPackageJson: opaqueJson,
    }),
    wireObject({
      kind: wireLiteral('ecdsa_additive_lane_holder_package_v1'),
      ecdsaEncryptedMaterialEnvelopeJson: opaqueJson,
    }),
  ]);
}

export function parseLaneHolderPackageWireV1(
  raw: unknown,
  label = 'laneHolderPackage',
): LaneHolderPackageWireV1 {
  return laneHolderPackageWireV1()(raw, label);
}

function ecdsaAdditiveLaneHolderRoundV1() {
  return wireObject({
    kind: wireLiteral('ecdsa_additive_lane_holder_round_v1'),
    preambleHashB64u: digestString,
    targetHolderPublicCommitment33B64u: compressedPointString,
    encryptedDeltaCiphertextDigestB64u: digestString,
    sealedTargetHolderMaterialDigestB64u: digestString,
    holderAttestationB64u: requiredString,
    holderCommittedAtMs: requiredInteger,
  });
}

export function parseEcdsaAdditiveLaneHolderRoundV1(
  raw: unknown,
  label = 'ecdsaHolderRound',
): EcdsaAdditiveLaneHolderRoundV1 {
  return ecdsaAdditiveLaneHolderRoundV1()(raw, label);
}

// Each schema parses exactly the declared wire type it serves. Ambient, so it costs nothing.
declare const schemasParseTheirDeclaredTypes: AllTrue<
  [
    ParsesExactly<typeof ownerLaneProtocolSourceV1, OwnerLaneProtocolSourceV1>,
    ParsesExactly<typeof provisionedLaneProtocolSourceV1, ProvisionedLaneProtocolSourceV1>,
    ParsesExactly<typeof laneTargetHolderV1, RotatableSigningLaneJobV1['targetHolder']>,
    ParsesExactly<typeof laneTargetSigningWorkerV1, LaneTargetSigningWorkerV1>,
    ParsesExactly<typeof ecdsaSourceCapabilityBindingV1, EcdsaSourceCapabilityBindingV1>,
    ParsesExactly<typeof thresholdEcdsaChainTarget, ThresholdEcdsaChainTarget>,
    ParsesExactly<typeof ecdsaTargetCapabilityBindingV1, EcdsaTargetCapabilityBindingV1>,
    ParsesExactly<typeof laneHolderPackageWireV1, LaneHolderPackageWireV1>,
    ParsesExactly<typeof ecdsaAdditiveLaneHolderRoundV1, EcdsaAdditiveLaneHolderRoundV1>,
  ]
>;
