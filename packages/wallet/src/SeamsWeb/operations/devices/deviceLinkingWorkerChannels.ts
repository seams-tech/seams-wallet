import {
  encodeLinkedDeviceRequestProofV1,
  parseLinkedDeviceEmailOtpFactorReleaseEnvelopeV1,
  parseLinkedDeviceEmailOtpVerificationGrantV1,
  parseLinkDevicePublicKeyB64u,
  parseLinkedDeviceWalletSessionCredentialDeliveryV1,
  parseLinkedDeviceWalletSessionCredentialDeliveryBindingV1,
  parseWalletSessionOperationCredentialV1,
  type LinkedDeviceEmailOtpFactorReleaseEnvelopeV1,
  type LinkedDeviceEmailOtpVerificationGrantV1,
  type LinkedDeviceRequestProofV1,
  type LinkedDeviceWalletSessionCredentialDeliveryV1,
} from '@shared/device-linking';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { parseDigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  parseLinkedDeviceEnrollmentId,
  parseLinkedDeviceId,
  parseLinkDeviceSessionId,
  type LinkDeviceSessionId,
  type LinkedDeviceEnrollmentId,
  type LinkedDeviceId,
} from '@shared/signing-lanes/ids';
import {
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  parseWalletId,
  type WalletAuthMethodId,
  type WalletId,
} from '@shared/utils/domainIds';
import { resolveWorkerUrl } from '@/core/walletRuntimePaths';
import {
  createDeviceLinkingOrdinaryMaterialWorkerPortV1,
  type DeviceLinkingOrdinaryMaterialWorkerPortV1,
  type DeviceLinkingOrdinaryMaterialWorkerPrivateRequestV1,
  type DeviceLinkingOrdinaryMaterialWorkerRequestV1,
} from './deviceLinkingOrdinaryMaterialWorker';
import type {
  DeviceLinkingEmailOtpFactorReleasePortV1,
  DeviceLinkingEmailOtpFactorReleaseResultV1,
  DeviceLinkingKeyMaterialHandleV1,
  DeviceLinkingKeyMaterialPortV1,
  DeviceLinkingKeyMaterialBundleV1,
  DeviceLinkingWalletSessionCredentialDeliveryOpenInputV1,
} from './deviceLinkingPorts';

export type DeviceLinkingWorkerEndpointV1 = {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  terminate(): void;
};

export type DeviceLinkingWorkerKeyMaterialPortV1 = DeviceLinkingKeyMaterialPortV1 & {
  close(): void;
} & DeviceLinkingEmailOtpFactorReleasePortV1 &
  DeviceLinkingOrdinaryMaterialWorkerPortV1;

type DeviceLinkingWorkerRequestV1 =
  | DeviceLinkingOrdinaryMaterialWorkerRequestV1
  | DeviceLinkingOrdinaryMaterialWorkerPrivateRequestV1
  | { readonly kind: 'device_linking_key_material_create_v1' }
  | {
      readonly kind: 'device_linking_email_otp_export_root_recipient_create_v1';
      readonly handleId: string;
    }
  | {
      readonly kind: 'device_linking_email_otp_factor_release_open_v1';
      readonly handleId: string;
      readonly walletId: WalletId;
      readonly linkSessionId: LinkDeviceSessionId;
      readonly enrollmentId: LinkedDeviceEnrollmentId;
      readonly deviceId: LinkedDeviceId;
      readonly walletAuthMethodId: WalletAuthMethodId;
      readonly baseWalletAuthMethodId: WalletAuthMethodId;
      readonly targetPreparationDigestB64u: DigestB64u;
      readonly expectedChallengeId: string;
      readonly verificationGrant: LinkedDeviceEmailOtpVerificationGrantV1;
      readonly factorRelease: LinkedDeviceEmailOtpFactorReleaseEnvelopeV1;
    }
  | {
      readonly kind: 'device_linking_wallet_session_credential_delivery_open_v1';
      readonly handleId: string;
      readonly delivery: LinkedDeviceWalletSessionCredentialDeliveryV1;
      readonly expected: DeviceLinkingWalletSessionCredentialDeliveryOpenInputV1['expected'];
    }
  | {
      readonly kind: 'device_linking_request_sign_v1';
      readonly handleId: string;
      readonly linkSessionId: LinkDeviceSessionId;
      readonly method: 'GET' | 'POST';
      readonly canonicalPath: string;
      readonly bodyDigestB64u: DigestB64u;
      readonly devicePublicKeyDigestB64u: DigestB64u;
      readonly challengeB64u: string;
      readonly issuedAtMs: number;
      readonly expiresAtMs: number;
    }
  | {
      readonly kind: 'device_linking_key_material_discard_v1';
      readonly handleId: string;
    };

type DeviceLinkingWorkerResponseFrameV1 =
  | { readonly id: string; readonly ok: true; readonly result: unknown }
  | { readonly id: string; readonly ok: false; readonly error: string };

type PendingRequestV1 = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeoutId: ReturnType<typeof setTimeout>;
};

type DeviceLinkingKeyHandleRecordV1 = {
  readonly kind: unknown;
  readonly handleId: unknown;
};

function isDeviceLinkingKeyHandleRecordV1(value: unknown): value is DeviceLinkingKeyHandleRecordV1 {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === 'handleId|kind'
  );
}

type DeviceLinkingKeyCreateResultRecordV1 = {
  readonly handleId: unknown;
  readonly linkPublicKeyB64u: unknown;
  readonly devicePublicKeyB64u: unknown;
  readonly deliveryRecipientPublicKey65B64u: unknown;
};

function isDeviceLinkingKeyCreateResultRecordV1(
  value: unknown,
): value is DeviceLinkingKeyCreateResultRecordV1 {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('|') ===
      'deliveryRecipientPublicKey65B64u|devicePublicKeyB64u|handleId|linkPublicKeyB64u'
  );
}

type DeviceLinkingEmailOtpFactorReleaseResultRecordV1 = {
  readonly kind: unknown;
  readonly verificationGrant: unknown;
  readonly factorSecret: unknown;
};

function isDeviceLinkingEmailOtpFactorReleaseResultRecordV1(
  value: unknown,
): value is DeviceLinkingEmailOtpFactorReleaseResultRecordV1 {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === 'factorSecret|kind|verificationGrant'
  );
}

type DeviceLinkingRequestSignatureResultRecordV1 = {
  readonly signatureB64u: unknown;
};

function isDeviceLinkingRequestSignatureResultRecordV1(
  value: unknown,
): value is DeviceLinkingRequestSignatureResultRecordV1 {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === 'signatureB64u'
  );
}

type DeviceLinkingWorkerSuccessFrameRecordV1 = {
  readonly id: unknown;
  readonly ok: true;
  readonly result: unknown;
};

function isDeviceLinkingWorkerSuccessFrameRecordV1(
  value: unknown,
): value is DeviceLinkingWorkerSuccessFrameRecordV1 {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === 'id|ok|result' &&
    'ok' in value &&
    value.ok === true
  );
}

type DeviceLinkingWorkerFailureFrameRecordV1 = {
  readonly id: unknown;
  readonly ok: false;
  readonly error: unknown;
};

function isDeviceLinkingWorkerFailureFrameRecordV1(
  value: unknown,
): value is DeviceLinkingWorkerFailureFrameRecordV1 {
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
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function parseDigest(value: unknown, label: string): DigestB64u {
  try {
    return parseDigestB64u(value);
  } catch (error) {
    throw new Error(`${label} ${error instanceof Error ? error.message : 'is invalid'}`);
  }
}

function parseFixedB64u(value: unknown, length: number, label: string): string {
  const encoded = nonEmpty(value, label);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error(`${label} is invalid`);
  let bytes: Uint8Array;
  try {
    bytes = base64UrlDecode(encoded);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (bytes.length !== length || base64UrlEncode(bytes) !== encoded) {
    throw new Error(`${label} must be canonical base64url`);
  }
  bytes.fill(0);
  return encoded;
}

function parseHandle(value: unknown): DeviceLinkingKeyMaterialHandleV1 {
  if (!isDeviceLinkingKeyHandleRecordV1(value)) {
    throw new Error('device-linking key handle has invalid fields');
  }
  const record = value;
  if (record.kind !== 'device_linking_key_material_handle_v1') {
    throw new Error('device-linking key handle kind is invalid');
  }
  return {
    kind: 'device_linking_key_material_handle_v1',
    handleId: nonEmpty(record.handleId, 'device-linking key handle.handleId'),
  };
}

function parseCreateResult(value: unknown): DeviceLinkingKeyMaterialBundleV1 {
  if (!isDeviceLinkingKeyCreateResultRecordV1(value)) {
    throw new Error('device-linking key create response has invalid fields');
  }
  const record = value;
  return {
    handle: {
      kind: 'device_linking_key_material_handle_v1',
      handleId: nonEmpty(record.handleId, 'device-linking key create handleId'),
    },
    linkPublicKeyB64u: parseLinkDevicePublicKeyB64u(record.linkPublicKeyB64u),
    devicePublicKeyB64u: parseLinkDevicePublicKeyB64u(record.devicePublicKeyB64u),
    deliveryRecipientPublicKey65B64u: parseFixedB64u(
      record.deliveryRecipientPublicKey65B64u,
      65,
      'deliveryRecipientPublicKey65B64u',
    ),
  };
}

function parseEmailOtpFactorReleaseResult(
  value: unknown,
): DeviceLinkingEmailOtpFactorReleaseResultV1 {
  if (!isDeviceLinkingEmailOtpFactorReleaseResultRecordV1(value)) {
    throw new Error('device-linking Email OTP factor release response has invalid fields');
  }
  const record = value;
  if (record.kind !== 'device_linking_email_otp_factor_release_result_v1') {
    throw new Error('device-linking Email OTP factor release response kind is invalid');
  }
  if (!(record.factorSecret instanceof ArrayBuffer) || record.factorSecret.byteLength !== 32) {
    throw new Error('device-linking Email OTP factor release secret is invalid');
  }
  return {
    kind: 'device_linking_email_otp_factor_release_result_v1',
    verificationGrant: parseLinkedDeviceEmailOtpVerificationGrantV1(record.verificationGrant),
    factorSecret: record.factorSecret,
  };
}

function parseWalletSessionCredentialDeliveryResult(value: unknown) {
  return parseWalletSessionOperationCredentialV1(value);
}

function parseSignatureResult(value: unknown): { readonly signatureB64u: string } {
  if (!isDeviceLinkingRequestSignatureResultRecordV1(value)) {
    throw new Error('device-linking request signature response has invalid fields');
  }
  const record = value;
  return {
    signatureB64u: parseFixedB64u(record.signatureB64u, 64, 'signatureB64u'),
  };
}

function parseResponseFrame(value: unknown): DeviceLinkingWorkerResponseFrameV1 | null {
  if (isDeviceLinkingWorkerSuccessFrameRecordV1(value)) {
    const id = value.id;
    if (typeof id !== 'string' || id.trim() !== id || id.length === 0) return null;
    return { id, ok: true, result: value.result };
  }
  if (isDeviceLinkingWorkerFailureFrameRecordV1(value)) {
    const id = value.id;
    if (typeof id !== 'string' || id.trim() !== id || id.length === 0) return null;
    if (typeof value.error !== 'string' || !value.error.trim()) return null;
    return { id, ok: false, error: value.error };
  }
  return null;
}

function requestId(): string {
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
    throw new Error('secure randomness is unavailable for device-linking worker');
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const id = `device-linking-${base64UrlEncode(bytes)}`;
  bytes.fill(0);
  return id;
}

function normalizeTimeout(value: number | undefined): number {
  if (value !== undefined && Number.isSafeInteger(value) && value > 0) return value;
  return 60_000;
}

function workerError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string' && value.trim()) return new Error(value);
  return new Error('device-linking worker failed');
}

function createDefaultEndpoint(): DeviceLinkingWorkerEndpointV1 {
  if (typeof Worker === 'undefined') {
    throw new Error(
      'device-linking worker is unavailable; provide an authenticated worker endpoint',
    );
  }
  const url = resolveWorkerUrl(undefined, { worker: 'deviceLinking' });
  return new Worker(url, { type: 'module' });
}

function assertCanonicalPath(value: string): string {
  if (
    !value.startsWith('/') ||
    value.includes('?') ||
    value.includes('#') ||
    value.trim() !== value
  ) {
    throw new Error('canonicalPath is invalid');
  }
  return value;
}

function assertTimestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} is invalid`);
  return value;
}

function buildRequest(
  input: Parameters<DeviceLinkingKeyMaterialPortV1['signDeviceSessionRequestV1']>[0],
): DeviceLinkingWorkerRequestV1 {
  const parsedSession = parseLinkDeviceSessionId(input.linkSessionId);
  if (!parsedSession.ok) throw new Error(parsedSession.error.message);
  if (input.method !== 'GET' && input.method !== 'POST') throw new Error('method is invalid');
  const expiresAtMs = assertTimestamp(input.expiresAtMs, 'expiresAtMs');
  const issuedAtMs = assertTimestamp(input.issuedAtMs, 'issuedAtMs');
  if (expiresAtMs <= issuedAtMs) throw new Error('expiresAtMs must be after issuedAtMs');
  return {
    kind: 'device_linking_request_sign_v1',
    handleId: nonEmpty(input.handle.handleId, 'handle.handleId'),
    linkSessionId: parsedSession.value,
    method: input.method,
    canonicalPath: assertCanonicalPath(input.canonicalPath),
    bodyDigestB64u: parseDigest(input.bodyDigestB64u, 'bodyDigestB64u'),
    devicePublicKeyDigestB64u: parseDigest(
      input.devicePublicKeyDigestB64u,
      'devicePublicKeyDigestB64u',
    ),
    challengeB64u: parseFixedB64u(input.challengeB64u, 32, 'challengeB64u'),
    issuedAtMs,
    expiresAtMs,
  };
}

/**
 * Creates the browser-side bridge to the device-linking worker. Frames only
 * contain public keys, opaque handles, canonical request fields, and opaque
 * signatures. Private CryptoKeys never leave the worker.
 */
export function createDeviceLinkingKeyMaterialPortV1(
  args: {
    readonly endpoint?: DeviceLinkingWorkerEndpointV1;
    readonly timeoutMs?: number;
  } = {},
): DeviceLinkingWorkerKeyMaterialPortV1 {
  const timeoutMs = normalizeTimeout(args.timeoutMs);
  const pending = new Map<string, PendingRequestV1>();
  let endpoint: DeviceLinkingWorkerEndpointV1 | null = args.endpoint ?? null;
  let closed = false;

  const onMessage = (event: MessageEvent): void => {
    const frame = parseResponseFrame(event.data);
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
  const bindEndpoint = (nextEndpoint: DeviceLinkingWorkerEndpointV1): void => {
    nextEndpoint.addEventListener('message', onMessage);
    nextEndpoint.addEventListener('error', onError);
  };

  if (args.endpoint) {
    bindEndpoint(args.endpoint);
    endpoint = args.endpoint;
  }

  const ensureEndpoint = (): DeviceLinkingWorkerEndpointV1 => {
    if (endpoint) return endpoint;
    const created = createDefaultEndpoint();
    try {
      bindEndpoint(created);
      endpoint = created;
      return created;
    } catch (error) {
      created.terminate();
      throw error;
    }
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    const currentEndpoint = endpoint;
    currentEndpoint?.removeEventListener('message', onMessage);
    currentEndpoint?.removeEventListener('error', onError);
    const error = new Error('device-linking worker transport is closed');
    for (const [id, request] of pending) {
      clearTimeout(request.timeoutId);
      pending.delete(id);
      request.reject(error);
    }
    currentEndpoint?.terminate();
    endpoint = null;
  };

  const request = (
    input: DeviceLinkingWorkerRequestV1,
    transfer?: Transferable[],
  ): Promise<unknown> => {
    if (closed) return Promise.reject(new Error('device-linking worker transport is closed'));
    let activeEndpoint: DeviceLinkingWorkerEndpointV1;
    try {
      activeEndpoint = ensureEndpoint();
    } catch (error) {
      return Promise.reject(workerError(error));
    }
    const id = requestId();
    return new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`device-linking worker request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timeoutId });
      try {
        activeEndpoint.postMessage({ id, request: input }, transfer);
      } catch (error) {
        clearTimeout(timeoutId);
        pending.delete(id);
        reject(workerError(error));
      }
    });
  };

  const ordinaryMaterial = createDeviceLinkingOrdinaryMaterialWorkerPortV1(request);

  return {
    ...ordinaryMaterial,
    close,
    async createBootstrapKeyMaterialV1() {
      return parseCreateResult(await request({ kind: 'device_linking_key_material_create_v1' }));
    },
    async discardKeyMaterialV1(input) {
      const handle = parseHandle(input.handle);
      await request({ kind: 'device_linking_key_material_discard_v1', handleId: handle.handleId });
    },
    async openEmailOtpFactorReleaseV1(input) {
      const handle = parseHandle(input.keyMaterial);
      const walletId = parseWalletId(input.walletId);
      if (!walletId.ok) throw new Error(walletId.error.message);
      const linkSessionId = parseLinkDeviceSessionId(input.linkSessionId);
      if (!linkSessionId.ok) throw new Error(linkSessionId.error.message);
      const enrollmentId = parseLinkedDeviceEnrollmentId(input.enrollmentId);
      if (!enrollmentId.ok) throw new Error(enrollmentId.error.message);
      const deviceId = parseLinkedDeviceId(input.deviceId);
      if (!deviceId.ok) throw new Error(deviceId.error.message);
      const walletAuthMethodId = parseWalletAuthMethodId(input.walletAuthMethodId);
      if (!walletAuthMethodId.ok) throw new Error(walletAuthMethodId.error.message);
      const baseWalletAuthMethodId = parseWalletAuthMethodId(input.baseWalletAuthMethodId);
      if (!baseWalletAuthMethodId.ok) throw new Error(baseWalletAuthMethodId.error.message);
      const targetPreparationDigestB64u = parseDigest(
        input.targetPreparationDigestB64u,
        'targetPreparationDigestB64u',
      );
      const expectedChallengeId = nonEmpty(input.expectedChallengeId, 'expectedChallengeId');
      const verificationGrant = parseLinkedDeviceEmailOtpVerificationGrantV1(
        input.verificationGrant,
      );
      const factorRelease = parseLinkedDeviceEmailOtpFactorReleaseEnvelopeV1(input.factorRelease);
      return parseEmailOtpFactorReleaseResult(
        await request({
          kind: 'device_linking_email_otp_factor_release_open_v1',
          handleId: handle.handleId,
          walletId: walletId.value,
          linkSessionId: linkSessionId.value,
          enrollmentId: enrollmentId.value,
          deviceId: deviceId.value,
            walletAuthMethodId: walletAuthMethodId.value,
          baseWalletAuthMethodId: baseWalletAuthMethodId.value,
          targetPreparationDigestB64u,
          expectedChallengeId,
          verificationGrant,
          factorRelease,
        }),
      );
    },
    async openWalletSessionCredentialDeliveryV1(input) {
      const handle = parseHandle(input.keyMaterial);
      const delivery = parseLinkedDeviceWalletSessionCredentialDeliveryV1(input.delivery);
      const expected = input.expected;
      const walletId = parseWalletId(expected.walletId);
      if (!walletId.ok) throw new Error(walletId.error.message);
      const authorityId = parseWalletAuthorityId(expected.authorityId);
      if (!authorityId.ok) throw new Error(authorityId.error.message);
      const linkSessionId = parseLinkDeviceSessionId(expected.linkSessionId);
      if (!linkSessionId.ok) throw new Error(linkSessionId.error.message);
      const walletAuthMethodId = parseWalletAuthMethodId(expected.walletAuthMethodId);
      if (!walletAuthMethodId.ok) throw new Error(walletAuthMethodId.error.message);
      return parseWalletSessionCredentialDeliveryResult(
        await request({
          kind: 'device_linking_wallet_session_credential_delivery_open_v1',
          handleId: handle.handleId,
          delivery,
          expected: {
            ...expected,
            linkSessionId: linkSessionId.value,
            walletId: walletId.value,
            authorityId: authorityId.value,
          walletAuthMethodId: walletAuthMethodId.value,
            deliveryBinding: parseLinkedDeviceWalletSessionCredentialDeliveryBindingV1(
              expected.deliveryBinding,
            ),
          },
        }),
      );
    },
    async signDeviceSessionRequestV1(input) {
      const requestInput = buildRequest(input);
      return parseSignatureResult(await request(requestInput));
    },
  };
}

/** Builds the exact bytes used by the worker before Ed25519 signing. */
export function encodeDeviceLinkingRequestForWorkerV1(input: {
  readonly linkSessionId: LinkDeviceSessionId;
  readonly devicePublicKeyDigestB64u: DigestB64u;
  readonly bodyDigestB64u: DigestB64u;
  readonly method: 'GET' | 'POST';
  readonly canonicalPath: string;
  readonly challengeB64u: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}): Uint8Array {
  const zeroSignature = new Uint8Array(64);
  const proof: LinkedDeviceRequestProofV1 = {
    kind: 'linked_device_request_proof_v1',
    linkSessionId: input.linkSessionId,
    devicePublicKeyDigestB64u: input.devicePublicKeyDigestB64u,
    requestNonceB64u: input.challengeB64u,
    method: input.method,
    canonicalPath: input.canonicalPath,
    bodyDigestB64u: input.bodyDigestB64u,
    issuedAtMs: input.issuedAtMs,
    expiresAtMs: input.expiresAtMs,
    signatureB64u: base64UrlEncode(zeroSignature),
  };
  const encoded = encodeLinkedDeviceRequestProofV1(proof);
  zeroSignature.fill(0);
  return encoded;
}
