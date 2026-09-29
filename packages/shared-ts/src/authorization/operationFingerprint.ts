import { base64UrlEncode } from '../utils/base64';
import type { DigestB64u } from '../utils/canonicalPrimitives';
import { parseDigestB64u } from '../utils/canonicalPrimitives';
import { alphabetizeStringify, sha256BytesUtf8 } from '../utils/digests';
import type {
  CapabilityId,
  CapabilityOperationId,
  CapabilityOperationRef,
  PrincipalId,
  TenantId,
} from './capabilityKinds';

const CAPABILITY_OPERATION_FINGERPRINT_DOMAIN_V1 =
  'seams:authorization:capability-operation-fingerprint:v1';

declare const capabilityOperationFingerprintDigestBrand: unique symbol;

export type CapabilityOperationFingerprintDigest = DigestB64u & {
  readonly [capabilityOperationFingerprintDigestBrand]: true;
};

export type OperationDigestSet = {
  readonly laneDigest: DigestB64u;
  readonly intentDigest: DigestB64u;
  readonly displayDigest: DigestB64u;
};

type CapabilityOperationEnvelopeFields<
  TOperation extends CapabilityOperationRef = CapabilityOperationRef,
> = {
  readonly tenantId: TenantId;
  readonly principalId: PrincipalId;
  readonly capabilityId: CapabilityId;
  readonly operationId: CapabilityOperationId;
  readonly operation: TOperation;
  readonly digests: OperationDigestSet;
};

class CapabilityOperationEnvelopeProof<
  TOperation extends CapabilityOperationRef = CapabilityOperationRef,
> {
  readonly tenantId: TenantId;
  readonly principalId: PrincipalId;
  readonly capabilityId: CapabilityId;
  readonly operationId: CapabilityOperationId;
  readonly operation: TOperation;
  readonly digests: OperationDigestSet;

  private retainProof(): true {
    return true;
  }

  constructor(fields: CapabilityOperationEnvelopeFields<TOperation>) {
    void this.retainProof();
    this.tenantId = fields.tenantId;
    this.principalId = fields.principalId;
    this.capabilityId = fields.capabilityId;
    this.operationId = fields.operationId;
    this.operation = fields.operation;
    this.digests = fields.digests;
  }
}

export type CapabilityOperationEnvelope<
  TOperation extends CapabilityOperationRef = CapabilityOperationRef,
> = CapabilityOperationEnvelopeProof<TOperation>;

export function buildCapabilityOperationEnvelope<TOperation extends CapabilityOperationRef>(
  fields: CapabilityOperationEnvelopeFields<TOperation>,
): CapabilityOperationEnvelope<TOperation> {
  return new CapabilityOperationEnvelopeProof({
    tenantId: fields.tenantId,
    principalId: fields.principalId,
    capabilityId: fields.capabilityId,
    operationId: fields.operationId,
    operation: fields.operation,
    digests: {
      laneDigest: fields.digests.laneDigest,
      intentDigest: fields.digests.intentDigest,
      displayDigest: fields.digests.displayDigest,
    },
  });
}

export function canonicalCapabilityOperationFingerprintPreimageV1(
  envelope: CapabilityOperationEnvelope,
): string {
  return `${CAPABILITY_OPERATION_FINGERPRINT_DOMAIN_V1}|${alphabetizeStringify({
    tenantId: envelope.tenantId,
    principalId: envelope.principalId,
    capabilityId: envelope.capabilityId,
    operationId: envelope.operationId,
    operation: envelope.operation,
    digests: envelope.digests,
  })}`;
}

export async function computeCapabilityOperationFingerprintDigest(
  envelope: CapabilityOperationEnvelope,
): Promise<CapabilityOperationFingerprintDigest> {
  const digest = base64UrlEncode(
    await sha256BytesUtf8(canonicalCapabilityOperationFingerprintPreimageV1(envelope)),
  );
  return parseCapabilityOperationFingerprintDigest(digest);
}

export function parseCapabilityOperationFingerprintDigest(
  value: unknown,
): CapabilityOperationFingerprintDigest {
  return parseDigestB64u(value) as CapabilityOperationFingerprintDigest;
}

export function parseSigningOperationFingerprintDigest(value: unknown): DigestB64u {
  if (typeof value !== 'string' || !value.startsWith('sha256:')) {
    throw new Error('signing operation fingerprint must use the sha256: prefix');
  }
  return parseDigestB64u(value.slice('sha256:'.length));
}
