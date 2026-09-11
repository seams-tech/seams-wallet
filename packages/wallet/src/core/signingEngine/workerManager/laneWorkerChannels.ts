import type {
  LaneHolderPackageWireV1,
  LaneHolderRecipientHandleV1,
  LaneHolderRecipientWorkerV1,
  RotatableSigningLaneJobV1,
} from '@shared/signing-lanes/rotation';
import type { LaneProtocolCommitReceiptV1 } from '@shared/signing-lanes/rotation';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { parseDigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  parseLaneHolderRecipientHandleV1,
  parseLaneOperationId,
  parseMpcMaterialActivationId,
} from '@shared/utils/domainIds';
import {
  parseLaneHolderPackageWireV1,
  parseLaneProtocolCommitReceiptV1,
  parseRotatableSigningLaneJobV1,
} from '@shared/signing-lanes/rotationParsers';
import {
  parseHpkePublicKeyB64u,
  parseLaneCustodyBindingDigestB64u,
  parseLaneHolderCustodyBindingId,
  parseLaneHolderParticipantId,
  parseSigningWorkerRecipientKeyDigestB64u,
  type HpkePublicKeyB64u,
  type SigningWorkerRecipientKeyDigestB64u,
} from '@shared/signing-lanes/participants';
import { computeLaneHolderParticipantBindingDigestV1 } from '@shared/signing-lanes/participantDigest';
import {
  parseLaneEnrollmentId,
  parseLaneShareEpoch,
  parseSigningLaneId,
  parseWalletKeyId,
  type LaneOperationId,
} from '@shared/signing-lanes/ids';
import { parseMpcMaterialActivationRef } from '@shared/utils/domainIds';

type CreateRecipientInputV1 = Parameters<
  LaneHolderRecipientWorkerV1['createLaneHolderRecipientV1']
>[0];

export type LaneWorkerChannelRequestV1 =
  | {
      readonly kind: 'lane_holder_recipient_create_v1';
      readonly input: CreateRecipientInputV1;
    }
  | {
      readonly kind: 'lane_holder_package_open_seal_v1';
      readonly job: RotatableSigningLaneJobV1;
      readonly protocolCommitReceipt: LaneProtocolCommitReceiptV1;
      readonly holderPackage: LaneHolderPackageWireV1;
      readonly recipientHandle: LaneHolderRecipientHandleV1;
    }
  | {
      readonly kind: 'lane_holder_package_verify_v1';
      readonly job: RotatableSigningLaneJobV1;
      readonly protocolCommitReceipt: LaneProtocolCommitReceiptV1;
      readonly holderPackage: LaneHolderPackageWireV1;
    }
  | {
      readonly kind: 'lane_holder_recipient_discard_v1';
      readonly recipientHandle: LaneHolderRecipientHandleV1;
      readonly operationId: LaneOperationId;
    }
  | {
      readonly kind: 'lane_material_invalidate_v1';
      readonly walletKeyId: Parameters<
        LaneHolderRecipientWorkerV1['invalidateLaneMaterialV1']
      >[0]['walletKeyId'];
      readonly laneId: Parameters<
        LaneHolderRecipientWorkerV1['invalidateLaneMaterialV1']
      >[0]['laneId'];
      readonly laneShareEpoch: Parameters<
        LaneHolderRecipientWorkerV1['invalidateLaneMaterialV1']
      >[0]['laneShareEpoch'];
      readonly materialActivation: Parameters<
        LaneHolderRecipientWorkerV1['invalidateLaneMaterialV1']
      >[0]['materialActivation'];
    };

export type LaneWorkerChannelTransportV1 = {
  request(input: LaneWorkerChannelRequestV1): Promise<unknown>;
};

export type LaneHolderWorkerEndpointV1 = {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  terminate(): void;
};

export type LaneHolderWorkerTransportV1 = LaneWorkerChannelTransportV1 & {
  close(): void;
};

type LaneWorkerPendingRequestV1 = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type LaneWorkerResponseFrameV1 =
  | { readonly id: string; readonly ok: true; readonly result: unknown }
  | { readonly id: string; readonly ok: false; readonly error: string };

type LaneRecipientCreateInputRecordV1 = {
  readonly operationId: unknown;
  readonly enrollmentId: unknown;
  readonly walletKeyId: unknown;
  readonly targetLaneId: unknown;
  readonly targetLaneShareEpoch: unknown;
  readonly targetMaterialActivationId: unknown;
  readonly targetHolderParticipantId: unknown;
  readonly custodyBindingId: unknown;
  readonly custodyBindingDigestB64u: unknown;
};

function isLaneRecipientCreateInputRecordV1(
  value: unknown,
): value is LaneRecipientCreateInputRecordV1 {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('|') ===
      'custodyBindingDigestB64u|custodyBindingId|enrollmentId|operationId|targetHolderParticipantId|targetLaneId|targetLaneShareEpoch|targetMaterialActivationId|walletKeyId'
  );
}

type LaneRecipientCreateRequestRecordV1 = {
  readonly kind: unknown;
  readonly input: unknown;
};

function isLaneRecipientCreateRequestRecordV1(
  value: unknown,
): value is LaneRecipientCreateRequestRecordV1 {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === 'input|kind'
  );
}

type LanePackageOpenSealRequestRecordV1 = {
  readonly kind: unknown;
  readonly job: unknown;
  readonly protocolCommitReceipt: unknown;
  readonly holderPackage: unknown;
  readonly recipientHandle: unknown;
};

function isLanePackageOpenSealRequestRecordV1(
  value: unknown,
): value is LanePackageOpenSealRequestRecordV1 {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('|') ===
      'holderPackage|job|kind|protocolCommitReceipt|recipientHandle'
  );
}

type LanePackageVerifyRequestRecordV1 = {
  readonly kind: unknown;
  readonly job: unknown;
  readonly protocolCommitReceipt: unknown;
  readonly holderPackage: unknown;
};

function isLanePackageVerifyRequestRecordV1(
  value: unknown,
): value is LanePackageVerifyRequestRecordV1 {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === 'holderPackage|job|kind|protocolCommitReceipt'
  );
}

type LaneRecipientDiscardRequestRecordV1 = {
  readonly kind: unknown;
  readonly recipientHandle: unknown;
  readonly operationId: unknown;
};

function isLaneRecipientDiscardRequestRecordV1(
  value: unknown,
): value is LaneRecipientDiscardRequestRecordV1 {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === 'kind|operationId|recipientHandle'
  );
}

type LaneMaterialInvalidateRequestRecordV1 = {
  readonly kind: unknown;
  readonly walletKeyId: unknown;
  readonly laneId: unknown;
  readonly laneShareEpoch: unknown;
  readonly materialActivation: unknown;
};

function isLaneMaterialInvalidateRequestRecordV1(
  value: unknown,
): value is LaneMaterialInvalidateRequestRecordV1 {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('|') ===
      'kind|laneId|laneShareEpoch|materialActivation|walletKeyId'
  );
}

type LaneRecipientCreateResponseRecordV1 = {
  readonly recipientHandle: unknown;
  readonly hpkePublicKeyB64u: unknown;
  readonly hpkePublicKeyDigestB64u: unknown;
};

function isLaneRecipientCreateResponseRecordV1(
  value: unknown,
): value is LaneRecipientCreateResponseRecordV1 {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('|') ===
      'hpkePublicKeyB64u|hpkePublicKeyDigestB64u|recipientHandle'
  );
}

type LanePackageSealResponseRecordV1 = {
  readonly sealedHolderMaterialB64u: unknown;
  readonly sealedHolderRecordDigestB64u: unknown;
  readonly verifiedHolderCiphertextDigestSetB64u: unknown;
};

function isLanePackageSealResponseRecordV1(
  value: unknown,
): value is LanePackageSealResponseRecordV1 {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('|') ===
      'sealedHolderMaterialB64u|sealedHolderRecordDigestB64u|verifiedHolderCiphertextDigestSetB64u'
  );
}

type LanePackageVerifyResponseRecordV1 = {
  readonly verifiedHolderCiphertextDigestSetB64u: unknown;
};

function isLanePackageVerifyResponseRecordV1(
  value: unknown,
): value is LanePackageVerifyResponseRecordV1 {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === 'verifiedHolderCiphertextDigestSetB64u'
  );
}

type LaneWorkerSuccessFrameRecordV1 = {
  readonly id: unknown;
  readonly ok: true;
  readonly result: unknown;
};

function isLaneWorkerSuccessFrameRecordV1(value: unknown): value is LaneWorkerSuccessFrameRecordV1 {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === 'id|ok|result' &&
    'ok' in value &&
    value.ok === true
  );
}

type LaneWorkerFailureFrameRecordV1 = {
  readonly id: unknown;
  readonly ok: false;
  readonly error: unknown;
};

function isLaneWorkerFailureFrameRecordV1(value: unknown): value is LaneWorkerFailureFrameRecordV1 {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === 'error|id|ok' &&
    'ok' in value &&
    value.ok === false
  );
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function parseHandle(value: unknown): LaneHolderRecipientHandleV1 {
  const result = parseLaneHolderRecipientHandleV1(value);
  if (result.ok) return result.value;
  throw new Error(result.error.message);
}

function parseOperationId(value: unknown): CreateRecipientInputV1['operationId'] {
  const result = parseLaneOperationId(value);
  if (result.ok) return result.value;
  throw new Error(result.error.message);
}

function parsedDomainValue<T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
  label: string,
): T {
  if (result.ok) return result.value;
  throw new Error(`${label} ${result.error.message}`);
}

function parseJob(value: unknown): RotatableSigningLaneJobV1 {
  return parseRotatableSigningLaneJobV1(value);
}

function parseCommit(value: unknown): LaneProtocolCommitReceiptV1 {
  return parseLaneProtocolCommitReceiptV1(value);
}

function parseCreateRecipientInput(value: unknown): CreateRecipientInputV1 {
  if (!isLaneRecipientCreateInputRecordV1(value)) {
    throw new Error('lane recipient-create input has invalid fields');
  }
  const input = value;
  return {
    operationId: parseOperationId(input.operationId),
    enrollmentId: parsedDomainValue(
      parseLaneEnrollmentId(input.enrollmentId),
      'lane recipient-create enrollmentId',
    ),
    walletKeyId: parsedDomainValue(
      parseWalletKeyId(input.walletKeyId),
      'lane recipient-create walletKeyId',
    ),
    targetLaneId: parsedDomainValue(
      parseSigningLaneId(input.targetLaneId),
      'lane recipient-create targetLaneId',
    ),
    targetLaneShareEpoch: parsedDomainValue(
      parseLaneShareEpoch(input.targetLaneShareEpoch),
      'lane recipient-create targetLaneShareEpoch',
    ),
    targetMaterialActivationId: parsedDomainValue(
      parseMpcMaterialActivationId(input.targetMaterialActivationId),
      'lane recipient-create targetMaterialActivationId',
    ),
    targetHolderParticipantId: parsedDomainValue(
      parseLaneHolderParticipantId(input.targetHolderParticipantId),
      'lane recipient-create targetHolderParticipantId',
    ),
    custodyBindingId: parsedDomainValue(
      parseLaneHolderCustodyBindingId(input.custodyBindingId),
      'lane recipient-create custodyBindingId',
    ),
    custodyBindingDigestB64u: parsedDomainValue(
      parseLaneCustodyBindingDigestB64u(input.custodyBindingDigestB64u),
      'lane recipient-create custodyBindingDigestB64u',
    ),
  };
}

function parseLaneWorkerChannelRequestV1(value: unknown): LaneWorkerChannelRequestV1 {
  if (isLaneRecipientCreateRequestRecordV1(value)) {
    if (value.kind !== 'lane_holder_recipient_create_v1') {
      throw new Error('lane holder worker request.kind is invalid');
    }
    return {
      kind: 'lane_holder_recipient_create_v1',
      input: parseCreateRecipientInput(value.input),
    };
  }
  if (isLanePackageOpenSealRequestRecordV1(value)) {
    if (value.kind !== 'lane_holder_package_open_seal_v1') {
      throw new Error('lane holder worker request.kind is invalid');
    }
    return {
      kind: 'lane_holder_package_open_seal_v1',
      job: parseJob(value.job),
      protocolCommitReceipt: parseCommit(value.protocolCommitReceipt),
      holderPackage: parseLaneHolderPackageWireV1(value.holderPackage),
      recipientHandle: parseHandle(value.recipientHandle),
    };
  }
  if (isLanePackageVerifyRequestRecordV1(value)) {
    if (value.kind !== 'lane_holder_package_verify_v1') {
      throw new Error('lane holder worker request.kind is invalid');
    }
    return {
      kind: 'lane_holder_package_verify_v1',
      job: parseJob(value.job),
      protocolCommitReceipt: parseCommit(value.protocolCommitReceipt),
      holderPackage: parseLaneHolderPackageWireV1(value.holderPackage),
    };
  }
  if (isLaneRecipientDiscardRequestRecordV1(value)) {
    if (value.kind !== 'lane_holder_recipient_discard_v1') {
      throw new Error('lane holder worker request.kind is invalid');
    }
    return {
      kind: 'lane_holder_recipient_discard_v1',
      recipientHandle: parseHandle(value.recipientHandle),
      operationId: parseOperationId(value.operationId),
    };
  }
  if (isLaneMaterialInvalidateRequestRecordV1(value)) {
    if (value.kind !== 'lane_material_invalidate_v1') {
      throw new Error('lane holder worker request.kind is invalid');
    }
    return {
      kind: 'lane_material_invalidate_v1',
      walletKeyId: parsedDomainValue(
        parseWalletKeyId(value.walletKeyId),
        'lane material invalidation walletKeyId',
      ),
      laneId: parsedDomainValue(
        parseSigningLaneId(value.laneId),
        'lane material invalidation laneId',
      ),
      laneShareEpoch: parsedDomainValue(
        parseLaneShareEpoch(value.laneShareEpoch),
        'lane material invalidation laneShareEpoch',
      ),
      materialActivation: parsedDomainValue(
        parseMpcMaterialActivationRef(value.materialActivation),
        'lane material invalidation materialActivation',
      ),
    };
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('lane holder worker request must be an object');
  }
  if ('kind' in value && value.kind === 'lane_holder_recipient_create_v1') {
    const unexpected = Object.keys(value).find((field) => field !== 'kind' && field !== 'input');
    if (unexpected) throw new Error(`lane holder worker request.${unexpected} is not supported`);
  }
  throw new Error('lane holder worker request.kind is invalid');
}

function parseHpkeKey(value: unknown): HpkePublicKeyB64u {
  const result = parseHpkePublicKeyB64u(value);
  if (result.ok) return result.value;
  throw new Error(result.error.message);
}

function parseRecipientDigest(value: unknown): SigningWorkerRecipientKeyDigestB64u {
  const result = parseSigningWorkerRecipientKeyDigestB64u(value);
  if (result.ok) return result.value;
  throw new Error(result.error.message);
}

function parseDigest(value: unknown, label: string): DigestB64u {
  try {
    return parseDigestB64u(value);
  } catch (error) {
    throw new Error(`${label} ${error instanceof Error ? error.message : 'is invalid'}`);
  }
}

function parseOpaqueB64u(value: unknown, label: string): string {
  const normalized = nonEmpty(value, label);
  try {
    const bytes = base64UrlDecode(normalized);
    if (base64UrlEncode(bytes) !== normalized) throw new Error('must be canonical base64url');
    return normalized;
  } catch (error) {
    throw new Error(`${label} ${error instanceof Error ? error.message : 'is invalid'}`);
  }
}

function parseCreateResponse(
  value: unknown,
): Awaited<ReturnType<LaneHolderRecipientWorkerV1['createLaneHolderRecipientV1']>> {
  if (!isLaneRecipientCreateResponseRecordV1(value)) {
    throw new Error('lane recipient-create response has invalid fields');
  }
  const response = value;
  return {
    recipientHandle: parseHandle(response.recipientHandle),
    hpkePublicKeyB64u: parseHpkeKey(response.hpkePublicKeyB64u),
    hpkePublicKeyDigestB64u: parseRecipientDigest(response.hpkePublicKeyDigestB64u),
  };
}

function parseSealResponse(
  value: unknown,
): Awaited<ReturnType<LaneHolderRecipientWorkerV1['openAndSealLaneHolderPackageV1']>> {
  if (!isLanePackageSealResponseRecordV1(value)) {
    throw new Error('lane holder-seal response has invalid fields');
  }
  const response = value;
  return {
    sealedHolderMaterialB64u: parseOpaqueB64u(
      response.sealedHolderMaterialB64u,
      'sealedHolderMaterialB64u',
    ),
    sealedHolderRecordDigestB64u: parseDigest(
      response.sealedHolderRecordDigestB64u,
      'sealedHolderRecordDigestB64u',
    ),
    verifiedHolderCiphertextDigestSetB64u: parseDigest(
      response.verifiedHolderCiphertextDigestSetB64u,
      'verifiedHolderCiphertextDigestSetB64u',
    ),
  };
}

function parseVerifyResponse(
  value: unknown,
): Awaited<ReturnType<LaneHolderRecipientWorkerV1['verifyLaneHolderPackageCommitmentV1']>> {
  if (!isLanePackageVerifyResponseRecordV1(value)) {
    throw new Error('lane holder-package verify response has invalid fields');
  }
  const response = value;
  return {
    verifiedHolderCiphertextDigestSetB64u: parseDigest(
      response.verifiedHolderCiphertextDigestSetB64u,
      'verifiedHolderCiphertextDigestSetB64u',
    ),
  };
}

export function createLaneWorkerChannelsV1(
  transport: LaneWorkerChannelTransportV1,
): LaneHolderRecipientWorkerV1 {
  return {
    async createLaneHolderRecipientV1(input) {
      return parseCreateResponse(
        await transport.request({
          kind: 'lane_holder_recipient_create_v1',
          input,
        }),
      );
    },
    async openAndSealLaneHolderPackageV1(input) {
      return parseSealResponse(
        await transport.request({
          kind: 'lane_holder_package_open_seal_v1',
          job: parseJob(input.job),
          protocolCommitReceipt: parseCommit(input.protocolCommitReceipt),
          holderPackage: parseLaneHolderPackageWireV1(input.holderPackage),
          recipientHandle: parseHandle(input.recipientHandle),
        }),
      );
    },
    async verifyLaneHolderPackageCommitmentV1(input) {
      return parseVerifyResponse(
        await transport.request({
          kind: 'lane_holder_package_verify_v1',
          job: parseJob(input.job),
          protocolCommitReceipt: parseCommit(input.protocolCommitReceipt),
          holderPackage: parseLaneHolderPackageWireV1(input.holderPackage),
        }),
      );
    },
    async discardLaneHolderRecipientV1(input) {
      await transport.request({
        kind: 'lane_holder_recipient_discard_v1',
        recipientHandle: parseHandle(input.recipientHandle),
        operationId: parseOperationId(input.operationId),
      });
    },
    async invalidateLaneMaterialV1(input) {
      await transport.request({
        kind: 'lane_material_invalidate_v1',
        walletKeyId: input.walletKeyId,
        laneId: input.laneId,
        laneShareEpoch: input.laneShareEpoch,
        materialActivation: input.materialActivation,
      });
    },
  };
}

export const createLaneHolderRecipientWorkerChannelsV1 = createLaneWorkerChannelsV1;

function parseWorkerResponseFrame(value: unknown): LaneWorkerResponseFrameV1 | null {
  if (isLaneWorkerSuccessFrameRecordV1(value)) {
    const id = value.id;
    if (typeof id !== 'string' || !id.trim()) return null;
    return { id, ok: true, result: value.result };
  }
  if (isLaneWorkerFailureFrameRecordV1(value)) {
    const id = value.id;
    if (typeof id !== 'string' || !id.trim()) return null;
    if (typeof value.error !== 'string' || !value.error.trim()) return null;
    return { id, ok: false, error: value.error };
  }
  return null;
}

function workerRequestId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return `lane-holder-${globalThis.crypto.randomUUID()}`;
  }
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.getRandomValues === 'function'
  ) {
    const entropy = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return `lane-holder-${base64UrlEncode(entropy)}`;
  }
  throw new Error('secure randomness is unavailable for lane holder worker requests');
}

function workerError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string' && value.trim()) return new Error(value);
  return new Error('lane holder worker failed');
}

/**
 * Creates the dedicated holder-worker transport. The endpoint is injectable so
 * unit tests can exercise the frame protocol without constructing a browser
 * Worker. The worker owns all crypto state; this transport only carries typed
 * requests and opaque responses.
 */
export function createLaneHolderWorkerTransportV1(
  args: {
    readonly endpoint?: LaneHolderWorkerEndpointV1;
    readonly timeoutMs?: number;
  } = {},
): LaneHolderWorkerTransportV1 {
  const endpoint = args.endpoint ?? createDefaultLaneHolderWorkerEndpoint();
  const timeoutMs = normalizeTimeout(args.timeoutMs);
  const pending = new Map<string, LaneWorkerPendingRequestV1>();
  let closed = false;

  const onMessage = (event: MessageEvent): void => {
    const frame = parseWorkerResponseFrame(event.data);
    if (!frame) return;
    const request = pending.get(frame.id);
    if (!request) return;
    clearTimeout(request.timeoutId);
    pending.delete(frame.id);
    if (frame.ok) request.resolve(frame.result);
    else request.reject(new Error(frame.error));
  };
  const onError = (event: ErrorEvent): void => {
    const error = workerError(event.message);
    for (const [id, request] of pending) {
      clearTimeout(request.timeoutId);
      pending.delete(id);
      request.reject(error);
    }
  };
  endpoint.addEventListener('message', onMessage);
  endpoint.addEventListener('error', onError);

  const close = (): void => {
    if (closed) return;
    closed = true;
    endpoint.removeEventListener('message', onMessage);
    endpoint.removeEventListener('error', onError);
    const error = new Error('lane holder worker transport is closed');
    for (const [id, request] of pending) {
      clearTimeout(request.timeoutId);
      pending.delete(id);
      request.reject(error);
    }
    endpoint.terminate();
  };

  return {
    close,
    request(input) {
      if (closed) return Promise.reject(new Error('lane holder worker transport is closed'));
      const id = workerRequestId();
      return new Promise<unknown>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`lane holder worker request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timeoutId });
        try {
          endpoint.postMessage({ id, request: input });
        } catch (error) {
          clearTimeout(timeoutId);
          pending.delete(id);
          reject(workerError(error));
        }
      });
    },
  };
}

export function createRegisteredLaneHolderRecipientWorkerV1(
  args: {
    readonly endpoint?: LaneHolderWorkerEndpointV1;
    readonly timeoutMs?: number;
  } = {},
): {
  readonly worker: LaneHolderRecipientWorkerV1;
  readonly transport: LaneHolderWorkerTransportV1;
} {
  const transport = createLaneHolderWorkerTransportV1(args);
  return {
    transport,
    worker: createLaneWorkerChannelsV1(transport),
  };
}

type LaneHolderRecipientSessionV1 = {
  state: 'open' | 'sealing' | 'sealed';
  readonly input: CreateRecipientInputV1;
  readonly descriptor: ReturnType<typeof parseCreateResponse>;
};

export type AuthorizedLaneHolderWorkerRequestHandlerV1 = {
  request(value: unknown): Promise<unknown>;
  close(): Promise<void>;
};

export type LaneHolderWorkerRequestScopeV1 = {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
};

export type InstalledLaneHolderWorkerRequestHandlerV1 = {
  close(): Promise<void>;
};

function assertSameMaterialActivation(
  left: LaneProtocolCommitReceiptV1['sourceMaterialActivation'],
  right: RotatableSigningLaneJobV1['source']['materialActivation'],
): void {
  if (
    left.kind !== right.kind ||
    String(left.activationId) !== String(right.activationId) ||
    left.capability !== right.capability ||
    left.materialOwner !== right.materialOwner ||
    left.keyBinding !== right.keyBinding ||
    left.lifecycleBinding !== right.lifecycleBinding ||
    left.signingWorker !== right.signingWorker
  ) {
    throw new Error('lane protocol receipt changed the source material activation');
  }
}

function assertProtocolCommitMatchesExactJob(
  job: RotatableSigningLaneJobV1,
  receipt: LaneProtocolCommitReceiptV1,
): void {
  if (
    String(job.operationId) !== String(receipt.operationId) ||
    String(job.enrollmentId) !== String(receipt.enrollmentId) ||
    String(job.walletId) !== String(receipt.walletId) ||
    String(job.walletKeyId) !== String(receipt.walletKeyId) ||
    String(job.source.laneId) !== String(receipt.sourceLaneId) ||
    String(job.source.laneShareEpoch) !== String(receipt.sourceLaneShareEpoch) ||
    job.source.revocationEpoch !== receipt.sourceRevocationEpoch ||
    String(job.target.laneId) !== String(receipt.targetLaneId) ||
    String(job.target.laneShareEpoch) !== String(receipt.targetLaneShareEpoch) ||
    String(job.targetMaterialActivationId) !== String(receipt.targetMaterialActivationId) ||
    job.keyFamily !== receipt.keyFamily ||
    job.targetHolder.hpkePublicKeyDigestB64u !== receipt.holderRecipientKeyDigestB64u ||
    job.targetSigningWorker.hpkePublicKeyDigestB64u !== receipt.serverRecipientKeyDigestB64u
  ) {
    throw new Error('lane holder package does not match its exact job and protocol receipt');
  }
  assertSameMaterialActivation(receipt.sourceMaterialActivation, job.source.materialActivation);
}

function assertHolderPackageFamily(
  job: RotatableSigningLaneJobV1,
  holderPackage: LaneHolderPackageWireV1,
): void {
  switch (job.keyFamily) {
    case 'ed25519':
      if (holderPackage.kind !== 'ed25519_yao_lane_holder_package_set_v1') {
        throw new Error('Ed25519 lane received an ECDSA holder package');
      }
      return;
    case 'ecdsa_secp256k1':
      if (holderPackage.kind !== 'ecdsa_additive_lane_holder_package_v1') {
        throw new Error('ECDSA lane received an Ed25519 holder package');
      }
      return;
    default:
      return assertNeverLaneJob(job);
  }
}

function assertNeverLaneJob(value: never): never {
  throw new Error(`unsupported lane holder job: ${String(value)}`);
}

async function assertRecipientSessionMatchesJob(
  session: LaneHolderRecipientSessionV1,
  job: RotatableSigningLaneJobV1,
): Promise<void> {
  const input = session.input;
  const descriptor = session.descriptor;
  const participantBindingDigestB64u = await computeLaneHolderParticipantBindingDigestV1({
    participantId: input.targetHolderParticipantId,
    custody: {
      kind: 'lane_holder_custody_identity_v1',
      custodyBindingId: input.custodyBindingId,
      custodyBindingDigestB64u: input.custodyBindingDigestB64u,
    },
    hpkePublicKeyB64u: descriptor.hpkePublicKeyB64u,
    hpkePublicKeyDigestB64u: descriptor.hpkePublicKeyDigestB64u,
  });
  if (
    String(input.operationId) !== String(job.operationId) ||
    String(input.enrollmentId) !== String(job.enrollmentId) ||
    String(input.walletKeyId) !== String(job.walletKeyId) ||
    String(input.targetLaneId) !== String(job.target.laneId) ||
    String(input.targetLaneShareEpoch) !== String(job.target.laneShareEpoch) ||
    String(input.targetMaterialActivationId) !== String(job.targetMaterialActivationId) ||
    String(input.targetHolderParticipantId) !== String(job.targetHolder.participantId) ||
    participantBindingDigestB64u !== job.targetHolder.participantBindingDigestB64u ||
    input.custodyBindingId !== job.targetHolder.custodyBindingId ||
    input.custodyBindingDigestB64u !== job.targetHolder.custodyBindingDigestB64u ||
    descriptor.hpkePublicKeyB64u !== job.targetHolder.hpkePublicKeyB64u ||
    descriptor.hpkePublicKeyDigestB64u !== job.targetHolder.hpkePublicKeyDigestB64u
  ) {
    throw new Error('lane holder recipient does not match the exact target job');
  }
}

function assertVerifiedHolderDigest(
  receipt: LaneProtocolCommitReceiptV1,
  digest: DigestB64u,
): void {
  if (receipt.targetHolderCiphertextDigestSetB64u !== digest) {
    throw new Error('lane holder package digest does not match the committed transcript');
  }
}

function sessionKey(handle: LaneHolderRecipientHandleV1): string {
  return String(handle);
}

class AuthorizedLaneHolderWorkerRequestHandler implements AuthorizedLaneHolderWorkerRequestHandlerV1 {
  readonly #backend: LaneHolderRecipientWorkerV1;
  readonly #sessions = new Map<string, LaneHolderRecipientSessionV1>();
  #closed = false;

  constructor(backend: LaneHolderRecipientWorkerV1) {
    this.#backend = backend;
  }

  async request(value: unknown): Promise<unknown> {
    if (this.#closed) throw new Error('lane holder worker request handler is closed');
    const request = parseLaneWorkerChannelRequestV1(value);
    switch (request.kind) {
      case 'lane_holder_recipient_create_v1':
        return await this.#createRecipient(request.input);
      case 'lane_holder_package_open_seal_v1':
        return await this.#openAndSeal(request);
      case 'lane_holder_package_verify_v1':
        return await this.#verifyPackage(request);
      case 'lane_holder_recipient_discard_v1':
        await this.#discardRecipient(request.recipientHandle, request.operationId);
        return undefined;
      case 'lane_material_invalidate_v1':
        await this.#invalidateMaterial(request);
        return undefined;
      default:
        return assertNeverLaneWorkerRequest(request);
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    let cleanupError: Error | null = null;
    for (const session of this.#sessions.values()) {
      try {
        await this.#backend.discardLaneHolderRecipientV1({
          recipientHandle: session.descriptor.recipientHandle,
          operationId: session.input.operationId,
        });
      } catch (error) {
        cleanupError ??= workerError(error);
      }
    }
    this.#sessions.clear();
    if (cleanupError) throw cleanupError;
  }

  async #createRecipient(
    input: CreateRecipientInputV1,
  ): Promise<ReturnType<typeof parseCreateResponse>> {
    const descriptor = parseCreateResponse(await this.#backend.createLaneHolderRecipientV1(input));
    const key = sessionKey(descriptor.recipientHandle);
    const existing = this.#sessions.get(key);
    if (existing) {
      await this.#backend
        .discardLaneHolderRecipientV1({
          recipientHandle: existing.descriptor.recipientHandle,
          operationId: existing.input.operationId,
        })
        .catch(ignoreCleanupFailure);
      this.#sessions.delete(key);
      throw new Error('lane holder backend reused an active recipient handle');
    }
    this.#sessions.set(key, { state: 'open', input, descriptor });
    return descriptor;
  }

  async #openAndSeal(
    request: Extract<LaneWorkerChannelRequestV1, { kind: 'lane_holder_package_open_seal_v1' }>,
  ): Promise<ReturnType<typeof parseSealResponse>> {
    const key = sessionKey(request.recipientHandle);
    const session = this.#sessions.get(key);
    if (!session) throw new Error('lane holder recipient handle is unknown or discarded');
    if (session.state !== 'open') {
      throw new Error(`lane holder recipient cannot seal from ${session.state} state`);
    }
    session.state = 'sealing';
    try {
      assertProtocolCommitMatchesExactJob(request.job, request.protocolCommitReceipt);
      assertHolderPackageFamily(request.job, request.holderPackage);
      await assertRecipientSessionMatchesJob(session, request.job);
      const sealed = parseSealResponse(
        await this.#backend.openAndSealLaneHolderPackageV1({
          job: request.job,
          protocolCommitReceipt: request.protocolCommitReceipt,
          holderPackage: request.holderPackage,
          recipientHandle: request.recipientHandle,
        }),
      );
      assertVerifiedHolderDigest(
        request.protocolCommitReceipt,
        sealed.verifiedHolderCiphertextDigestSetB64u,
      );
      session.state = 'sealed';
      return sealed;
    } catch (error) {
      await this.#backend
        .discardLaneHolderRecipientV1({
          recipientHandle: session.descriptor.recipientHandle,
          operationId: session.input.operationId,
        })
        .catch(ignoreCleanupFailure);
      this.#sessions.delete(key);
      throw workerError(error);
    }
  }

  async #verifyPackage(
    request: Extract<LaneWorkerChannelRequestV1, { kind: 'lane_holder_package_verify_v1' }>,
  ): Promise<ReturnType<typeof parseVerifyResponse>> {
    assertProtocolCommitMatchesExactJob(request.job, request.protocolCommitReceipt);
    assertHolderPackageFamily(request.job, request.holderPackage);
    const verified = parseVerifyResponse(
      await this.#backend.verifyLaneHolderPackageCommitmentV1({
        job: request.job,
        protocolCommitReceipt: request.protocolCommitReceipt,
        holderPackage: request.holderPackage,
      }),
    );
    assertVerifiedHolderDigest(
      request.protocolCommitReceipt,
      verified.verifiedHolderCiphertextDigestSetB64u,
    );
    return verified;
  }

  async #discardRecipient(
    recipientHandle: LaneHolderRecipientHandleV1,
    operationId: LaneOperationId,
  ): Promise<void> {
    const key = sessionKey(recipientHandle);
    const session = this.#sessions.get(key);
    if (!session) return;
    if (String(session.input.operationId) !== String(operationId)) {
      throw new Error('lane holder recipient discard has the wrong operation');
    }
    if (session.state === 'sealing') {
      throw new Error('lane holder recipient cannot be discarded while sealing');
    }
    await this.#backend.discardLaneHolderRecipientV1({ recipientHandle, operationId });
    this.#sessions.delete(key);
  }

  async #invalidateMaterial(
    request: Extract<LaneWorkerChannelRequestV1, { kind: 'lane_material_invalidate_v1' }>,
  ): Promise<void> {
    await this.#backend.invalidateLaneMaterialV1({
      walletKeyId: request.walletKeyId,
      laneId: request.laneId,
      laneShareEpoch: request.laneShareEpoch,
      materialActivation: request.materialActivation,
    });
    for (const [key, session] of this.#sessions) {
      if (
        String(session.input.walletKeyId) !== String(request.walletKeyId) ||
        String(session.input.targetLaneId) !== String(request.laneId) ||
        String(session.input.targetLaneShareEpoch) !== String(request.laneShareEpoch) ||
        String(session.input.targetMaterialActivationId) !==
          String(request.materialActivation.activationId)
      ) {
        continue;
      }
      await this.#backend.discardLaneHolderRecipientV1({
        recipientHandle: session.descriptor.recipientHandle,
        operationId: session.input.operationId,
      });
      this.#sessions.delete(key);
    }
  }
}

function ignoreCleanupFailure(): void {}

function assertNeverLaneWorkerRequest(value: never): never {
  throw new Error(`unsupported lane holder worker request: ${String(value)}`);
}

export function createAuthorizedLaneHolderWorkerRequestHandlerV1(
  authorizedBackend: LaneHolderRecipientWorkerV1,
): AuthorizedLaneHolderWorkerRequestHandlerV1 {
  return new AuthorizedLaneHolderWorkerRequestHandler(authorizedBackend);
}

type LaneHolderWorkerRequestFrameV1 = {
  readonly id: string;
  readonly request: unknown;
};

type LaneHolderWorkerRequestFrameRecordV1 = {
  readonly id: unknown;
  readonly request: unknown;
};

function isLaneHolderWorkerRequestFrameRecordV1(
  value: unknown,
): value is LaneHolderWorkerRequestFrameRecordV1 {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === 'id|request'
  );
}

function parseLaneHolderWorkerRequestFrameV1(value: unknown): LaneHolderWorkerRequestFrameV1 {
  if (!isLaneHolderWorkerRequestFrameRecordV1(value)) {
    throw new Error('lane holder worker frame has invalid fields');
  }
  const frame = value;
  const id = nonEmpty(frame.id, 'lane holder worker frame.id');
  if (id.length > 256) throw new Error('lane holder worker frame.id is too long');
  return { id, request: frame.request };
}

class InstalledLaneHolderWorkerRequestHandler implements InstalledLaneHolderWorkerRequestHandlerV1 {
  readonly #scope: LaneHolderWorkerRequestScopeV1;
  readonly #handler: AuthorizedLaneHolderWorkerRequestHandlerV1;
  readonly #listener: (event: MessageEvent) => void;
  #closed = false;

  constructor(
    scope: LaneHolderWorkerRequestScopeV1,
    handler: AuthorizedLaneHolderWorkerRequestHandlerV1,
  ) {
    this.#scope = scope;
    this.#handler = handler;
    this.#listener = this.#onMessage.bind(this);
    this.#scope.addEventListener('message', this.#listener);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#scope.removeEventListener('message', this.#listener);
    await this.#handler.close();
  }

  #onMessage(event: MessageEvent): void {
    void this.#respond(event.data);
  }

  async #respond(value: unknown): Promise<void> {
    let id: string | null = null;
    try {
      const frame = parseLaneHolderWorkerRequestFrameV1(value);
      id = frame.id;
      const result = await this.#handler.request(frame.request);
      this.#scope.postMessage({ id, ok: true, result } satisfies LaneWorkerResponseFrameV1);
    } catch (error) {
      if (id) {
        this.#scope.postMessage({
          id,
          ok: false,
          error: workerError(error).message,
        } satisfies LaneWorkerResponseFrameV1);
      }
    }
  }
}

export function installAuthorizedLaneHolderWorkerRequestHandlerV1(args: {
  readonly scope: LaneHolderWorkerRequestScopeV1;
  readonly authorizedBackend: LaneHolderRecipientWorkerV1;
}): InstalledLaneHolderWorkerRequestHandlerV1 {
  return new InstalledLaneHolderWorkerRequestHandler(
    args.scope,
    createAuthorizedLaneHolderWorkerRequestHandlerV1(args.authorizedBackend),
  );
}

function normalizeTimeout(value: number | undefined): number {
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  return 60_000;
}

function createDefaultLaneHolderWorkerEndpoint(): LaneHolderWorkerEndpointV1 {
  throw new Error(
    'lane holder worker endpoint is not registered; provide the authenticated worker endpoint',
  );
}
