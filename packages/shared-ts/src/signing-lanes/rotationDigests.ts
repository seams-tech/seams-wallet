import { base64UrlDecode, base64UrlEncode } from '../utils/base64';
import { parseDigestB64u, type DigestB64u } from '../utils/canonicalPrimitives';
import { sha256Bytes } from '../utils/digests';
import type { MpcMaterialActivationRef } from '../utils/domainIds';
import type {
  AggregateLaneActivationChildReceiptV1,
  AggregateLaneActivationReceiptV1,
  AggregateLaneRevocationChildReceiptV1,
  AggregateLaneRevocationReceiptV1,
  EcdsaServerRetirementReceiptV1,
  Ed25519ServerRetirementReceiptV1,
  Ed25519YaoLaneJobV1,
  LaneEnrollmentManifestChildV1,
  LaneEnrollmentManifestV1,
  LaneOperationAuthorizationBindingV1,
  RevokeSigningLaneV1,
  RotatableSigningLaneJobV1,
  SigningWorkerLaneMaterialIdentityV1,
} from './rotation';
import { isProvisionedLaneProtocolSourceV1 } from './rotation';
import { ownerLaneParticipantContinuityCanonicalBytesV1 } from './ownerContinuity';

const ENROLLMENT_MANIFEST_DOMAIN = 'seams/rotatable-signing-lanes/enrollment-manifest/v1';
const AGGREGATE_ACTIVATION_DOMAIN = 'seams/rotatable-signing-lanes/aggregate-activation-receipt/v1';
const AGGREGATE_REVOCATION_DOMAIN = 'seams/rotatable-signing-lanes/aggregate-revocation-receipt/v1';
const ED25519_JOB_TRANSCRIPT_DOMAIN = 'seams/rotatable-signing-lanes/ed25519-job/v1';
const ED25519_SESSION_DOMAIN = 'seams/rotatable-signing-lanes/ed25519-session/v1';
const PROTOCOL_COMMIT_RECEIPT_DOMAIN = 'seams/rotatable-signing-lanes/protocol-commit-receipt/v1';
const HOLDER_DELIVERY_RECEIPT_DOMAIN = 'seams/rotatable-signing-lanes/holder-delivery-receipt/v1';
const SERVER_ACTIVATION_RECEIPT_DOMAIN =
  'seams/rotatable-signing-lanes/server-activation-receipt/v1';
const ECDSA_RETIREMENT_RECEIPT_DOMAIN = 'seams/rotatable-signing-lanes/ecdsa-retirement-receipt/v1';
const ED25519_RETIREMENT_RECEIPT_DOMAIN =
  'seams/rotatable-signing-lanes/ed25519-retirement-receipt/v1';

const TEXT_ENCODER = new TextEncoder();

function bytes(value: number[]): Uint8Array {
  return Uint8Array.from(value);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function u32(value: number, label: string): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} must be a non-negative u32`);
  }
  return bytes([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function u64(value: number, label: string): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  let remaining = BigInt(value);
  const output = new Uint8Array(8);
  for (let index = 7; index >= 0; index -= 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return output;
}

function lp32(value: Uint8Array, label: string): Uint8Array {
  return concat([u32(value.length, `${label}.length`), value]);
}

function text(value: string, label: string): Uint8Array {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return lp32(TEXT_ENCODER.encode(value), label);
}

function digest(value: string, label: string): Uint8Array {
  try {
    return lp32(base64UrlDecode(parseDigestB64u(value)), label);
  } catch (error) {
    throw new Error(`${label} ${error instanceof Error ? error.message : 'is invalid'}`);
  }
}

function recordDomain(domain: string): Uint8Array {
  return text(domain, 'domain');
}

function activation(value: MpcMaterialActivationRef): Uint8Array {
  return concat([
    text(value.kind, 'materialActivation.kind'),
    text(value.activationId, 'materialActivation.activationId'),
    text(value.capability, 'materialActivation.capability'),
    text(value.materialOwner, 'materialActivation.materialOwner'),
    text(value.keyBinding, 'materialActivation.keyBinding'),
    text(value.lifecycleBinding, 'materialActivation.lifecycleBinding'),
    text(value.signingWorker, 'materialActivation.signingWorker'),
  ]);
}

function activationField(value: MpcMaterialActivationRef, label: string): Uint8Array {
  return lp32(activation(value), label);
}

function encodeAuthorization(value: LaneOperationAuthorizationBindingV1): Uint8Array {
  if (value.kind === 'linked_device_enrollment') {
    return concat([
      text(value.kind, 'authorization.kind'),
      text(value.authorizedOperationId, 'authorization.authorizedOperationId'),
      text(value.linkedDeviceEnrollmentId, 'authorization.linkedDeviceEnrollmentId'),
      digest(
        value.linkedDevicePermissionDigestB64u,
        'authorization.linkedDevicePermissionDigestB64u',
      ),
    ]);
  }
  return concat([
    text(value.kind, 'authorization.kind'),
    text(value.authorizedOperationId, 'authorization.authorizedOperationId'),
    digest(value.ownerLaneRefreshDigestB64u, 'authorization.ownerLaneRefreshDigestB64u'),
  ]);
}

function encodeSource(value: RotatableSigningLaneJobV1['source']): Uint8Array {
  const common = [
    text(value.laneId, 'source.laneId'),
    text(value.laneKind, 'source.laneKind'),
    text(value.laneShareEpoch, 'source.laneShareEpoch'),
    u64(value.revocationEpoch, 'source.revocationEpoch'),
    text(value.sourceKind, 'source.sourceKind'),
  ] as const;
  if (value.ownerParticipantContinuity !== undefined) {
    return concat([
      ...common,
      ownerLaneParticipantContinuityCanonicalBytesV1(value.ownerParticipantContinuity),
      digest(value.participantBindingDigestB64u, 'source.participantBindingDigestB64u'),
      activationField(value.materialActivation, 'source.materialActivation'),
    ]);
  }
  if (!isProvisionedLaneProtocolSourceV1(value)) {
    throw new Error('provisioned lane source participant identities are required');
  }
  return concat([
    ...common,
    text(value.holderParticipantId, 'source.holderParticipantId'),
    text(value.signingWorkerParticipantId, 'source.signingWorkerParticipantId'),
    text(value.signingWorkerRecipientKeyId, 'source.signingWorkerRecipientKeyId'),
    digest(value.participantBindingDigestB64u, 'source.participantBindingDigestB64u'),
    activationField(value.materialActivation, 'source.materialActivation'),
  ]);
}

export function encodeEd25519YaoLaneJobTranscriptV1(value: Ed25519YaoLaneJobV1): Uint8Array {
  const target =
    value.target.operation === 'create_lane'
      ? concat([
          text(value.target.operation, 'target.operation'),
          text(value.target.laneKind, 'target.laneKind'),
          text(value.target.expectedTargetState, 'target.expectedTargetState'),
        ])
      : concat([
          text(value.target.operation, 'target.operation'),
          text(value.target.laneKind, 'target.laneKind'),
          text(value.target.expectedTargetState, 'target.expectedTargetState'),
          activation(value.target.priorMaterialActivation),
        ]);
  const authorization =
    value.authorization.kind === 'linked_device_enrollment'
      ? concat([
          text(value.authorization.kind, 'authorization.kind'),
          text(value.authorization.authorizedOperationId, 'authorization.authorizedOperationId'),
          text(
            value.authorization.linkedDeviceEnrollmentId,
            'authorization.linkedDeviceEnrollmentId',
          ),
          text(
            value.authorization.linkedDevicePermissionDigestB64u,
            'authorization.linkedDevicePermissionDigestB64u',
          ),
        ])
      : concat([
          text(value.authorization.kind, 'authorization.kind'),
          text(value.authorization.authorizedOperationId, 'authorization.authorizedOperationId'),
          text(
            value.authorization.ownerLaneRefreshDigestB64u,
            'authorization.ownerLaneRefreshDigestB64u',
          ),
        ]);
  return concat([
    recordDomain(ED25519_JOB_TRANSCRIPT_DOMAIN),
    text(value.kind, 'kind'),
    text(value.yaoRequestKind, 'yaoRequestKind'),
    text(value.operationId, 'operationId'),
    text(value.enrollmentId, 'enrollmentId'),
    text(value.idempotencyKey, 'idempotencyKey'),
    text(value.walletId, 'walletId'),
    text(value.walletKeyId, 'walletKeyId'),
    encodeSource(value.source),
    target,
    text(value.target.laneId, 'target.laneId'),
    text(value.target.laneShareEpoch, 'target.laneShareEpoch'),
    text(value.targetMaterialActivationId, 'targetMaterialActivationId'),
    text(value.targetHolder.participantId, 'targetHolder.participantId'),
    text(
      value.targetHolder.participantBindingDigestB64u,
      'targetHolder.participantBindingDigestB64u',
    ),
    text(value.targetHolder.custodyBindingId, 'targetHolder.custodyBindingId'),
    text(value.targetHolder.custodyBindingDigestB64u, 'targetHolder.custodyBindingDigestB64u'),
    text(value.targetHolder.hpkePublicKeyB64u, 'targetHolder.hpkePublicKeyB64u'),
    text(value.targetHolder.hpkePublicKeyDigestB64u, 'targetHolder.hpkePublicKeyDigestB64u'),
    text(value.targetSigningWorker.participantId, 'targetSigningWorker.participantId'),
    text(
      value.targetSigningWorker.participantBindingDigestB64u,
      'targetSigningWorker.participantBindingDigestB64u',
    ),
    text(value.targetSigningWorker.recipientKeyId, 'targetSigningWorker.recipientKeyId'),
    text(value.targetSigningWorker.hpkePublicKeyB64u, 'targetSigningWorker.hpkePublicKeyB64u'),
    text(
      value.targetSigningWorker.hpkePublicKeyDigestB64u,
      'targetSigningWorker.hpkePublicKeyDigestB64u',
    ),
    authorization,
    text(value.registeredPublicKeyB64u, 'registeredPublicKeyB64u'),
    u64(value.keyCreationSignerSlot, 'keyCreationSignerSlot'),
    text(value.stableContextBindingB64u, 'stableContextBindingB64u'),
    text(value.nearEd25519SigningKeyId, 'nearEd25519SigningKeyId'),
    text(value.yaoSuiteId, 'yaoSuiteId'),
    text(value.circuitDigestB64u, 'circuitDigestB64u'),
    text(value.protocolVersion, 'protocolVersion'),
    u64(value.expiresAtMs, 'expiresAtMs'),
  ]);
}

export async function computeEd25519YaoLaneSessionDigestV1(
  value: Ed25519YaoLaneJobV1,
): Promise<string> {
  const jobDigest = await sha256Bytes(encodeEd25519YaoLaneJobTranscriptV1(value));
  return base64UrlEncode(
    await sha256Bytes(concat([TEXT_ENCODER.encode(ED25519_SESSION_DOMAIN), jobDigest])),
  );
}

function encodeManifestChild(value: LaneEnrollmentManifestChildV1): Uint8Array {
  return concat([
    text(value.operationId, 'child.operationId'),
    text(value.walletKeyId, 'child.walletKeyId'),
    text(value.keyFamily, 'child.keyFamily'),
    text(value.sourceLaneId, 'child.sourceLaneId'),
    text(value.sourceLaneShareEpoch, 'child.sourceLaneShareEpoch'),
    u64(value.sourceRevocationEpoch, 'child.sourceRevocationEpoch'),
    activationField(value.sourceMaterialActivation, 'child.sourceMaterialActivation'),
    text(value.targetLaneId, 'child.targetLaneId'),
    text(value.targetLaneShareEpoch, 'child.targetLaneShareEpoch'),
    text(value.targetMaterialActivationId, 'child.targetMaterialActivationId'),
    digest(value.holderParticipantBindingDigestB64u, 'child.holderParticipantBindingDigestB64u'),
    digest(
      value.signingWorkerParticipantBindingDigestB64u,
      'child.signingWorkerParticipantBindingDigestB64u',
    ),
  ]);
}

export function encodeLaneEnrollmentManifestV1(value: LaneEnrollmentManifestV1): Uint8Array {
  const children = value.orderedChildren.map(encodeManifestChild);
  return concat([
    recordDomain(ENROLLMENT_MANIFEST_DOMAIN),
    text(value.enrollmentId, 'enrollmentId'),
    text(value.walletId, 'walletId'),
    lp32(encodeAuthorization(value.authorization), 'authorization'),
    u64(value.createdAtMs, 'createdAtMs'),
    u64(value.expiresAtMs, 'expiresAtMs'),
    u32(children.length, 'orderedChildren'),
    ...children.map((child) => lp32(child, 'orderedChildren.item')),
  ]);
}

export async function computeLaneEnrollmentManifestDigestV1(
  value: LaneEnrollmentManifestV1,
): Promise<string> {
  return base64UrlEncode(await sha256Bytes(encodeLaneEnrollmentManifestV1(value)));
}

function encodeActivationChild(value: AggregateLaneActivationChildReceiptV1): Uint8Array {
  return concat([
    text(value.operationId, 'child.operationId'),
    text(value.walletKeyId, 'child.walletKeyId'),
    text(value.targetLaneId, 'child.targetLaneId'),
    text(value.targetLaneShareEpoch, 'child.targetLaneShareEpoch'),
    activationField(value.targetMaterialActivation, 'child.targetMaterialActivation'),
    digest(value.protocolCommitReceiptDigestB64u, 'child.protocolCommitReceiptDigestB64u'),
    digest(value.holderDeliveryReceiptDigestB64u, 'child.holderDeliveryReceiptDigestB64u'),
    digest(value.serverActivationReceiptDigestB64u, 'child.serverActivationReceiptDigestB64u'),
  ]);
}

export function encodeAggregateLaneActivationReceiptV1(
  value: AggregateLaneActivationReceiptV1,
): Uint8Array {
  const children = value.orderedChildReceipts.map(encodeActivationChild);
  return concat([
    recordDomain(AGGREGATE_ACTIVATION_DOMAIN),
    text(value.enrollmentId, 'enrollmentId'),
    text(value.walletId, 'walletId'),
    digest(value.manifestDigestB64u, 'manifestDigestB64u'),
    u64(value.activatedAtMs, 'activatedAtMs'),
    u32(children.length, 'orderedChildReceipts'),
    ...children.map((child) => lp32(child, 'orderedChildReceipts.item')),
  ]);
}

export async function computeAggregateLaneActivationReceiptDigestV1(
  value: AggregateLaneActivationReceiptV1,
): Promise<string> {
  return base64UrlEncode(await sha256Bytes(encodeAggregateLaneActivationReceiptV1(value)));
}

function encodeRevocationChild(value: AggregateLaneRevocationChildReceiptV1): Uint8Array {
  return concat([
    text(value.operationId, 'child.operationId'),
    text(value.walletKeyId, 'child.walletKeyId'),
    text(value.targetLaneId, 'child.targetLaneId'),
    text(value.targetLaneShareEpoch, 'child.targetLaneShareEpoch'),
    activationField(value.targetMaterialActivation, 'child.targetMaterialActivation'),
    u64(value.revocationEpoch, 'child.revocationEpoch'),
    digest(value.retirementReceiptDigestB64u, 'child.retirementReceiptDigestB64u'),
  ]);
}

export function encodeAggregateLaneRevocationReceiptV1(
  value: AggregateLaneRevocationReceiptV1,
): Uint8Array {
  const children = value.orderedChildReceipts.map(encodeRevocationChild);
  return concat([
    recordDomain(AGGREGATE_REVOCATION_DOMAIN),
    text(value.enrollmentId, 'enrollmentId'),
    text(value.walletId, 'walletId'),
    digest(value.manifestDigestB64u, 'manifestDigestB64u'),
    u64(value.revokedAtMs, 'revokedAtMs'),
    u32(children.length, 'orderedChildReceipts'),
    ...children.map((child) => lp32(child, 'orderedChildReceipts.item')),
  ]);
}

export async function computeAggregateLaneRevocationReceiptDigestV1(
  value: AggregateLaneRevocationReceiptV1,
): Promise<string> {
  return base64UrlEncode(await sha256Bytes(encodeAggregateLaneRevocationReceiptV1(value)));
}

export function encodeRevokeSigningLaneV1(value: RevokeSigningLaneV1): Uint8Array {
  return concat([
    recordDomain('seams/rotatable-signing-lanes/revoke-signing-lane/v1'),
    text(value.walletId, 'walletId'),
    text(value.walletKeyId, 'walletKeyId'),
    text(value.laneId, 'laneId'),
    text(value.laneShareEpoch, 'laneShareEpoch'),
    u64(value.expectedRevocationEpoch, 'expectedRevocationEpoch'),
    text(value.reason, 'reason'),
    text(value.retirementCorrelationId, 'retirementCorrelationId'),
    digest(value.retirementRequestDigestB64u, 'retirementRequestDigestB64u'),
    digest(value.retirementEffectBindingDigestB64u, 'retirementEffectBindingDigestB64u'),
    u64(value.requestedAtMs, 'requestedAtMs'),
  ]);
}

export async function computeRevokeSigningLaneDigestV1(
  value: RevokeSigningLaneV1,
): Promise<string> {
  return base64UrlEncode(await sha256Bytes(encodeRevokeSigningLaneV1(value)));
}

export function encodeLaneProtocolCommitReceiptV1(
  value: import('./rotation').LaneProtocolCommitReceiptV1,
): Uint8Array {
  return concat([
    recordDomain(PROTOCOL_COMMIT_RECEIPT_DOMAIN),
    text(value.operationId, 'operationId'),
    text(value.enrollmentId, 'enrollmentId'),
    text(value.walletId, 'walletId'),
    text(value.walletKeyId, 'walletKeyId'),
    text(value.sourceLaneId, 'sourceLaneId'),
    text(value.sourceLaneShareEpoch, 'sourceLaneShareEpoch'),
    u64(value.sourceRevocationEpoch, 'sourceRevocationEpoch'),
    activationField(value.sourceMaterialActivation, 'sourceMaterialActivation'),
    text(value.targetLaneId, 'targetLaneId'),
    text(value.targetLaneShareEpoch, 'targetLaneShareEpoch'),
    text(value.targetMaterialActivationId, 'targetMaterialActivationId'),
    text(value.keyFamily, 'keyFamily'),
    digest(value.publicIdentityDigestB64u, 'publicIdentityDigestB64u'),
    text(value.targetHolderPublicCommitmentB64u, 'targetHolderPublicCommitmentB64u'),
    text(value.targetServerPublicCommitmentB64u, 'targetServerPublicCommitmentB64u'),
    digest(value.targetHolderCiphertextDigestSetB64u, 'targetHolderCiphertextDigestSetB64u'),
    digest(value.targetServerCiphertextDigestSetB64u, 'targetServerCiphertextDigestSetB64u'),
    digest(value.holderRecipientKeyDigestB64u, 'holderRecipientKeyDigestB64u'),
    digest(value.serverRecipientKeyDigestB64u, 'serverRecipientKeyDigestB64u'),
    digest(value.transcriptHashB64u, 'transcriptHashB64u'),
    u64(value.committedAtMs, 'committedAtMs'),
  ]);
}

export function encodeLaneHolderDeliveryReceiptV1(
  value: import('./rotation').LaneHolderDeliveryReceiptV1,
): Uint8Array {
  return concat([
    recordDomain(HOLDER_DELIVERY_RECEIPT_DOMAIN),
    text(value.operationId, 'operationId'),
    text(value.enrollmentId, 'enrollmentId'),
    text(value.targetLaneId, 'targetLaneId'),
    text(value.targetLaneShareEpoch, 'targetLaneShareEpoch'),
    text(value.targetMaterialActivationId, 'targetMaterialActivationId'),
    digest(value.holderParticipantBindingDigestB64u, 'holderParticipantBindingDigestB64u'),
    digest(value.holderRecipientKeyDigestB64u, 'holderRecipientKeyDigestB64u'),
    digest(value.holderCiphertextDigestSetB64u, 'holderCiphertextDigestSetB64u'),
    digest(value.sealedHolderRecordDigestB64u, 'sealedHolderRecordDigestB64u'),
    digest(value.transcriptHashB64u, 'transcriptHashB64u'),
    u64(value.acknowledgedAtMs, 'acknowledgedAtMs'),
  ]);
}

export function encodeLaneServerActivationReceiptV1(
  value: import('./rotation').LaneServerActivationReceiptV1,
): Uint8Array {
  return concat([
    recordDomain(SERVER_ACTIVATION_RECEIPT_DOMAIN),
    text(value.operationId, 'operationId'),
    text(value.enrollmentId, 'enrollmentId'),
    text(value.targetLaneId, 'targetLaneId'),
    text(value.targetLaneShareEpoch, 'targetLaneShareEpoch'),
    activationField(value.targetMaterialActivation, 'targetMaterialActivation'),
    digest(
      value.signingWorkerParticipantBindingDigestB64u,
      'signingWorkerParticipantBindingDigestB64u',
    ),
    digest(value.serverCiphertextDigestSetB64u, 'serverCiphertextDigestSetB64u'),
    digest(value.transcriptHashB64u, 'transcriptHashB64u'),
    u64(value.activatedAtMs, 'activatedAtMs'),
  ]);
}

export function encodeEcdsaServerRetirementReceiptCanonicalPayloadV1(
  value: EcdsaServerRetirementReceiptV1,
): Uint8Array {
  return concat([
    recordDomain(ECDSA_RETIREMENT_RECEIPT_DOMAIN),
    text(value.kind, 'kind'),
    text(value.manifest.manifestId, 'manifest.manifestId'),
    u64(value.manifest.manifestRevision, 'manifest.manifestRevision'),
    activationField(value.materialActivation, 'materialActivation'),
    text(value.walletKeyId, 'walletKeyId'),
    text(value.laneId, 'laneId'),
    text(value.laneShareEpoch, 'laneShareEpoch'),
    u64(value.revocationEpoch, 'revocationEpoch'),
    text(value.retirementReason, 'retirementReason'),
    text(value.retirementCorrelationId, 'retirementCorrelationId'),
    digest(value.retirementRequestDigestB64u, 'retirementRequestDigestB64u'),
    text(value.serverGeneration, 'serverGeneration'),
    text(value.lifecycleId, 'lifecycleId'),
    text(value.retiredAt, 'retiredAt'),
  ]);
}

export async function computeEcdsaServerRetirementReceiptDigestV1(
  value: EcdsaServerRetirementReceiptV1,
): Promise<DigestB64u> {
  return parseDigestB64u(
    base64UrlEncode(await sha256Bytes(encodeEcdsaServerRetirementReceiptCanonicalPayloadV1(value))),
  );
}

export function encodeSigningWorkerLaneMaterialIdentityV1(
  value: SigningWorkerLaneMaterialIdentityV1,
): Uint8Array {
  return concat([
    text(value.operationId, 'identity.operationId'),
    text(value.enrollmentId, 'identity.enrollmentId'),
    text(value.walletId, 'identity.walletId'),
    text(value.walletKeyId, 'identity.walletKeyId'),
    text(value.targetLaneId, 'identity.targetLaneId'),
    text(value.targetLaneShareEpoch, 'identity.targetLaneShareEpoch'),
    text(value.targetMaterialActivationId, 'identity.targetMaterialActivationId'),
    text(value.keyFamily, 'identity.keyFamily'),
    digest(value.holderParticipantBindingDigestB64u, 'identity.holderParticipantBindingDigestB64u'),
    digest(
      value.signingWorkerParticipantBindingDigestB64u,
      'identity.signingWorkerParticipantBindingDigestB64u',
    ),
    digest(value.holderRecipientKeyDigestB64u, 'identity.holderRecipientKeyDigestB64u'),
    digest(value.serverRecipientKeyDigestB64u, 'identity.serverRecipientKeyDigestB64u'),
    digest(value.transcriptHashB64u, 'identity.transcriptHashB64u'),
    digest(value.protocolCommitReceiptDigestB64u, 'identity.protocolCommitReceiptDigestB64u'),
  ]);
}

export function encodeEd25519ServerRetirementReceiptCanonicalPayloadV1(
  value: Ed25519ServerRetirementReceiptV1,
): Uint8Array {
  return concat([
    recordDomain(ED25519_RETIREMENT_RECEIPT_DOMAIN),
    text(value.kind, 'kind'),
    encodeSigningWorkerLaneMaterialIdentityV1(value.identity),
    u64(value.revocationEpoch, 'revocationEpoch'),
    text(value.retirementReason, 'retirementReason'),
    text(value.retirementCorrelationId, 'retirementCorrelationId'),
    digest(value.retirementRequestDigestB64u, 'retirementRequestDigestB64u'),
    u64(value.retiredAtMs, 'retiredAtMs'),
  ]);
}

export async function computeEd25519ServerRetirementReceiptDigestV1(
  value: Ed25519ServerRetirementReceiptV1,
): Promise<DigestB64u> {
  return parseDigestB64u(
    base64UrlEncode(
      await sha256Bytes(encodeEd25519ServerRetirementReceiptCanonicalPayloadV1(value)),
    ),
  );
}
